"""Job application tracker: the reference solution for the build-from-scratch challenge (not published to students)."""
import json
import sqlite3
import sys
from datetime import date

CHAIN = ["saved", "applied", "screening", "interview", "offer", "accepted"]
CLOSED = ["rejected", "withdrawn"]
STATUSES = CHAIN + CLOSED
RESPONDED = {"screening", "interview", "offer", "accepted", "rejected"}
STALE_DAYS = 14

SCHEMA = """
CREATE TABLE applications (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    role    TEXT NOT NULL,
    status  TEXT NOT NULL,
    applied_on TEXT NOT NULL
);
CREATE UNIQUE INDEX one_per_role ON applications (lower(company), lower(role));
CREATE TABLE notes (
    application_id INTEGER NOT NULL REFERENCES applications(id),
    text TEXT NOT NULL
);
"""


class TrackerError(Exception):
    pass


class JobTracker:
    def __init__(self, today="2026-11-03"):
        self.today = date.fromisoformat(today)
        self.conn = sqlite3.connect(":memory:")
        self.conn.executescript(SCHEMA)

    def _insert(self, company, role, status, day):
        try:
            with self.conn:
                return self.conn.execute(
                    "INSERT INTO applications (company, role, status, applied_on) VALUES (?, ?, ?, ?)", (company, role, status, day)
                ).lastrowid
        except sqlite3.IntegrityError:
            raise TrackerError("duplicate application") from None

    def add(self, text):
        parts = [p.strip() for p in text.split("|")]
        if len(parts) != 3 or not all(parts):
            raise TrackerError("usage: add COMPANY | ROLE | DATE")
        try:
            day = date.fromisoformat(parts[2])
        except ValueError:
            raise TrackerError("invalid date") from None
        return self._insert(parts[0], parts[1], "applied", day.isoformat())

    def _row(self, application_id):
        row = self.conn.execute("SELECT id, company, role, status, applied_on FROM applications WHERE id = ?", (application_id,)).fetchone()
        if row is None:
            raise TrackerError(f"no application #{application_id}")
        return row

    def move(self, application_id, status):
        if status not in STATUSES:
            raise TrackerError(f"unknown status {status}")
        current = self._row(application_id)[3]
        forward = current in CHAIN[:-1] and status == CHAIN[CHAIN.index(current) + 1]
        close = current in CHAIN[:-1] and status in CLOSED
        if not (forward or close):
            raise TrackerError(f"cannot move from {current} to {status}")
        with self.conn:
            self.conn.execute("UPDATE applications SET status = ? WHERE id = ?", (status, application_id))

    def note(self, application_id, text):
        self._row(application_id)
        with self.conn:
            self.conn.execute("INSERT INTO notes (application_id, text) VALUES (?, ?)", (application_id, text))

    def find(self, status=None, company=None, term=None):
        sql, params = "SELECT id, company, role, status, applied_on FROM applications WHERE 1 = 1", []
        if status:
            sql += " AND status = ?"
            params.append(status)
        if company:
            sql += " AND instr(lower(company), ?) > 0"
            params.append(company.lower())
        if term:
            sql += " AND (instr(lower(company), ?) > 0 OR instr(lower(role), ?) > 0)"
            params += [term.lower(), term.lower()]
        return self.conn.execute(sql + " ORDER BY id", params).fetchall()

    def import_jobs(self, payload):
        """Add postings from a job-board API response as 'saved'. Returns (new, skipped)."""
        try:
            jobs = json.loads(payload)["jobs"]
            if not isinstance(jobs, list):
                raise TypeError
        except (ValueError, KeyError, TypeError):
            raise TrackerError("invalid API response") from None
        new = skipped = 0
        for job in jobs:
            company = job.get("company") if isinstance(job, dict) else None
            title = job.get("title") if isinstance(job, dict) else None
            if not (isinstance(company, str) and isinstance(title, str) and company.strip() and title.strip()):
                skipped += 1
                continue
            try:
                self._insert(company.strip(), title.strip(), "saved", self.today.isoformat())
                new += 1
            except TrackerError:
                skipped += 1
        return new, skipped

    def dashboard(self):
        rows = self.conn.execute("SELECT status, applied_on FROM applications").fetchall()
        counts = {s: sum(1 for status, _ in rows if status == s) for s in STATUSES}
        submitted = [status for status, _ in rows if status != "saved"]
        responded = sum(1 for status in submitted if status in RESPONDED)
        stale = sum(1 for status, day in rows if status == "applied" and (self.today - date.fromisoformat(day)).days >= STALE_DAYS)
        lines = [f"Applications: {len(rows)}"] + [f"{s}: {n}" for s, n in counts.items() if n]
        lines.append(f"Response rate: {responded * 100 / len(submitted):.1f}%" if submitted else "Response rate: n/a")
        lines.append(f"Stale (applied {STALE_DAYS}+ days ago): {stale}")
        return lines

    def show(self, application_id):
        lines = [format_row(self._row(application_id))]
        lines += [f"  - {text}" for (text,) in self.conn.execute("SELECT text FROM notes WHERE application_id = ? ORDER BY rowid", (application_id,))]
        return lines


def format_row(row):
    return f"#{row[0]} {row[1]} | {row[2]} | {row[3]} | {row[4]}"


def handle(tracker, line):
    command, _, rest = line.strip().partition(" ")
    rest = rest.strip()
    try:
        if command == "today":
            tracker.today = date.fromisoformat(rest)
            return [f"Today is {rest}."]
        if command == "add":
            return [f"Added #{tracker.add(rest)}."]
        if command == "status":
            application_id, _, status = rest.partition(" ")
            if not status.strip():
                raise TrackerError("usage: status ID STATUS")
            tracker.move(int(application_id), status.strip())
            return [f"#{application_id} is now {status.strip()}."]
        if command == "note":
            application_id, _, text = rest.partition(" ")
            if not text.strip():
                raise TrackerError("usage: note ID TEXT")
            tracker.note(int(application_id), text.strip())
            return [f"Noted #{application_id}."]
        if command == "show":
            return tracker.show(int(rest))
        if command == "list":
            filters = {}
            for token in rest.split():
                key, _, value = token.partition("=")
                if key not in ("status", "company") or not value:
                    raise TrackerError("usage: list [status=X] [company=Y]")
                filters[key] = value
            return [format_row(r) for r in tracker.find(**filters)] or ["No applications."]
        if command == "search":
            return [format_row(r) for r in tracker.find(term=rest)] or ["No matches."]
        if command == "import":
            new, skipped = tracker.import_jobs(rest)
            return [f"Imported {new} new, skipped {skipped}."]
        if command == "dashboard":
            return tracker.dashboard()
        return ["Error: unknown command."]
    except TrackerError as error:
        return [f"Error: {error}."]
    except ValueError:
        return ["Error: invalid number or date."]


def main():
    tracker = JobTracker()
    for raw in sys.stdin:
        if raw.strip():
            print("\n".join(handle(tracker, raw)))


if __name__ == "__main__":
    main()
