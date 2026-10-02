# Waypoint Atlas

Interactive 3D Earth and flat-map viewer of the published **Navigraph AIRAC 2610** waypoint and airway network.

**Public viewer:** https://kamng0222.github.io/waypoint-atlas/

257,277 waypoints · 91,099 airway connections · 9,859 airway names. Search BEKOL or A1, switch between globe and flat map, pan/rotate/zoom, filter airway classes, and inspect directional connections. Connected dots are shown initially; enable **Include unlinked waypoints** to display every fix.

Data source: [Navigraph](https://navigraph.com/). Recorded connectivity is not measured traffic flow. Research visualisation; not for operational navigation. Independent project, not endorsed by or affiliated with Navigraph.

The owner explicitly confirmed redistribution permission for this export. Source rights remain with their respective owners; no new licence to redistribute navigation data is granted by this repository. The source SQLite/DAT database, flight CSVs, local paths and logs are excluded.

## Build and run

Requires Python 3.10+ and a modern browser; no pip dependencies.

```sh
python tools/setup_assets.py
python tools/build_authorized_public.py --network public_data/network.json.gz --redistribution-approved --output public_navigraph_site
python -m http.server 8766 --directory public_navigraph_site
```

GitHub Actions builds and deploys this site on `main`. To build the invented demonstration instead, run `python tools/build_static.py --output public_site`.

For your own local SQLite database:

```sh
python app.py --database /path/to/little_navmap_navigraph.sqlite --open
```

The public viewer can also open a selected `network.json` locally in browser memory without uploading that file. Reset or refresh returns to the published AIRAC 2610 graph.

## Engineering handover

Read [DESIGN_AND_HANDOVER.md](DESIGN_AND_HANDOVER.md), [PUBLICATION.md](PUBLICATION.md), and [LOCAL_README.md](LOCAL_README.md). Programme 02 remains unspecified.

```sh
python -m unittest discover -s tests -v
```

Optional Playwright/Edge browser QA scripts are development tools, not runtime dependencies. CesiumJS 1.146.0 is installed from npm with a pinned SHA-512 check; upstream licence/credit notices are preserved.
