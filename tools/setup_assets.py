"""Install pinned, integrity-checked Cesium assets. Internet needed only for setup."""
import base64
import hashlib
import io
import json
import tarfile
import urllib.request
from pathlib import Path

VERSION = "1.146.0"
INTEGRITY = "hvKkURnmc8OZ8qKNrwawl/YijwAItaWLbpAdIVNAUXODCLMjpod4PbdLuwo8Ab6ETL915MUGV2NocHFCRCeqqA=="
ROOT = Path(__file__).resolve().parents[1]


def main():
    url = f"https://registry.npmjs.org/cesium/-/cesium-{VERSION}.tgz"
    print(f"Downloading CesiumJS {VERSION} from npm...", flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        payload = response.read()
    actual = base64.b64encode(hashlib.sha512(payload).digest()).decode("ascii")
    if actual != INTEGRITY:
        raise RuntimeError("Cesium archive integrity mismatch; no files installed")
    destination = ROOT / "web" / "vendor" / "cesium"
    destination.mkdir(parents=True, exist_ok=True)
    prefix = "package/Build/Cesium/"
    count = 0
    with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            if member.name.startswith(prefix):
                relative = member.name[len(prefix):]
            elif member.name in ("package/LICENSE.md", "package/ThirdParty.extra.json"):
                relative = member.name.split("/", 1)[1]
            else:
                continue
            target = (destination / relative).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise RuntimeError("Unsafe archive path")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(member).read())
            count += 1
    (destination / "asset-version.json").write_text(json.dumps({"version": VERSION, "url": url,
        "sha512": INTEGRITY, "files": count}, indent=2), encoding="utf-8")
    print(f"Installed {count} files. Globe imagery and rendering now work offline.")


if __name__ == "__main__":
    main()
