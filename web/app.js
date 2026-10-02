/* Plain JavaScript front end. The full network is local; no cloud token needed. */
"use strict";
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString("en-US");
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const C = window.Cesium;
const palette = { J: "#60decd", V: "#6ba9ff", B: "#e5b873" };
const state = {
  viewer: null, network: null, pointsById: new Map(), edgesById: new Map(),
  connectedIds: new Set(), layers: new Map(), pointCollections: [],
  selectedEntities: [], selectedId: null, pointGeneration: 0,
  searchGeneration: 0, selectionGeneration: 0, ready: false,
};

function setProgress(message, percent) {
  $("loadingText").textContent = message;
  $("progress").style.width = `${percent}%`;
}
function toast(message, duration = 4500) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => { $("toast").hidden = true; }, duration);
}
function setStatus(message) { $("status").textContent = message; }
async function api(path) {
  if (window.AtlasDataSource) return window.AtlasDataSource.api(path);
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${path}`);
  return response.json();
}
function getOpacity() { return Number($("opacity").value) / 100; }
function typeEnabled(type) {
  const input = document.querySelector(`[data-layer="${type}"]`);
  return !input || input.checked;
}
function refreshStatus() {
  if (!state.network) return;
  const stats = state.network.manifest.stats;
  const enabled = state.network.segments.reduce((n, edge) => n + Number(typeEnabled(edge[4])), 0);
  const points = $("showPoints").checked ? ($("allPoints").checked ? stats.waypoints : stats.connected_waypoints) : 0;
  setStatus(`${fmt(enabled)} links · ${fmt(points)} waypoint dots · ${cycleLabel()}`);
  state.viewer.scene.requestRender();
}
function cycleLabel() {
  return state.network.manifest.metadata.data_source === "SYNTHETIC" ? "SYNTHETIC DEMO" : `AIRAC ${state.network.manifest.metadata.airac_cycle}`;
}

async function loadNetwork(network) {
  state.ready = false; $("loading").hidden = false;
  ++state.selectionGeneration; ++state.searchGeneration;
  clearHighlight(); $("detailPanel").hidden = true; $("searchResults").hidden = true;
  for (const primitive of state.layers.values()) state.viewer.scene.primitives.remove(primitive);
  state.layers.clear(); state.pointsById.clear(); state.edgesById.clear(); state.connectedIds.clear();
  state.network = network;
  for (const point of network.waypoints) state.pointsById.set(point[0], point);
  for (const edge of network.segments) {
    state.edgesById.set(edge[0], edge); state.connectedIds.add(edge[1]); state.connectedIds.add(edge[2]);
  }
  const stats = network.manifest.stats;
  $("pointCount").textContent = fmt(stats.waypoints); $("edgeCount").textContent = fmt(stats.segments);
  $("cycleBadge").textContent = cycleLabel();
  document.querySelector(".data-note").textContent = network.manifest.notice || "Published airway connectivity. Traffic volume and flown tracks are not represented.";
  await makeNetworkLines(); await makePoints(); updateLayers();
  state.ready = true; $("loading").hidden = true; refreshStatus();
}

/* Batch positions into a handful of GPU draw calls, rather than 91k entities.
 * GeometryPipeline handles 2D projection and antimeridian splits. Each great
 * circle is sampled at <=1 degree; 4.5km display lift keeps chords above Earth.
 * The lift is an illustrative display offset, never an airway altitude.
 */
async function makeNetworkLines() {
  const positions = {};
  for (const edge of state.network.segments) {
    const type = edge[4];
    if (!positions[type]) positions[type] = [];
    const output = positions[type];
    const start = C.Cartographic.fromDegrees(edge[10], edge[11]);
    const end = C.Cartographic.fromDegrees(edge[12], edge[13]);
    const geodesic = new C.EllipsoidGeodesic(start, end);
    const steps = Math.max(1, Math.ceil(geodesic.surfaceDistance / 100000));
    let previous = C.Cartesian3.fromRadians(start.longitude, start.latitude, 4500);
    for (let step = 1; step <= steps; step++) {
      const next = geodesic.interpolateUsingFraction(step / steps);
      const position = C.Cartesian3.fromRadians(next.longitude, next.latitude, 4500);
      output.push(previous.x, previous.y, previous.z, position.x, position.y, position.z);
      previous = position;
    }
    if (edge[0] % 8000 === 0) {
      setProgress(`Building airway geometry · ${fmt(edge[0])} segments`, 40 + edge[0] / state.network.segments.length * 25);
      await pause();
    }
  }
  for (const [type, values] of Object.entries(positions)) {
    const coordinates = new Float64Array(values);
    const geometry = new C.Geometry({
      attributes: { position: new C.GeometryAttribute({ componentDatatype: C.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: coordinates }) },
      indices: new Uint32Array(Array.from({ length: values.length / 3 }, (_, index) => index)),
      primitiveType: C.PrimitiveType.LINES,
      boundingSphere: C.BoundingSphere.fromVertices(coordinates),
    });
    const primitive = state.viewer.scene.primitives.add(new C.Primitive({
      geometryInstances: new C.GeometryInstance({ id: `network-${type}`, geometry,
        attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(C.Color.fromCssColorString(palette[type] || "#a6c5df").withAlpha(getOpacity())) } }),
      appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: true,
        renderState: { depthTest: { enabled: true }, depthMask: false, lineWidth: 1 } }),
      asynchronous: false, allowPicking: false, compressVertices: false,
    }));
    state.layers.set(type, primitive);
    await pause();
  }
}

async function makePoints() {
  const generation = ++state.pointGeneration;
  const includeAll = $("allPoints").checked;
  const pending = [];
  let collection = null;
  const count = includeAll ? state.network.waypoints.length : state.connectedIds.size;
  let added = 0;
  try {
    for (const point of state.network.waypoints) {
      if (!includeAll && !state.connectedIds.has(point[0])) continue;
      if (!collection || collection.length >= 8000) {
        collection = state.viewer.scene.primitives.add(new C.PointPrimitiveCollection({ blendOption: C.BlendOption.TRANSLUCENT }));
        pending.push(collection);
        collection.show = false;
      }
      collection.add({ position: C.Cartesian3.fromDegrees(point[3], point[4], 5000),
        pixelSize: state.connectedIds.has(point[0]) ? 3 : 2,
        color: C.Color.fromCssColorString(state.connectedIds.has(point[0]) ? "#d1f0ee" : "#8098b0").withAlpha(.65),
        id: { kind: "waypoint", id: point[0] },
        scaleByDistance: new C.NearFarScalar(100000, 1.6, 22000000, .45),
      });
      added++;
      if (added % 4000 === 0) {
        if (!state.ready) setProgress(`Preparing waypoint dots · ${fmt(added)} / ${fmt(count)}`, 68 + added / count * 24);
        await pause();
        if (generation !== state.pointGeneration) {
          pending.forEach((item) => state.viewer.scene.primitives.remove(item));
          return;
        }
      }
    }
    state.pointCollections.forEach((item) => state.viewer.scene.primitives.remove(item));
    state.pointCollections = pending;
    pending.forEach((item) => { item.show = $("showPoints").checked; });
    refreshStatus();
  } catch (error) {
    pending.forEach((item) => state.viewer.scene.primitives.remove(item));
    throw error;
  }
}

function clearHighlight() {
  state.selectedEntities.forEach((entity) => state.viewer.entities.remove(entity));
  state.selectedEntities = [];
  state.selectedId = null;
  state.viewer.scene.requestRender();
}
function addHighlight(rows, points = []) {
  clearHighlight();
  const color = C.Color.fromCssColorString("#ffe39a");
  for (const row of rows) {
    let positions = [row.from_lonx, row.from_laty, 6500, row.to_lonx, row.to_laty, 6500];
    if (row.direction === "B") positions = [row.to_lonx, row.to_laty, 6500, row.from_lonx, row.from_laty, 6500];
    state.selectedEntities.push(state.viewer.entities.add({ polyline: {
      positions: C.Cartesian3.fromDegreesArrayHeights(positions), width: row.direction === "N" ? 3 : 7,
      material: row.direction === "N" || !["F", "B"].includes(row.direction) ? color : new C.PolylineArrowMaterialProperty(color),
      arcType: C.ArcType.GEODESIC, granularity: C.Math.toRadians(.25),
    } }));
  }
  for (const point of points) {
    state.selectedEntities.push(state.viewer.entities.add({ position: C.Cartesian3.fromDegrees(point.lonx, point.laty, 8000),
      point: { pixelSize: 9, color, outlineWidth: 2, outlineColor: C.Color.fromCssColorString("#192d39") },
      label: { text: point.ident, font: "12px sans-serif", fillColor: color, showBackground: true,
        backgroundColor: C.Color.fromCssColorString("#071622").withAlpha(.9), pixelOffset: new C.Cartesian2(0, -20),
        verticalOrigin: C.VerticalOrigin.BOTTOM, distanceDisplayCondition: new C.DistanceDisplayCondition(0, 15000000) },
    }));
  }
  state.viewer.scene.requestRender();
}
function detailGrid(entries) {
  const grid = document.createElement("div"); grid.className = "detail-grid";
  entries.forEach(([title, value]) => {
    const cell = document.createElement("div");
    const label = document.createElement("small"); label.textContent = title;
    cell.append(label, document.createTextNode(String(value))); grid.append(cell);
  });
  return grid;
}
function altitude(value) { return value == null || value >= 99999 ? "Unspecified" : `${fmt(value)} ft`; }
function directionLabel(row) {
  return row.direction === "F" ? `${row.from_ident} → ${row.to_ident}` : row.direction === "B" ? `${row.to_ident} → ${row.from_ident}` :
    `${row.from_ident} ↔ ${row.to_ident}`;
}
function connectionElement(row, clickableAirway = true) {
  const item = document.createElement("div"); item.className = "connection";
  if (clickableAirway) {
    const button = document.createElement("button"); button.textContent = `${row.airway_name} · ${row.airway_type}`;
    button.addEventListener("click", () => selectAirway(row.airway_name)); item.append(button);
  }
  const link = document.createElement("span"); link.textContent = directionLabel(row); item.append(link);
  const info = document.createElement("small");
  info.textContent = `Fragment ${row.airway_fragment_no} · Seq ${row.sequence_no} · Min ${altitude(row.minimum_altitude)} · Max ${altitude(row.maximum_altitude)}`;
  item.append(info); return item;
}
async function selectWaypoint(id, fly = true) {
  const generation = ++state.selectionGeneration;
  try {
    const result = await api(`/api/waypoint/${id}`);
    if (generation !== state.selectionGeneration) return;
    const point = result.waypoint;
    addHighlight(result.connections, [point]); state.selectedId = id;
    $("detailKind").textContent = "WAYPOINT / NAVIGATION FIX";
    $("detailTitle").textContent = point.ident;
    $("detailSubtitle").textContent = `${point.region || "No region"} · ${point.type || "Fix"} · Database ID ${point.waypoint_id}`;
    $("detailBody").replaceChildren(detailGrid([["LATITUDE", point.laty.toFixed(6)], ["LONGITUDE", point.lonx.toFixed(6)],
      ["AIRWAY LINKS", result.connections.length], ["AIRPORT", point.airport_ident || "—"]]));
    const heading = document.createElement("h3"); heading.textContent = "Recorded connections"; $("detailBody").append(heading);
    if (!result.connections.length) {
      const note = document.createElement("p"); note.className = "small-note";
      note.textContent = "No en-route airway segments reference this fix. Terminal procedure links are outside this first version.";
      $("detailBody").append(note);
    }
    result.connections.forEach((row) => $("detailBody").append(connectionElement(row)));
    $("detailPanel").hidden = false;
    $("searchResults").hidden = true;
    if (fly) flyTo(point.lonx, point.laty, 1200000);
  } catch (error) { toast(error.message); }
}
async function selectAirway(name) {
  const generation = ++state.selectionGeneration;
  try {
    const result = await api(`/api/airway/${encodeURIComponent(name)}`);
    if (generation !== state.selectionGeneration) return;
    addHighlight(result.segments);
    $("detailKind").textContent = "PUBLISHED AIRWAY"; $("detailTitle").textContent = result.name;
    $("detailSubtitle").textContent = "All recorded fragments with this airway name";
    const fragments = new Set(result.segments.map((row) => row.airway_fragment_no));
    $("detailBody").replaceChildren(detailGrid([["SEGMENTS", fmt(result.segments.length)], ["FRAGMENTS", fmt(fragments.size)],
      ["TYPES", [...new Set(result.segments.map((row) => row.airway_type))].join(", ")], ["HIGHLIGHT", "Gold"]]));
    const note = document.createElement("p"); note.className = "small-note";
    note.textContent = "A name may be reused in different regions. Fragment and sequence are preserved; no artificial links join separate fragments. Arrows show recorded one-way directions.";
    $("detailBody").append(note);
    result.segments.slice(0, 250).forEach((row) => $("detailBody").append(connectionElement(row, false)));
    if (result.segments.length > 250) {
      const more = document.createElement("p"); more.className = "small-note";
      more.textContent = `List displays the first 250 of ${fmt(result.segments.length)} segments; the entire airway is highlighted.`;
      $("detailBody").append(more);
    }
    $("detailPanel").hidden = false; $("searchResults").hidden = true;
    const coordinates = result.segments.flatMap((row) => [C.Cartesian3.fromDegrees(row.from_lonx, row.from_laty), C.Cartesian3.fromDegrees(row.to_lonx, row.to_laty)]);
    const sphere = C.BoundingSphere.fromPoints(coordinates);
    state.viewer.camera.flyToBoundingSphere(sphere, { duration: 1.3, offset: new C.HeadingPitchRange(0, -Math.PI / 2, Math.max(500000, sphere.radius * 3)) });
  } catch (error) { toast(error.message); }
}

async function search() {
  const generation = ++state.searchGeneration;
  const query = $("searchInput").value.trim();
  if (!query) { $("searchResults").hidden = true; return; }
  try {
    const result = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if (generation !== state.searchGeneration) return;
    const container = $("searchResults"); container.replaceChildren(); container.hidden = false;
    for (const [heading, records] of [["WAYPOINTS", result.waypoints], ["AIRWAYS", result.airways]]) {
      if (!records.length) continue;
      const label = document.createElement("div"); label.className = "result-heading"; label.textContent = heading; container.append(label);
      records.forEach((record) => {
        const button = document.createElement("button"); button.className = "result"; button.type = "button";
        const name = document.createElement("span"); name.textContent = record.ident || record.name;
        const info = document.createElement("small"); info.textContent = heading === "WAYPOINTS" ? `${record.region || "—"} · #${record.id}` : `${fmt(record.segments)} links`;
        button.append(name, info);
        button.addEventListener("click", () => heading === "WAYPOINTS" ? selectWaypoint(record.id) : selectAirway(record.name));
        container.append(button);
      });
    }
    if (!container.children.length) { const note = document.createElement("p"); note.textContent = "No matches in this dataset."; container.append(note); }
  } catch (error) { toast(error.message); }
}

function flyTo(lon, lat, height, duration = 1.2) {
  state.viewer.camera.flyTo({ destination: C.Cartesian3.fromDegrees(lon, lat, height),
    orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 }, duration });
}
function home(duration = 1.2) {
  if (state.viewer.scene.mode === C.SceneMode.SCENE2D) {
    state.viewer.camera.flyTo({ destination: C.Rectangle.fromDegrees(-180, -80, 180, 80), duration });
  } else flyTo(110, 22, 23000000, duration);
}
function moveCamera(direction) {
  const camera = state.viewer.camera;
  if (state.viewer.scene.mode === C.SceneMode.SCENE3D) {
    const moves = { left: "rotateLeft", right: "rotateRight", up: "rotateUp", down: "rotateDown" };
    camera[moves[direction]](.12);
  } else {
    const moves = { left: "moveLeft", right: "moveRight", up: "moveUp", down: "moveDown" };
    camera[moves[direction]](camera.getMagnitude() * .10);
  }
  state.viewer.scene.requestRender();
}
function zoom(inward) {
  const camera = state.viewer.camera;
  const distance = camera.positionCartographic.height * .22;
  camera[inward ? "zoomIn" : "zoomOut"](Math.max(1000, distance));
  state.viewer.scene.requestRender();
}
function setMode(flat) {
  $("autoRotate").checked = false;
  state.viewer.scene.completeMorph();
  if (flat) state.viewer.scene.morphTo2D(1);
  else state.viewer.scene.morphTo3D(1);
  $("mode3d").classList.toggle("active", !flat); $("mode2d").classList.toggle("active", flat);
  $("mode3d").setAttribute("aria-pressed", String(!flat)); $("mode2d").setAttribute("aria-pressed", String(flat));
  $("mapMode").textContent = `GLOBAL NETWORK / ${flat ? "2D" : "3D"}`;
  $("autoRotate").disabled = flat;
  $("north").disabled = flat;
  state.viewer.scene.requestRender();
}
function updateLayers() {
  for (const [type, primitive] of state.layers) primitive.show = typeEnabled(type);
  state.pointCollections.forEach((collection) => { collection.show = $("showPoints").checked; });
  refreshStatus();
}

function wireControls() {
  $("mode3d").onclick = () => setMode(false); $("mode2d").onclick = () => setMode(true);
  $("home").onclick = () => home();
  $("zoomIn").onclick = () => zoom(true); $("zoomOut").onclick = () => zoom(false);
  $("north").onclick = () => {
    state.viewer.camera.setView({ orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
    state.viewer.scene.requestRender();
  };
  document.querySelectorAll("[data-camera]").forEach((button) => { button.onclick = () => moveCamera(button.dataset.camera); });
  document.querySelectorAll("[data-layer]").forEach((input) => input.addEventListener("change", updateLayers));
  $("showPoints").addEventListener("change", updateLayers);
  $("allPoints").addEventListener("change", async () => {
    $("allPoints").disabled = true;
    toast("Preparing waypoint dots…", 30000);
    try { await makePoints(); toast(`${fmt($("allPoints").checked ? state.network.waypoints.length : state.connectedIds.size)} waypoint dots ready.`); }
    catch (error) { toast(error.message); }
    finally { $("allPoints").disabled = false; }
  });
  $("opacity").addEventListener("input", () => {
    $("opacityValue").textContent = `${$("opacity").value}%`;
    for (const [type, primitive] of state.layers) {
      if (primitive.ready) primitive.getGeometryInstanceAttributes(`network-${type}`).color =
        C.ColorGeometryInstanceAttribute.toValue(C.Color.fromCssColorString(palette[type] || "#a6c5df").withAlpha(getOpacity()));
    }
    state.viewer.scene.requestRender();
  });
  $("resetLayers").onclick = async () => {
    document.querySelectorAll("[data-layer]").forEach((input) => { input.checked = true; });
    $("showPoints").checked = true; $("opacity").value = 50; $("opacity").dispatchEvent(new Event("input"));
    if ($("allPoints").checked) { $("allPoints").checked = false; $("allPoints").dispatchEvent(new Event("change")); }
    updateLayers();
  };
  const presets = { asia: [113, 27, 6000000], europe: [12, 48, 4500000], america: [-100, 39, 6500000], oceania: [145, -25, 6000000] };
  document.querySelectorAll("[data-preset]").forEach((button) => { button.onclick = () => flyTo(...presets[button.dataset.preset]); });
  $("searchForm").onsubmit = (event) => { event.preventDefault(); search(); };
  let debounce;
  $("searchInput").addEventListener("input", () => { ++state.searchGeneration; clearTimeout(debounce); debounce = setTimeout(search, 230); });
  $("closeDetail").onclick = () => { $("detailPanel").hidden = true; };
  $("clearSelection").onclick = () => { ++state.selectionGeneration; clearHighlight(); $("detailPanel").hidden = true; };
  $("fullscreen").onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch (error) { toast("Full screen is unavailable in this browser panel."); }
  };
  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input,textarea,button")) return;
    const directions = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (directions[event.key]) { event.preventDefault(); moveCamera(directions[event.key]); }
    if (event.key === "+" || event.key === "=") zoom(true);
    if (event.key === "-") zoom(false);
    if (event.key === "Escape") { $("detailPanel").hidden = true; $("searchResults").hidden = true; }
  });
  const handler = new C.ScreenSpaceEventHandler(state.viewer.scene.canvas);
  handler.setInputAction((event) => {
    if (!state.ready) return;
    const picked = state.viewer.scene.pick(event.position);
    if (picked && picked.id && picked.id.kind === "waypoint") selectWaypoint(picked.id.id, false);
  }, C.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction((event) => {
    const position = state.viewer.camera.pickEllipsoid(event.endPosition);
    if (!position) return;
    const cartographic = C.Cartographic.fromCartesian(position);
    $("coordinates").textContent = `${C.Math.toDegrees(cartographic.latitude).toFixed(3)}° LAT / ${C.Math.toDegrees(cartographic.longitude).toFixed(3)}° LON · WGS84`;
  }, C.ScreenSpaceEventType.MOUSE_MOVE);
  let lastTime = performance.now();
  state.viewer.clock.onTick.addEventListener(() => {
    const now = performance.now(); const elapsed = Math.min((now - lastTime) / 1000, .1); lastTime = now;
    if ($("autoRotate").checked && state.viewer.scene.mode === C.SceneMode.SCENE3D) {
      state.viewer.camera.rotateRight(.025 * elapsed); state.viewer.scene.requestRender();
    }
  });
}

async function main() {
  try {
    if (!C) throw new Error("Cesium assets missing. Run python tools/setup_assets.py, then refresh.");
    const provider = await C.TileMapServiceImageryProvider.fromUrl("./vendor/cesium/Assets/Textures/NaturalEarthII", { maximumLevel: 2 });
    state.viewer = new C.Viewer("earth", {
      baseLayer: new C.ImageryLayer(provider, { brightness: .72, saturation: .65, gamma: .95 }),
      baseLayerPicker: false, animation: false, timeline: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      fullscreenButton: false, selectionIndicator: false, infoBox: false,
      requestRenderMode: true, maximumRenderTimeChange: Infinity,
      terrainProvider: new C.EllipsoidTerrainProvider(), scene3DOnly: false,
      msaaSamples: 2,
    });
    state.viewer.resolutionScale = Math.min(1, 1.5 / window.devicePixelRatio);
    state.viewer.scene.globe.baseColor = C.Color.fromCssColorString("#112d43");
    state.viewer.scene.backgroundColor = C.Color.fromCssColorString("#06111e");
    state.viewer.scene.globe.enableLighting = false;
    state.viewer.scene.globe.depthTestAgainstTerrain = false;
    state.viewer.scene.screenSpaceCameraController.minimumZoomDistance = 20000;
    state.viewer.scene.screenSpaceCameraController.maximumZoomDistance = 55000000;
    if (state.viewer.scene.skyBox) state.viewer.scene.skyBox.show = false;
    state.viewer.scene.renderError.addEventListener((scene, error) => {
      console.error(error); toast(`Globe rendering error: ${error.message}`, 15000);
      setStatus("Rendering error · See browser console");
    });
    home(0); setProgress("Loading the complete global network…", 15);
    await loadNetwork(await api("/api/network"));
    wireControls();
    const stats = state.network.manifest.stats;
    if (stats.excluded_invalid_waypoints || stats.excluded_invalid_segments)
      toast("Some invalid records were excluded. See cache/manifest.json.", 12000);
    // Exposed only for reproducible local QA and follow-up development.
    window.NavigraphAtlas = { state, selectWaypoint, selectAirway, setMode, home, moveCamera, loadNetwork };
    if (window.AtlasDataSource) window.AtlasDataSource.enableImport();
  } catch (error) {
    console.error(error); $("loadingTitle").textContent = "Unable to open the globe";
    $("loadingText").textContent = error.message;
    document.querySelector(".spinner").style.display = "none";
    setStatus("Startup failed · Check the Python terminal and browser console");
  }
}
main();
