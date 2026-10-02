"""Publish an explicitly authorised network export; never copy the source database."""
import argparse
import gzip
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).absolute().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", required=True, type=Path)
    parser.add_argument("--redistribution-approved", required=True, action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "public_navigraph_site")
    args = parser.parse_args()
    raw = args.network.read_bytes()
    data = json.loads(gzip.decompress(raw) if args.network.suffix == ".gz" else raw)
    if data.get("format_version") != 1 or data["manifest"]["metadata"]["data_source"] != "NAVIGRAPH":
        parser.error("Expected the reviewed Navigraph format_version 1 export")
    # Exclude workstation paths and database bookkeeping from all published metadata.
    data["manifest"].pop("signature", None)
    data["manifest"]["metadata"] = {k: v for k, v in data["manifest"]["metadata"].items()
                                      if k in ("airac_cycle", "data_source", "valid_through")}
    data["manifest"]["notice"] = (
        f"Navigraph AIRAC {data['manifest']['metadata']['airac_cycle']} · Recorded airway connections, "
        "not measured traffic flows. Research visualisation; not for operational navigation.")
    output = args.output.absolute()
    subprocess.run([sys.executable, str(ROOT / "tools/build_static.py"), "--output", str(output)], check=True)
    payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    (output / "network.json.gz").write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
    html = (output / "index.html").read_text(encoding="utf-8")
    html = html.replace("window.ATLAS_STATIC = true;", "window.ATLAS_STATIC = true; window.ATLAS_DATA_URL = './network.json.gz';")
    html = html.replace("PUBLIC DEMO", "PUBLIC NAVDATA").replace("LOCAL NAVDATA", "NAVIGRAPH NAVDATA")
    html = html.replace("Opening the synthetic demo", "Opening the Navigraph network")
    html = html.replace("Loading invented demonstration points and links…", "Loading the published Navigraph waypoint network…")
    (output / "index.html").write_text(html, encoding="utf-8")
    print(f"Built authorised public Navigraph site: {len(data['waypoints'])} waypoints, {len(data['segments'])} links")


if __name__ == "__main__":
    main()
