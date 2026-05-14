from flask import Flask, render_template, request, jsonify
from urllib.request import urlopen, Request
from urllib.parse import urlencode
import json
import numpy as np
from scipy.ndimage import shift
from sympy import symbols, Eq, solve

app = Flask(__name__)

# Cost constants
CAPITAL_COST_PER_M3 = 112        # $ per m³ of digester volume
TRANSPORT_COST_PER_TON_MILE = 0.09  # $ per (ton * mile) for cow manure travel
ELECTRICITY_COST_PER_TON = 15    # $ per ton of total annual biomass
METHANE_CONTENT_FRACTION = 0.59  # 59% methane content in biogas

WASTE_PER_FEDDAN = {
    "SS":  1.78,  "SCR": 2.0,  "RS": 2.0,  "WS":  2.0, "CS":  2.0,
    "SCB": 8.0,   "GPL": 0.6,  "LPL": 0.5, "BPL": 2.0,
    "PT":  0.96,  "PG":  0.0,  "OPB": 1.5, "GPB": 0.6, "MGP": 2.0,
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

GROUP_1 = ["SS", "SCR", "RS", "WS", "CS", "SCB"]
GROUP_2 = ["GPL", "LPL", "BPL"]
GROUP_3 = ["PT", "PG", "OPB", "GPB", "MGP"]

GROUPS = [
    ("Group 1 — Field crops", GROUP_1),
    ("Group 2 — Pruning leaves", GROUP_2),
    ("Group 3 — Pruning branches & palm", GROUP_3),
]

VS1, VS2, VS3, VS4 = 0.9127, 0.808367, 0.90216, 0.7642
M1, M2, M3, M4 = 0.603, 0.598, 0.615, 0.566
w1, w2, w3, w4 = 0.0499, 0.0528, 0.062, 0.15
d1, d2, d3, d4 = 1 - w1, 1 - w2, 1 - w3, 1 - w4

Elements_G1 = [434.78, 5.4]
Elements_G2 = [410, 9.133]
Elements_G3 = [452, 6.22]
Elements_CM = [324, 17]

GK_G1 = [505.889, 32.145, -2.149]
GK_G2 = [404.6696, 35.88, -2.0848]
GK_G3 = [320.209, 13.395, -3.698]
GK_CM = [458.6850926, 34.53505804, 5.998816047]


def calculate_mixture(target_CN, M_G1, M_G2, M_G3):
    X_li, X_n = symbols('X_li X_n')
    sel_C, sel_N, sel_D = [], [], []
    if M_G1 > 0:
        sel_C.append(Elements_G1[0]); sel_N.append(Elements_G1[1]); sel_D.append(d1)
    if M_G2 > 0:
        sel_C.append(Elements_G2[0]); sel_N.append(Elements_G2[1]); sel_D.append(d2)
    if M_G3 > 0:
        sel_C.append(Elements_G3[0]); sel_N.append(Elements_G3[1]); sel_D.append(d3)
    if not sel_C:
        return None, None
    num = sum(C * X_li * D for C, D in zip(sel_C, sel_D)) + Elements_CM[0] * X_n * d4
    den = sum(N * X_li * D for N, D in zip(sel_N, sel_D)) + Elements_CM[1] * X_n * d4
    sol = solve((Eq(num / den, target_CN), Eq(X_li + X_n, 1)), (X_li, X_n))
    return float(sol[X_li].evalf()), float(sol[X_n].evalf())


def gompertz(t, P, Rm, l):
    return P * np.exp(-1 * np.exp(((Rm * np.e) / P) * (l - t) + 1))


def simulate(areas, target_CN, HRT, density_mix, travel_distance_mi=0, has_cow_manure=False):
    avail = {k: WASTE_PER_FEDDAN[k] * float(areas.get(k, 0) or 0) for k in WASTE_PER_FEDDAN}
    M_G1 = sum(avail[k] for k in GROUP_1)
    M_G2 = sum(avail[k] for k in GROUP_2)
    M_G3 = sum(avail[k] for k in GROUP_3)
    Mli = M_G1 + M_G2 + M_G3
    if Mli <= 0:
        return {"error": "No biomass entered. Set at least one area > 0."}

    X_li, X_n = calculate_mixture(target_CN, M_G1, M_G2, M_G3)
    if X_li is None:
        return {"error": "Could not solve mixture for the given C/N ratio."}

    x1 = (M_G1 / Mli) * X_li
    x2 = (M_G2 / Mli) * X_li
    x3 = (M_G3 / Mli) * X_li

    Mn = X_n * (Mli / X_li)
    M_T = Mn + Mli

    w_mix = x1 * w1 + x2 * w2 + x3 * w3 + X_n * w4
    VS_mix = x1 * d1 * VS1 + x2 * d2 * VS2 + x3 * d3 * VS3 + X_n * d4 * VS4
    add_water = 0 if w_mix >= 0.88 else (0.88 - w_mix) / (1 - 0.88)

    SI_day = (M_T * 1000) / 365
    Volume_Flow = (SI_day * (1 + add_water)) / density_mix
    digester_volume = Volume_Flow * HRT

    xData = np.arange(0, HRT + 1)
    y1 = gompertz(xData, GK_G1[0], GK_G1[1], GK_G1[2])
    y2 = gompertz(xData, GK_G1[0], GK_G2[1], GK_G3[2])
    y3 = gompertz(xData, GK_G1[0], GK_G2[1], GK_G3[2])
    y4 = gompertz(xData, GK_CM[0], GK_CM[1], GK_CM[2])
    y_mix = y1 * x1 + y2 * x2 + y3 * x3 + y4 * X_n
    daily_prod = np.diff(y_mix)
    total_daily_prod = SI_day * daily_prod * VS_mix

    n2 = 365
    base = np.append(total_daily_prod, np.zeros(n2 - len(daily_prod))).astype(np.float64)
    production_total = np.zeros(n2)
    for i in range(n2):
        production_total += shift(base, i, cval=0)

    digester_volume_safety = digester_volume * 1.25

    # Annual methane profile (L/day) = biogas profile * methane fraction
    methane_profile = production_total * METHANE_CONTENT_FRACTION

    # Costs
    capital_cost = digester_volume_safety * CAPITAL_COST_PER_M3
    # Transport cost: only applies if user has NO local cow manure (must truck it in)
    transport_cost = (travel_distance_mi * M_T * TRANSPORT_COST_PER_TON_MILE) if not has_cow_manure else 0
    electricity_cost = ELECTRICITY_COST_PER_TON * M_T
    total_opex = transport_cost + electricity_cost

    return {
        "X_li": round(X_li, 4),
        "X_n": round(X_n, 4),
        "M_T": round(M_T, 2),
        "Mli": round(Mli, 2),
        "Mn": round(Mn, 2),
        "SI_day": round(SI_day, 2),
        "digester_volume": round(digester_volume, 2),
        "digester_volume_safety": round(digester_volume_safety, 2),
        "production_total": [round(v, 2) for v in production_total.tolist()],
        "methane_profile": [round(v, 2) for v in methane_profile.tolist()],
        "peak": round(float(production_total.max()), 2),
        "mean": round(float(production_total.mean()), 2),
        "annual_total": round(float(production_total.sum()), 2),
        "methane_peak": round(float(methane_profile.max()), 2),
        "methane_annual": round(float(methane_profile.sum()), 2),
        "capital_cost": round(capital_cost, 2),
        "transport_cost": round(transport_cost, 2),
        "electricity_cost": round(electricity_cost, 2),
        "total_opex": round(total_opex, 2),
        "has_cow_manure": has_cow_manure,
    }


@app.route("/")
def index():
    return render_template(
        "index.html",
        groups=GROUPS,
        labels=CROP_LABELS,
        waste=WASTE_PER_FEDDAN,
        defaults={"SCR": 3, "OPB": 6},
    )


@app.route("/simulate", methods=["POST"])
def simulate_endpoint():
    data = request.get_json(force=True)
    areas = data.get("areas", {})
    try:
        target_CN = float(data.get("target_CN", 43))
        HRT = int(data.get("HRT", 40))
        density = float(data.get("density", 1000))
        travel_distance = float(data.get("travel_distance", 0) or 0)
        has_cow_manure = bool(data.get("has_cow_manure", False))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid numeric parameter."}), 400
    return jsonify(simulate(areas, target_CN, HRT, density, travel_distance, has_cow_manure))


@app.route("/weather")
def weather():
    """Proxy Open-Meteo (free, no API key required). https://open-meteo.com/"""
    try:
        lat = float(request.args.get("lat"))
        lon = float(request.args.get("lon"))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid coordinates"}), 400

    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return jsonify({"error": "Coordinates out of range"}), 400

    params = urlencode({
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m",
    })
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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
