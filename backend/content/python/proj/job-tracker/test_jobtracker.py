import unittest

from jobtracker import JobTracker, TrackerError, handle


def run(tracker, *lines):
    return [out for line in lines for out in handle(tracker, line)]


class JobTrackerTests(unittest.TestCase):
    def setUp(self):
        self.t = JobTracker("2026-11-03")
        self.addCleanup(self.t.conn.close)

    def test_add_validates_and_rejects_duplicates_ignoring_case(self):
        self.assertEqual(run(self.t, "add Acme | Dev | 2026-10-01", "add ACME | dev | 2026-10-02"), ["Added #1.", "Error: duplicate application."])
        self.assertEqual(run(self.t, "add Acme | Dev | 2026-13-01"), ["Error: invalid date."])
        self.assertEqual(run(self.t, "add Acme | Dev"), ["Error: usage: add COMPANY | ROLE | DATE."])

    def test_status_workflow(self):
        run(self.t, "add Acme | Dev | 2026-10-01")
        self.assertEqual(run(self.t, "status 1 screening", "status 1 offer", "status 1 nonsense", "status 7 applied"),
                         ["#1 is now screening.", "Error: cannot move from screening to offer.", "Error: unknown status nonsense.", "Error: no application #7."])
        self.assertEqual(run(self.t, "status 1 rejected", "status 1 interview"), ["#1 is now rejected.", "Error: cannot move from rejected to interview."])

    def test_full_path_to_accepted_is_final(self):
        run(self.t, "add Acme | Dev | 2026-10-01")
        for status in ("screening", "interview", "offer", "accepted"):
            self.assertEqual(run(self.t, f"status 1 {status}"), [f"#1 is now {status}."])
        self.assertEqual(run(self.t, "status 1 withdrawn"), ["Error: cannot move from accepted to withdrawn."])

    def test_search_and_filters(self):
        run(self.t, "add Acme Corp | Backend Developer | 2026-10-01", "add Globex | Data Analyst | 2026-10-02", "status 2 screening")
        self.assertEqual(len(self.t.find(term="DEVELOPER")), 1)
        self.assertEqual(len(self.t.find(company="glo")), 1)
        self.assertEqual([r[0] for r in self.t.find(status="screening")], [2])
        self.assertEqual(run(self.t, "search zzz", "list status=applied company=glo"), ["No matches.", "No applications."])
        self.assertEqual(run(self.t, "list colour=red"), ["Error: usage: list [status=X] [company=Y]."])

    def test_notes(self):
        run(self.t, "add Acme | Dev | 2026-10-01", "note 1 first", "note 1 second")
        self.assertEqual(run(self.t, "show 1"), ["#1 Acme | Dev | applied | 2026-10-01", "  - first", "  - second"])
        self.assertEqual(run(self.t, "note 9 x"), ["Error: no application #9."])

    def test_import_from_api_payload(self):
        payload = '{"jobs": [{"company": "Hooli", "title": "Python Dev"}, {"company": "hooli", "title": "python dev"}, {"company": "", "title": "x"}, 5, {"title": "no company"}]}'
        self.assertEqual(self.t.import_jobs(payload), (1, 4))
        self.assertEqual(self.t.find()[0][3:], ("saved", "2026-11-03"))
        for bad in ("not json", "{}", '{"jobs": 5}', "[1]"):
            with self.assertRaises(TrackerError, msg=bad):
                self.t.import_jobs(bad)

    def test_dashboard_numbers(self):
        self.assertEqual(self.t.dashboard(), ["Applications: 0", "Response rate: n/a", "Stale (applied 14+ days ago): 0"])
        run(self.t, "add A | x | 2026-10-01", "add B | x | 2026-10-30", "add C | x | 2026-10-30", "status 3 screening")
        lines = self.t.dashboard()
        self.assertIn("applied: 2", lines)
        self.assertIn("Response rate: 33.3%", lines)
        self.assertIn("Stale (applied 14+ days ago): 1", lines)

    def test_today_changes_staleness(self):
        run(self.t, "add A | x | 2026-10-30")
        self.assertIn("Stale (applied 14+ days ago): 0", self.t.dashboard())
        run(self.t, "today 2026-11-12")  # 13 days later
        self.assertIn("Stale (applied 14+ days ago): 0", self.t.dashboard())
        run(self.t, "today 2026-11-13")  # exactly 14 days later
        self.assertIn("Stale (applied 14+ days ago): 1", self.t.dashboard())

    def test_bad_input_never_crashes(self):
        for line in ("", "status", "status x y", "show abc", "note 1", "today yesterday", "nonsense"):
            self.assertTrue(handle(self.t, line)[0].startswith("Error:"), line)


if __name__ == "__main__":
    unittest.main()
