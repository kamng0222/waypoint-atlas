# Public GitHub publication

The user authorised publication of the software and a synthetic demonstration on 2 October 2026. They explicitly selected keeping the real Navigraph data local.

Repository: https://github.com/kamng0222/waypoint-atlas

Intended GitHub Pages URL: https://kamng0222.github.io/waypoint-atlas/

## Public content

The public app is named **Waypoint Atlas**. Its demonstration nodes and links are generated deterministically by `tools/build_static.py`. All labels start with DEM; every demo record is invented. The data banner clearly says SYNTHETIC DEMO. The demonstration does not represent actual waypoints, airways, traffic, or a Navigraph AIRAC cycle.

The public code includes the Python adapter and viewer. It includes no Navigraph SQLite/DAT inputs, exported private graph, flight CSVs, logs, or screenshots of the real data. The bootstrap archive is generated using an explicit file allowlist.

## Static architecture

GitHub Pages serves files, and does not execute the Python HTTP server. `web/data-source.js` supplies the viewer's search/detail API in browser memory when `window.ATLAS_STATIC` is set. The local Python app continues to use its HTTP API.

All script, CSS, worker, and imagery URLs are relative to the site, so repository subpaths are supported. The GitHub Actions build obtains the pinned, integrity-verified Cesium runtime and then generates the synthetic site. It never reads a private navigation input.

The public page's **Open local network.json** control reads a selected file with the browser File API. It rebuilds the viewer's graph in the current tab. It does not POST the file, send its contents in a URL, call a remote data API, or persist it to browser storage. **Return to synthetic demo** discards the imported in-memory graph. Refreshing also returns to the demo.

For local data, run the Python app to create `cache/network.json`, then select that file in the public viewer. Viewing data locally does not establish any redistribution rights. Consult your data licence separately.

## Deployment and source bootstrap

The initial upload contains `source.zip` plus a public README and this document. A reviewed GitHub Actions workflow extracts the allowlisted source archive on the first build, expands it into readable repository files, commits those files, installs Cesium, runs the Python tests, builds the synthetic site, and deploys Pages.

Later builds use the readable repository source directly. They do not reapply the bootstrap archive when `app.py` is already present. The archive remains a source snapshot; future changes should be made to the expanded source, with normal Git commits.

The workflow needs a repository-scoped temporary GitHub Actions token for the initial source commit, and standard Pages deployment permissions. It uses no personal access token and no external secrets.

## Local build

```powershell
python tools/setup_assets.py
python tools/build_static.py --output public_site
python -m http.server 8766 --bind 127.0.0.1 --directory public_site
```

Open http://127.0.0.1:8766. Do not put private input data inside `public_site`.

## Relevant source terms

- [Navigraph developer terms](https://developers.navigraph.com/docs/developer-terms-of-service), including sections 4.2, 5.4, 6, and 7, describe use, charts, branding, and access restrictions. The published demo contains no Navigraph dataset and does not claim affiliation.
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) describes the static build/deploy arrangement.

This document records the chosen publication scope; it does not claim a separate licence to redistribute navigation data.
