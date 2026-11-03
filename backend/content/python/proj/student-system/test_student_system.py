import unittest

from student_system import NotFound, Student, StudentRepository, ValidationError, connect, handle


def make_repo():
    repo = StudentRepository(connect())
    repo.add(Student.create(101, "Asha Rao", "asha@example.com", "cse", 2))
    repo.add(Student.create(102, "Ravi Kumar", "ravi@example.com", "ECE", 3))
    repo.add(Student.create(103, "Zoya Khan", "zoya@example.com", "CSE", 3))
    return repo


class ValidationTests(unittest.TestCase):
    def test_create_cleans_the_input(self):
        s = Student.create("7", "  asha   rao ", " Asha@Example.COM ", "cse", "2")
        self.assertEqual((s.roll_no, s.name, s.email, s.course, s.year), (7, "asha rao", "asha@example.com", "CSE", 2))

    def test_each_rule_rejects_bad_data(self):
        bad = [
            (0, "Asha", "a@b.co", "CSE", 1), ("x", "Asha", "a@b.co", "CSE", 1), (1, "A", "a@b.co", "CSE", 1),
            (1, "Asha1", "a@b.co", "CSE", 1), (1, "Asha", "no-at", "CSE", 1), (1, "Asha", "a@b.co", "MBA", 1),
            (1, "Asha", "a@b.co", "CSE", 5), (1, "Asha", "a@b.co", "CSE", "two"),
        ]
        for args in bad:
            with self.assertRaises(ValidationError, msg=args):
                Student.create(*args)


class RepositoryTests(unittest.TestCase):
    def test_get_and_not_found(self):
        repo = make_repo()
        self.assertEqual(repo.get(101).name, "Asha Rao")
        with self.assertRaises(NotFound):
            repo.get(999)

    def test_duplicates_are_rejected(self):
        repo = make_repo()
        with self.assertRaises(ValidationError):
            repo.add(Student.create(101, "Other Person", "other@example.com", "ME", 1))
        with self.assertRaises(ValidationError):
            repo.add(Student.create(104, "Other Person", "ASHA@example.com", "ME", 1))

    def test_update_validates_and_persists(self):
        repo = make_repo()
        self.assertEqual(repo.update(101, "year", "4").year, 4)
        self.assertEqual(repo.get(101).year, 4)
        with self.assertRaises(ValidationError):
            repo.update(101, "year", "9")
        with self.assertRaises(ValidationError):
            repo.update(101, "email", "ravi@example.com")
        with self.assertRaises(ValidationError):
            repo.update(101, "roll_no", "5")

    def test_list_filters(self):
        repo = make_repo()
        self.assertEqual([s.roll_no for s in repo.list()], [101, 102, 103])
        self.assertEqual([s.roll_no for s in repo.list(course="cse")], [101, 103])
        self.assertEqual([s.roll_no for s in repo.list(year=3)], [102, 103])
        self.assertEqual([s.roll_no for s in repo.list(course="CSE", year=3)], [103])

    def test_search_matches_name_or_email_and_treats_wildcards_literally(self):
        repo = make_repo()
        self.assertEqual([s.roll_no for s in repo.search("KUM")], [102])
        self.assertEqual([s.roll_no for s in repo.search("zoya@")], [103])
        self.assertEqual(repo.search("%"), [])
        self.assertEqual(repo.search("' OR 1=1 --"), [])

    def test_sql_injection_text_is_just_data(self):
        repo = make_repo()
        with self.assertRaises(ValidationError):
            Student.create(5, "x'); DROP TABLE students; --", "x@y.co", "CSE", 1)
        self.assertEqual(len(repo.list()), 3)

    def test_marks_are_updated_not_duplicated_and_reported(self):
        repo = make_repo()
        repo.add_mark(101, "Maths", 80)
        repo.add_mark(101, "Maths", 90)
        repo.add_mark(101, "Physics", 70)
        self.assertEqual(repo.averages()[0], (101, "Asha Rao", 2, 80.0))
        self.assertEqual(repo.averages()[1][2:], (0, None))
        with self.assertRaises(ValidationError):
            repo.add_mark(101, "Maths", 101)
        with self.assertRaises(NotFound):
            repo.add_mark(555, "Maths", 50)

    def test_deleting_a_student_deletes_the_marks(self):
        repo = make_repo()
        repo.add_mark(101, "Maths", 80)
        repo.delete(101)
        self.assertEqual(repo.conn.execute("SELECT COUNT(*) FROM marks").fetchone()[0], 0)
        with self.assertRaises(NotFound):
            repo.delete(101)


class CommandTests(unittest.TestCase):
    def test_commands_and_errors(self):
        repo = StudentRepository(connect())
        self.assertEqual(handle(repo, "list"), ["No students."])
        self.assertEqual(handle(repo, "add 1 | Asha Rao | a@b.co | cse | 2"), ["Added Asha Rao (roll 1)."])
        self.assertEqual(handle(repo, "show 1"), ["1 | Asha Rao | a@b.co | CSE | year 2"])
        self.assertEqual(handle(repo, "add 1 | Asha Rao | c@d.co | cse | 2"), ["Error: roll number or email already exists."])
        self.assertEqual(handle(repo, "add 1 | Asha"), ["Error: usage: add ROLL | NAME | EMAIL | COURSE | YEAR."])
        self.assertEqual(handle(repo, "list color=red"), ["Error: usage: list [course=NAME] [year=N]."])
        self.assertEqual(handle(repo, "show x"), ["Error: roll number must be a whole number."])
        self.assertTrue(handle(repo, "fly")[0].startswith("Error: unknown command"))


if __name__ == "__main__":
    unittest.main()
