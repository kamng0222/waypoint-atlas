# Waypoint Atlas

Interactive 3D Earth and flat-map network visualiser, with a Python local-data server and a static public demonstration.

**Live demo:** https://kamng0222.github.io/waypoint-atlas/

The public demonstration uses invented points and links. It does not contain real Navigraph data. A selected `network.json` export is processed only in your browser tab and is not uploaded.

## Run locally

Requires Python 3.10+; no pip dependencies.

```sh
python tools/setup_assets.py
python app.py --database /path/to/little_navmap_navigraph.sqlite --open
```

Your navigation database stays local. It is not included in this repository. Check your data licence before any public redistribution.

## Build the synthetic public site

```sh
python tools/setup_assets.py
python tools/build_static.py --output public_site
python -m http.server 8766 --directory public_site
```

Open http://localhost:8766. The Pages workflow automates this build on `main`.

## Features

- 3D globe and flat map, drag/pan/zoom, region presets, rotation.
- Full recorded en-route connections for your own local database.
- Waypoint and airway search, incident connections, directional highlights.
- Airway class filters and optional unlinked waypoint dots.
- Static demo with browser-only local export import.

## Engineering handover

Read [DESIGN_AND_HANDOVER.md](DESIGN_AND_HANDOVER.md), [PUBLICATION.md](PUBLICATION.md), and [LOCAL_README.md](LOCAL_README.md). Programme 02 remains unspecified.

```sh
python -m unittest discover -s tests -v
```

The 17 Python regression tests use synthetic database fixtures. Optional browser QA scripts use Playwright and Microsoft Edge; these are not runtime dependencies.

The initial `source.zip` is an allowlisted bootstrap snapshot. GitHub Actions expands it into readable files on the first run; subsequent development uses the expanded repository source.

CesiumJS 1.146.0 is downloaded from npm with a pinned SHA-512 check. Its upstream licence and credit notices are preserved. This project is independent of Navigraph; it is not endorsed by or affiliated with Navigraph.
