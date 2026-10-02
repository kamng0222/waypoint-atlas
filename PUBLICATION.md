# Public GitHub publication

Repository: https://github.com/kamng0222/waypoint-atlas
Public viewer: https://kamng0222.github.io/waypoint-atlas/

## Publication scope and authorisation

On 2 October 2026 the user initially selected a synthetic demonstration with real data kept local. They subsequently explicitly changed that choice: **“Publish the real dataset—I have redistribution permission.”** The current public deployment therefore contains the Navigraph AIRAC 2610 waypoint/airway graph. This records the user's statement; no permission document was supplied or independently verified.

Published graph: 257,277 waypoints; 91,099 airway segments; 47,317 linked waypoints; 9,859 airway names. These are recorded en-route connections, not measured traffic flows. This viewer is for research and is not for operational navigation. It is an independent project, with no claim of endorsement by Navigraph.

The original SQLite database, DAT input, flight CSVs, logs and workstation paths remain outside the published content. Only the reviewed graph export is public. Public navigation data retains its source rights; this project does not grant a new licence to third parties.

## Static architecture

GitHub Pages serves static HTML/JavaScript and cannot run Python. `web/data-source.js` indexes the downloaded graph in browser memory for search and incident connections. The deployed HTML sets `ATLAS_STATIC` and `ATLAS_DATA_URL='./network.json.gz'`. Modern browsers stream the gzip response through `DecompressionStream('gzip')`; the compressed graph is approximately 6.8 MB and expands to approximately 24.6 MB. All asset URLs remain relative for repository subpaths. There is no Cesium cloud token, external imagery request or analytics.

`tools/build_static.py` still builds a synthetic-only demonstration. Real-data publication is a separate explicit command:

```sh
python tools/setup_assets.py
python tools/build_authorized_public.py --network public_data/network.json.gz --redistribution-approved --output public_navigraph_site
python -m http.server 8766 --directory public_navigraph_site
```

The authorised builder removes `manifest.signature`, permits only source/cycle/validity metadata, generates a deterministic compressed export, and labels the source and AIRAC cycle. It requires the approval flag, never reads the SQLite input, and keeps the synthetic example available as `demo.json`.

## Browser-only local import

**Open local network.json** continues to read a selected export in this tab without uploading it. **Return to published Navigraph network** discards the import and reloads the public graph. Refresh also restores the public graph. Publicly served `network.json.gz` is already public; a subsequently selected local file is not sent to a server.

## Deployment and handover

GitHub Actions runs fixture tests, checks JavaScript syntax, installs integrity-verified Cesium assets, builds the authorised site, verifies the graph counts and metadata, and deploys Pages. A one-time integrity-checked `navigraph-publication.zip` expands reviewed code/documentation and the compressed graph into readable repository paths. Later builds use those paths directly. The old `source.zip` and `package-manifest.json` are historical snapshots of the earlier synthetic release, not the current build sources.

Future AI work should read DESIGN_AND_HANDOVER.md and this file. Do not replace the export with another cycle or publish additional inputs without explicit authorisation. The approval here covers this supplied AIRAC 2610 waypoint/airway graph, not all future Navigraph products or cycles.
