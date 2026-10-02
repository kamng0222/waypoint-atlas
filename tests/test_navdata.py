"""Meaningful graph, cache, and HTTP regression tests using a miniature database."""
import gzip
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import closing
from http.server import ThreadingHTTPServer
from pathlib import Path

from app import make_handler
from navdata import NavData, connect, valid_coordinate


def fixture(path):
    with closing(sqlite3.connect(path)) as c:
        c.executescript("""
          CREATE TABLE metadata(airac_cycle TEXT,data_source TEXT);
          INSERT INTO metadata VALUES('TEST','FIXTURE');
          CREATE TABLE waypoint(waypoint_id INTEGER PRIMARY KEY,ident TEXT,region TEXT,
            lonx REAL,laty REAL,type TEXT,airport_ident TEXT);
          INSERT INTO waypoint VALUES(1,'SAME','AA',179.5,20,'W',NULL);
          INSERT INTO waypoint VALUES(2,'SAME','BB',-179.5,20,'W',NULL);
          INSERT INTO waypoint VALUES(3,'ALONE','AA',115,22,'W',NULL);
          INSERT INTO waypoint VALUES(4,'BAD','AA',200,22,'W',NULL);
          CREATE TABLE airway(airway_id INTEGER PRIMARY KEY,from_waypoint_id INTEGER,
            to_waypoint_id INTEGER,airway_name TEXT,airway_type TEXT,direction TEXT,
            minimum_altitude INTEGER,maximum_altitude INTEGER,airway_fragment_no INTEGER,
            sequence_no INTEGER,from_lonx REAL,from_laty REAL,to_lonx REAL,to_laty REAL,route_type TEXT);
          INSERT INTO airway VALUES(10,1,2,'A1','J','F',10000,99999,1,1,179.5,20,-179.5,20,'R');
          INSERT INTO airway VALUES(11,2,1,'A1','V','B',5000,15000,2,1,-179.5,20,179.5,20,'R');
          INSERT INTO airway VALUES(12,1,999,'BAD','B','N',0,99999,1,1,179.5,20,0,0,'R');
        """)


class FixtureCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.database = self.root / "source with spaces.sqlite"
        fixture(self.database)
        self.data = NavData(self.database, self.root / "cache")
        self.network = json.loads(self.data.network_bytes)

    def tearDown(self):
        self.temp.cleanup()


class DataTests(FixtureCase):
    def test_duplicate_names_keep_distinct_ids(self):
        points = self.data.search("SAME")["waypoints"]
        self.assertEqual({p["id"] for p in points}, {1, 2})
        self.assertEqual({p["region"] for p in points}, {"AA", "BB"})

    def test_export_preserves_dateline_and_direction(self):
        first, second = self.network["segments"]
        self.assertEqual(first[10:14], [179.5, 20.0, -179.5, 20.0])
        self.assertEqual([first[5], second[5]], ["F", "B"])
        self.assertEqual([first[8], second[8]], [1, 2])

    def test_invalid_records_reported_without_inventing_connections(self):
        stats = self.data.manifest["stats"]
        self.assertEqual(stats["waypoints"], 3)
        self.assertEqual(stats["segments"], 2)
        self.assertEqual(stats["connected_waypoints"], 2)
        self.assertEqual(stats["isolated_waypoints"], 1)
        self.assertEqual(stats["excluded_invalid_waypoints"], 1)
        self.assertEqual(stats["excluded_invalid_segments"], 1)
        self.assertEqual(self.data.waypoint(3)["connections"], [])

    def test_readonly_source(self):
        c = connect(self.database)
        with self.assertRaises(sqlite3.OperationalError):
            c.execute("DELETE FROM waypoint")
        c.close()
        self.assertEqual(self.data.manifest["stats"]["waypoints"], 3)

    def test_source_changes_invalidate_cache(self):
        with closing(sqlite3.connect(self.database)) as c:
            c.execute("INSERT INTO waypoint VALUES(5,'NEW','AA',0,0,'W',NULL)")
            c.commit()
        updated = NavData(self.database, self.root / "cache")
        self.assertEqual(updated.manifest["stats"]["waypoints"], 4)

    def test_cache_reused_when_source_unchanged(self):
        original = self.data.network_path.stat().st_mtime_ns
        NavData(self.database, self.root / "cache")
        self.assertEqual(original, self.data.network_path.stat().st_mtime_ns)

    def test_missing_gzip_rebuilt(self):
        self.data.gzip_path.unlink()
        rebuilt = NavData(self.database, self.root / "cache")
        self.assertEqual(gzip.decompress(rebuilt.gzip_bytes), rebuilt.network_bytes)

    def test_literal_wildcards_and_injection(self):
        for value in ["%", "_", "' OR 1=1 --"]:
            self.assertEqual(self.data.search(value), {"waypoints": [], "airways": []})

    def test_waypoint_connections_are_incident(self):
        detail = self.data.waypoint(1)
        self.assertEqual(len(detail["connections"]), 2)
        self.assertTrue(all(1 in (row["from_waypoint_id"], row["to_waypoint_id"]) for row in detail["connections"]))
        self.assertIsNone(self.data.waypoint(999))

    def test_airway_fragments_remain_separate(self):
        result = self.data.airway("a1")
        self.assertEqual(result["name"], "A1")
        self.assertEqual([s["airway_fragment_no"] for s in result["segments"]], [1, 2])

    def test_gzip_has_identical_records(self):
        self.assertEqual(gzip.decompress(self.data.gzip_bytes), self.data.network_bytes)

    def test_coordinate_validation(self):
        for lon, lat in [(float("nan"), 0), (0, float("inf")), (181, 0), (0, 91), (None, 0)]:
            self.assertFalse(valid_coordinate(lon, lat))
        self.assertTrue(valid_coordinate(-180, -90))
        self.assertTrue(valid_coordinate(180, 90))


class HttpTests(FixtureCase):
    def setUp(self):
        super().setUp()
        web = self.root / "web"
        web.mkdir()
        (web / "index.html").write_text("<h1>Atlas</h1>", encoding="utf-8")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.data, web))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        super().tearDown()

    def get(self, path, headers=None):
        return urllib.request.urlopen(urllib.request.Request(self.url + path, headers=headers or {}))

    def test_http_gzip_negotiation(self):
        with self.get("/api/network", {"Accept-Encoding": "gzip"}) as response:
            self.assertEqual(response.headers["Content-Encoding"], "gzip")
            self.assertEqual(gzip.decompress(response.read()), self.data.network_bytes)
        with self.get("/api/network", {"Accept-Encoding": "gzip;q=0"}) as response:
            self.assertIsNone(response.headers.get("Content-Encoding"))
            self.assertEqual(response.read(), self.data.network_bytes)
        with self.get("/api/network", {"Accept-Encoding": "gzip;q=0.5"}) as response:
            self.assertEqual(response.headers["Content-Encoding"], "gzip")

    def test_http_etag(self):
        with self.get("/api/network") as response:
            etag = response.headers["ETag"]
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.get("/api/network", {"If-None-Match": etag})
        self.assertEqual(error.exception.code, 304)

    def test_http_traversal_and_missing_endpoint(self):
        for path in ["/%2e%2e/source%20with%20spaces.sqlite", "/api/missing", "/api/waypoint/999"]:
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.get(path)
            self.assertEqual(error.exception.code, 404)

    def test_http_invalid_id(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.get("/api/waypoint/no-number")
        self.assertEqual(error.exception.code, 400)

    def test_http_detail_and_static(self):
        with self.get("/api/waypoint/1") as response:
            self.assertEqual(json.load(response)["waypoint"]["ident"], "SAME")
        with self.get("/") as response:
            self.assertEqual(response.read(), b"<h1>Atlas</h1>")


if __name__ == "__main__":
    unittest.main()
