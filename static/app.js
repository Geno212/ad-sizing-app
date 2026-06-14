// =====================================================
// State shared across modes
// =====================================================
let lastResult = null;       // last full simulate() result (either mode)
let lastMode = "mode1";
const TANKS = [
  { id: "digester",   name: "Digester Tank",   volKey: "digester_volume_safety", color: "#22c55e" },
  { id: "separation", name: "Separation Tank", volKey: "separation_volume",      color: "#60a5fa" },
  { id: "storage",    name: "Storage Tank",    volKey: "storage_volume",         color: "#facc15" },
];
let tankGeo = {};            // id -> geometry result

// =====================================================
// Group tabs (Mode 1 crop groups)
// =====================================================
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// =====================================================
// Mode switching
// =====================================================
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".mode-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.mode).classList.add("active");
    lastMode = btn.dataset.mode;
  });
});

// =====================================================
// Cow manure toggle
// =====================================================
const cowToggle = document.getElementById("hasCowManure");
const travelWrap = document.getElementById("travelWrap");
function syncCowManure() {
  travelWrap.classList.toggle("show", !cowToggle.checked);
}
cowToggle.addEventListener("change", syncCowManure);
syncCowManure();

// =====================================================
// Map (Leaflet + OpenStreetMap)
// =====================================================
let map, marker;
const DEFAULT_COORDS = [28.8336, 30.7849];

function initMap() {
  map = L.map("map", { center: DEFAULT_COORDS, zoom: 6, zoomControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  const greenIcon = L.divIcon({
    className: "custom-marker",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#22c55e;
      border:3px solid #052e16;box-shadow:0 0 12px #22c55e,0 0 0 4px rgba(34,197,94,0.25);"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9],
  });

  marker = L.marker(DEFAULT_COORDS, { icon: greenIcon, draggable: true }).addTo(map);
  map.on("click", (e) => setLocation(e.latlng.lat, e.latlng.lng));
  marker.on("dragend", () => {
    const ll = marker.getLatLng();
    setLocation(ll.lat, ll.lng);
  });
  fetchWeather(DEFAULT_COORDS[0], DEFAULT_COORDS[1]);
}

function setLocation(lat, lon, zoom) {
  const lat4 = parseFloat(lat.toFixed(4));
  const lon4 = parseFloat(lon.toFixed(4));
  marker.setLatLng([lat4, lon4]);
  document.getElementById("latInput").value = lat4;
  document.getElementById("lonInput").value = lon4;
  if (zoom) map.setView([lat4, lon4], zoom);
  fetchWeather(lat4, lon4);
}

async function fetchWeather(lat, lon) {
  const el = document.getElementById("weatherStatus");
  el.className = "weather-status loading";
  el.textContent = `Fetching live temperature for (${lat.toFixed(3)}, ${lon.toFixed(3)})…`;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    el.className = "weather-status error";
    el.textContent = "✗ Invalid coordinates.";
    return;
  }
  try {
    const res = await fetch(`/weather?lat=${lat}&lon=${lon}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      el.className = "weather-status error";
      el.textContent = `✗ ${data.error || "Temperature unavailable."}`;
      return;
    }
    el.className = "weather-status";
    el.textContent = `✓ Live temp: ${data.temperature.toFixed(1)}°C at (${lat.toFixed(3)}, ${lon.toFixed(3)})`;
  } catch (e) {
    el.className = "weather-status error";
    el.textContent = `✗ Network error: ${e.message}`;
  }
}

// ---- Coordinate "GO TO COORDS" button ----
document.getElementById("searchBtn").addEventListener("click", () => {
  const lat = parseFloat(document.getElementById("latInput").value);
  const lon = parseFloat(document.getElementById("lonInput").value);
  const el = document.getElementById("weatherStatus");
  if (isNaN(lat) || isNaN(lon)) {
    el.className = "weather-status error";
    el.textContent = "✗ Please enter valid numeric coordinates.";
    return;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    el.className = "weather-status error";
    el.textContent = "✗ Coordinates out of range (lat ±90, lon ±180).";
    return;
  }
  setLocation(lat, lon, Math.max(map.getZoom(), 8));
});

// =====================================================
// Place search (Nominatim via /geocode) + coordinate parsing
// =====================================================
const COORD_RE = /^\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*$/;

async function runPlaceSearch() {
  const q = document.getElementById("placeSearch").value.trim();
  const box = document.getElementById("searchResults");
  if (!q) return;

  // Direct coordinate entry
  const m = q.match(COORD_RE);
  if (m) {
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      box.innerHTML = "";
      setLocation(lat, lon, Math.max(map.getZoom(), 9));
      return;
    }
  }

  box.innerHTML = `<div class="search-loading">Searching “${q}”…</div>`;
  try {
    const res = await fetch(`/geocode?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok || data.error || !data.results || !data.results.length) {
      box.innerHTML = `<div class="search-empty">No matches found.</div>`;
      return;
    }
    box.innerHTML = "";
    data.results.forEach((r) => {
      const item = document.createElement("button");
      item.className = "search-item";
      item.type = "button";
      item.textContent = r.name;
      item.addEventListener("click", () => {
        box.innerHTML = "";
        document.getElementById("placeSearch").value = r.name;
        setLocation(r.lat, r.lon, Math.max(map.getZoom(), 10));
      });
      box.appendChild(item);
    });
  } catch (e) {
    box.innerHTML = `<div class="search-empty">✗ Search failed: ${e.message}</div>`;
  }
}
document.getElementById("placeSearchBtn").addEventListener("click", runPlaceSearch);
document.getElementById("placeSearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runPlaceSearch(); }
});

initMap();

// =====================================================
// Shared parameter payload
// =====================================================
function baseParams() {
  return {
    target_CN: parseFloat(document.getElementById("target_CN").value),
    HRT: parseInt(document.getElementById("HRT").value, 10),
    density: parseFloat(document.getElementById("density").value),
    has_cow_manure: cowToggle.checked,
    travel_distance: parseFloat(document.getElementById("travelDistance").value) || 0,
  };
}

function validateParams(statusEl) {
  const p = baseParams();
  if (isNaN(p.target_CN) || p.target_CN <= 0) { fail(statusEl, "Enter a valid C/N ratio."); return null; }
  if (isNaN(p.HRT) || p.HRT <= 0) { fail(statusEl, "Enter a valid HRT (days)."); return null; }
  if (isNaN(p.density) || p.density <= 0) { fail(statusEl, "Enter a valid mixture density."); return null; }
  return p;
}
function fail(el, msg) { el.className = "status error"; el.textContent = msg; }

// =====================================================
// MODE 1 — Calculate From Feddans
// =====================================================
async function runMode1() {
  const runBtn = document.getElementById("runBtn");
  const status = document.getElementById("status");
  const p = validateParams(status);
  if (!p) return;

  const areas = {};
  let anyArea = false;
  document.querySelectorAll(".area-input").forEach((el) => {
    const v = parseFloat(el.value) || 0;
    areas[el.dataset.key] = v;
    if (v > 0) anyArea = true;
  });
  if (!anyArea) { fail(status, "Enter at least one crop area greater than zero."); return; }

  runBtn.disabled = true;
  status.className = "status";
  status.textContent = "Computing…";

  try {
    const res = await fetch("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ areas, ...p }),
    });
    const data = await res.json();
    if (data.error) { fail(status, data.error); return; }
    lastResult = data; lastMode = "mode1";
    renderResults(data, { mode: "mode1", travel: p.travel_distance });
    status.textContent = "Done.";
  } catch (e) {
    fail(status, "Request failed: " + e.message);
  } finally {
    runBtn.disabled = false;
  }
}

// =====================================================
// MODE 2 — Calculate Required Feddans
// =====================================================
async function runMode2() {
  const runBtn = document.getElementById("runBtn2");
  const status = document.getElementById("status2");
  const p = validateParams(status);
  if (!p) return;

  const crops = [];
  document.querySelectorAll(".crop2-check:checked").forEach((el) => crops.push(el.dataset.key));
  if (!crops.length) { fail(status, "Select at least one crop."); return; }

  const targetValue = parseFloat(document.getElementById("targetValue").value);
  if (isNaN(targetValue) || targetValue <= 0) { fail(status, "Enter a required gas quantity > 0."); return; }

  const payload = {
    crops,
    gas_type: document.getElementById("gasType").value,
    unit: document.getElementById("gasUnit").value,
    target_value: targetValue,
    ...p,
  };

  runBtn.disabled = true;
  status.className = "status";
  status.textContent = "Solving for required area…";

  try {
    const res = await fetch("/required_feddans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) { fail(status, data.error); return; }
    lastResult = data; lastMode = "mode2";
    renderResults(data, { mode: "mode2", travel: p.travel_distance });
    status.textContent = "Done.";
  } catch (e) {
    fail(status, "Request failed: " + e.message);
  } finally {
    runBtn.disabled = false;
  }
}

// =====================================================
// Render shared results
// =====================================================
const fmt = (v, d = 2) =>
  (v === null || v === undefined || isNaN(v)) ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: d });

function renderResults(d, opts) {
  const results = document.getElementById("results");
  document.getElementById("resultsTitle").textContent =
    opts.mode === "mode2" ? "Results — Required Feddans" : "Results — From Feddans";

  // Required feddans (mode 2 only)
  const reqWrap = document.getElementById("reqFeddansWrap");
  if (opts.mode === "mode2") {
    reqWrap.classList.remove("hidden");
    document.getElementById("m_reqfeddans").textContent = fmt(d.required_feddans, 3);
  } else {
    reqWrap.classList.add("hidden");
  }

  // Feedstock
  document.getElementById("m_xli").textContent = fmt(d.X_li, 4);
  document.getElementById("m_xn").textContent = fmt(d.X_n, 4);
  document.getElementById("m_mli").textContent = fmt(d.Mli);
  document.getElementById("m_mn").textContent = fmt(d.Mn);
  document.getElementById("m_mt").textContent = fmt(d.M_T);

  // Digester & water
  document.getElementById("m_siday").textContent = fmt(d.SI_day);
  document.getElementById("m_water").textContent = fmt(d.water_per_day);
  document.getElementById("m_dig").textContent = fmt(d.digester_volume);
  document.getElementById("m_vol").textContent = fmt(d.digester_volume_safety);

  // Tanks
  document.getElementById("m_storage").textContent = fmt(d.storage_volume);
  document.getElementById("m_sep").textContent = fmt(d.separation_volume);

  // Gas
  document.getElementById("m_biogas_m3").textContent = fmt(d.annual_biogas_m3);
  document.getElementById("m_biogas_l").textContent = fmt(d.annual_biogas_L, 0);
  document.getElementById("m_ch4pct").textContent = fmt(d.methane_percentage) + " %";
  document.getElementById("m_ch4_m3").textContent = fmt(d.annual_methane_m3);
  document.getElementById("m_ch4_l").textContent = fmt(d.annual_methane_L, 0);

  // Cost
  document.getElementById("m_capex").textContent = "$" + fmt(d.capital_cost);
  document.getElementById("m_transport").textContent = "$" + fmt(d.transport_cost);
  document.getElementById("m_transport_hint").textContent =
    d.has_cow_manure ? "Skipped — local cow manure available"
                     : `$0.09 × ${opts.travel} mi × ${d.M_T} t`;
  document.getElementById("m_electricity").textContent = "$" + fmt(d.electricity_cost);
  document.getElementById("m_opex").textContent = "$" + fmt(d.total_opex);

  // Charts
  document.getElementById("m_peak").textContent = fmt(d.peak, 0);
  document.getElementById("m_mean").textContent = fmt(d.mean, 0);
  document.getElementById("m_annual").textContent = fmt(d.annual_total, 0);
  document.getElementById("m_methane_peak").textContent = fmt(d.methane_peak, 0);
  document.getElementById("m_methane_annual").textContent = fmt(d.methane_annual, 0);
  drawProdChart(d.production_total);
  drawMethaneChart(d.methane_profile);

  results.classList.remove("hidden");
  results.scrollIntoView({ behavior: "smooth", block: "start" });

  // Build tank geometry UI from the new volumes
  buildTankConfig(d);
  document.getElementById("geometry").classList.remove("hidden");
}

// =====================================================
// Charts
// =====================================================
let prodChart = null, methaneChart = null;

function chartOptions(yLabel) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { labels: { color: "#d8f5e6", font: { family: "JetBrains Mono, monospace" } } },
      tooltip: {
        backgroundColor: "#050a08", borderColor: "#1f5a3d", borderWidth: 1,
        titleColor: "#4ade80", bodyColor: "#d8f5e6",
        callbacks: {
          title: (items) => `Day ${items[0].label}`,
          label: (item) => ` ${Math.round(item.parsed.y).toLocaleString()} L/day`,
        },
      },
    },
    scales: {
      x: { title: { display: true, text: "Day of year", color: "#6a8c7a" },
           ticks: { color: "#6a8c7a", maxTicksLimit: 12 }, grid: { color: "rgba(34,197,94,0.06)" } },
      y: { title: { display: true, text: yLabel, color: "#6a8c7a" },
           ticks: { color: "#6a8c7a", callback: (v) => v.toLocaleString() }, grid: { color: "rgba(34,197,94,0.06)" } },
    },
  };
}

function lineChart(ctx, values, label, color, rgba) {
  const grad = ctx.createLinearGradient(0, 0, 0, 380);
  grad.addColorStop(0, rgba.replace("A", "0.5"));
  grad.addColorStop(1, rgba.replace("A", "0.02"));
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: values.map((_, i) => i + 1),
      datasets: [{ label, data: values, borderColor: color, backgroundColor: grad,
        borderWidth: 2, fill: true, tension: 0.25, pointRadius: 0, pointHoverRadius: 4 }],
    },
    options: chartOptions(label),
  });
}

function drawProdChart(values) {
  const ctx = document.getElementById("prodChart").getContext("2d");
  if (prodChart) prodChart.destroy();
  prodChart = lineChart(ctx, values, "Biogas (L/day)", "#4ade80", "rgba(34,197,94,A)");
}
function drawMethaneChart(values) {
  const ctx = document.getElementById("methaneChart").getContext("2d");
  if (methaneChart) methaneChart.destroy();
  methaneChart = lineChart(ctx, values, "Methane (L/day)", "#facc15", "rgba(250,204,21,A)");
}

// =====================================================
// SECTION 4 — Tank Geometry
// =====================================================
function buildTankConfig(d) {
  const wrap = document.querySelector(".tank-config");
  wrap.innerHTML = "";
  TANKS.forEach((t) => {
    const vol = d[t.volKey] || 0;
    const card = document.createElement("div");
    card.className = "tank-card";
    card.innerHTML = `
      <div class="tank-card-head" style="border-color:${t.color}">
        <span class="tank-dot" style="background:${t.color}"></span>${t.name}
      </div>
      <div class="tank-card-vol">Volume: <b>${fmt(vol)}</b> m³</div>
      <label><span>Shape</span>
        <select class="tank-shape" data-id="${t.id}">
          <option value="square">Square</option>
          <option value="circular">Circular</option>
          <option value="rectangular">Rectangular</option>
        </select>
      </label>
      <label><span>Height (m)</span>
        <input type="number" class="tank-height" data-id="${t.id}" value="4" min="0.1" step="0.5">
      </label>`;
    card.dataset.vol = vol;
    card.dataset.id = t.id;
    wrap.appendChild(card);
  });
}

async function runGeometry() {
  const status = document.getElementById("geoStatus");
  if (!lastResult) { fail(status, "Run a simulation first."); return; }

  const tanks = {};
  let valid = true;
  document.querySelectorAll(".tank-card").forEach((card) => {
    const id = card.dataset.id;
    const shape = card.querySelector(".tank-shape").value;
    const height = parseFloat(card.querySelector(".tank-height").value);
    if (isNaN(height) || height <= 0) valid = false;
    tanks[id] = { volume: parseFloat(card.dataset.vol), height, shape };
  });
  if (!valid) { fail(status, "Each tank needs a height greater than zero."); return; }

  status.className = "status";
  status.textContent = "Computing geometry…";
  try {
    const res = await fetch("/tank_geometry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tanks }),
    });
    const data = await res.json();
    tankGeo = data;
    renderGeometry(data);
    drawTankSvg(data);
    document.getElementById("visualization").classList.remove("hidden");
    status.textContent = "Done.";
  } catch (e) {
    fail(status, "Request failed: " + e.message);
  }
}

function dimText(g) {
  if (g.shape === "square") return `Side: ${fmt(g.side, 3)} m`;
  if (g.shape === "circular") return `Radius: ${fmt(g.radius, 3)} m · Diameter: ${fmt(g.diameter, 3)} m`;
  if (g.shape === "rectangular") return `Length: ${fmt(g.length, 3)} m · Width: ${fmt(g.width, 3)} m`;
  return "—";
}

function renderGeometry(data) {
  const out = document.getElementById("geoResults");
  out.classList.remove("hidden");
  out.innerHTML = "";
  TANKS.forEach((t) => {
    const g = data[t.id];
    if (!g || g.error) {
      out.innerHTML += `<div class="tank-result"><h4 style="color:${t.color}">${t.name}</h4>
        <div class="status error">${g ? g.error : "No data"}</div></div>`;
      return;
    }
    out.innerHTML += `
      <div class="tank-result">
        <h4 style="color:${t.color}">${t.name}</h4>
        <div class="tr-grid">
          <div><span>Volume</span><b>${fmt(g.volume)} m³</b></div>
          <div><span>Height</span><b>${fmt(g.height)} m</b></div>
          <div><span>Area</span><b>${fmt(g.area)} m²</b></div>
          <div><span>Shape</span><b style="text-transform:capitalize">${g.shape}</b></div>
          <div class="tr-dims"><span>Dimensions</span><b>${dimText(g)}</b></div>
        </div>
      </div>`;
  });
}

// =====================================================
// SECTION 5 — SVG Visualization (proportional site plan)
// =====================================================
function footprintExtent(fp) {
  if (fp.type === "circle") return { w: fp.r * 2, h: fp.r * 2 };
  return { w: fp.w, h: fp.h };
}

function drawTankSvg(data) {
  const svg = document.getElementById("tankSvg");
  const NS = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";

  const items = TANKS.map((t) => ({ t, g: data[t.id] })).filter((x) => x.g && !x.g.error);
  if (!items.length) return;

  // Proportional scale: largest real-world dimension maps to a fixed pixel box.
  const maxDim = Math.max(...items.map((x) => {
    const e = footprintExtent(x.g.footprint); return Math.max(e.w, e.h);
  }));
  const CELL = 300, PAD = 40, LABEL_H = 90;
  const scale = (CELL - 2 * PAD) / maxDim;

  // Lay tanks left→right
  items.forEach((x, i) => {
    const e = footprintExtent(x.g.footprint);
    const cx = i * CELL + CELL / 2;
    const cy = 190;
    const w = e.w * scale, h = e.h * scale;
    const g = x.g, color = x.t.color;

    // ground tile
    const tile = document.createElementNS(NS, "rect");
    tile.setAttribute("x", i * CELL + 8); tile.setAttribute("y", 40);
    tile.setAttribute("width", CELL - 16); tile.setAttribute("height", 300);
    tile.setAttribute("rx", 10);
    tile.setAttribute("fill", "rgba(34,197,94,0.03)");
    tile.setAttribute("stroke", "rgba(34,197,94,0.12)");
    svg.appendChild(tile);

    let shapeEl;
    if (g.footprint.type === "circle") {
      shapeEl = document.createElementNS(NS, "circle");
      shapeEl.setAttribute("cx", cx); shapeEl.setAttribute("cy", cy);
      shapeEl.setAttribute("r", (w / 2));
    } else {
      shapeEl = document.createElementNS(NS, "rect");
      shapeEl.setAttribute("x", cx - w / 2); shapeEl.setAttribute("y", cy - h / 2);
      shapeEl.setAttribute("width", w); shapeEl.setAttribute("height", h);
      shapeEl.setAttribute("rx", 4);
    }
    shapeEl.setAttribute("fill", color + "22");
    shapeEl.setAttribute("stroke", color);
    shapeEl.setAttribute("stroke-width", "2.5");
    svg.appendChild(shapeEl);

    // labels
    const lines = [
      { t: x.t.name, cls: "svg-title", dy: 0 },
      { t: `Vol ${fmt(g.volume)} m³`, cls: "svg-sub", dy: 18 },
      { t: `Area ${fmt(g.area)} m²`, cls: "svg-sub", dy: 34 },
      { t: dimText(g), cls: "svg-dim", dy: 52 },
    ];
    lines.forEach((ln) => {
      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", cx);
      text.setAttribute("y", cy + h / 2 + 30 + ln.dy);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", ln.cls);
      text.setAttribute("fill", ln.cls === "svg-title" ? color : "#9fc7b3");
      text.textContent = ln.t;
      svg.appendChild(text);
    });
  });

  svg.setAttribute("viewBox", `0 0 ${items.length * CELL} 460`);
}

document.getElementById("runGeoBtn").addEventListener("click", runGeometry);

// =====================================================
// Export — PDF & Excel
// =====================================================
function resultRows(d) {
  const rows = [
    ["Lignocellulosic Fraction X_li", d.X_li],
    ["Cow Manure Fraction X_n", d.X_n],
    ["Total Annual Biomass (ton/yr)", d.Mli],
    ["Required Cow Manure (ton/yr)", d.Mn],
    ["Total Feedstock (ton/yr)", d.M_T],
    ["Daily Feed SI_day (kg/day)", d.SI_day],
    ["Water Required / Day (kg/day)", d.water_per_day],
    ["Digester Volume (m³)", d.digester_volume],
    ["Digester Design ×1.25 (m³)", d.digester_volume_safety],
    ["Storage Tank (m³)", d.storage_volume],
    ["Separation Tank (m³)", d.separation_volume],
    ["Annual Biogas (m³/yr)", d.annual_biogas_m3],
    ["Annual Biogas (L/yr)", d.annual_biogas_L],
    ["Methane Content (%)", d.methane_percentage],
    ["Annual Methane (m³/yr)", d.annual_methane_m3],
    ["Annual Methane (L/yr)", d.annual_methane_L],
    ["CAPEX ($)", d.capital_cost],
    ["OPEX Transport ($)", d.transport_cost],
    ["OPEX Electricity ($)", d.electricity_cost],
    ["Total OPEX ($)", d.total_opex],
  ];
  if (d.required_feddans !== undefined) rows.unshift(["Required Feddans (per crop)", d.required_feddans]);
  return rows;
}

document.getElementById("exportPdf").addEventListener("click", () => {
  if (!lastResult) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text("BioCalc — AD Sizing Report", 14, 18);
  doc.setFontSize(10);
  doc.text(`Mode: ${lastMode === "mode2" ? "Required Feddans" : "From Feddans"}`, 14, 26);
  doc.text(new Date().toLocaleString(), 14, 32);

  let y = 44;
  resultRows(lastResult).forEach(([k, v]) => {
    doc.text(String(k), 14, y);
    doc.text(fmt(v, 4), 150, y, { align: "right" });
    y += 7;
    if (y > 280) { doc.addPage(); y = 20; }
  });

  // Tank geometry
  if (Object.keys(tankGeo).length) {
    doc.addPage(); y = 20;
    doc.setFontSize(14); doc.text("Tank Geometry", 14, y); y += 10;
    doc.setFontSize(10);
    TANKS.forEach((t) => {
      const g = tankGeo[t.id];
      if (!g || g.error) return;
      doc.text(`${t.name} — ${g.shape}`, 14, y); y += 6;
      doc.text(`Vol ${fmt(g.volume)} m³ · Height ${fmt(g.height)} m · Area ${fmt(g.area)} m² · ${dimText(g)}`, 18, y);
      y += 9;
    });
  }
  doc.save("biocalc-report.pdf");
});

document.getElementById("exportXlsx").addEventListener("click", () => {
  if (!lastResult) return;
  const wb = XLSX.utils.book_new();
  const main = XLSX.utils.aoa_to_sheet([["Metric", "Value"], ...resultRows(lastResult)]);
  XLSX.utils.book_append_sheet(wb, main, "Results");

  if (Object.keys(tankGeo).length) {
    const rows = [["Tank", "Shape", "Volume (m³)", "Height (m)", "Area (m²)", "Dimensions"]];
    TANKS.forEach((t) => {
      const g = tankGeo[t.id];
      if (!g || g.error) return;
      rows.push([t.name, g.shape, g.volume, g.height, g.area, dimText(g)]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Tank Geometry");
  }
  XLSX.writeFile(wb, "biocalc-report.xlsx");
});

// =====================================================
// Wire up run buttons
// =====================================================
document.getElementById("runBtn").addEventListener("click", runMode1);
document.getElementById("runBtn2").addEventListener("click", runMode2);
