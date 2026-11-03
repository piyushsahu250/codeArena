"""Task management REST API: FastAPI, SQLite, token authentication, validation and automatic documentation."""
import json
import sqlite3
import tempfile
import time
from datetime import date
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from auth import ITERATIONS, TokenError, hash_password, sign, verify, verify_password

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority    TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'doing', 'done')),
    due_date    TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks (owner_id, status);
"""
COLUMNS = "id, title, description, priority, status, due_date"


def as_task(row):
    return dict(zip(COLUMNS.split(", "), row))


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=20, pattern=r"^[a-z0-9_]+$", examples=["asha"])
    password: str = Field(min_length=8, max_length=100, examples=["Study2026"])


class UserOut(BaseModel):
    id: int
    username: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=100, examples=["Write the report"])
    description: str = Field(default="", max_length=1000)
    priority: Literal["low", "medium", "high"] = "medium"
    due_date: Optional[date] = None


class TaskPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=1000)
    priority: Optional[Literal["low", "medium", "high"]] = None
    status: Optional[Literal["open", "doing", "done"]] = None
    due_date: Optional[date] = None


class TaskOut(BaseModel):
    id: int
    title: str
    description: str
    priority: str
    status: str
    due_date: Optional[date]


def create_app(db_path, secret, clock=time.time, token_seconds=3600, iterations=ITERATIONS):
    """Build the application. Everything that varies (database, secret, clock) is a parameter, so tests can control it."""
    app = FastAPI(title="Task Manager API", version="1.0.0", description="Register, log in, and manage your own tasks.")
    setup = sqlite3.connect(db_path)
    setup.executescript(SCHEMA)
    setup.close()
    bearer = HTTPBearer(auto_error=False)

    def get_db():
        conn = sqlite3.connect(db_path)  # one connection per request: safe with FastAPI's worker threads
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
        finally:
            conn.close()

    def current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer), db=Depends(get_db)) -> int:
        challenge = {"WWW-Authenticate": "Bearer"}
        if credentials is None:
            raise HTTPException(401, "missing token", headers=challenge)
        try:
            username = verify(secret, credentials.credentials, clock())
        except TokenError as error:
            raise HTTPException(401, str(error), headers=challenge) from None
        row = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if row is None:
            raise HTTPException(401, "unknown user", headers=challenge)
        return row[0]

    def load(db, user_id, task_id):
        row = db.execute(f"SELECT {COLUMNS} FROM tasks WHERE id = ? AND owner_id = ?", (task_id, user_id)).fetchone()
        if row is None:  # somebody else's task looks exactly like a missing one
            raise HTTPException(404, "task not found")
        return row

    @app.get("/health", tags=["system"])
    def health():
        return {"status": "ok"}

    @app.post("/auth/register", status_code=201, response_model=UserOut, tags=["auth"])
    def register(body: Credentials, db=Depends(get_db)):
        try:
            with db:
                user_id = db.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (body.username, hash_password(body.password, iterations))).lastrowid
        except sqlite3.IntegrityError:
            raise HTTPException(409, "username is taken") from None
        return {"id": user_id, "username": body.username}

    @app.post("/auth/login", response_model=TokenOut, tags=["auth"])
    def login(body: Credentials, db=Depends(get_db)):
        row = db.execute("SELECT password_hash FROM users WHERE username = ?", (body.username,)).fetchone()
        if row is None or not verify_password(body.password, row[0]):
            raise HTTPException(401, "invalid username or password")  # the same answer for both cases
        return {"access_token": sign(secret, body.username, clock() + token_seconds)}

    @app.post("/tasks", status_code=201, response_model=TaskOut, tags=["tasks"])
    def create_task(body: TaskIn, user_id: int = Depends(current_user), db=Depends(get_db)):
        with db:
            task_id = db.execute(
                "INSERT INTO tasks (owner_id, title, description, priority, due_date) VALUES (?, ?, ?, ?, ?)",
                (user_id, body.title.strip(), body.description, body.priority, body.due_date.isoformat() if body.due_date else None),
            ).lastrowid
        return as_task(load(db, user_id, task_id))

    @app.get("/tasks", response_model=list[TaskOut], tags=["tasks"])
    def list_tasks(
        status: Optional[Literal["open", "doing", "done"]] = None,
        priority: Optional[Literal["low", "medium", "high"]] = None,
        q: Optional[str] = Query(default=None, max_length=50, description="Text to look for in the title"),
        limit: int = Query(default=20, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        user_id: int = Depends(current_user),
        db=Depends(get_db),
    ):
        clauses, params = ["owner_id = ?"], [user_id]
        if status:
            clauses.append("status = ?")
            params.append(status)
        if priority:
            clauses.append("priority = ?")
            params.append(priority)
        if q:
            clauses.append("instr(lower(title), ?) > 0")
            params.append(q.lower())
        rows = db.execute(f"SELECT {COLUMNS} FROM tasks WHERE {' AND '.join(clauses)} ORDER BY id LIMIT ? OFFSET ?", params + [limit, offset]).fetchall()
        return [as_task(row) for row in rows]

    @app.get("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
    def read_task(task_id: int, user_id: int = Depends(current_user), db=Depends(get_db)):
        return as_task(load(db, user_id, task_id))

    @app.patch("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
    def update_task(task_id: int, body: TaskPatch, user_id: int = Depends(current_user), db=Depends(get_db)):
        load(db, user_id, task_id)
        changes = body.model_dump(exclude_unset=True)
        if not changes:
            raise HTTPException(422, "send at least one field to change")
        if any(changes.get(name, "set") is None for name in ("title", "description", "priority", "status")):
            raise HTTPException(422, "only due_date can be set to null")
        if "due_date" in changes and changes["due_date"] is not None:
            changes["due_date"] = changes["due_date"].isoformat()
        assignments = ", ".join(f"{name} = ?" for name in changes)  # the names come from the model, the values go through ?
        with db:
            db.execute(f"UPDATE tasks SET {assignments} WHERE id = ? AND owner_id = ?", [*changes.values(), task_id, user_id])
        return as_task(load(db, user_id, task_id))

    @app.delete("/tasks/{task_id}", status_code=204, tags=["tasks"])
    def delete_task(task_id: int, user_id: int = Depends(current_user), db=Depends(get_db)):
        load(db, user_id, task_id)
        with db:
            db.execute("DELETE FROM tasks WHERE id = ? AND owner_id = ?", (task_id, user_id))
        return Response(status_code=204)

    return app


def demo():
    from fastapi.testclient import TestClient

    with tempfile.TemporaryDirectory() as folder:
        client = TestClient(create_app(str(Path(folder) / "tasks.db"), secret="demo-secret", iterations=1000))

        def call(method, path, token=None, **kwargs):
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            response = client.request(method, path, headers=headers, **kwargs)
            body = response.json() if response.content else ""
            shown = "" if body == "" else json.dumps(body)
            if isinstance(body, dict) and "access_token" in body:
                shown = '{"token_type": "bearer", "access_token": "..."}'  # never print real tokens
            if response.status_code == 422:
                shown = "validation error on " + ", ".join(str(e["loc"][-1]) for e in body["detail"])
            print(f"{method} {path} -> {response.status_code} {shown}".rstrip())
            return response

        call("GET", "/tasks")
        call("POST", "/auth/register", json={"username": "asha", "password": "Study2026"})
        call("POST", "/auth/register", json={"username": "asha", "password": "Study2026"})
        call("POST", "/auth/register", json={"username": "ravi", "password": "Study2026"})
        call("POST", "/auth/register", json={"username": "x", "password": "short"})
        call("POST", "/auth/login", json={"username": "asha", "password": "WrongPass1"})
        token = call("POST", "/auth/login", json={"username": "asha", "password": "Study2026"}).json()["access_token"]
        ravi = call("POST", "/auth/login", json={"username": "ravi", "password": "Study2026"}).json()["access_token"]
        call("POST", "/tasks", token, json={"title": "Write the report", "priority": "high", "due_date": "2026-11-10"})
        call("POST", "/tasks", token, json={"title": "Read chapter 4"})
        call("POST", "/tasks", token, json={"title": "Report bugs", "priority": "high"})
        call("POST", "/tasks", token, json={"title": "Plan", "priority": "urgent"})
        call("GET", "/tasks?priority=high", token)
        call("GET", "/tasks?q=report&limit=1&offset=1", token)
        call("PATCH", "/tasks/1", token, json={"status": "done"})
        call("PATCH", "/tasks/1", token, json={"status": "finished"})
        call("GET", "/tasks?status=done", token)
        call("GET", "/tasks/1", ravi)
        call("DELETE", "/tasks/1", ravi)
        call("DELETE", "/tasks/1", token)
        call("GET", "/tasks/1", token)
        print("Documented paths: " + ", ".join(sorted(client.get("/openapi.json").json()["paths"])))


if __name__ == "__main__":
    demo()
