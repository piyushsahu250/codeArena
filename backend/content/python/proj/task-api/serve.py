"""Serve the API on your own computer.  Install the server first:  pip install uvicorn"""
import os

import uvicorn

from app import create_app

if __name__ == "__main__":
    secret = os.environ.get("TASK_API_SECRET")
    if not secret or len(secret) < 16:
        raise SystemExit("Set TASK_API_SECRET to a long random string first (at least 16 characters).")
    uvicorn.run(create_app("tasks.db", secret), host="127.0.0.1", port=8000)
