from flask import Flask, render_template, request, jsonify
from urllib.request import urlopen, Request
from urllib.parse import urlencode
import json
import os
import numpy as np

_ROOT = os.path.dirname(os.path.abspath(__file__))
app = Flask(
    __name__,
    template_folder=os.path.join(_ROOT, "templates"),
    static_folder=os.path.join(_ROOT, "static"),
)

# ---------------------------------------------------------------------------
# Cost constants
# ---------------------------------------------------------------------------
CAPITAL_COST_PER_M3 = 112          # $ per m³ of digester volume (×1.25 design)
TRANSPORT_COST_PER_TON_MILE = 0.09  # $ per (ton * mile) for cow manure travel
ELECTRICITY_COST_PER_TON = 15      # $ per ton of total annual biomass

# ---------------------------------------------------------------------------
# Crop database
# ---------------------------------------------------------------------------
WASTE_PER_FEDDAN = {
    "SS":  1.78, "SCR": 2.0, "RS": 2.0, "WS":  2.0, "CS":  2.0,
    "SCB": 8.0,  "GPL": 0.6, "LPL": 0.5, "BPL": 2.0,
    "PT":  0.96, "PG":  0.0, "OPB": 1.5, "GPB": 0.6, "MGP": 2.0,
}

CROP_LABELS = {
    "SS":  "Sorghum stalk",
    "SCR": "Sugarcane reed",
    "RS":  "Rice straw",
    "WS":  "Wheat straw",
    "CS":  "Corn stalk",
    "SCB": "Sugarcane bagasse",
    "GPL": "Grape pruning (leaves)",
    "LPL": "Citrus pruning leaves (Lemon)",
    "BPL": "Banana pruning (leaves)",
    "PT":  "Palm tree",
    "PG":  "Pampas grass",
    "OPB": "Citrus pruning branches (Orange)",
    "GPB": "Grape pruning branches",
    "MGP": "Mango + Guava pruning",
}

# Map the A1..A14 symbols used in the source models to internal keys
SYMBOL_TO_KEY = {
    "A1": "SS",  "A2": "SCR", "A3": "RS",  "A4": "WS",  "A5": "CS",
    "A6": "SCB", "A7": "GPL", "A8": "LPL", "A9": "BPL",
    "A10": "PT", "A11": "PG", "A12": "OPB", "A13": "GPB", "A14": "MGP",
}
KEY_TO_SYMBOL = {v: k for k, v in SYMBOL_TO_KEY.items()}

GROUP_OF = {
    "SS": "G1", "SCR": "G1", "RS": "G1", "WS": "G1", "CS": "G1", "SCB": "G1",
    "GPL": "G2", "LPL": "G2", "BPL": "G2",
    "PT": "G3", "PG": "G3", "OPB": "G3", "GPB": "G3", "MGP": "G3",
}

GROUP_1 = ["SS", "SCR", "RS", "WS", "CS", "SCB"]
GROUP_2 = ["GPL", "LPL", "BPL"]
GROUP_3 = ["PT", "PG", "OPB", "GPB", "MGP"]

GROUPS = [
    ("Group 1 — Field crops", GROUP_1),
    ("Group 2 — Pruning leaves", GROUP_2),
    ("Group 3 — Pruning branches & palm", GROUP_3),
]

# ---------------------------------------------------------------------------
# Group + cow manure properties
#   VS = volatile solids, M = methane fraction, w = water content,
#   d = dry content, C/N = elemental carbon / nitrogen, GK = Gompertz [P, Rm, lag]
# ---------------------------------------------------------------------------
GROUP_DATA = {
    "G1": {"VS": 0.9127,   "M": 0.603, "w": 0.0499, "C": 434.78, "N": 5.4,   "GK": [505.889, 32.145, -2.149]},
    "G2": {"VS": 0.808367, "M": 0.598, "w": 0.0528, "C": 410.0,  "N": 9.133, "GK": [404.6696, 35.88, -2.0848]},
    "G3": {"VS": 0.90216,  "M": 0.615, "w": 0.062,  "C": 452.0,  "N": 6.22,  "GK": [320.209, 13.395, -3.698]},
    "CM": {"VS": 0.7642,   "M": 0.566, "w": 0.15,   "C": 324.0,  "N": 17.0,  "GK": [458.6850926, 34.53505804, 5.998816047]},
}
for _g in GROUP_DATA.values():
    _g["d"] = 1 - _g["w"]

TARGET_CN_DEFAULT = 43
HRT_DEFAULT = 40
DENSITY_DEFAULT = 1000


# ---------------------------------------------------------------------------
# Closed-form C/N mixture solver (replaces the old sympy solve).
#   For the selected lignocellulosic groups sharing one fraction X_li:
#       A  = Σ C_g · d_g     Cc = Σ N_g · d_g   (over selected groups)
#       B  = C_cm · d_cm     D  = N_cm · d_cm
#       X_li = (R·D − B) / ((A − B) − R·(Cc − D))
#   Verified to match the sympy solution to ~15 digits.
# ---------------------------------------------------------------------------
def solve_mixture(target_CN, present_groups):
    if not present_groups:
        return None, None
    A = sum(GROUP_DATA[g]["C"] * GROUP_DATA[g]["d"] for g in present_groups)
    Cc = sum(GROUP_DATA[g]["N"] * GROUP_DATA[g]["d"] for g in present_groups)
    B = GROUP_DATA["CM"]["C"] * GROUP_DATA["CM"]["d"]
    D = GROUP_DATA["CM"]["N"] * GROUP_DATA["CM"]["d"]
    R = target_CN
    denom = (A - B) - R * (Cc - D)
    if denom == 0:
        return None, None
    X_li = (R * D - B) / denom
    return X_li, 1 - X_li


def gompertz(t, P, Rm, lag):
    return P * np.exp(-1 * np.exp(((Rm * np.e) / P) * (lag - t) + 1))


# ---------------------------------------------------------------------------
# Core engine — given cultivated areas (feddans per key) compute the full
# AD sizing, tank volumes, gas production and cost analysis.
# Mirrors "1st mode AD tool with tanks.txt".
# ---------------------------------------------------------------------------
def simulate(areas, target_CN, HRT, density_mix,
             travel_distance_mi=0, has_cow_manure=False):
    avail = {k: WASTE_PER_FEDDAN[k] * float(areas.get(k, 0) or 0) for k in WASTE_PER_FEDDAN}
    M_G1 = sum(avail[k] for k in GROUP_1)
    M_G2 = sum(avail[k] for k in GROUP_2)
    M_G3 = sum(avail[k] for k in GROUP_3)
    group_mass = {"G1": M_G1, "G2": M_G2, "G3": M_G3}
    Mli = M_G1 + M_G2 + M_G3
    if Mli <= 0:
        return {"error": "No biomass entered. Set at least one area > 0."}

    present = [g for g in ("G1", "G2", "G3") if group_mass[g] > 0]
    X_li, X_n = solve_mixture(target_CN, present)
    if X_li is None:
        return {"error": "Could not solve mixture for the given C/N ratio."}

    # Per-group mixing fractions within the lignocellulosic portion
    x = {g: (group_mass[g] / Mli) * X_li for g in ("G1", "G2", "G3")}

    Mn = X_n * (Mli / X_li)          # required cow manure (ton/year)
    M_T = Mn + Mli                   # total feedstock (ton/year)

    # Mixture water / dry / VS / methane content
    w_mix = sum(x[g] * GROUP_DATA[g]["w"] for g in x) + X_n * GROUP_DATA["CM"]["w"]
    VS_mix = (sum(x[g] * GROUP_DATA[g]["d"] * GROUP_DATA[g]["VS"] for g in x)
              + X_n * GROUP_DATA["CM"]["d"] * GROUP_DATA["CM"]["VS"])
    methane_fraction = (sum(x[g] * GROUP_DATA[g]["M"] for g in x)
                        + X_n * GROUP_DATA["CM"]["M"])

    add_water = 0 if w_mix >= 0.88 else (0.88 - w_mix) / (1 - 0.88)

    SI_day = (M_T * 1000) / 365                       # daily feed (kg/day)
    water_per_day = SI_day * add_water                # added water (kg/day)
    Volume_Flow = (SI_day * (1 + add_water)) / density_mix
    digester_volume = Volume_Flow * HRT
    digester_volume_safety = digester_volume * 1.25

    # Tank volumes (from the 1st model)
    separation_volume = (digester_volume / 4) * 1.25
    daily_slurry = SI_day + water_per_day
    storage_volume = (7 * daily_slurry) / 1000        # 7 days of slurry, m³

    # ---- Gas production: superimpose one feed's Gompertz curve over 365 days ----
    xData = np.arange(0, HRT + 1)
    # NOTE: reproduces the original model's group-curve wiring exactly.
    y1 = gompertz(xData, GROUP_DATA["G1"]["GK"][0], GROUP_DATA["G1"]["GK"][1], GROUP_DATA["G1"]["GK"][2])
    y2 = gompertz(xData, GROUP_DATA["G1"]["GK"][0], GROUP_DATA["G2"]["GK"][1], GROUP_DATA["G3"]["GK"][2])
    y3 = gompertz(xData, GROUP_DATA["G1"]["GK"][0], GROUP_DATA["G2"]["GK"][1], GROUP_DATA["G3"]["GK"][2])
    y4 = gompertz(xData, GROUP_DATA["CM"]["GK"][0], GROUP_DATA["CM"]["GK"][1], GROUP_DATA["CM"]["GK"][2])
    y_mix = y1 * x["G1"] + y2 * x["G2"] + y3 * x["G3"] + y4 * X_n
    daily_prod = np.diff(y_mix)                        # L/(kgVS·d)
    one_feed_daily = SI_day * daily_prod * VS_mix     # L/day from one day's feed

    production_total = np.zeros(365)
    L = len(one_feed_daily)
    for day in range(365):
        end = min(365, day + L)
        production_total[day:end] += one_feed_daily[:end - day]

    methane_profile = production_total * methane_fraction

    annual_biogas_L = float(production_total.sum())
    annual_biogas_m3 = annual_biogas_L / 1000
    annual_methane_L = annual_biogas_L * methane_fraction
    annual_methane_m3 = annual_methane_L / 1000

    # ---- Costs ----
    capital_cost = digester_volume_safety * CAPITAL_COST_PER_M3
    transport_cost = (travel_distance_mi * M_T * TRANSPORT_COST_PER_TON_MILE) if not has_cow_manure else 0
    electricity_cost = ELECTRICITY_COST_PER_TON * M_T
    total_opex = transport_cost + electricity_cost

    return {
        "X_li": round(X_li, 4),
        "X_n": round(X_n, 4),
        "Mli": round(Mli, 2),
        "Mn": round(Mn, 2),
        "M_T": round(M_T, 2),
        "SI_day": round(SI_day, 2),
        "water_per_day": round(water_per_day, 2),
        "add_water": round(add_water, 4),
        "digester_volume": round(digester_volume, 2),
        "digester_volume_safety": round(digester_volume_safety, 2),
        "separation_volume": round(separation_volume, 2),
        "storage_volume": round(storage_volume, 2),
        "methane_fraction": round(methane_fraction, 4),
        "methane_percentage": round(methane_fraction * 100, 2),
        "annual_biogas_m3": round(annual_biogas_m3, 2),
        "annual_biogas_L": round(annual_biogas_L, 2),
        "annual_methane_m3": round(annual_methane_m3, 2),
        "annual_methane_L": round(annual_methane_L, 2),
        "production_total": [round(v, 2) for v in production_total.tolist()],
        "methane_profile": [round(v, 2) for v in methane_profile.tolist()],
        "peak": round(float(production_total.max()), 2),
        "mean": round(float(production_total.mean()), 2),
        "annual_total": round(annual_biogas_L, 2),
        "methane_peak": round(float(methane_profile.max()), 2),
        "methane_annual": round(annual_methane_L, 2),
        "capital_cost": round(capital_cost, 2),
        "transport_cost": round(transport_cost, 2),
        "electricity_cost": round(electricity_cost, 2),
        "total_opex": round(total_opex, 2),
        "has_cow_manure": has_cow_manure,
    }


def convert_to_m3(value, unit):
    unit = (unit or "m3").lower().strip()
    if unit in ("m3", "m³", "cubic_meter", "cubic_meters"):
        return value
    if unit in ("l", "liter", "liters", "litre", "litres"):
        return value / 1000
    raise ValueError("Invalid unit. Use 'm3' or 'liter'.")


# ---------------------------------------------------------------------------
# Mode 2 — given a target annual biogas/methane, find required feddans.
# All selected crops share an equal feddan value; we bisection-solve for it.
# Mirrors "2nd mode AD tool.txt".
# ---------------------------------------------------------------------------
def required_feddans(crop_keys, target_value, gas_type, unit,
                     target_CN, HRT, density_mix,
                     travel_distance_mi=0, has_cow_manure=False):
    crop_keys = [k for k in crop_keys if WASTE_PER_FEDDAN.get(k, 0) > 0]
    if not crop_keys:
        return {"error": "Select at least one crop with non-zero waste yield."}

    target_m3 = convert_to_m3(float(target_value), unit)
    if target_m3 <= 0:
        return {"error": "Required gas quantity must be greater than zero."}

    metric = "annual_biogas_m3" if gas_type == "biogas" else "annual_methane_m3"

    def produced(feddans):
        areas = {k: feddans for k in crop_keys}
        res = simulate(areas, target_CN, HRT, density_mix,
                       travel_distance_mi, has_cow_manure)
        if "error" in res:
            return None, res
        return res[metric], res

    # Expand upper bound until it meets target
    high = 1.0
    last = None
    for _ in range(60):
        val, res = produced(high)
        if val is None:
            return res
        last = res
        if val >= target_m3:
            break
        high *= 2
    else:
        return {"error": "Could not reach the requested gas quantity within bounds."}

    low = 0.0
    for _ in range(100):
        mid = (low + high) / 2
        val, res = produced(mid)
        if val is None:
            return res
        if val < target_m3:
            low = mid
        else:
            high = mid
            last = res

    last = last or res
    last["required_feddans"] = round(high, 4)
    last["per_crop_feddans"] = {KEY_TO_SYMBOL[k]: round(high, 4) for k in crop_keys}
    last["target_gas_type"] = gas_type
    last["target_value"] = target_value
    last["target_unit"] = unit
    return last


# ---------------------------------------------------------------------------
# Tank geometry
# ---------------------------------------------------------------------------
def tank_geometry(volume, height, shape):
    volume = float(volume)
    height = float(height)
    if height <= 0:
        return {"error": "Height must be greater than zero."}
    area = volume / height
    out = {"volume": round(volume, 2), "height": round(height, 2),
           "area": round(area, 2), "shape": shape}

    if shape == "square":
        side = area ** 0.5
        out["side"] = round(side, 3)
        out["footprint"] = {"type": "square", "w": side, "h": side}
    elif shape == "circular":
        radius = (area / np.pi) ** 0.5
        out["radius"] = round(radius, 3)
        out["diameter"] = round(2 * radius, 3)
        out["footprint"] = {"type": "circle", "r": radius}
    elif shape == "rectangular":
        width = (area / 1.5) ** 0.5
        length = 1.5 * width
        out["width"] = round(width, 3)
        out["length"] = round(length, 3)
        out["footprint"] = {"type": "rect", "w": length, "h": width}
    else:
        return {"error": f"Unknown shape: {shape}"}
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template(
        "index.html",
        groups=GROUPS,
        labels=CROP_LABELS,
        waste=WASTE_PER_FEDDAN,
        symbols=KEY_TO_SYMBOL,
        defaults={"SCR": 3, "OPB": 6},
    )


@app.route("/simulate", methods=["POST"])
def simulate_endpoint():
    data = request.get_json(force=True)
    areas = data.get("areas", {})
    try:
        target_CN = float(data.get("target_CN", TARGET_CN_DEFAULT))
        HRT = int(data.get("HRT", HRT_DEFAULT))
        density = float(data.get("density", DENSITY_DEFAULT))
        travel_distance = float(data.get("travel_distance", 0) or 0)
        has_cow_manure = bool(data.get("has_cow_manure", False))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid numeric parameter."}), 400
    return jsonify(simulate(areas, target_CN, HRT, density,
                            travel_distance, has_cow_manure))


@app.route("/required_feddans", methods=["POST"])
def required_feddans_endpoint():
    data = request.get_json(force=True)
    crops = data.get("crops", [])              # list of internal keys
    gas_type = data.get("gas_type", "biogas")
    unit = data.get("unit", "m3")
    try:
        target_value = float(data.get("target_value", 0))
        target_CN = float(data.get("target_CN", TARGET_CN_DEFAULT))
        HRT = int(data.get("HRT", HRT_DEFAULT))
        density = float(data.get("density", DENSITY_DEFAULT))
        travel_distance = float(data.get("travel_distance", 0) or 0)
        has_cow_manure = bool(data.get("has_cow_manure", False))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid numeric parameter."}), 400
    if gas_type not in ("biogas", "methane"):
        return jsonify({"error": "gas_type must be 'biogas' or 'methane'."}), 400
    try:
        result = required_feddans(crops, target_value, gas_type, unit,
                                  target_CN, HRT, density,
                                  travel_distance, has_cow_manure)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(result)


@app.route("/tank_geometry", methods=["POST"])
def tank_geometry_endpoint():
    data = request.get_json(force=True)
    tanks = data.get("tanks", {})
    out = {}
    for name, t in tanks.items():
        try:
            out[name] = tank_geometry(t.get("volume", 0), t.get("height", 0),
                                      t.get("shape", "square"))
        except (TypeError, ValueError):
            out[name] = {"error": "Invalid tank input."}
    return jsonify(out)


@app.route("/weather")
def weather():
    """Proxy Open-Meteo (free, no API key). https://open-meteo.com/"""
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid coordinates"}), 400
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return jsonify({"error": "Coordinates out of range"}), 400

    params = urlencode({"latitude": lat, "longitude": lon, "current": "temperature_2m"})
    url = f"https://api.open-meteo.com/v1/forecast?{params}"
    try:
        req = Request(url, headers={"User-Agent": "BioCalc/1.0"})
        with urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        temp = payload.get("current", {}).get("temperature_2m")
        if temp is None:
            return jsonify({"error": "Temperature unavailable for this point"}), 502
        return jsonify({"temperature": temp, "lat": lat, "lon": lon})
    except Exception as e:
        return jsonify({"error": f"Weather API failed: {e}"}), 502


@app.route("/geocode")
def geocode():
    """Proxy OpenStreetMap Nominatim search (free, no API key)."""
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"error": "Empty query"}), 400
    params = urlencode({"q": q, "format": "json", "limit": 5, "addressdetails": 1})
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    try:
        req = Request(url, headers={"User-Agent": "BioCalc/1.0 (biogas sizing tool)"})
        with urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        results = [{
            "name": item.get("display_name"),
            "lat": float(item["lat"]),
            "lon": float(item["lon"]),
        } for item in payload]
        return jsonify({"results": results})
    except Exception as e:
        return jsonify({"error": f"Geocoding failed: {e}"}), 502


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
