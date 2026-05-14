# AD Sizing App

Flask web app for sizing anaerobic digesters from crop residue and cow-manure mixtures.

## Run locally

```bash
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000.

## Deploy on Render

This repo includes a `render.yaml` blueprint. On [render.com](https://render.com):

1. New + → Blueprint → connect this GitHub repo.
2. Render reads `render.yaml` and creates a free web service running `gunicorn app:app`.
3. First build takes a few minutes (scipy/numpy compile).
