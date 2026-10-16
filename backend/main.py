"""
WanderWise backend entry point.

The code lives in the app/ package (see app/main.py for the layout). This file
exists so the usual commands keep working:

Run locally:   uvicorn main:app --reload
API docs:      http://localhost:8000/docs
"""

from app.main import app  # noqa: F401
