import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app import create_app
from auth import TokenError, sign, verify, verify_password, hash_password


class Clock:
    def __init__(self):
        self.now = 1_000_000.0

    def __call__(self):
        return self.now


class TokenTests(unittest.TestCase):
    def test_sign_and_verify(self):
        token = sign("secret", "asha", 2000)
        self.assertEqual(verify("secret", token, 1999), "asha")

    def test_expired_wrong_secret_and_tampered(self):
        token = sign("secret", "asha", 2000)
        with self.assertRaises(TokenError):
            verify("secret", token, 2000)
        with self.assertRaises(TokenError):
            verify("other", token, 1000)
        payload, signature = token.split(".")
        forged = sign("secret", "admin", 2000).split(".")[0] + "." + signature
        with self.assertRaises(TokenError):
            verify("secret", forged, 1000)
        for junk in ("", "abc", "a.b.c", "!!!.???"):
            with self.assertRaises(TokenError, msg=junk):
                verify("secret", junk, 1000)

    def test_passwords(self):
        stored = hash_password("Study2026", 1000)
        self.assertTrue(verify_password("Study2026", stored))
        self.assertFalse(verify_password("study2026", stored))
        self.assertFalse(verify_password("x", "garbage"))


class ApiTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.clock = Clock()
        self.client = TestClient(create_app(str(Path(folder.name) / "t.db"), "test-secret", clock=self.clock, token_seconds=60, iterations=1000))
        self.token = self.login("asha")
        self.other = self.login("ravi")

    def login(self, name):
        creds = {"username": name, "password": "Study2026"}
        self.client.post("/auth/register", json=creds)
        return self.client.post("/auth/login", json=creds).json()["access_token"]

    def call(self, method, path, token=None, **kwargs):
        headers = {"Authorization": f"Bearer {token or self.token}"}
        return self.client.request(method, path, headers=headers, **kwargs)

    # ---- authentication ----
    def test_register_rules(self):
        creds = {"username": "asha", "password": "Study2026"}
        self.assertEqual(self.client.post("/auth/register", json=creds).status_code, 409)
        for bad in ({"username": "Asha", "password": "Study2026"}, {"username": "ab", "password": "Study2026"}, {"username": "okname", "password": "short"}, {}):
            self.assertEqual(self.client.post("/auth/register", json=bad).status_code, 422, bad)

    def test_register_does_not_leak_the_password(self):
        body = self.client.post("/auth/register", json={"username": "kabir", "password": "Study2026"}).json()
        self.assertEqual(set(body), {"id", "username"})

    def test_login_failures_look_the_same(self):
        wrong = self.client.post("/auth/login", json={"username": "asha", "password": "WrongPass1"})
        ghost = self.client.post("/auth/login", json={"username": "ghost", "password": "WrongPass1"})
        self.assertEqual((wrong.status_code, ghost.status_code), (401, 401))
        self.assertEqual(wrong.json(), ghost.json())

    def test_protected_routes_need_a_valid_token(self):
        self.assertEqual(self.client.get("/tasks").status_code, 401)
        self.assertEqual(self.client.get("/tasks", headers={"Authorization": "Bearer nonsense"}).status_code, 401)
        self.assertEqual(self.client.get("/tasks").headers["www-authenticate"], "Bearer")

    def test_expired_token_is_rejected(self):
        self.assertEqual(self.call("GET", "/tasks").status_code, 200)
        self.clock.now += 61
        response = self.call("GET", "/tasks")
        self.assertEqual((response.status_code, response.json()["detail"]), (401, "token expired"))

    # ---- CRUD ----
    def test_create_read_update_delete(self):
        created = self.call("POST", "/tasks", json={"title": "  Write report ", "priority": "high", "due_date": "2026-11-10"})
        self.assertEqual(created.status_code, 201)
        task = created.json()
        self.assertEqual((task["title"], task["status"], task["due_date"]), ("Write report", "open", "2026-11-10"))
        self.assertEqual(self.call("GET", f"/tasks/{task['id']}").json(), task)
        patched = self.call("PATCH", f"/tasks/{task['id']}", json={"status": "done", "due_date": None}).json()
        self.assertEqual((patched["status"], patched["due_date"], patched["title"]), ("done", None, "Write report"))
        self.assertEqual(self.call("DELETE", f"/tasks/{task['id']}").status_code, 204)
        self.assertEqual(self.call("GET", f"/tasks/{task['id']}").status_code, 404)

    def test_validation_errors(self):
        for body in ({}, {"title": ""}, {"title": "x", "priority": "urgent"}, {"title": "x", "due_date": "not-a-date"}, {"title": "x" * 101}):
            self.assertEqual(self.call("POST", "/tasks", json=body).status_code, 422, body)
        task_id = self.call("POST", "/tasks", json={"title": "x"}).json()["id"]
        for body in ({}, {"status": "finished"}, {"title": None}):
            self.assertEqual(self.call("PATCH", f"/tasks/{task_id}", json=body).status_code, 422, body)

    def test_users_cannot_see_or_change_each_others_tasks(self):
        task_id = self.call("POST", "/tasks", json={"title": "private"}).json()["id"]
        for method in ("GET", "PATCH", "DELETE"):
            kwargs = {"json": {"status": "done"}} if method == "PATCH" else {}
            self.assertEqual(self.call(method, f"/tasks/{task_id}", self.other, **kwargs).status_code, 404, method)
        self.assertEqual(self.call("GET", "/tasks", self.other).json(), [])
        self.assertEqual(self.call("GET", f"/tasks/{task_id}").json()["title"], "private")

    def test_filters_search_and_paging(self):
        for title, priority in (("Report A", "high"), ("Read B", "low"), ("Report C", "high"), ("Plan D", "medium")):
            self.call("POST", "/tasks", json={"title": title, "priority": priority})
        self.call("PATCH", "/tasks/1", json={"status": "done"})
        titles = lambda path: [t["title"] for t in self.call("GET", path).json()]
        self.assertEqual(titles("/tasks?priority=high"), ["Report A", "Report C"])
        self.assertEqual(titles("/tasks?status=done"), ["Report A"])
        self.assertEqual(titles("/tasks?q=REPORT"), ["Report A", "Report C"])
        self.assertEqual(titles("/tasks?limit=2&offset=1"), ["Read B", "Report C"])
        self.assertEqual(titles("/tasks?q=%25"), [])
        for bad in ("limit=0", "limit=101", "offset=-1", "status=nope"):
            self.assertEqual(self.call("GET", f"/tasks?{bad}").status_code, 422, bad)

    def test_sql_injection_text_is_only_data(self):
        self.call("POST", "/tasks", json={"title": "x'); DROP TABLE tasks; --"})
        self.assertEqual(len(self.call("GET", "/tasks?q=%27%20OR%201%3D1%20--").json()), 0)
        self.assertEqual(len(self.call("GET", "/tasks").json()), 1)

    # ---- documentation ----
    def test_openapi_documents_the_api(self):
        spec = self.client.get("/openapi.json").json()
        self.assertEqual(spec["info"]["title"], "Task Manager API")
        self.assertIn("/tasks/{task_id}", spec["paths"])
        self.assertIn("patch", spec["paths"]["/tasks/{task_id}"])
        self.assertEqual(self.client.get("/docs").status_code, 200)
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
