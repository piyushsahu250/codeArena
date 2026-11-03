import sqlite3
import unittest
from datetime import datetime, timedelta

from exam import ExamError, ExamSystem
from security import hash_password, verify_password


class Clock:
    def __init__(self):
        self.now = datetime(2026, 11, 3, 10, 0)

    def __call__(self):
        return self.now

    def advance(self, minutes):
        self.now += timedelta(minutes=minutes)


class SecurityTests(unittest.TestCase):
    def test_hash_is_salted_and_verifiable(self):
        a, b = hash_password("Secret123", 1000), hash_password("Secret123", 1000)
        self.assertNotEqual(a, b)
        self.assertTrue(verify_password("Secret123", a))
        self.assertFalse(verify_password("secret123", a))
        self.assertNotIn("Secret123", a)

    def test_malformed_hash_is_just_false(self):
        for stored in ("", "plain", "md5$1$00$00", "pbkdf2_sha256$x$zz$00"):
            self.assertFalse(verify_password("x", stored))


class ExamTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.system = ExamSystem(self.conn, self.clock, iterations=1000)
        self.admin = self.system.bootstrap_admin("teacher", "Teach2026")
        self.asha = self.system.register("asha", "Study2026")
        self.ravi = self.system.register("ravi", "Study2026")
        self.q = [
            self.system.add_question(self.admin, "python", f"Question {i}?", ["a", "b", "c"], i % 3) for i in range(4)
        ]
        self.exam = self.system.create_exam(self.admin, "Quiz", 30, 50, self.q)

    def test_registration_rules(self):
        for name, password in (("ab", "Study2026"), ("bad name", "Study2026"), ("okname", "short1"), ("okname", "onlyletters")):
            with self.assertRaises(ExamError, msg=(name, password)):
                self.system.register(name, password)
        with self.assertRaises(ExamError):
            self.system.register("ASHA", "Study2026")  # usernames are case-insensitive

    def test_passwords_are_stored_hashed(self):
        stored = self.conn.execute("SELECT password_hash FROM users WHERE username = 'asha'").fetchone()[0]
        self.assertTrue(stored.startswith("pbkdf2_sha256$"))
        self.assertNotIn("Study2026", stored)

    def test_login_uses_one_message_for_both_failures(self):
        self.assertEqual(self.system.login("Asha", "Study2026").username, "asha")
        messages = set()
        for name, password in (("asha", "wrong-pass1"), ("ghost", "Study2026")):
            with self.assertRaises(ExamError) as ctx:
                self.system.login(name, password)
            messages.add(str(ctx.exception))
        self.assertEqual(len(messages), 1)

    def test_only_one_bootstrap_admin_and_signup_makes_students(self):
        self.assertEqual(self.asha.role, "student")
        with self.assertRaises(ExamError):
            self.system.bootstrap_admin("second", "Teach2026")

    def test_authorization(self):
        with self.assertRaises(ExamError):
            self.system.add_question(self.asha, "t", "q", ["a", "b"], 0)
        with self.assertRaises(ExamError):
            self.system.create_exam(self.asha, "x", 10, 50, self.q)
        with self.assertRaises(ExamError):
            self.system.report(self.asha, self.exam)
        with self.assertRaises(ExamError):
            self.system.start(self.admin, self.exam)

    def test_question_validation(self):
        bad = [("t", "q", ["a"], 0), ("t", "q", ["a", "a"], 0), ("t", "q", ["a", "b"], 2), ("t", "", ["a", "b"], 0), ("t", "q", ["a", " "], 0)]
        for topic, text, options, correct in bad:
            with self.assertRaises(ExamError, msg=(text, options, correct)):
                self.system.add_question(self.admin, topic, text, options, correct)

    def test_paper_hides_the_answers(self):
        _, paper = self.system.start(self.asha, self.exam)
        self.assertEqual(len(paper), 4)
        self.assertTrue(all(len(item) == 3 for item in paper))

    def test_one_attempt_per_student_and_no_peeking(self):
        attempt, _ = self.system.start(self.asha, self.exam)
        with self.assertRaises(ExamError):
            self.system.start(self.asha, self.exam)
        with self.assertRaises(ExamError):
            self.system.answer(self.ravi, attempt, self.q[0], 0)
        with self.assertRaises(ExamError):
            self.system.result(self.asha, attempt)

    def test_scoring_and_pass_mark(self):
        attempt, _ = self.system.start(self.asha, self.exam)
        for i, question in enumerate(self.q[:2]):
            self.system.answer(self.asha, attempt, question, i % 3)  # both right
        self.system.answer(self.asha, attempt, self.q[2], 0)  # wrong
        result = self.system.finish(self.asha, attempt)
        self.assertEqual((result.score, result.total, result.percent), (2, 4, 50.0))
        self.assertTrue(result.passed)  # exactly on the pass mark counts as a pass
        self.assertEqual([r[0] for r in result.review], ["Question 2?", "Question 3?"])
        self.assertEqual(result.review[1][1], None)

    def test_answers_can_be_changed_before_finishing(self):
        attempt, _ = self.system.start(self.asha, self.exam)
        self.system.answer(self.asha, attempt, self.q[0], 2)
        self.system.answer(self.asha, attempt, self.q[0], 0)
        self.assertEqual(self.system.finish(self.asha, attempt).score, 1)

    def test_time_limit(self):
        attempt, _ = self.system.start(self.asha, self.exam)
        self.clock.advance(30)  # exactly at the limit is still allowed
        self.system.answer(self.asha, attempt, self.q[0], 0)
        self.clock.advance(1)
        with self.assertRaises(ExamError) as ctx:
            self.system.answer(self.asha, attempt, self.q[1], 1)
        self.assertEqual(str(ctx.exception), "time is up")
        result = self.system.finish(self.asha, attempt)
        self.assertEqual(result.score, 1)
        self.assertTrue(result.late)

    def test_invalid_choices_and_foreign_questions(self):
        attempt, _ = self.system.start(self.asha, self.exam)
        for choice in (-1, 3, "1", True, None):
            with self.assertRaises(ExamError, msg=choice):
                self.system.answer(self.asha, attempt, self.q[0], choice)
        other = self.system.add_question(self.admin, "t", "Not in exam?", ["a", "b"], 0)
        with self.assertRaises(ExamError):
            self.system.answer(self.asha, attempt, other, 0)

    def test_cannot_change_or_finish_twice(self):
        attempt, _ = self.system.start(self.asha, self.exam)
        self.system.finish(self.asha, attempt)
        with self.assertRaises(ExamError):
            self.system.finish(self.asha, attempt)
        with self.assertRaises(ExamError):
            self.system.answer(self.asha, attempt, self.q[0], 0)

    def test_report(self):
        a1, _ = self.system.start(self.asha, self.exam)
        a2, _ = self.system.start(self.ravi, self.exam)
        for question, choice in zip(self.q, (0, 1, 2, 0)):  # asha: all four right
            self.system.answer(self.asha, a1, question, choice)
        self.system.answer(self.ravi, a2, self.q[0], 0)  # ravi: one right
        self.system.finish(self.asha, a1)
        self.system.finish(self.ravi, a2)
        report = self.system.report(self.admin, self.exam)
        self.assertEqual((report["finished"], report["average"], report["highest"], report["passed"]), (2, 62.5, 100.0, 1))
        self.assertEqual([p for _, p in report["questions"]], [100.0, 50.0, 50.0, 50.0])

    def test_report_for_an_exam_nobody_took(self):
        report = self.system.report(self.admin, self.exam)
        self.assertEqual((report["finished"], report["average"]), (0, 0.0))


if __name__ == "__main__":
    unittest.main()
