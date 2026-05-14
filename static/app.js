// ===== Tabs =====
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// ===== Cow manure toggle =====
const cowToggle = document.getElementById("hasCowManure");
const travelWrap = document.getElementById("travelWrap");
function syncCowManure() {
  if (cowToggle.checked) travelWrap.classList.remove("show");
  else travelWrap.classList.add("show");
}
cowToggle.addEventListener("change", syncCowManure);
syncCowManure();

// ===== Map (Leaflet + OpenStreetMap) =====
let map, marker;
const DEFAULT_COORDS = [28.8336, 30.7849];

function initMap() {
  map = L.map("map", {
    center: DEFAULT_COORDS,
    zoom: 6,
    zoomControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  const greenIcon = L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width:18px;height:18px;border-radius:50%;
      background:#22c55e;border:3px solid #052e16;
      box-shadow:0 0 12px #22c55e, 0 0 0 4px rgba(34,197,94,0.25);
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  marker = L.marker(DEFAULT_COORDS, { icon: greenIcon, draggable: true }).addTo(map);

  map.on("click", (e) => setLocation(e.latlng.lat, e.latlng.lng));
  marker.on("dragend", () => {
    const ll = marker.getLatLng();
    setLocation(ll.lat, ll.lng);
  });

  // initial weather load
  fetchWeather(DEFAULT_COORDS[0], DEFAULT_COORDS[1]);
}

function setLocation(lat, lon) {
  const lat4 = parseFloat(lat.toFixed(4));
  const lon4 = parseFloat(lon.toFixed(4));
  marker.setLatLng([lat4, lon4]);
  document.getElementById("latInput").value = lat4;
  document.getElementById("lonInput").value = lon4;
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

document.getElementById("searchBtn").addEventListener("click", () => {
  const lat = parseFloat(document.getElementById("latInput").value);
  const lon = parseFloat(document.getElementById("lonInput").value);
  if (isNaN(lat) || isNaN(lon)) {
    const el = document.getElementById("weatherStatus");
    el.className = "weather-status error";
    el.textContent = "✗ Please enter valid numeric coordinates.";
    return;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    const el = document.getElementById("weatherStatus");
    el.className = "weather-status error";
    el.textContent = "✗ Coordinates out of range (lat ±90, lon ±180).";
    return;
  }
  map.setView([lat, lon], Math.max(map.getZoom(), 8));
  setLocation(lat, lon);
});

initMap();

// ===== Simulation =====
let prodChart = null;
let methaneChart = null;

async function runSimulation() {
  const runBtn = document.getElementById("runBtn");
  const status = document.getElementById("status");
  const results = document.getElementById("results");

  const areas = {};
  document.querySelectorAll(".area-input").forEach((el) => {
    areas[el.dataset.key] = parseFloat(el.value) || 0;
  });

  const payload = {
    areas,
    target_CN: parseFloat(document.getElementById("target_CN").value),
    HRT: parseInt(document.getElementById("HRT").value, 10),
    density: parseFloat(document.getElementById("density").value),
    has_cow_manure: cowToggle.checked,
    travel_distance: parseFloat(document.getElementById("travelDistance").value) || 0,
  };

  runBtn.disabled = true;
  status.className = "status";
  status.textContent = "Computing…";

  try {
    const res = await fetch("/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.error) {
      status.className = "status error";
      status.textContent = data.error;
      results.classList.add("hidden");
      return;
    }

    // Mixture & sizing
    document.getElementById("m_xli").textContent = data.X_li.toFixed(4);
    document.getElementById("m_xn").textContent = data.X_n.toFixed(4);
    document.getElementById("m_mt").textContent = data.M_T.toLocaleString();
    document.getElementById("m_siday").textContent = data.SI_day.toLocaleString();
    document.getElementById("m_vol").textContent = data.digester_volume_safety.toLocaleString();
    document.getElementById("m_vol_raw").textContent =
      `Raw: ${data.digester_volume.toLocaleString()} m³ × 1.25 safety factor`;

    // Cost analysis
    document.getElementById("m_capex").textContent = "$" + data.capital_cost.toLocaleString();
    document.getElementById("m_transport").textContent = "$" + data.transport_cost.toLocaleString();
    document.getElementById("m_transport_hint").textContent =
      data.has_cow_manure
        ? "Skipped — local cow manure available"
        : `$0.09 × ${payload.travel_distance} mi × ${data.M_T} t`;
    document.getElementById("m_electricity").textContent = "$" + data.electricity_cost.toLocaleString();
    document.getElementById("m_opex").textContent = "$" + data.total_opex.toLocaleString();

    // Biogas summary
    document.getElementById("m_peak").textContent = Math.round(data.peak).toLocaleString();
    document.getElementById("m_mean").textContent = Math.round(data.mean).toLocaleString();
    document.getElementById("m_annual").textContent = Math.round(data.annual_total).toLocaleString();

    // Methane summary
    document.getElementById("m_methane_peak").textContent = Math.round(data.methane_peak).toLocaleString();
    document.getElementById("m_methane_annual").textContent = Math.round(data.methane_annual).toLocaleString();

    drawProdChart(data.production_total);
    drawMethaneChart(data.methane_profile);

    results.classList.remove("hidden");
    status.textContent = "Done.";
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    status.className = "status error";
    status.textContent = "Request failed: " + e.message;
  } finally {
    runBtn.disabled = false;
  }
}

function chartOptions(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { labels: { color: "#d8f5e6", font: { family: "JetBrains Mono, monospace" } } },
      tooltip: {
        backgroundColor: "#050a08",
        borderColor: "#1f5a3d",
        borderWidth: 1,
        titleColor: "#4ade80",
        bodyColor: "#d8f5e6",
        callbacks: {
          title: (items) => `Day ${items[0].label}`,
          label: (item) => ` ${Math.round(item.parsed.y).toLocaleString()} L/day`,
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "Day of year", color: "#6a8c7a" },
        ticks: { color: "#6a8c7a", maxTicksLimit: 12 },
        grid: { color: "rgba(34, 197, 94, 0.06)" },
      },
      y: {
        title: { display: true, text: yLabel, color: "#6a8c7a" },
        ticks: { color: "#6a8c7a", callback: (v) => v.toLocaleString() },
        grid: { color: "rgba(34, 197, 94, 0.06)" },
      },
    },
  };
}

function drawProdChart(values) {
  const ctx = document.getElementById("prodChart").getContext("2d");
  if (prodChart) prodChart.destroy();
  const grad = ctx.createLinearGradient(0, 0, 0, 380);
  grad.addColorStop(0, "rgba(34, 197, 94, 0.5)");
  grad.addColorStop(1, "rgba(34, 197, 94, 0.02)");
  prodChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: values.map((_, i) => i + 1),
      datasets: [{
        label: "Biogas Production (L/day)",
        data: values,
        borderColor: "#4ade80",
        backgroundColor: grad,
        borderWidth: 2,
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
      }],
    },
    options: chartOptions("Biogas (L/day)"),
  });
}

function drawMethaneChart(values) {
  const ctx = document.getElementById("methaneChart").getContext("2d");
  if (methaneChart) methaneChart.destroy();
  const grad = ctx.createLinearGradient(0, 0, 0, 380);
  grad.addColorStop(0, "rgba(250, 204, 21, 0.45)");
  grad.addColorStop(1, "rgba(250, 204, 21, 0.02)");
  methaneChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: values.map((_, i) => i + 1),
      datasets: [{
        label: "Methane Production (L/day) — 59% CH₄",
        data: values,
        borderColor: "#facc15",
        backgroundColor: grad,
        borderWidth: 2,
        fill: true,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4,
      }],
    },
    options: chartOptions("CH₄ (L/day)"),
  });
}

document.getElementById("runBtn").addEventListener("click", runSimulation);
