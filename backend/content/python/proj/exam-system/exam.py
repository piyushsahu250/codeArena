"""Online quiz and examination system: users and roles, a question bank, timed attempts, automatic scoring and reports."""
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta

from security import ITERATIONS, hash_password, verify_password

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'student'))
);
CREATE TABLE IF NOT EXISTS questions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    topic         TEXT NOT NULL,
    text          TEXT NOT NULL,
    options       TEXT NOT NULL,
    correct_index INTEGER NOT NULL CHECK (correct_index >= 0)
);
CREATE TABLE IF NOT EXISTS exams (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT NOT NULL UNIQUE,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    pass_percent     INTEGER NOT NULL CHECK (pass_percent BETWEEN 1 AND 100)
);
CREATE TABLE IF NOT EXISTS exam_questions (
    exam_id     INTEGER NOT NULL REFERENCES exams(id),
    question_id INTEGER NOT NULL REFERENCES questions(id),
    position    INTEGER NOT NULL,
    PRIMARY KEY (exam_id, question_id)
);
CREATE TABLE IF NOT EXISTS attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    exam_id     INTEGER NOT NULL REFERENCES exams(id),
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    score       INTEGER,
    total       INTEGER,
    UNIQUE (user_id, exam_id)
);
CREATE TABLE IF NOT EXISTS answers (
    attempt_id  INTEGER NOT NULL REFERENCES attempts(id),
    question_id INTEGER NOT NULL REFERENCES questions(id),
    chosen      INTEGER NOT NULL,
    answered_at TEXT NOT NULL,
    PRIMARY KEY (attempt_id, question_id)
);
"""
USERNAME = re.compile(r"[a-z0-9_]{3,20}")


class ExamError(Exception):
    """A rule of the exam system was broken; the message is safe to show to the user."""


@dataclass(frozen=True)
class User:
    id: int
    username: str
    role: str


@dataclass(frozen=True)
class Result:
    score: int
    total: int
    percent: float
    passed: bool
    late: bool
    review: list  # (question text, the answer given or None, the correct answer) for every wrong answer


class ExamSystem:
    def __init__(self, conn, clock=datetime.now, iterations=ITERATIONS):
        self.conn, self.clock, self.iterations = conn, clock, iterations
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA)

    # ---- accounts -------------------------------------------------------------------------------------
    def _create_user(self, username, password, role):
        username = username.strip().lower()
        if not USERNAME.fullmatch(username):
            raise ExamError("username must be 3 to 20 letters, digits or underscores")
        if len(password) < 8 or not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
            raise ExamError("password needs at least 8 characters, with letters and digits")
        try:
            with self.conn:
                cursor = self.conn.execute(
                    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                    (username, hash_password(password, self.iterations), role),
                )
        except sqlite3.IntegrityError:
            raise ExamError("that username is taken") from None
        return User(cursor.lastrowid, username, role)

    def register(self, username, password):
        """Public sign-up always creates a student: nobody can register themselves as an admin."""
        return self._create_user(username, password, "student")

    def bootstrap_admin(self, username, password):
        """Create the first admin (run once by whoever installs the system)."""
        if self.conn.execute("SELECT 1 FROM users WHERE role = 'admin'").fetchone():
            raise ExamError("an admin already exists")
        return self._create_user(username, password, "admin")

    def login(self, username, password):
        row = self.conn.execute("SELECT id, username, role, password_hash FROM users WHERE username = ?", (username.strip().lower(),)).fetchone()
        # One message for "no such user" and "wrong password", so attackers cannot find out which usernames exist.
        if row is None or not verify_password(password, row[3]):
            raise ExamError("invalid username or password")
        return User(*row[:3])

    @staticmethod
    def _require(user, role):
        if user.role != role:
            raise ExamError(f"only {role}s can do that")

    # ---- question bank and exams (admin) --------------------------------------------------------------
    def add_question(self, user, topic, text, options, correct_index):
        self._require(user, "admin")
        options = [str(o).strip() for o in options]
        if not text.strip() or not topic.strip():
            raise ExamError("a question needs a topic and a text")
        if not 2 <= len(options) <= 6 or "" in options or len(set(options)) != len(options):
            raise ExamError("a question needs 2 to 6 different, non-empty options")
        if not isinstance(correct_index, int) or not 0 <= correct_index < len(options):
            raise ExamError("the correct answer must be one of the options")
        with self.conn:
            cursor = self.conn.execute(
                "INSERT INTO questions (topic, text, options, correct_index) VALUES (?, ?, ?, ?)",
                (topic.strip().lower(), text.strip(), json.dumps(options), correct_index),
            )
        return cursor.lastrowid

    def create_exam(self, user, title, duration_minutes, pass_percent, question_ids):
        self._require(user, "admin")
        if not question_ids or len(set(question_ids)) != len(question_ids):
            raise ExamError("an exam needs at least one question, each only once")
        if not isinstance(duration_minutes, int) or duration_minutes <= 0 or not 1 <= pass_percent <= 100:
            raise ExamError("duration must be positive and pass percent between 1 and 100")
        known = self.conn.execute(f"SELECT COUNT(*) FROM questions WHERE id IN ({','.join('?' * len(question_ids))})", question_ids).fetchone()[0]
        if known != len(question_ids):
            raise ExamError("unknown question in the list")
        try:
            with self.conn:
                exam_id = self.conn.execute("INSERT INTO exams (title, duration_minutes, pass_percent) VALUES (?, ?, ?)", (title.strip(), duration_minutes, pass_percent)).lastrowid
                self.conn.executemany("INSERT INTO exam_questions (exam_id, question_id, position) VALUES (?, ?, ?)", [(exam_id, q, i) for i, q in enumerate(question_ids, 1)])
        except sqlite3.IntegrityError:
            raise ExamError("an exam with that title exists") from None
        return exam_id

    # ---- taking an exam (student) ---------------------------------------------------------------------
    def _exam(self, exam_id):
        row = self.conn.execute("SELECT id, title, duration_minutes, pass_percent FROM exams WHERE id = ?", (exam_id,)).fetchone()
        if row is None:
            raise ExamError("no such exam")
        return row

    def _attempt(self, user, attempt_id):
        row = self.conn.execute("SELECT id, user_id, exam_id, started_at, finished_at FROM attempts WHERE id = ?", (attempt_id,)).fetchone()
        if row is None or row[1] != user.id:  # somebody else's attempt looks exactly like a missing one
            raise ExamError("no such attempt")
        return row

    @staticmethod
    def _deadline(started_at, minutes):
        return datetime.fromisoformat(started_at) + timedelta(minutes=minutes)

    def start(self, user, exam_id):
        """Start the one attempt a student gets. Returns (attempt id, paper); the paper never contains the correct answers."""
        self._require(user, "student")
        self._exam(exam_id)
        try:
            with self.conn:
                attempt_id = self.conn.execute(
                    "INSERT INTO attempts (user_id, exam_id, started_at) VALUES (?, ?, ?)",
                    (user.id, exam_id, self.clock().isoformat(timespec="seconds")),
                ).lastrowid
        except sqlite3.IntegrityError:
            raise ExamError("you have already started this exam") from None
        rows = self.conn.execute(
            "SELECT q.id, q.text, q.options FROM exam_questions eq JOIN questions q ON q.id = eq.question_id WHERE eq.exam_id = ? ORDER BY eq.position",
            (exam_id,),
        ).fetchall()
        return attempt_id, [(qid, text, json.loads(options)) for qid, text, options in rows]

    def answer(self, user, attempt_id, question_id, chosen):
        _, _, exam_id, started_at, finished_at = self._attempt(user, attempt_id)
        if finished_at:
            raise ExamError("this attempt is already finished")
        if self.clock() > self._deadline(started_at, self._exam(exam_id)[2]):
            raise ExamError("time is up")
        row = self.conn.execute(
            "SELECT q.options FROM exam_questions eq JOIN questions q ON q.id = eq.question_id WHERE eq.exam_id = ? AND q.id = ?",
            (exam_id, question_id),
        ).fetchone()
        if row is None:
            raise ExamError("that question is not part of this exam")
        if isinstance(chosen, bool) or not isinstance(chosen, int) or not 0 <= chosen < len(json.loads(row[0])):
            raise ExamError("choose one of the listed options")
        with self.conn:
            self.conn.execute(
                "INSERT INTO answers (attempt_id, question_id, chosen, answered_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT (attempt_id, question_id) DO UPDATE SET chosen = excluded.chosen, answered_at = excluded.answered_at",
                (attempt_id, question_id, chosen, self.clock().isoformat(timespec="seconds")),
            )

    def finish(self, user, attempt_id):
        _, _, exam_id, _, finished_at = self._attempt(user, attempt_id)
        if finished_at:
            raise ExamError("this attempt is already finished")
        total = self.conn.execute("SELECT COUNT(*) FROM exam_questions WHERE exam_id = ?", (exam_id,)).fetchone()[0]
        score = self.conn.execute(
            "SELECT COUNT(*) FROM answers a JOIN questions q ON q.id = a.question_id WHERE a.attempt_id = ? AND a.chosen = q.correct_index",
            (attempt_id,),
        ).fetchone()[0]
        with self.conn:
            self.conn.execute("UPDATE attempts SET finished_at = ?, score = ?, total = ? WHERE id = ?", (self.clock().isoformat(timespec="seconds"), score, total, attempt_id))
        return self.result(user, attempt_id)

    def result(self, user, attempt_id):
        _, _, exam_id, started_at, finished_at = self._attempt(user, attempt_id)
        if not finished_at:
            raise ExamError("finish the exam to see the result")
        _, _, minutes, pass_percent = self._exam(exam_id)
        score, total = self.conn.execute("SELECT score, total FROM attempts WHERE id = ?", (attempt_id,)).fetchone()
        percent = score * 100 / total
        review = []
        for text, options, correct, chosen in self.conn.execute(
            "SELECT q.text, q.options, q.correct_index, a.chosen FROM exam_questions eq JOIN questions q ON q.id = eq.question_id "
            "LEFT JOIN answers a ON a.question_id = q.id AND a.attempt_id = ? WHERE eq.exam_id = ? ORDER BY eq.position",
            (attempt_id, exam_id),
        ):
            options = json.loads(options)
            if chosen != correct:
                review.append((text, None if chosen is None else options[chosen], options[correct]))
        late = datetime.fromisoformat(finished_at) > self._deadline(started_at, minutes)
        return Result(score, total, percent, percent >= pass_percent, late, review)

    # ---- reports (admin) ------------------------------------------------------------------------------
    def report(self, user, exam_id):
        self._require(user, "admin")
        _, title, _, pass_percent = self._exam(exam_id)
        rows = self.conn.execute("SELECT score * 100.0 / total FROM attempts WHERE exam_id = ? AND finished_at IS NOT NULL", (exam_id,)).fetchall()
        percents = [r[0] for r in rows]
        per_question = self.conn.execute(
            "SELECT q.text, COALESCE(SUM(a.chosen = q.correct_index), 0) FROM exam_questions eq JOIN questions q ON q.id = eq.question_id "
            "LEFT JOIN answers a ON a.question_id = q.id AND a.attempt_id IN (SELECT id FROM attempts WHERE exam_id = ? AND finished_at IS NOT NULL) "
            "WHERE eq.exam_id = ? GROUP BY q.id ORDER BY eq.position",
            (exam_id, exam_id),
        ).fetchall()
        return {
            "title": title,
            "finished": len(percents),
            "average": sum(percents) / len(percents) if percents else 0.0,
            "highest": max(percents) if percents else 0.0,
            "passed": sum(p >= pass_percent for p in percents),
            "questions": [(text, correct * 100 / len(percents) if percents else 0.0) for text, correct in per_question],
        }


def format_result(result):
    status = "PASS" if result.passed else "FAIL"
    lines = [f"Score: {result.score}/{result.total} ({result.percent:.1f}%) {status}" + (" - finished after the time limit" if result.late else "")]
    for text, given, correct in result.review:
        lines.append(f"  Review: {text} - you answered {given if given is not None else 'nothing'}; correct answer: {correct}")
    return lines


def format_report(report):
    lines = [
        f"Report for {report['title']}",
        f"Finished attempts: {report['finished']}, average {report['average']:.1f}%, highest {report['highest']:.1f}%, passed {report['passed']}",
    ]
    lines += [f"  {percent:5.1f}% correct: {text}" for text, percent in report["questions"]]
    return lines


class DemoClock:
    def __init__(self):
        self.now = datetime(2026, 11, 3, 10, 0)

    def __call__(self):
        return self.now

    def advance(self, minutes):
        self.now += timedelta(minutes=minutes)


def demo(show=print):
    clock = DemoClock()
    system = ExamSystem(sqlite3.connect(":memory:"), clock, iterations=1000)  # few iterations only to keep the demo fast
    admin = system.bootstrap_admin("prof_rao", "Teach2026")
    asha, ravi, kabir = (system.register(name, "Study2026") for name in ("asha", "ravi", "kabir"))

    def attempt(label, action):
        try:
            return action()
        except ExamError as error:
            show(f"{label}: Error: {error}.")

    show(f"Public sign-up creates a {system.register('newcomer', 'Study2026').role}, never an admin.")
    attempt("Second admin bootstrap", lambda: system.bootstrap_admin("another_admin", "Teach2026"))
    attempt("Login with a wrong password", lambda: system.login("asha", "wrong-password1"))
    attempt("Login with an unknown user", lambda: system.login("nobody", "Study2026"))
    attempt("Student adds a question", lambda: system.add_question(asha, "python", "Q?", ["a", "b"], 0))
    bank = [
        ("What does len([1, 2, 3]) return?", ["2", "3", "4", "an error"], 1),
        ("Which keyword defines a function?", ["def", "fun", "define", "function"], 0),
        ("What is the type of 3 / 2 in Python 3?", ["int", "float", "str", "bool"], 1),
        ("Which of these is immutable?", ["list", "dict", "tuple", "set"], 2),
        ("What does 'abc'.upper() return?", ["'ABC'", "'abc'", "'Abc'", "an error"], 0),
    ]
    ids = [system.add_question(admin, "python basics", text, options, correct) for text, options, correct in bank]
    exam_id = system.create_exam(admin, "Python Basics Test", 30, 60, ids)
    show(f"Exam ready: {len(ids)} questions, 30 minutes, pass mark 60%.")

    attempt_asha, paper = system.start(asha, exam_id)
    show(f"Paper for asha: {len(paper)} questions, answers hidden.")
    attempt("asha starts again", lambda: system.start(asha, exam_id))
    attempt_ravi, _ = system.start(ravi, exam_id)
    attempt_kabir, _ = system.start(kabir, exam_id)
    clock.advance(10)
    for question_id, choice in zip(ids, (1, 0, 1, 0)):  # asha: first three right, the fourth wrong
        system.answer(asha, attempt_asha, question_id, choice)
    for question_id, choice in zip(ids, (0, 0, 0, 2, 1)):  # ravi: only the second and the fourth right
        system.answer(ravi, attempt_ravi, question_id, choice)
    attempt("Ravi reads asha's attempt", lambda: system.result(ravi, attempt_asha))
    attempt("asha reads the result too early", lambda: system.result(asha, attempt_asha))
    clock.advance(21)  # 31 minutes after the start: the 30-minute limit has passed
    attempt("asha answers the last question", lambda: system.answer(asha, attempt_asha, ids[4], 0))
    for name, user, attempt_id in (("asha", asha, attempt_asha), ("ravi", ravi, attempt_ravi), ("kabir", kabir, attempt_kabir)):
        show(f"Result for {name}:")
        show("\n".join("  " + line for line in format_result(system.finish(user, attempt_id))))
    show("\n".join(format_report(system.report(admin, exam_id))))


if __name__ == "__main__":
    demo()
