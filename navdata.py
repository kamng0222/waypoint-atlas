"""Read-only Little Navmap adapter and versioned, lossless network export."""
from __future__ import annotations

import gzip
import json
import math
import os
import sqlite3
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

FORMAT_VERSION = 1
POINT_COLUMNS = ["id", "ident", "region", "lon", "lat", "type"]
EDGE_COLUMNS = ["id", "from", "to", "name", "type", "direction", "minimum_altitude",
                "maximum_altitude", "fragment", "sequence", "from_lon", "from_lat",
                "to_lon", "to_lat", "route_type"]


def connect(database: Path) -> sqlite3.Connection:
    """URI mode=ro prevents accidental modifications to the source database."""
    path = str(database.absolute()).replace("\\", "/")
    # A mapped drive can resolve to UNC. Keep an empty URI authority for SQLite.
    uri = "file:" + ("//" if path.startswith("//") else "") + quote(path, safe="/:")
    connection = sqlite3.connect(uri + "?mode=ro", uri=True)
    connection.execute("PRAGMA query_only=ON")
    connection.row_factory = sqlite3.Row
    return connection


def valid_coordinate(lon: float, lat: float) -> bool:
    return (isinstance(lon, (int, float)) and isinstance(lat, (int, float))
            and math.isfinite(lon) and math.isfinite(lat)
            and -180 <= lon <= 180 and -90 <= lat <= 90)


class NavData:
    def __init__(self, database: Path, cache_dir: Path, rebuild: bool = False):
        self.database = database.absolute()
        if not self.database.is_file():
            raise FileNotFoundError(f"Navigraph database not found: {self.database}")
        self.cache_dir = cache_dir.resolve()
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.network_path = self.cache_dir / "network.json"
        self.gzip_path = self.cache_dir / "network.json.gz"
        self.manifest_path = self.cache_dir / "manifest.json"
        self.signature = {"path": str(self.database), "size": self.database.stat().st_size,
                          "mtime_ns": self.database.stat().st_mtime_ns, "format": FORMAT_VERSION}
        cached = {}
        try:
            cached = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        if rebuild or cached.get("signature") != self.signature or not all(
                p.exists() for p in (self.network_path, self.gzip_path)):
            self._export()
        self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        self.network_bytes = self.network_path.read_bytes()
        self.gzip_bytes = self.gzip_path.read_bytes()

    def _export(self):
        with closing(connect(self.database)) as connection:
            tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {"waypoint", "airway", "metadata"}.issubset(tables):
                raise ValueError("Expected a Little Navmap Navigraph database with waypoint, airway and metadata tables")
            metadata = dict(connection.execute("SELECT * FROM metadata LIMIT 1").fetchone())
            points, edges, bad_points, bad_edges = [], [], 0, 0
            ids = set()
            for row in connection.execute("SELECT waypoint_id,ident,region,lonx,laty,type FROM waypoint ORDER BY waypoint_id"):
                if valid_coordinate(row[3], row[4]):
                    points.append(list(row))
                    ids.add(row[0])
                else:
                    bad_points += 1
            sql = """SELECT airway_id,from_waypoint_id,to_waypoint_id,airway_name,airway_type,
                     direction,minimum_altitude,maximum_altitude,airway_fragment_no,sequence_no,
                     from_lonx,from_laty,to_lonx,to_laty,route_type FROM airway ORDER BY airway_id"""
            for row in connection.execute(sql):
                if row[1] in ids and row[2] in ids and valid_coordinate(row[10], row[11]) and valid_coordinate(row[12], row[13]):
                    edges.append(list(row))
                else:
                    bad_edges += 1
            connected = {endpoint for edge in edges for endpoint in edge[1:3]}
            stats = {
                "waypoints": len(points), "segments": len(edges),
                "connected_waypoints": len(connected), "isolated_waypoints": len(points) - len(connected),
                "airway_names": len({edge[3] for edge in edges}),
                "airway_types": dict(Counter(edge[4] for edge in edges)),
                "directions": dict(Counter(edge[5] for edge in edges)),
                "excluded_invalid_waypoints": bad_points, "excluded_invalid_segments": bad_edges,
            }
            manifest = {"signature": self.signature, "metadata": metadata, "stats": stats,
                        "exported_at": datetime.now(timezone.utc).isoformat(),
                        "waypoint_columns": POINT_COLUMNS, "segment_columns": EDGE_COLUMNS}
            document = {"format_version": FORMAT_VERSION, "manifest": manifest,
                        "waypoints": points, "segments": edges}
            payload = json.dumps(document, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
            self._atomic_write(self.network_path, payload)
            self._atomic_write(self.gzip_path, gzip.compress(payload, compresslevel=6, mtime=0))
            self._atomic_write(self.manifest_path, json.dumps(manifest, indent=2).encode("utf-8"))

    @staticmethod
    def _atomic_write(path: Path, payload: bytes):
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(payload)
        os.replace(temporary, path)

    def search(self, query: str, limit: int = 20) -> dict:
        query = query.strip().upper()[:50]
        if not query:
            return {"waypoints": [], "airways": []}
        # Escape LIKE wildcards, so a user query is literal and never SQL.
        pattern = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        with closing(connect(self.database)) as connection:
            points = connection.execute("""SELECT waypoint_id AS id,ident,region,lonx AS lon,laty AS lat,type
              FROM waypoint WHERE ident LIKE ? ESCAPE '\\'
              ORDER BY CASE WHEN ident=? THEN 0 ELSE 1 END,ident,region,waypoint_id LIMIT ?""", (pattern, query, limit))
            waypoints = [dict(row) for row in points]
            airways = connection.execute("""SELECT airway_name AS name,count(*) AS segments,
              group_concat(DISTINCT airway_type) AS types FROM airway
              WHERE airway_name LIKE ? ESCAPE '\\' GROUP BY airway_name
              ORDER BY CASE WHEN airway_name=? THEN 0 ELSE 1 END,airway_name LIMIT ?""", (pattern, query, limit))
            return {"waypoints": waypoints, "airways": [dict(row) for row in airways]}

    def waypoint(self, waypoint_id: int) -> dict | None:
        with closing(connect(self.database)) as connection:
            row = connection.execute("SELECT * FROM waypoint WHERE waypoint_id=?", (waypoint_id,)).fetchone()
            if row is None:
                return None
            edges = connection.execute("""SELECT a.*,f.ident AS from_ident,f.region AS from_region,
              t.ident AS to_ident,t.region AS to_region FROM airway a
              JOIN waypoint f ON f.waypoint_id=a.from_waypoint_id
              JOIN waypoint t ON t.waypoint_id=a.to_waypoint_id
              WHERE a.from_waypoint_id=? OR a.to_waypoint_id=? ORDER BY airway_name,airway_fragment_no,sequence_no""",
                                       (waypoint_id, waypoint_id))
            return {"waypoint": dict(row), "connections": [dict(edge) for edge in edges]}

    def airway(self, name: str) -> dict:
        with closing(connect(self.database)) as connection:
            rows = connection.execute("""SELECT a.*,f.ident AS from_ident,f.region AS from_region,
              t.ident AS to_ident,t.region AS to_region FROM airway a
              JOIN waypoint f ON f.waypoint_id=a.from_waypoint_id
              JOIN waypoint t ON t.waypoint_id=a.to_waypoint_id WHERE airway_name=?
              ORDER BY airway_fragment_no,sequence_no,airway_id""", (name.strip().upper(),))
            return {"name": name.strip().upper(), "segments": [dict(row) for row in rows]}
