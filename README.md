# AD Sizing App — BioCalc

Flask web app for sizing anaerobic digesters from crop residue + cow-manure
mixtures. It estimates biomass availability, digester & tank sizing, water
demand, biogas / methane production, cost, and produces a preliminary tank
layout.

## Features

- **Site selector** — interactive map, place search (OpenStreetMap Nominatim),
  manual coordinates, live temperature.
- **Mode 1 — Calculate From Feddans**: enter crops + feddans → full plant sizing.
- **Mode 2 — Calculate Required Feddans**: enter a target annual biogas/methane
  quantity → required cultivated area (closed-form mixture + bisection solver).
- **Tank geometry & layout**: square / circular / rectangular dimensions per tank.
- **Tank visualization**: proportional SVG site plan.
- **Export**: PDF and Excel.

The C/N mixture is solved in closed form (no SymPy), so the dependency footprint
is just Flask + NumPy — small enough for Vercel serverless functions.

## Run locally

```bash
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000.

## Deploy on Vercel (recommended)

The repo includes `vercel.json` and `api/index.py` (the serverless entrypoint
that exposes the Flask `app`).

```bash
npm i -g vercel      # if not installed
vercel               # preview deploy
vercel --prod        # production
```

Or: vercel.com → New Project → import this GitHub repo → Deploy. No env vars or
API keys are required.

## Deploy on Render (alternative)

`render.yaml` is still included. On render.com: New + → Blueprint → connect the
repo → it runs `gunicorn app:app` on the free plan.
