/* Static GitHub Pages adapter. Local Python mode continues to use its HTTP API. */
"use strict";
if (window.ATLAS_STATIC) {
  window.AtlasDataSource = (() => {
    let network = null;
    let points = new Map(), incident = new Map(), airways = new Map();
    const pointColumns = ["waypoint_id", "ident", "region", "lonx", "laty", "type"];
    const edgeColumns = ["airway_id", "from_waypoint_id", "to_waypoint_id", "airway_name", "airway_type", "direction", "minimum_altitude", "maximum_altitude", "airway_fragment_no", "sequence_no", "from_lonx", "from_laty", "to_lonx", "to_laty", "route_type"];
    const record = (columns, row) => Object.fromEntries(columns.map((key, index) => [key, row[index]]));
    function prepare(document) {
      if (document.format_version !== 1 || !Array.isArray(document.waypoints) || !Array.isArray(document.segments) || !document.manifest?.metadata)
        throw new Error("Expected a format_version 1 network.json export from this programme.");
      const nextPoints = new Map(), nextIncident = new Map(), nextAirways = new Map();
      for (const row of document.waypoints) {
        if (row.length < 6 || !Number.isInteger(row[0]) || nextPoints.has(row[0]) || !Number.isFinite(row[3]) || !Number.isFinite(row[4]) || Math.abs(row[3]) > 180 || Math.abs(row[4]) > 90)
          throw new Error("The export contains invalid or duplicate waypoint records.");
        nextPoints.set(row[0], record(pointColumns, row));
      }
      for (const row of document.segments) {
        if (row.length < 15 || !nextPoints.has(row[1]) || !nextPoints.has(row[2]) || !row.slice(10, 14).every(Number.isFinite) || Math.abs(row[10]) > 180 || Math.abs(row[12]) > 180 || Math.abs(row[11]) > 90 || Math.abs(row[13]) > 90)
          throw new Error("The export contains an invalid airway segment or a missing endpoint.");
        const edge = record(edgeColumns, row), from = nextPoints.get(row[1]), to = nextPoints.get(row[2]);
        Object.assign(edge, { from_ident: from.ident, from_region: from.region, to_ident: to.ident, to_region: to.region });
        for (const id of new Set(row.slice(1, 3))) {
          if (!nextIncident.has(id)) nextIncident.set(id, []);
          nextIncident.get(id).push(edge);
        }
        if (!nextAirways.has(row[3])) nextAirways.set(row[3], []);
        nextAirways.get(row[3]).push(edge);
      }
      const sort = (a, b) => String(a.airway_name).localeCompare(String(b.airway_name)) || a.airway_fragment_no - b.airway_fragment_no || a.sequence_no - b.sequence_no || a.airway_id - b.airway_id;
      for (const edges of nextAirways.values()) edges.sort(sort);
      for (const edges of nextIncident.values()) edges.sort(sort);
      const types = {}, directions = {};
      for (const edge of document.segments) { types[edge[4]] = (types[edge[4]] || 0) + 1; directions[edge[5]] = (directions[edge[5]] || 0) + 1; }
      document.manifest.stats = { ...document.manifest.stats, waypoints: nextPoints.size, segments: document.segments.length,
        connected_waypoints: nextIncident.size, isolated_waypoints: nextPoints.size - nextIncident.size,
        airway_names: nextAirways.size, airway_types: types, directions };
      network = document; points = nextPoints; incident = nextIncident; airways = nextAirways;
    }
    async function loadDemo() {
      const response = await fetch("./demo.json");
      if (!response.ok) throw new Error("Could not load the synthetic demo.");
      prepare(await response.json());
    }
    async function api(path) {
      if (!network) await loadDemo();
      if (path === "/api/network") return network;
      if (path.startsWith("/api/waypoint/")) {
        const id = Number(path.split("/").pop());
        if (!points.has(id)) throw new Error("Waypoint not found.");
        return { waypoint: points.get(id), connections: incident.get(id) || [] };
      }
      if (path.startsWith("/api/airway/")) {
        const name = decodeURIComponent(path.split("/").pop()).toUpperCase();
        return { name, segments: airways.get(name) || [] };
      }
      if (path.startsWith("/api/search")) {
        const q = new URL(path, location.href).searchParams.get("q").trim().toUpperCase();
        const pointResults = [...points.values()].filter((point) => String(point.ident).toUpperCase().startsWith(q))
          .sort((a, b) => Number(b.ident === q) - Number(a.ident === q) || a.ident.localeCompare(b.ident) || a.waypoint_id - b.waypoint_id).slice(0, 20)
          .map((point) => ({ id: point.waypoint_id, ident: point.ident, region: point.region, lon: point.lonx, lat: point.laty, type: point.type }));
        const airwayResults = [...airways.entries()].filter(([name]) => name.startsWith(q))
          .sort(([a], [b]) => Number(b === q) - Number(a === q) || a.localeCompare(b)).slice(0, 20)
          .map(([name, edges]) => ({ name, segments: edges.length, types: [...new Set(edges.map((edge) => edge.airway_type))].join(",") }));
        return { waypoints: pointResults, airways: airwayResults };
      }
      throw new Error("Unknown static API operation.");
    }
    function enableImport() {
      const controls = document.getElementById("staticControls"); controls.hidden = false;
      document.getElementById("searchInput").placeholder = "Try DEM00001 or DEM-EAS-J…";
      const input = document.getElementById("datasetFile"), reset = document.getElementById("resetDemo");
      const showError = (error) => { const toast = document.getElementById("toast"); toast.textContent = error.message; toast.hidden = false; };
      input.addEventListener("change", async () => {
        const file = input.files[0]; if (!file) return;
        input.disabled = reset.disabled = true;
        try {
          if (file.size > 150 * 1024 * 1024) throw new Error("Choose a network export smaller than 150 MB.");
          const document = JSON.parse(await file.text());
          prepare(document);
          if (document.manifest.metadata.data_source !== "SYNTHETIC") document.manifest.notice = "Your local dataset is loaded in this tab only. It is not uploaded to GitHub or any server.";
          await window.NavigraphAtlas.loadNetwork(document);
        } catch (error) { showError(error); }
        finally { input.disabled = reset.disabled = false; input.value = ""; }
      });
      reset.onclick = async () => {
        input.disabled = reset.disabled = true;
        try { await loadDemo(); await window.NavigraphAtlas.loadNetwork(network); }
        catch (error) { showError(error); }
        finally { input.disabled = reset.disabled = false; }
      };
    }
    return { api, enableImport };
  })();
}
