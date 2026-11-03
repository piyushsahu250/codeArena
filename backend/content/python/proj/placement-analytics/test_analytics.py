import io
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from analytics import PNG_SIGNATURE, DataError, analyze, band_for, branch_summary, components, load, placed_by_band, report, save_charts

HEADER = "student_id,branch,cgpa,problems_solved,mock_score,projects,internships,communication,placed\n"
HERE = Path(__file__).parent


def frame(*rows):
    return load(io.StringIO(HEADER + "\n".join(rows) + "\n"))


class ValidationTests(unittest.TestCase):
    def test_the_bundled_dataset_is_valid(self):
        df = load(HERE / "students.csv")
        self.assertEqual((len(df), df["branch"].nunique()), (30, 4))

    def test_bad_files_are_rejected(self):
        bad = {
            "columns": "student_id,branch\nS1,CSE\n",
            "empty": HEADER,
            "range": HEADER + "S1,CSE,11,10,50,1,0,3,yes\n",
            "scale": HEADER + "S1,CSE,8,10,50,1,0,6,yes\n",
            "negative": HEADER + "S1,CSE,8,-1,50,1,0,3,yes\n",
            "text": HEADER + "S1,CSE,eight,10,50,1,0,3,yes\n",
            "placed": HEADER + "S1,CSE,8,10,50,1,0,3,maybe\n",
            "missing": HEADER + "S1,CSE,8,10,,1,0,3,yes\n",
            "duplicate": HEADER + "S1,CSE,8,10,50,1,0,3,yes\nS1,ECE,8,10,50,1,0,3,no\n",
        }
        for name, text in bad.items():
            with self.assertRaises(DataError, msg=name):
                load(io.StringIO(text))


class IndexTests(unittest.TestCase):
    def test_index_matches_a_hand_calculation(self):
        # 6.9/10*25 + 40/100*25 + 52/100*25 + 1/3*10 + 0 + 3/5*5 = 17.25 + 10 + 13 + 3.3333 + 0 + 3 = 46.5833
        row = analyze(frame("S1,CSE,6.9,40,52,1,0,3,no")).iloc[0]
        self.assertEqual(row["readiness"], 46.6)
        self.assertEqual(row["band"], "Needs work")
        self.assertEqual(row["weakest"], "internship")

    def test_full_marks_give_100_and_extra_effort_is_capped(self):
        df = analyze(frame("S1,CSE,10,500,100,9,5,5,yes"))
        self.assertEqual(df.iloc[0]["readiness"], 100.0)
        self.assertTrue((components(df) <= 1).all().all())

    def test_band_boundaries(self):
        self.assertEqual([band_for(s) for s in (100, 75, 74.9, 55, 54.9, 0)], ["Ready", "Ready", "Almost ready", "Almost ready", "Needs work", "Needs work"])

    def test_original_frame_is_not_modified(self):
        df = frame("S1,CSE,8,50,50,1,0,3,yes")
        analyze(df)
        self.assertNotIn("readiness", df.columns)


class SummaryTests(unittest.TestCase):
    def setUp(self):
        self.df = analyze(load(HERE / "students.csv"))

    def test_branch_summary_counts(self):
        summary = branch_summary(self.df)
        self.assertEqual(int(summary["students"].sum()), 30)
        self.assertEqual(list(summary.index), ["CIVIL", "CSE", "ECE", "ME"])

    def test_placed_by_band_adds_up(self):
        rows = placed_by_band(self.df)
        self.assertEqual(sum(students for _, students, _ in rows), 30)
        self.assertEqual(sum(placed for _, _, placed in rows), int((self.df["placed"] == "yes").sum()))

    def test_practice_and_mock_scores_are_positively_correlated(self):
        self.assertGreater(self.df["problems_solved"].corr(self.df["mock_score"]), 0.7)

    def test_report_is_stable_and_honest(self):
        lines = report(self.df)
        self.assertEqual(lines, report(self.df))
        self.assertIn("synthetic", lines[0])
        self.assertIn("cannot show that readiness caused", lines[-1])

    def test_chart_is_a_png(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "c.png"
            save_charts(self.df, path)
            self.assertEqual(path.read_bytes()[:8], PNG_SIGNATURE)


if __name__ == "__main__":
    unittest.main()
