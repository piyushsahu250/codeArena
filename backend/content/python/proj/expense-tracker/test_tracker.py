import os
import sqlite3
import tempfile
import unittest
from datetime import date

from chart import save_chart
from tracker import Tracker, TrackerError, format_report, format_trend, handle, money, parse_amount


def make_tracker(case):
    conn = sqlite3.connect(":memory:")
    case.addCleanup(conn.close)
    t = Tracker(conn, today=date(2026, 11, 3))
    t.add("2026-10-01", "1200", "Rent")
    t.add("2026-10-03", "250.50", "food", "lunch")
    t.add("2026-10-20", "640", "food")
    t.add("2026-09-05", "1000", "rent")
    return t


class MoneyTests(unittest.TestCase):
    def test_parse_amount_uses_exact_cents(self):
        self.assertEqual(parse_amount("250.50"), 25050)
        self.assertEqual(parse_amount("0.1") + parse_amount("0.2"), parse_amount("0.3"))
        self.assertEqual(parse_amount(" 7 "), 700)

    def test_bad_amounts(self):
        for bad in ("0", "-5", "abc", "1.234", "nan", "inf", "", "1e20"):
            with self.assertRaises(TrackerError, msg=bad):
                parse_amount(bad)

    def test_money_formatting(self):
        self.assertEqual((money(5), money(123456789), money(25050)), ("0.05", "1,234,567.89", "250.50"))


class TrackerTests(unittest.TestCase):
    def test_add_validates_date_and_category(self):
        t = make_tracker(self)
        for args in (("2026-13-01", "5", "food"), ("2026-11-04", "5", "food"), ("2026-10-01", "5", "1"), ("tomorrow", "5", "food")):
            with self.assertRaises(TrackerError, msg=args):
                t.add(*args)

    def test_categories_are_case_insensitive(self):
        t = make_tracker(self)
        self.assertEqual(t.conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0], 2)

    def test_month_report_totals_and_order(self):
        report = make_tracker(self).month_report("2026-10")
        self.assertEqual(report["total"], 209050)
        self.assertEqual(report["by_category"], [("rent", 120000), ("food", 89050)])

    def test_budget_status(self):
        t = make_tracker(self)
        t.set_budget("food", "800")
        t.set_budget("food", "900")
        self.assertEqual(t.month_report("2026-10")["budgets"], [("food", 89050, 90000)])
        self.assertIn("  food: spent 890.50 of 900.00 (9.50 left)", format_report(t.month_report("2026-10")))
        t.set_budget("food", "500")
        self.assertIn("(OVER by 390.50)", format_report(t.month_report("2026-10"))[-1])

    def test_empty_month_and_bad_month(self):
        t = make_tracker(self)
        self.assertEqual(format_report(t.month_report("2026-12")), ["No expenses in 2026-12."])
        for bad in ("2026-1", "2026-13", "October"):
            with self.assertRaises(TrackerError):
                t.month_report(bad)

    def test_delete(self):
        t = make_tracker(self)
        t.delete(1)
        self.assertEqual(t.month_report("2026-10")["total"], 89050)
        with self.assertRaises(TrackerError):
            t.delete(1)

    def test_trend_and_chart(self):
        t = make_tracker(self)
        self.assertEqual(t.monthly_totals(), [("2026-09", 100000), ("2026-10", 209050)])
        self.assertTrue(format_trend(t.monthly_totals())[1].startswith("2026-10 ####################"))
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "c.png")
            save_chart(t.monthly_totals(), path)
            with open(path, "rb") as f:
                self.assertEqual(f.read(8), b"\x89PNG\r\n\x1a\n")
        with self.assertRaises(TrackerError):
            save_chart([], "x.png")

    def test_commands(self):
        conn = sqlite3.connect(":memory:")
        self.addCleanup(conn.close)
        t = Tracker(conn, today=date(2026, 11, 3))
        self.assertEqual(handle(t, "add 2026-10-03 250.50 food Lunch with team"), ["Added expense #1."])
        self.assertEqual(handle(t, "add 2026-10-03 0 food"), ["Error: amount must be greater than zero."])
        self.assertEqual(handle(t, "add 2026-10-03"), ["Error: usage: add DATE AMOUNT CATEGORY [NOTE]."])
        self.assertEqual(handle(t, "delete abc")[0][:6], "Error:")


if __name__ == "__main__":
    unittest.main()
