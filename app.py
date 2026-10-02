"""Local Python HTTP server. Run: python app.py --open"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from navdata import NavData

ROOT = Path(__file__).absolute().parent
DEFAULT_DATABASE = ROOT.parent / "Navigraph" / "little_navmap_navigraph.sqlite"


def make_handler(data: NavData, web_root: Path = ROOT / "web"):
    etag = '"' + hashlib.sha256(data.gzip_bytes).hexdigest() + '"'
    web_root = web_root.resolve()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            params = parse_qs(parsed.query)
            try:
                if path == "/api/health":
                    return self.send_json({"ok": True, "programme": "Navigraph waypoint visualiser"})
                if path == "/api/manifest":
                    return self.send_json(data.manifest)
                if path == "/api/network":
                    if self.headers.get("If-None-Match") == etag:
                        return self.send_bytes(b"", status=304, headers={"ETag": etag})
                    accepts_gzip = False
                    for part in self.headers.get("Accept-Encoding", "").split(","):
                        tokens = [token.strip().lower() for token in part.split(";")]
                        if tokens[0] == "gzip":
                            quality = next((float(token[2:]) for token in tokens[1:] if token.startswith("q=")), 1)
                            accepts_gzip = quality > 0
                    headers = {"ETag": etag, "Vary": "Accept-Encoding", "Cache-Control": "no-cache"}
                    if accepts_gzip:
                        headers["Content-Encoding"] = "gzip"
                    return self.send_bytes(data.gzip_bytes if accepts_gzip else data.network_bytes,
                                           "application/json; charset=utf-8", headers=headers)
                if path == "/api/search":
                    return self.send_json(data.search(params.get("q", [""])[0]))
                if path.startswith("/api/waypoint/"):
                    result = data.waypoint(int(path.rsplit("/", 1)[-1]))
                    return self.send_json(result or {"error": "Waypoint not found"}, 200 if result else 404)
                if path.startswith("/api/airway/"):
                    result = data.airway(path.rsplit("/", 1)[-1])
                    return self.send_json(result, 200 if result["segments"] else 404)
                if path.startswith("/api/"):
                    return self.send_json({"error": "Unknown API endpoint"}, 404)
                relative = "index.html" if path == "/" else path.lstrip("/")
                file = (web_root / relative).resolve()
                if not file.is_relative_to(web_root) or not file.is_file():
                    return self.send_json({"error": "File not found"}, 404)
                mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                if file.suffix == ".js":
                    mime = "text/javascript"
                return self.send_bytes(file.read_bytes(), mime)
            except (ValueError, OverflowError):
                return self.send_json({"error": "Invalid request parameter"}, 400)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:
                print(f"Request error: {exc}")
                self.send_json({"error": "Server error; see Python terminal"}, 500)

        def send_json(self, value, status=200):
            return self.send_bytes(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                                   "application/json; charset=utf-8", status)

        def send_bytes(self, payload, content_type="text/plain", status=200, headers=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", (headers or {}).get("Cache-Control", "no-cache"))
            for key, value in (headers or {}).items():
                if key != "Cache-Control":
                    self.send_header(key, value)
            self.end_headers()
            self.wfile.write(payload)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--open", action="store_true", help="Open the visualiser in your default browser")
    parser.add_argument("--rebuild", action="store_true", help="Rebuild the read-only database export")
    args = parser.parse_args()
    if not (ROOT / "web" / "vendor" / "cesium" / "Cesium.js").is_file():
        parser.exit(1, "Cesium assets missing. Run: python tools/setup_assets.py\n")
    print("Preparing Navigraph network (source opened read-only)...", flush=True)
    try:
        data = NavData(args.database, ROOT / "cache", args.rebuild)
        server = ThreadingHTTPServer((args.host, args.port), make_handler(data))
    except (OSError, ValueError) as exc:
        parser.exit(1, f"Unable to start: {exc}\n")
    url = f"http://{args.host}:{args.port}"
    print(f"AIRAC {data.manifest['metadata'].get('airac_cycle')} | "
          f"{data.manifest['stats']['waypoints']:,} waypoints | "
          f"{data.manifest['stats']['segments']:,} segments", flush=True)
    print(f"Visualiser: {url}\nPress Ctrl+C to stop.", flush=True)
    if args.open:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
