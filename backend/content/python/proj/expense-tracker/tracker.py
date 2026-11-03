"""Personal Expense Tracker: SQLite storage, monthly reports, budgets and a spending chart."""
import re
import sqlite3
import sys
from datetime import date
from decimal import Decimal, InvalidOperation

SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS expenses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    spent_on     TEXT    NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    category_id  INTEGER NOT NULL REFERENCES categories(id),
    note         TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (spent_on);
CREATE TABLE IF NOT EXISTS budgets (
    category_id   INTEGER PRIMARY KEY REFERENCES categories(id),
    monthly_cents INTEGER NOT NULL CHECK (monthly_cents > 0)
);
"""
CATEGORY = re.compile(r"[a-z][a-z -]{1,29}")
MONTH = re.compile(r"(\d{4})-(0[1-9]|1[0-2])")


class TrackerError(ValueError):
    pass


def parse_amount(text):
    """'250.50' -> 25050 (cents). Money is kept as whole cents, never as floats."""
    try:
        amount = Decimal(str(text).strip())
    except InvalidOperation:
        raise TrackerError("amount must be a number") from None
    if not amount.is_finite() or amount <= 0:
        raise TrackerError("amount must be greater than zero")
    cents = amount * 100
    if cents != cents.to_integral_value():
        raise TrackerError("amount can have at most two decimals")
    if cents > 10**10:
        raise TrackerError("amount is too large")
    return int(cents)


def money(cents):
    return f"{Decimal(cents) / 100:,.2f}"


def parse_date(text, today):
    try:
        day = date.fromisoformat(text)
    except ValueError:
        raise TrackerError("date must look like 2026-10-31") from None
    if day > today:
        raise TrackerError("date is in the future")
    return day


def clean_category(name):
    name = " ".join(str(name).lower().split())
    if not CATEGORY.fullmatch(name):
        raise TrackerError("category must be 2 to 30 letters")
    return name


def check_month(text):
    if not MONTH.fullmatch(text):
        raise TrackerError("month must look like 2026-10")
    return text


class Tracker:
    def __init__(self, conn, today=None):
        self.conn = conn
        self.today = today or date.today()
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA)

    def _category_id(self, name):
        with self.conn:
            self.conn.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (name,))
        return self.conn.execute("SELECT id FROM categories WHERE name = ?", (name,)).fetchone()[0]

    def add(self, spent_on, amount, category, note=""):
        day = parse_date(spent_on, self.today)
        cents = parse_amount(amount)
        category_id = self._category_id(clean_category(category))
        with self.conn:
            cursor = self.conn.execute(
                "INSERT INTO expenses (spent_on, amount_cents, category_id, note) VALUES (?, ?, ?, ?)",
                (day.isoformat(), cents, category_id, note.strip()),
            )
        return cursor.lastrowid

    def delete(self, expense_id):
        with self.conn:
            deleted = self.conn.execute("DELETE FROM expenses WHERE id = ?", (expense_id,)).rowcount
        if deleted == 0:
            raise TrackerError(f"no expense with id {expense_id}")

    def set_budget(self, category, amount):
        cents = parse_amount(amount)
        category_id = self._category_id(clean_category(category))
        with self.conn:
            self.conn.execute(
                "INSERT INTO budgets (category_id, monthly_cents) VALUES (?, ?) "
                "ON CONFLICT (category_id) DO UPDATE SET monthly_cents = excluded.monthly_cents",
                (category_id, cents),
            )

    def month_report(self, month):
        month = check_month(month)
        rows = self.conn.execute(
            "SELECT c.name, SUM(e.amount_cents) AS total FROM expenses e JOIN categories c ON c.id = e.category_id "
            "WHERE substr(e.spent_on, 1, 7) = ? GROUP BY c.id ORDER BY total DESC, c.name",
            (month,),
        ).fetchall()
        spent = dict(rows)
        caps = self.conn.execute(
            "SELECT c.name, b.monthly_cents FROM budgets b JOIN categories c ON c.id = b.category_id ORDER BY c.name"
        ).fetchall()
        return {
            "month": month,
            "total": sum(spent.values()),
            "by_category": rows,
            "budgets": [(name, spent.get(name, 0), cap) for name, cap in caps],
        }

    def monthly_totals(self):
        return self.conn.execute(
            "SELECT substr(spent_on, 1, 7) AS month, SUM(amount_cents) FROM expenses GROUP BY month ORDER BY month"
        ).fetchall()


def format_report(report):
    if not report["by_category"]:
        return [f"No expenses in {report['month']}."]
    width = max(len(name) for name, _ in report["by_category"])
    lines = [f"Report for {report['month']}", f"Total: {money(report['total'])}"]
    for name, cents in report["by_category"]:
        lines.append(f"  {name.ljust(width)}  {money(cents):>9}  {cents * 100 / report['total']:5.1f}%")
    if report["budgets"]:
        lines.append("Budgets:")
        for name, spent, cap in report["budgets"]:
            status = f"OVER by {money(spent - cap)}" if spent > cap else f"{money(cap - spent)} left"
            lines.append(f"  {name}: spent {money(spent)} of {money(cap)} ({status})")
    return lines


def format_trend(totals):
    if not totals:
        return ["No expenses yet."]
    peak = max(cents for _, cents in totals)
    return [f"{month} {'#' * max(1, round(cents * 20 / peak)):<20} {money(cents)}" for month, cents in totals]


def handle(tracker, line):
    command, _, rest = line.strip().partition(" ")
    rest = rest.strip()
    try:
        if command == "today":
            tracker.today = date.fromisoformat(rest)
            return [f"Today is {rest}."]
        if command == "add":
            parts = rest.split(None, 3)
            if len(parts) < 3:
                raise TrackerError("usage: add DATE AMOUNT CATEGORY [NOTE]")
            expense_id = tracker.add(parts[0], parts[1], parts[2], parts[3] if len(parts) == 4 else "")
            return [f"Added expense #{expense_id}."]
        if command == "delete":
            tracker.delete(int(rest))
            return [f"Deleted expense #{rest}."]
        if command == "budget":
            parts = rest.split()
            if len(parts) != 2:
                raise TrackerError("usage: budget CATEGORY AMOUNT")
            tracker.set_budget(parts[0], parts[1])
            return [f"Budget for {clean_category(parts[0])} set to {money(parse_amount(parts[1]))}."]
        if command == "report":
            return format_report(tracker.month_report(rest))
        if command == "trend":
            return format_trend(tracker.monthly_totals())
        if command == "chart":
            from chart import save_chart

            save_chart(tracker.monthly_totals(), rest or "monthly.png")
            return [f"Chart saved: {rest or 'monthly.png'}"]
        return ["Error: unknown command. Try today, add, delete, budget, report, trend or chart."]
    except (TrackerError, ValueError) as error:
        return [f"Error: {error}."]


def main():
    tracker = Tracker(sqlite3.connect(":memory:"))
    for raw in sys.stdin:
        if raw.strip():
            print("\n".join(handle(tracker, raw)))


if __name__ == "__main__":
    main()
