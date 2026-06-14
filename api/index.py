"""Vercel serverless entrypoint. Exposes the Flask app as `app`."""
import os
import sys

# Make the project root importable so `import app` resolves to ../app.py
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402  (Vercel @vercel/python looks for `app`)
