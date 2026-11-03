"""Student Management System: object-oriented design on top of SQLite, with CRUD, search, filters and validation."""
import re
import sqlite3
import sys
from dataclasses import asdict, dataclass

EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
NAME = re.compile(r"[A-Za-z][A-Za-z .'-]{1,59}")
COURSES = {"CSE", "ECE", "ME", "CIVIL"}
EDITABLE = ("name", "email", "course", "year")

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    roll_no INTEGER NOT NULL UNIQUE,
    name    TEXT    NOT NULL,
    email   TEXT    NOT NULL UNIQUE,
    course  TEXT    NOT NULL,
    year    INTEGER NOT NULL CHECK (year BETWEEN 1 AND 4)
);
CREATE TABLE IF NOT EXISTS marks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject    TEXT    NOT NULL,
    score      INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    UNIQUE (student_id, subject)
);
"""


class ValidationError(ValueError):
    """The data breaks a rule (bad format, duplicate, out of range)."""


class NotFound(LookupError):
    """The record asked for does not exist."""


def to_int(value, what):
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValidationError(f"{what} must be a whole number") from None


@dataclass(frozen=True)
class Student:
    roll_no: int
    name: str
    email: str
    course: str
    year: int

    @classmethod
    def create(cls, roll_no, name, email, course, year):
        """Validate raw input (usually text) and return a clean Student."""
        roll_no = to_int(roll_no, "roll number")
        if roll_no <= 0:
            raise ValidationError("roll number must be positive")
        name = " ".join(str(name).split())
        if not NAME.fullmatch(name):
            raise ValidationError("name must be 2 to 60 letters")
        email = str(email).strip().lower()
        if not EMAIL.fullmatch(email):
            raise ValidationError("invalid email")
        course = str(course).strip().upper()
        if course not in COURSES:
            raise ValidationError(f"course must be one of {', '.join(sorted(COURSES))}")
        year = to_int(year, "year")
        if not 1 <= year <= 4:
            raise ValidationError("year must be between 1 and 4")
        return cls(roll_no, name, email, course, year)

    def line(self):
        return f"{self.roll_no} | {self.name} | {self.email} | {self.course} | year {self.year}"


def connect(path=":memory:"):
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


class StudentRepository:
    """All SQL lives here. Every value reaches SQL through a ? placeholder, never through string formatting."""

    COLUMNS = "roll_no, name, email, course, year"

    def __init__(self, conn):
        self.conn = conn
        conn.executescript(SCHEMA)

    def add(self, student):
        try:
            with self.conn:
                self.conn.execute(
                    f"INSERT INTO students ({self.COLUMNS}) VALUES (?, ?, ?, ?, ?)",
                    (student.roll_no, student.name, student.email, student.course, student.year),
                )
        except sqlite3.IntegrityError:
            raise ValidationError("roll number or email already exists") from None

    def get(self, roll_no):
        row = self.conn.execute(f"SELECT {self.COLUMNS} FROM students WHERE roll_no = ?", (roll_no,)).fetchone()
        if row is None:
            raise NotFound(f"no student with roll number {roll_no}")
        return Student(*row)

    def update(self, roll_no, field, value):
        current = self.get(roll_no)
        if field not in EDITABLE:
            raise ValidationError(f"cannot change {field}")
        updated = Student.create(**{**asdict(current), field: value})
        try:
            with self.conn:
                self.conn.execute(
                    "UPDATE students SET name = ?, email = ?, course = ?, year = ? WHERE roll_no = ?",
                    (updated.name, updated.email, updated.course, updated.year, roll_no),
                )
        except sqlite3.IntegrityError:
            raise ValidationError("email already exists") from None
        return updated

    def delete(self, roll_no):
        with self.conn:
            deleted = self.conn.execute("DELETE FROM students WHERE roll_no = ?", (roll_no,)).rowcount
        if deleted == 0:
            raise NotFound(f"no student with roll number {roll_no}")

    def list(self, course=None, year=None):
        clauses, params = [], []
        if course:
            clauses.append("course = ?")
            params.append(course.strip().upper())
        if year is not None:
            clauses.append("year = ?")
            params.append(year)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        rows = self.conn.execute(f"SELECT {self.COLUMNS} FROM students{where} ORDER BY roll_no", params).fetchall()
        return [Student(*row) for row in rows]

    def search(self, term):
        term = term.strip().lower()
        rows = self.conn.execute(
            f"SELECT {self.COLUMNS} FROM students WHERE instr(lower(name), ?) > 0 OR instr(email, ?) > 0 ORDER BY roll_no",
            (term, term),
        ).fetchall()
        return [Student(*row) for row in rows]

    def add_mark(self, roll_no, subject, score):
        student_id = self.conn.execute("SELECT id FROM students WHERE roll_no = ?", (roll_no,)).fetchone()
        if student_id is None:
            raise NotFound(f"no student with roll number {roll_no}")
        subject = subject.strip()
        if not subject or len(subject) > 40:
            raise ValidationError("subject must be 1 to 40 characters")
        score = to_int(score, "score")
        if not 0 <= score <= 100:
            raise ValidationError("score must be between 0 and 100")
        with self.conn:
            self.conn.execute(
                "INSERT INTO marks (student_id, subject, score) VALUES (?, ?, ?) "
                "ON CONFLICT (student_id, subject) DO UPDATE SET score = excluded.score",
                (student_id[0], subject, score),
            )

    def averages(self):
        """(roll_no, name, number of subjects, average or None) for every student."""
        return self.conn.execute(
            "SELECT s.roll_no, s.name, COUNT(m.id), AVG(m.score) FROM students s "
            "LEFT JOIN marks m ON m.student_id = s.id GROUP BY s.id ORDER BY s.roll_no"
        ).fetchall()

    def course_averages(self):
        return self.conn.execute(
            "SELECT s.course, AVG(m.score) FROM students s JOIN marks m ON m.student_id = s.id "
            "GROUP BY s.course ORDER BY s.course"
        ).fetchall()


def parse_filters(tokens):
    course = year = None
    for token in tokens:
        key, _, value = token.partition("=")
        if key == "course" and value:
            course = value
        elif key == "year" and value:
            year = to_int(value, "year")
        else:
            raise ValidationError("usage: list [course=NAME] [year=N]")
    return course, year


def handle(repo, line):
    """Run one command line and return the output lines. Errors become 'Error: ...' lines."""
    command, _, rest = line.strip().partition(" ")
    rest = rest.strip()
    try:
        if command == "add":
            parts = [p.strip() for p in rest.split("|")]
            if len(parts) != 5:
                raise ValidationError("usage: add ROLL | NAME | EMAIL | COURSE | YEAR")
            student = Student.create(*parts)
            repo.add(student)
            return [f"Added {student.name} (roll {student.roll_no})."]
        if command == "update":
            parts = rest.split(None, 2)
            if len(parts) != 3:
                raise ValidationError("usage: update ROLL FIELD VALUE")
            student = repo.update(to_int(parts[0], "roll number"), parts[1], parts[2])
            return [f"Updated {student.name}."]
        if command == "delete":
            repo.delete(to_int(rest, "roll number"))
            return [f"Deleted roll {rest}."]
        if command == "show":
            return [repo.get(to_int(rest, "roll number")).line()]
        if command == "list":
            students = repo.list(*parse_filters(rest.split()))
            return [s.line() for s in students] or ["No students."]
        if command == "search":
            if not rest:
                raise ValidationError("usage: search TERM")
            return [s.line() for s in repo.search(rest)] or ["No matches."]
        if command == "mark":
            parts = rest.split()
            if len(parts) != 3:
                raise ValidationError("usage: mark ROLL SUBJECT SCORE")
            repo.add_mark(to_int(parts[0], "roll number"), parts[1], parts[2])
            return [f"Recorded {parts[1]} for roll {parts[0]}."]
        if command == "report":
            lines = []
            for roll_no, name, subjects, average in repo.averages():
                plural = "subject" if subjects == 1 else "subjects"
                detail = f"{subjects} {plural}, average {average:.2f}" if subjects else "no marks yet"
                lines.append(f"{roll_no} {name}: {detail}")
            lines.append("Course averages: " + (", ".join(f"{c} {a:.2f}" for c, a in repo.course_averages()) or "none"))
            return lines
        return ["Error: unknown command. Try add, update, delete, show, list, search, mark or report."]
    except (ValidationError, NotFound) as error:
        return [f"Error: {error}."]


def main():
    repo = StudentRepository(connect())
    for raw in sys.stdin:
        if raw.strip():
            print("\n".join(handle(repo, raw)))


if __name__ == "__main__":
    main()
