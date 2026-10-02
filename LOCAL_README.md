# Programme 01 — Navigraph Atlas

A local Python programme that serves an interactive HTML visualiser of the Navigraph waypoint and airway network.

## Start

From this directory:

```powershell
python app.py --open
```

Open <http://127.0.0.1:8765>. Keep the Python process running while using the map. Ctrl+C stops the server. Do not open `web/index.html` directly: the viewer needs its local HTTP API and asset paths.

Requirements: Python 3.10+ and a desktop browser with WebGL. Tested here with Python 3.12 and Microsoft Edge. No pip installation, account, or API key is required. The installed browser library and imagery run offline.

If the assets are missing after copying or checking out the source:

```powershell
python tools/setup_assets.py
```

That one-time setup downloads an integrity-checked CesiumJS 1.146.0 archive. Later map sessions use only local files.

## VS Code

Open the parent `Navigraph.code-workspace`. Use **Terminal → Run Task → Start Navigraph visualiser**, or F5 with **Programme 01: Navigraph globe**. The Python and Python Debugger extensions were already installed on this computer when the project was created. Opening this programme folder directly also works using its `.vscode` configurations.

The task works independently of the debugger extension. Select a Python interpreter if VS Code asks.

## Explore

- **3D globe / Flat map:** switch between an Earth globe and a flat geographic map.
- **Drag:** rotate the globe or pan the flat map. Scroll to zoom. In 3D, right drag or Ctrl + left drag tilts the view.
- **Arrow controls / keyboard arrows:** move the camera. `+` and `-` zoom. The **N** button restores north and a downward view in 3D.
- **World view / region buttons:** jump to a useful extent.
- **Slow globe rotation:** rotates automatically in 3D; stops when switching to flat mode.
- **Search:** enter a waypoint name such as `BEKOL`, or an airway name such as `A1`. Choose a result. Duplicate waypoint names are listed separately with region and database ID.
- **Waypoint dots:** click a dot to inspect recorded incident airway links. Click an airway name in its details to highlight that airway.
- **High / low / both filters:** independently show or hide the database's J, V, and B airway classes.
- **Link brightness:** adjusts line opacity.
- **Include unlinked waypoints:** includes all waypoint records, including those with no en-route airway link. This can take several seconds on slower computers.
- **Clear highlight:** removes the selection overlay. Hiding the detail panel alone keeps its highlight.

The map loads all 91,099 airway segments in the supplied AIRAC 2610 database. It initially displays the 47,317 fixes that participate in those segments. The all-points option displays all 257,277 waypoint records. Colours distinguish airway classes; gold highlights a selection. Highlighted one-way links show arrows.

This version displays published en-route connectivity. It does not display flight counts, inferred traffic, terminal procedure links, or live aircraft.

## Data refresh and alternatives

Replace/update the source SQLite file through your usual Navigraph workflow, stop the Python server, and restart it. Cache regeneration follows changes in source path, size, or modification timestamp. Reload the browser. For a forced rebuild:

```powershell
python app.py --rebuild --open
```

For another compatible database or another port:

```powershell
python app.py --database 'K:\path\little_navmap_navigraph.sqlite' --port 8766 --open
```

## Verify

```powershell
python -m unittest discover -s tests -v
```

The 17 tests cover graph identity, fragments, directions, dateline coordinates, invalid records, read-only access, cache changes, literal search, HTTP compression, ETags, and file containment.

Optional browser QA requires Node and Playwright, but they are not runtime dependencies:

```powershell
npm install --no-save playwright
node tools/browser_smoke.cjs
```

The script uses an installed Microsoft Edge browser and a running server at port 8765. It writes screenshots and a JSON report to `tests/artifacts/`. The initial build's screenshots and passing report are already present there.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Port 8765 is in use | Reuse the running visualiser, stop its Python process, or start with `--port 8766`. |
| Blank page or startup error | Read the error card, Python terminal, and browser console. Check that WebGL is supported. |
| Missing Cesium assets | Run `python tools/setup_assets.py`. |
| Browser cannot reach the viewer | Start `python app.py`; verify the address printed in its terminal. |
| Map feels slow with all points | Turn off unlinked waypoints or waypoint dots; use a desktop browser. |
| No links for a selected fix | That fix has no references in the `airway` table. This is valid; the programme does not invent links. |
| A short airway name highlights several distant areas | The same airway name can be reused across disconnected fragments and regions. All stored fragments are shown. |
| Dataset changed while programme was running | Stop and restart the server, then reload the browser. |
| Earth imagery looks coarse when close up | This version intentionally uses bundled, low-resolution Natural Earth imagery for offline operation. |

Detailed engineering notes and continuation instructions: [DESIGN_AND_HANDOVER.md](DESIGN_AND_HANDOVER.md).
