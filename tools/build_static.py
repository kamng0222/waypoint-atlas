"""Build a public synthetic demonstration. Never reads Navigraph or cache files."""
import argparse
import json
import random
import shutil
from pathlib import Path

ROOT = Path(__file__).absolute().parents[1]


def synthetic_network():
    randomizer = random.Random(20261002)
    points, edges, hubs = [], [], []
    areas = [
        ("EAS", 80, 140, 10, 52), ("EUR", -12, 38, 35, 62),
        ("NAM", -130, -60, 20, 56), ("SAM", -80, -35, -52, 8),
        ("AFR", -15, 45, -32, 32), ("OCE", 110, 175, -45, -5),
    ]
    types = ["J", "V", "B"]
    def edge(a, b, name, kind, sequence):
        p, q = points[a - 1], points[b - 1]
        edges.append([len(edges) + 1, a, b, name, kind, ["N", "F", "B"][sequence % 3],
                      None, None, 1, sequence, p[3], p[4], q[3], q[4], "DEMO"])
    for area, west, east, south, north in areas:
        ids = []
        for row in range(15):
            line = []
            for column in range(21):
                ident = len(points) + 1
                lon = west + (east - west) * column / 20 + randomizer.uniform(-.4, .4)
                lat = south + (north - south) * row / 14 + randomizer.uniform(-.4, .4)
                points.append([ident, f"DEM{ident:05}", "SX", round(lon, 6), round(lat, 6), "SYNTHETIC"])
                line.append(ident)
            ids.append(line)
        hubs.append(ids[7][10])
        sequence = 0
        for row in range(15):
            for column in range(21):
                neighbours = []
                if column < 20: neighbours.append(ids[row][column + 1])
                if row < 14: neighbours.append(ids[row + 1][column])
                if row < 14 and column < 20 and (row + column) % 3 == 0: neighbours.append(ids[row + 1][column + 1])
                for neighbour in neighbours:
                    kind = types[(row + column) % 3]; sequence += 1
                    edge(ids[row][column], neighbour, f"DEM-{area}-{kind}", kind, sequence)
    for i, start in enumerate(hubs):
        for j, end in enumerate(hubs[i + 1:], i + 1):
            edge(start, end, "DEM-GLOBAL", "J", i * 6 + j)
    # Explicit artificial date-line example, independent of any real data.
    for lon in [176, -176]:
        ident = len(points) + 1
        points.append([ident, f"DEM{ident:05}", "SX", lon, 5, "SYNTHETIC"])
    edge(len(points) - 1, len(points), "DEM-DATE", "B", 1)
    connected = {p for row in edges for p in row[1:3]}
    return {"format_version": 1, "manifest": {
        "metadata": {"airac_cycle": "DEMO", "data_source": "SYNTHETIC"},
        "notice": "SYNTHETIC DEMO: all points and links are invented to demonstrate the viewer. They are not real waypoints or airways.",
        "stats": {"waypoints": len(points), "segments": len(edges), "connected_waypoints": len(connected),
                  "isolated_waypoints": len(points) - len(connected), "excluded_invalid_waypoints": 0, "excluded_invalid_segments": 0}},
        "waypoints": points, "segments": edges}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "public_site")
    args = parser.parse_args()
    output = args.output.absolute()
    if output == ROOT or output == ROOT / "web":
        parser.error("Output must be a separate build directory")
    output.mkdir(parents=True, exist_ok=True)
    if any(p.is_file() for p in output.rglob("*.sqlite")) or (output / "network.json").exists():
        parser.error("Build output contains private navigation data; choose a clean directory")
    # Explicit allowlist prevents copying data, logs, caches or screenshots.
    for name in ["index.html", "app.js", "data-source.js", "style.css"]:
        shutil.copy2(ROOT / "web" / name, output / name)
    html = (output / "index.html").read_text(encoding="utf-8")
    html = html.replace("window.CESIUM_BASE_URL", "window.ATLAS_STATIC = true; window.CESIUM_BASE_URL")
    html = html.replace("Navigraph Atlas", "Waypoint Atlas").replace("NAVIGRAPH <span>", "WAYPOINT <span>")
    html = html.replace("THE WORLD'S WAYPOINT NETWORK", "INTERACTIVE NETWORK EXPLORER")
    html = html.replace("LOCAL EXPLORER", "PUBLIC DEMO").replace("Opening the world's airways", "Opening the synthetic demo")
    html = html.replace("Reading your local Navigraph dataset…", "Loading invented demonstration points and links…")
    (output / "index.html").write_text(html, encoding="utf-8")
    (output / "demo.json").write_text(json.dumps(synthetic_network(), separators=(",", ":")), encoding="utf-8")
    (output / ".nojekyll").touch()
    vendor = ROOT / "web" / "vendor" / "cesium"
    if not (vendor / "Cesium.js").exists():
        parser.error("Run python tools/setup_assets.py before building")
    shutil.copytree(vendor, output / "vendor" / "cesium", dirs_exist_ok=True)
    print(f"Built public synthetic demo: {output}")


if __name__ == "__main__":
    main()
