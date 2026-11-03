// Phase 6, mini projects 6-10: Contact Management System (build from scratch), Expense Tracker, To-Do List, Library Management System, Quiz Application.
"use strict";
const { chain, flow } = require("./render");
const { task, rubric } = require("./lib");

const judged = (title, statement, starter, solution, cases, hints) => ({ ...task(title, statement, starter, solution, cases), hints });
const manual = (title, instructions, hints) => ({ title, instructions, hints });
const lessons = [];

// ---------------------------------------------------------------- 6 Contact Management System (build from scratch)
{
  const contacts = `"""Contact book: the reference solution for the build-from-scratch challenge (not published to students)."""
import re
import sys

PHONE = re.compile(r"\\d{10}")
EMAIL = re.compile(r"[^@\\s]+@[^@\\s]+\\.[^@\\s]+")


class ContactBook:
    def __init__(self):
        self.contacts = {}

    @staticmethod
    def _check(field, value):
        if field == "phone" and not PHONE.fullmatch(value):
            raise ValueError("invalid phone number.")
        if field == "email" and not EMAIL.fullmatch(value):
            raise ValueError("invalid email.")
        if field not in ("phone", "email"):
            raise ValueError(f"unknown field {field}.")

    def _key(self, name):
        key = name.lower()
        if key not in self.contacts:
            raise ValueError(f"no contact named {name}.")
        return key

    def add(self, name, phone, email=None):
        if name.lower() in self.contacts:
            raise ValueError(f"{name} already exists.")
        self._check("phone", phone)
        if email is not None:
            self._check("email", email)
        self.contacts[name.lower()] = {"name": name, "phone": phone, "email": email}

    def update(self, name, field, value):
        key = self._key(name)
        self._check(field, value)
        self.contacts[key][field] = value

    def delete(self, name):
        del self.contacts[self._key(name)]

    def listing(self):
        return sorted(self.contacts.values(), key=lambda c: c["name"].lower())

    def search(self, term):
        term = term.lower()
        return [c for c in self.listing() if term in c["name"].lower() or term in c["phone"]]


def line(contact):
    return f"{contact['name']} - {contact['phone']} - {contact['email'] or '-'}"


def main():
    book = ContactBook()
    for raw in sys.stdin:
        parts = raw.split()
        if not parts:
            continue
        command, args = parts[0], parts[1:]
        try:
            if command == "add" and len(args) in (2, 3):
                book.add(*args)
                print(f"Added {args[0]}.")
            elif command == "update" and len(args) == 3:
                book.update(*args)
                print(f"Updated {args[0]}.")
            elif command == "delete" and len(args) == 1:
                book.delete(args[0])
                print(f"Deleted {args[0]}.")
            elif command == "list":
                found = book.listing()
                print("\\n".join(map(line, found)) if found else "No contacts.")
            elif command == "search" and len(args) == 1:
                found = book.search(args[0])
                print("\\n".join(map(line, found)) if found else "No matches.")
            else:
                print("Commands: add NAME PHONE [EMAIL] | update NAME phone|email VALUE | delete NAME | list | search TERM")
        except ValueError as error:
            print(f"Error: {error.args[0]}")


if __name__ == "__main__":
    main()
`;
  const tests = `import unittest

from contacts import ContactBook


class ContactTests(unittest.TestCase):
    def setUp(self):
        self.book = ContactBook()
        self.book.add("Asha", "9876543210", "asha@example.com")
        self.book.add("ravi", "9123456780")

    def test_listing_is_sorted_ignoring_case(self):
        self.book.add("Bela", "9000000000")
        self.assertEqual([c["name"] for c in self.book.listing()], ["Asha", "Bela", "ravi"])

    def test_duplicate_names_ignore_case(self):
        with self.assertRaises(ValueError):
            self.book.add("ASHA", "9999999999")

    def test_validation(self):
        for phone in ("12345", "98765abcde", "98765432101"):
            with self.assertRaises(ValueError):
                self.book.add("Zed", phone)
        with self.assertRaises(ValueError):
            self.book.add("Zed", "9999999999", "not-an-email")

    def test_search_by_name_or_phone(self):
        self.assertEqual([c["name"] for c in self.book.search("SH")], ["Asha"])
        self.assertEqual([c["name"] for c in self.book.search("91")], ["ravi"])
        self.assertEqual(self.book.search("zzz"), [])

    def test_update_and_delete(self):
        self.book.update("RAVI", "email", "r@x.in")
        self.assertEqual(self.book.search("ravi")[0]["email"], "r@x.in")
        self.book.delete("asha")
        self.assertEqual(len(self.book.listing()), 1)
        with self.assertRaises(ValueError):
            self.book.delete("asha")
        with self.assertRaises(ValueError):
            self.book.update("ravi", "address", "x")


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "add Asha 9876543210 asha@example.com\nadd Ravi 9123456780\nadd asha 1112223334\nadd Zoya 12345\nlist\nsearch 91\nsearch SH\nupdate Ravi email ravi@example.com\nupdate Kabir phone 9000000000\ndelete Ravi\nlist\nsearch xyz\n";
  const out = "Added Asha.\nAdded Ravi.\nError: asha already exists.\nError: invalid phone number.\nAsha - 9876543210 - asha@example.com\nRavi - 9123456780 - -\nRavi - 9123456780 - -\nAsha - 9876543210 - asha@example.com\nUpdated Ravi.\nError: no contact named Kabir.\nDeleted Ravi.\nAsha - 9876543210 - asha@example.com\nNo matches.\n";
  lessons.push({
    title: "Mini Project 6: Contact Management System (build from scratch)",
    minutes: 120,
    project: {
      id: "contact-management", kind: "MINI", difficulty: "MEDIUM", minutes: 120, scratch: true, packages: [],
      problem: "Build a contact management program from scratch. It stores names, 10-digit phone numbers and optional emails, lists contacts alphabetically, searches by name or phone, updates and deletes contacts, and rejects bad data. No step-by-step solution is given: you design it yourself and prove it works with the acceptance tests.",
      scenario: "A shop assistant keeps customers' numbers on scraps of paper and loses them. A tidy command-line contact book removes the chaos, but only if it refuses bad entries (a phone number with nine digits is worse than none) and finds people quickly.",
      objectives: ["Break a problem into data, rules and commands before writing code", "Choose data structures yourself (dictionary, list, class) and justify them", "Validate input with regular expressions or string methods", "Prove the program with your own unit tests and the platform's acceptance tests"],
      prerequisites: ["Dictionaries, lists and sorting", "Classes (recommended) and exceptions", "Regular expressions or str methods for validation", "Reading commands from standard input"],
      requirements: ["add NAME PHONE [EMAIL]: names are single words; the phone must be exactly 10 digits; the email, if given, must look like name@domain.tld", "Names are unique ignoring case (asha and Asha clash) but are displayed as typed", "list: all contacts sorted by name ignoring case, one per line as NAME - PHONE - EMAIL (a dash when there is no email), or No contacts.", "search TERM: contacts whose name or phone contains the term (ignoring case), or No matches.", "update NAME phone|email VALUE and delete NAME; both look the name up ignoring case", "Every refusal prints Error: followed by a message; the program never crashes"],
      architecture: chain("Contact book architecture (suggested)", "A suggested design: the command loop parses lines and calls a ContactBook object that holds a dictionary of contacts and validates data; the loop prints results.",
        [{ k: "io", t: "commands" }, { k: "proc", t: "command loop\nparse + print" }, { k: "proc", t: "ContactBook\nrules + storage" }, { k: "io", t: "listing,\nmessages" }], { w: 150, gap: 36, hgt: 62 }),
      flowchart: flow("Contact book flowchart", "Read a command, check its form, apply it to the book (which validates), and print either the result or an Error line; repeat until the input ends.", ["start", "read a command", "known command\nwith right arguments?", "ask ContactBook\nto do it", "valid?", "print result\nor Error:"], { loop: true }),
      schema: null,
      milestones: ["Plan on paper: what is stored for each contact, how are names compared, which commands exist and what each prints.", "Milestone 1: add and list. Store contacts, reject duplicates, list them sorted ignoring case.", "Milestone 2: validation. Accept only 10-digit phone numbers and plausible emails, with the exact Error: messages.", "Milestone 3: search and delete. Search by name or phone ignoring case; delete by name.", "Milestone 4: update. Change phone or email with the same validation, and reject unknown fields.", "Milestone 5: tests and polish. Write unit tests for every rule, handle empty and malformed commands, write the README."],
      layout: ["contacts.py", "test_contacts.py"],
      reference: { "contacts.py": contacts, "test_contacts.py": tests },
      run: "contacts.py", test: "test_contacts.py", stdin, sample: { out },
      explain: [["Command contract", "The exact commands and messages are the specification. The acceptance tests compare your output to it character by character, so read the requirements carefully."], ["Uniqueness ignoring case", "Store contacts under a lower-case key and keep the display name separately."], ["Validation in one place", "Put the phone and email rules in the data layer (not scattered in the command loop) so every command that changes data uses them."], ["Sorting", "Sort at display time with a key function so you never have to keep the storage ordered."], ["Errors", "Raise exceptions in the data layer; print Error: messages in the command loop."]],
      testing: ["Write at least one unit test per rule: duplicates ignoring case, each invalid phone, an invalid email, search by name and by phone, update, delete of a missing name.", "Run the acceptance tests in the Project tasks section; each failing case shows the expected output.", "Try odd input: an empty line, a command with too few words, a phone with letters or 11 digits.", "Re-read the requirements and check every sentence against your program."],
      bugs: [["Duplicates appear when the case differs", "Compare names in lower case."], ["List is not alphabetical for mixed case", "Sort with key=str.lower or a lower-cased name."], ["A phone number with 11 digits is accepted", "Match the whole string (fullmatch), not just the start."], ["Crash on a one-word command", "Check the number of arguments before indexing."], ["Search finds nothing for a phone", "Search the phone text too, and compare lower-case terms."]],
      extensions: ["Save contacts to a JSON file and load them at start-up.", "Add groups or tags (family, work) and search by tag.", "Support several phone numbers per contact.", "Export to CSV and import from CSV with validation of every row.", "Replace the dictionary by an SQLite table."],
      interview: ["Which data structure did you choose for contacts, and why?", "How do you keep names unique ignoring case but display them as typed?", "Where does validation belong, and why?", "How would you make search faster for a million contacts?", "How did you test the program?"],
      rubric: rubric("All commands behave exactly as specified and pass the acceptance tests", "Your own design is clean: validation in one place, sorting at display time, case rules correct"),
      tasks: [
        judged("Contacts: add and list", "Build the contact book (see the guide for the full specification). In this milestone: add NAME PHONE [EMAIL] prints Added NAME.; a name that already exists (ignoring case) prints Error: NAME already exists. (with the name as typed this time); a phone that is not exactly 10 digits prints Error: invalid phone number.; list prints the contacts sorted by name ignoring case, one per line as NAME - PHONE - EMAIL (a dash when there is no email) or No contacts. when there are none.", "# Build the contact book from scratch\n", contacts, [["list\n", "No contacts."], ["add Asha 9876543210 asha@example.com\nadd Ravi 9123456780\nadd asha 1112223334\nadd Zoya 12345\nlist\n", "Added Asha.\nAdded Ravi.\nError: asha already exists.\nError: invalid phone number.\nAsha - 9876543210 - asha@example.com\nRavi - 9123456780 - -"], ["add bela 9000000000\nadd Asha 8000000000\nadd Zed 7000000000\nlist\n", "Added bela.\nAdded Asha.\nAdded Zed.\nAsha - 8000000000 - -\nbela - 9000000000 - -\nZed - 7000000000 - -"], ["add Q 98765432101\nadd Q 9876543210x\nlist\n", "Error: invalid phone number.\nError: invalid phone number.\nNo contacts."]],
          ["Keep contacts in a dictionary keyed by the lower-case name.", "Use re.fullmatch(r\"\\d{10}\", phone) or str.isdigit() with len() == 10.", "Sort with key=lambda c: c[\"name\"].lower().", "Print Error: and then the message for each refusal."]),
        judged("Contacts: email, search and delete", "Extend the contact book. add may include an email that must look like name@domain.tld, otherwise print Error: invalid email.; search TERM prints, in the list format, the contacts whose name or phone contains TERM ignoring case, or No matches.; delete NAME prints Deleted NAME. or Error: no contact named NAME. (names are matched ignoring case).", "# Extend your contact book\n", contacts, [["add Asha 9876543210 asha@example.com\nadd Ravi 9123456780\nsearch 91\nsearch SH\nsearch xyz\n", "Added Asha.\nAdded Ravi.\nRavi - 9123456780 - -\nAsha - 9876543210 - asha@example.com\nNo matches."], ["add Bob 1234567890 bob-at-example\nlist\n", "Error: invalid email.\nNo contacts."], ["add Cy 1234567890\ndelete CY\ndelete cy\nlist\n", "Added Cy.\nDeleted CY.\nError: no contact named cy.\nNo contacts."], ["add Mo 5555555555 mo@x.io\nsearch 555\nsearch MO\n", "Added Mo.\nMo - 5555555555 - mo@x.io\nMo - 5555555555 - mo@x.io"]],
          ["Search the lower-cased name and the phone text with the in operator.", "An email pattern such as [^@\\s]+@[^@\\s]+\\.[^@\\s]+ is enough here.", "Raise a ValueError in the data layer and print it in the loop."]),
        judged("Contacts: update", "Finish the contact book. update NAME FIELD VALUE changes the phone or the email of an existing contact (name matched ignoring case) after validating the new value the same way as add. It prints Updated NAME. or one of Error: no contact named NAME., Error: invalid phone number., Error: invalid email., Error: unknown field FIELD.", "# Finish your contact book\n", contacts, [["add Ravi 9123456780\nupdate ravi email ravi@example.com\nlist\n", "Added Ravi.\nUpdated ravi.\nRavi - 9123456780 - ravi@example.com"], ["add Ravi 9123456780\nupdate Ravi phone 12\nupdate Ravi email nope\nupdate Ravi address Pune\nupdate Kabir phone 9000000000\n", "Added Ravi.\nError: invalid phone number.\nError: invalid email.\nError: unknown field address.\nError: no contact named Kabir."], ["add Li 1111111111\nupdate Li phone 2222222222\nsearch 2222\n", "Added Li.\nUpdated Li.\nLi - 2222222222 - -"], ["update X phone 1234567890\n", "Error: no contact named X."]],
          ["Look the contact up first so that a missing name is reported first.", "Reuse the same validators as add.", "Reject a field that is neither phone nor email."]),
        manual("Contacts: plan before you code", "Write half a page (in your repository's README or a PLAN.md) describing the data you store, the classes or functions you will write, the validation rules and the order in which you will build the milestones. Commit it before you write any code.", ["Think about where each rule lives.", "List the error messages you must print."]),
        manual("Contacts: tests and publish", "Write unit tests for every rule (duplicate ignoring case, each invalid phone, invalid email, search by name and by phone, update, delete of a missing contact). Create the GitHub repository with a README, commit in small steps and submit the link.", []),
      ],
    },
  });
}

// ---------------------------------------------------------------- 7 Expense Tracker
{
  const expenses = `"""A personal expense tracker with totals by category and by month."""
import sys
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation

CENT = Decimal("0.01")


def parse_amount(text):
    try:
        amount = Decimal(text).quantize(CENT)
    except InvalidOperation:
        raise ValueError("invalid amount") from None
    if not amount.is_finite() or amount <= 0:
        raise ValueError("invalid amount")
    return amount


def parse_date(text):
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise ValueError("invalid date") from None


class Tracker:
    def __init__(self):
        self.expenses = []

    def add(self, when, category, amount, note=""):
        expense = {"date": parse_date(when), "category": category.lower(), "amount": parse_amount(amount), "note": note}
        self.expenses.append(expense)
        return expense

    def total(self):
        return sum((e["amount"] for e in self.expenses), Decimal("0.00"))

    def by_category(self):
        totals = defaultdict(Decimal)
        for e in self.expenses:
            totals[e["category"]] += e["amount"]
        return sorted(totals.items(), key=lambda item: (-item[1], item[0]))

    def month_total(self, month):
        return sum((e["amount"] for e in self.expenses if e["date"].strftime("%Y-%m") == month), Decimal("0.00"))


def main():
    tracker = Tracker()
    for line in sys.stdin:
        parts = line.split()
        if not parts:
            continue
        try:
            if parts[0] == "add" and len(parts) >= 4:
                e = tracker.add(parts[1], parts[2], parts[3], " ".join(parts[4:]))
                print(f"Added {e['amount']:.2f} to {e['category']}.")
            elif parts[0] == "total":
                print(f"Total: {tracker.total():.2f}")
            elif parts[0] == "categories":
                for category, amount in tracker.by_category():
                    print(f"{category} {amount:.2f}")
            elif parts[0] == "month" and len(parts) == 2:
                print(f"{parts[1]}: {tracker.month_total(parts[1]):.2f}")
            else:
                print("Commands: add DATE CATEGORY AMOUNT [NOTE] | total | categories | month YYYY-MM")
        except ValueError as error:
            print(f"Error: {error}")


if __name__ == "__main__":
    main()
`;
  const tests = `import unittest
from decimal import Decimal

from expenses import Tracker, parse_amount, parse_date


class ExpenseTests(unittest.TestCase):
    def setUp(self):
        self.t = Tracker()
        self.t.add("2026-10-03", "Food", "250.50", "lunch")
        self.t.add("2026-10-04", "transport", "80")
        self.t.add("2026-11-01", "food", "300")

    def test_total_is_exact(self):
        self.assertEqual(self.t.total(), Decimal("630.50"))
        t = Tracker()
        t.add("2026-01-01", "a", "0.1")
        t.add("2026-01-01", "a", "0.2")
        self.assertEqual(t.total(), Decimal("0.30"))

    def test_categories_sorted_by_amount_then_name(self):
        self.t.add("2026-11-02", "books", "80")
        self.assertEqual(self.t.by_category(), [("food", Decimal("550.50")), ("books", Decimal("80.00")), ("transport", Decimal("80.00"))])

    def test_month_total(self):
        self.assertEqual(self.t.month_total("2026-10"), Decimal("330.50"))
        self.assertEqual(self.t.month_total("2025-01"), Decimal("0.00"))

    def test_validation(self):
        for bad in ("abc", "-5", "0", "nan", "inf"):
            with self.assertRaises(ValueError):
                parse_amount(bad)
        for bad in ("2026-13-01", "yesterday", "2026-02-30"):
            with self.assertRaises(ValueError):
                parse_date(bad)
        self.assertEqual(len(self.t.expenses), 3)


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "add 2026-10-03 food 250.50 lunch\nadd 2026-10-04 transport 80 bus\nadd 2026-11-01 food 300\nadd 2026-11-02 rent 9000 monthly\nadd 2026-11-02 food abc\nadd 2026-13-01 food 10\ntotal\ncategories\nmonth 2026-10\n";
  lessons.push({
    title: "Mini Project 7: Expense Tracker",
    minutes: 90,
    project: {
      id: "expense-tracker", kind: "MINI", difficulty: "MEDIUM", minutes: 90, packages: [],
      problem: "Build a command-line expense tracker that records expenses (date, category, amount, note), validates every entry, and reports the total, the totals by category and the total of any month, using exact decimal arithmetic for money.",
      scenario: "A student on a monthly allowance wants to see where the money goes. A spreadsheet is easy to get wrong; a small program that checks every entry and never mis-adds cents is more reliable.",
      objectives: ["Use Decimal for money instead of float", "Validate dates and amounts and report precise errors", "Group and total data with defaultdict and sorted keys", "Separate parsing, storage and reporting"],
      prerequisites: ["Dictionaries and defaultdict", "datetime.date", "Exceptions", "Sorting with key functions"],
      requirements: ["add DATE CATEGORY AMOUNT [NOTE]: DATE is YYYY-MM-DD, AMOUNT is a positive number with at most two decimals kept", "total prints the sum of all expenses", "categories prints each category total, highest first (ties alphabetical)", "month YYYY-MM prints the total of that month", "Money uses exact decimal arithmetic and is always shown with two decimals", "Invalid dates or amounts print Error: invalid date or Error: invalid amount without changing the data"],
      architecture: chain("Expense tracker architecture", "Commands go to the command loop, which calls the Tracker; the Tracker validates through parse_amount and parse_date, stores expense records and computes totals.",
        [{ k: "io", t: "commands" }, { k: "proc", t: "main()" }, { k: "proc", t: "Tracker\nlist of expenses" }, { k: "proc", t: "parse_amount\nparse_date" }, { k: "io", t: "totals" }], { w: 130, gap: 28, hgt: 62 }),
      flowchart: flow("Expense tracker flowchart", "Parse the command, validate the date and amount for add, update the list, and print the requested total.", ["start", "read a command", "add or report?", "validate date\nand amount", "valid?", "store / compute\nand print"], { loop: true }),
      schema: null,
      steps: [["Choose the record.", "One dictionary per expense: date, category, amount, note."], ["Write parse_amount().", "Decimal(text).quantize(Decimal(\"0.01\")) rounds to cents; reject anything that is not a positive number (including nan and inf)."], ["Write parse_date().", "date.fromisoformat checks the format and the calendar (it rejects 2026-02-30)."], ["Write Tracker.add and total.", "Validate first, then store. sum() with a Decimal start value keeps two decimals even for an empty list."], ["Group by category.", "defaultdict(Decimal) adds up amounts; sort by (-amount, name)."], ["Filter by month.", "Compare date.strftime(\"%Y-%m\") with the requested text."], ["Write main() and test.", "Check exact cents (0.1 + 0.2), ties in the category order, invalid input and empty months."]],
      files: { "expenses.py": expenses, "test_expenses.py": tests },
      run: "expenses.py", test: "test_expenses.py", stdin, sample: { out: "Added 250.50 to food.\nAdded 80.00 to transport.\nAdded 300.00 to food.\nAdded 9000.00 to rent.\nError: invalid amount\nError: invalid date\nTotal: 9630.50\nrent 9000.00\nfood 550.50\ntransport 80.00\n2026-10: 330.50\n" },
      explain: [["Decimal", "Exact decimal arithmetic. Floats cannot store 0.1 exactly, so sums of money can drift by a cent."], ["parse_amount / parse_date", "Small validators that turn text into trusted values or raise ValueError with a short message."], ["Tracker", "Holds the data and the calculations; it prints nothing."], ["by_category", "Totals per category sorted by a compound key so the output is deterministic."], ["main", "The only place with input and output."]],
      testing: ["Run the sample and check every line.", "Run python -m unittest test_expenses -v", "Try 0.1 + 0.2 as two expenses and check the total is 0.30.", "Try a negative amount, nan, 2026-02-30, an empty category list and a month with no expenses."],
      bugs: [["Totals like 0.30000000000000004", "You used float; use Decimal built from text."], ["Decimal(0.1) gives a long number", "Build Decimals from strings, not from floats."], ["Categories appear in a different order each time", "Sort with a compound key so ties are stable."], ["Invalid dates are accepted", "Use date.fromisoformat, which checks the calendar."], ["A bad entry still changes the total", "Validate before appending."]],
      extensions: ["Save and load expenses as CSV or JSON.", "Add monthly budgets and warn when a category goes over.", "Draw a bar chart of category totals with Matplotlib.", "Move to SQLite (the major Expense Tracker project does this)."],
      interview: ["Why not use float for money?", "How does defaultdict simplify grouping?", "How would you add a budget feature?", "How do you make the report order deterministic?", "How would you store the expenses so they survive a restart?"],
      rubric: rubric("Totals, categories and months are exact; the sample matches; validation protects the data", "Exact Decimal arithmetic; deterministic ordering; validators separated from the tracker"),
      tasks: [
        judged("Expense tracker: totals", "Build the expense tracker. Commands: add DATE CATEGORY AMOUNT [NOTE] (DATE is YYYY-MM-DD, AMOUNT a positive number; categories are lower-cased) prints Added X.XX to CATEGORY. or Error: invalid amount / Error: invalid date; total prints Total: X.XX; categories prints CATEGORY X.XX for each category, highest total first and alphabetically for ties; month YYYY-MM prints YYYY-MM: X.XX. Use exact decimal arithmetic.", "# Write your expense tracker here\n", expenses, [[stdin, "Added 250.50 to food.\nAdded 80.00 to transport.\nAdded 300.00 to food.\nAdded 9000.00 to rent.\nError: invalid amount\nError: invalid date\nTotal: 9630.50\nrent 9000.00\nfood 550.50\ntransport 80.00\n2026-10: 330.50"], ["add 2026-01-01 a 0.1\nadd 2026-01-01 b 0.2\ntotal\n", "Added 0.10 to a.\nAdded 0.20 to b.\nTotal: 0.30"], ["add 2026-02-30 x 5\nadd 2026-02-28 x -5\ntotal\nmonth 2026-02\n", "Error: invalid date\nError: invalid amount\nTotal: 0.00\n2026-02: 0.00"], ["add 2026-03-01 Books 50\nadd 2026-03-02 gym 50\ncategories\n", "Added 50.00 to books.\nAdded 50.00 to gym.\nbooks 50.00\ngym 50.00"]],
          ["Use Decimal(text).quantize(Decimal(\"0.01\")).", "date.fromisoformat validates the calendar.", "defaultdict(Decimal) for category totals; sort by (-total, name).", "sum(..., Decimal(\"0.00\")) for empty lists."]),
        manual("Expense tracker: unit tests", "Write tests for exact totals (0.1 + 0.2), the category order with ties, the month filter, and every validation error. Make sure a rejected entry does not change the data.", []),
        manual("Expense tracker: publish it", "Create the repository with README and tests, commit in small steps and push; submit the link.", []),
      ],
    },
  });
}

// ---------------------------------------------------------------- 8 To-Do List
{
  const taskbook = `"""A to-do list with priorities, due dates and JSON storage."""
import json
import sys
from datetime import date

PRIORITIES = {"high": 0, "medium": 1, "low": 2}


class TaskBook:
    def __init__(self):
        self.tasks = []
        self.next_id = 1

    def add(self, text, priority="medium", due=None):
        if not text.strip():
            raise ValueError("task text is required")
        if priority not in PRIORITIES:
            raise ValueError("priority must be high, medium or low")
        if due is not None:
            try:
                date.fromisoformat(due)
            except ValueError:
                raise ValueError("due date must be YYYY-MM-DD") from None
        task = {"id": self.next_id, "text": text.strip(), "priority": priority, "due": due, "done": False}
        self.next_id += 1
        self.tasks.append(task)
        return task

    def _get(self, task_id):
        for task in self.tasks:
            if task["id"] == task_id:
                return task
        raise KeyError(f"no task {task_id}")

    def complete(self, task_id):
        self._get(task_id)["done"] = True

    def remove(self, task_id):
        self.tasks.remove(self._get(task_id))

    def ordered(self, pending_only=False):
        tasks = [t for t in self.tasks if not (pending_only and t["done"])]
        return sorted(tasks, key=lambda t: (t["done"], PRIORITIES[t["priority"]], t["due"] or "9999-99-99", t["id"]))

    def save(self, path):
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"next_id": self.next_id, "tasks": self.tasks}, handle)

    @classmethod
    def load(cls, path):
        taskbook = cls()
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        taskbook.tasks, taskbook.next_id = data["tasks"], data["next_id"]
        return taskbook


def describe(task, today):
    bits = [task["priority"]]
    if task["due"]:
        bits.append(f"due {task['due']}")
        if not task["done"] and task["due"] < today.isoformat():
            bits.append("overdue")
    return f"[{'x' if task['done'] else ' '}] {task['id']}. {task['text']} ({', '.join(bits)})"


def parse_add(words):
    priority, due, text = "medium", None, []
    for word in words:
        if word.startswith("!"):
            priority = word[1:]
        elif word.startswith("due:"):
            due = word[4:]
        else:
            text.append(word)
    return " ".join(text), priority, due


def main(argv):
    today = date.fromisoformat(argv[argv.index("--today") + 1]) if "--today" in argv else date.today()
    taskbook = TaskBook()
    for line in sys.stdin:
        parts = line.split()
        if not parts:
            continue
        try:
            if parts[0] == "add" and len(parts) > 1:
                task = taskbook.add(*parse_add(parts[1:]))
                print(f"Added {task['id']}: {task['text']}")
            elif parts[0] == "done" and len(parts) == 2:
                taskbook.complete(int(parts[1]))
                print(f"Done {parts[1]}.")
            elif parts[0] == "remove" and len(parts) == 2:
                taskbook.remove(int(parts[1]))
                print(f"Removed {parts[1]}.")
            elif parts[0] == "list":
                for task in taskbook.ordered(pending_only=parts[1:] == ["pending"]):
                    print(describe(task, today))
            else:
                print("Commands: add TEXT [!priority] [due:YYYY-MM-DD] | done ID | remove ID | list [pending]")
        except KeyError as error:
            print(f"Error: {error.args[0]}")
        except ValueError as error:
            print(f"Error: {error}")


if __name__ == "__main__":
    main(sys.argv)
`;
  const tests = `import os
import tempfile
import unittest
from datetime import date

from taskbook import TaskBook, describe, parse_add


class TodoTests(unittest.TestCase):
    def setUp(self):
        self.taskbook = TaskBook()
        self.taskbook.add("write report", "high", "2026-11-01")
        self.taskbook.add("buy milk")
        self.taskbook.add("water plants", "low")

    def test_order_priority_then_due_then_id_with_done_last(self):
        self.taskbook.complete(1)
        self.assertEqual([t["id"] for t in self.taskbook.ordered()], [2, 3, 1])

    def test_pending_only(self):
        self.taskbook.complete(2)
        self.assertEqual([t["id"] for t in self.taskbook.ordered(pending_only=True)], [1, 3])

    def test_errors(self):
        with self.assertRaises(KeyError):
            self.taskbook.complete(99)
        with self.assertRaises(ValueError):
            self.taskbook.add("x", "urgent")
        with self.assertRaises(ValueError):
            self.taskbook.add("x", due="31/12/2026")
        with self.assertRaises(ValueError):
            self.taskbook.add("   ")

    def test_ids_are_not_reused_after_remove(self):
        self.taskbook.remove(3)
        self.assertEqual(self.taskbook.add("new")["id"], 4)

    def test_describe_marks_overdue_only_when_pending(self):
        task = self.taskbook.tasks[0]
        self.assertIn("overdue", describe(task, date(2026, 11, 3)))
        task["done"] = True
        self.assertNotIn("overdue", describe(task, date(2026, 11, 3)))

    def test_parse_add(self):
        self.assertEqual(parse_add(["call", "mom", "!high", "due:2026-12-01"]), ("call mom", "high", "2026-12-01"))

    def test_save_and_load_round_trip(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "taskbook.json")
            self.taskbook.save(path)
            loaded = TaskBook.load(path)
        self.assertEqual(loaded.tasks, self.taskbook.tasks)
        self.assertEqual(loaded.add("again")["id"], 4)


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "add Buy milk\nadd Finish report !high due:2026-11-01\nadd Call mom due:2026-11-10\nadd !low Water plants\ndone 1\nlist\nremove 9\nremove 4\nlist pending\n";
  lessons.push({
    title: "Mini Project 8: To-Do List",
    minutes: 90,
    project: {
      id: "taskbook-list", kind: "MINI", difficulty: "MEDIUM", minutes: 90, packages: [],
      problem: "Build a to-do list that stores tasks with a priority and an optional due date, marks them done, removes them, shows them in a sensible order with overdue tasks flagged, and can save to and load from a JSON file.",
      scenario: "Everyone forgets things. A to-do list that puts the most important and most urgent tasks first, flags what is overdue and remembers tasks between runs is the first useful program many developers write.",
      objectives: ["Model tasks as dictionaries and manage them in a class", "Sort by several keys (done, priority, due date, id)", "Parse a small command language from free text", "Persist data in JSON and test file operations with temporary folders"],
      prerequisites: ["Lists and dictionaries", "Classes", "datetime.date", "json and file handling"],
      requirements: ["add TEXT [!high|!medium|!low] [due:YYYY-MM-DD] with default priority medium", "done ID, remove ID, list and list pending", "Order: pending before done, then high before medium before low, then earlier due dates, then id", "Flag a pending task whose due date is before today as overdue", "IDs are never reused", "save() and load() keep the tasks in a JSON file", "Invalid priority, date or id gives an Error line"],
      architecture: chain("To-do list architecture", "The command loop parses text into add/done/remove/list calls on a TaskBook object; the object keeps the tasks, orders them and saves them as JSON; describe() formats a task for display.",
        [{ k: "io", t: "commands" }, { k: "proc", t: "parse_add\nmain()" }, { k: "proc", t: "TaskBook\ntasks + ids" }, { k: "io", t: "tasks.json" }, { k: "io", t: "list output" }], { w: 130, gap: 28, hgt: 62 }),
      flowchart: flow("To-do list flowchart", "Read a command and, depending on it, add, complete, remove or list tasks; errors from invalid ids or data are caught and printed.", ["start", "read a command", "which command?", "change the\ntask list", "error?", "print result\nor message"], { loop: true }),
      schema: null,
      steps: [["Decide the task shape.", "{id, text, priority, due, done}. Due is kept as an ISO string, which sorts correctly as text."], ["Write add().", "Validate text, priority and due date before creating the task and incrementing next_id."], ["Write complete() and remove().", "A private _get() finds a task or raises KeyError, so both reuse one lookup."], ["Write ordered().", "sorted(..., key=(done, priority rank, due or a far-future string, id)) gives the required order in one line."], ["Write describe().", "Build the part in brackets from the priority, the due date and the overdue flag; compare ISO dates as strings."], ["Write parse_add().", "Words starting with ! or due: are options; the rest is the text."], ["Add JSON storage.", "save() writes next_id and tasks; load() restores both so ids stay unique."], ["Test.", "Cover ordering, overdue, errors, ids after removal and a save/load round trip in a temporary folder."]],
      files: { "taskbook.py": taskbook, "test_taskbook.py": tests },
      run: "taskbook.py", args: "--today 2026-11-03", test: "test_taskbook.py", stdin, sample: { out: "Added 1: Buy milk\nAdded 2: Finish report\nAdded 3: Call mom\nAdded 4: Water plants\nDone 1.\n[ ] 2. Finish report (high, due 2026-11-01, overdue)\n[ ] 3. Call mom (medium, due 2026-11-10)\n[ ] 4. Water plants (low)\n[x] 1. Buy milk (medium)\nError: no task 9\nRemoved 4.\n[ ] 2. Finish report (high, due 2026-11-01, overdue)\n[ ] 3. Call mom (medium, due 2026-11-10)\n" },
      explain: [["PRIORITIES", "Maps names to ranks so sorting can use numbers."], ["next_id", "A counter that only grows, so ids are never reused after a removal."], ["ordered", "One sort key tuple expresses all ordering rules; False sorts before True, so pending comes first."], ["describe", "Formats a task; takes today as a parameter so tests do not depend on the real date."], ["save / load", "JSON round trip; storing next_id keeps ids unique after a restart."], ["--today", "A command-line option that makes the overdue flag testable."]],
      testing: ["Run python taskbook.py --today 2026-11-03 < input.txt for the sample.", "Run python -m unittest test_taskbook -v", "Try: !urgent, due:31/12/2026, done 99, an empty add, two tasks with the same priority and due date.", "Save, restart and load: ids must continue from where they stopped."],
      bugs: [["Done tasks appear first", "Put task[\"done\"] first in the sort key (False before True)."], ["Tasks without due dates come first", "Use a far-future string for the missing due date in the key."], ["IDs repeat after remove", "Keep a separate next_id counter instead of len(tasks) + 1."], ["Overdue flag depends on the day you run it", "Pass today in as a parameter and test with a fixed date."], ["JSON load loses ids", "Save next_id as well as the tasks."]],
      extensions: ["Recurring tasks (daily or weekly).", "Tags and filtering by tag.", "A command to edit a task's text, priority or due date.", "Colour output for overdue tasks and a summary line.", "Sync to an SQLite database."],
      interview: ["How does Python sort by several keys?", "Why store dates as ISO strings, and what is the risk?", "Why not use len(tasks) + 1 for the next id?", "How do you test code that depends on today's date?", "What are the limits of a JSON file as storage?"],
      rubric: rubric("Commands, ordering and the overdue flag work; the sample matches; save and load round-trip", "Single sort key; injectable date; ids never reused; JSON round trip tested"),
      tasks: [
        judged("To-do list: ordering and overdue", "Build the to-do list. Today's date is 2026-11-03. Commands: add TEXT with optional !high, !medium or !low (default medium) and due:YYYY-MM-DD words (prints Added ID: TEXT); done ID (Done ID.); remove ID (Removed ID.); list or list pending. Tasks print as [ ] ID. TEXT (priority, due DATE, overdue) with [x] for done tasks; due and overdue appear only when applicable (overdue only for pending tasks due before today). Order: pending before done, then high, medium, low, then earlier due date (none last), then id. An unknown id prints Error: no task ID.", "# Write your to-do list here\n", taskbook.replace("main(sys.argv)", "main(['taskbook.py', '--today', '2026-11-03'])"), [[stdin, "Added 1: Buy milk\nAdded 2: Finish report\nAdded 3: Call mom\nAdded 4: Water plants\nDone 1.\n[ ] 2. Finish report (high, due 2026-11-01, overdue)\n[ ] 3. Call mom (medium, due 2026-11-10)\n[ ] 4. Water plants (low)\n[x] 1. Buy milk (medium)\nError: no task 9\nRemoved 4.\n[ ] 2. Finish report (high, due 2026-11-01, overdue)\n[ ] 3. Call mom (medium, due 2026-11-10)"], ["add b !low due:2026-11-04\nadd a !low due:2026-11-02\nadd c !low\nlist\n", "Added 1: b\nAdded 2: a\nAdded 3: c\n[ ] 2. a (low, due 2026-11-02, overdue)\n[ ] 1. b (low, due 2026-11-04)\n[ ] 3. c (low)"], ["add x\nadd y !high\ndone 2\nlist pending\ndone 7\n", "Added 1: x\nAdded 2: y\nDone 2.\n[ ] 1. x (medium)\nError: no task 7"], ["add Pay rent due:2026-11-03\nadd bad !urgent\nadd late due:2026-13-01\nlist\n", "Added 1: Pay rent\nError: priority must be high, medium or low\nError: due date must be YYYY-MM-DD\n[ ] 1. Pay rent (medium, due 2026-11-03)"]],
          ["Sort with a key tuple: (done, priority rank, due or a very late date, id).", "Dates in YYYY-MM-DD form compare correctly as strings.", "Keep next_id separate from the list length."]),
        manual("To-do list: JSON storage", "Add save(path) and load(path) and write a test that saves to a temporary folder, loads again and checks that tasks and ids are unchanged.", ["Use tempfile.TemporaryDirectory in the test."]),
        manual("To-do list: publish it", "Create the repository with README, tests and sample output; commit in small steps and push; submit the link.", []),
      ],
    },
  });
}

// ---------------------------------------------------------------- 9 Library Management System
{
  const library = `"""A small library system: books, members, loans, due dates and late fines."""
import sys
from datetime import date, timedelta

LOAN_DAYS = 14
FINE_PER_DAY = 2
MAX_LOANS = 3


class Library:
    def __init__(self):
        self.books = {}
        self.members = {}

    def add_book(self, isbn, copies, title):
        if copies < 1:
            raise ValueError("copies must be at least 1")
        if isbn in self.books:
            raise ValueError(f"book {isbn} already exists")
        self.books[isbn] = {"title": title, "copies": copies}

    def add_member(self, name):
        if name in self.members:
            raise ValueError(f"member {name} already exists")
        self.members[name] = {}

    def available(self, isbn):
        lent = sum(1 for loans in self.members.values() if isbn in loans)
        return self.books[isbn]["copies"] - lent

    def borrow(self, name, isbn, today):
        if name not in self.members:
            raise ValueError(f"unknown member {name}")
        if isbn not in self.books:
            raise ValueError(f"unknown book {isbn}")
        loans = self.members[name]
        if isbn in loans:
            raise ValueError(f"{name} already has this book")
        if len(loans) >= MAX_LOANS:
            raise ValueError(f"{name} has reached the limit of {MAX_LOANS} books")
        title = self.books[isbn]["title"]
        if self.available(isbn) < 1:
            raise ValueError(f"no copies of {title} left")
        loans[isbn] = today + timedelta(days=LOAN_DAYS)
        return title, loans[isbn]

    def return_book(self, name, isbn, today):
        loans = self.members.get(name, {})
        if isbn not in loans:
            raise ValueError(f"{name} does not have this book")
        due = loans.pop(isbn)
        late = max(0, (today - due).days)
        return self.books[isbn]["title"], late, late * FINE_PER_DAY


def main():
    library = Library()
    for line in sys.stdin:
        parts = line.split()
        if not parts:
            continue
        try:
            if parts[0] == "book" and len(parts) >= 4:
                library.add_book(parts[1], int(parts[2]), " ".join(parts[3:]))
                print(f"Added book {' '.join(parts[3:])}.")
            elif parts[0] == "member" and len(parts) == 2:
                library.add_member(parts[1])
                print(f"Added member {parts[1]}.")
            elif parts[0] == "borrow" and len(parts) == 4:
                title, due = library.borrow(parts[1], parts[2], date.fromisoformat(parts[3]))
                print(f"{parts[1]} borrowed {title}, due {due}.")
            elif parts[0] == "return" and len(parts) == 4:
                title, late, fine = library.return_book(parts[1], parts[2], date.fromisoformat(parts[3]))
                suffix = f" Late by {late} day{'s' if late != 1 else ''}, fine {fine}." if late else ""
                print(f"Returned {title}.{suffix}")
            elif parts[0] == "status":
                for isbn in sorted(library.books):
                    book = library.books[isbn]
                    print(f"{book['title']}: {library.available(isbn)} of {book['copies']} available")
            else:
                print("Commands: book ISBN COPIES TITLE | member NAME | borrow NAME ISBN DATE | return NAME ISBN DATE | status")
        except ValueError as error:
            print(f"Error: {error}")


if __name__ == "__main__":
    main()
`;
  const tests = `import unittest
from datetime import date

from library import Library


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.lib = Library()
        self.lib.add_book("111", 2, "Python Basics")
        self.lib.add_book("222", 1, "Data Structures")
        self.lib.add_member("asha")
        self.lib.add_member("ravi")
        self.day = date(2026, 10, 1)

    def test_borrow_sets_due_date_and_reduces_copies(self):
        title, due = self.lib.borrow("asha", "111", self.day)
        self.assertEqual((title, due), ("Python Basics", date(2026, 10, 15)))
        self.assertEqual(self.lib.available("111"), 1)

    def test_no_copies_left(self):
        self.lib.borrow("asha", "222", self.day)
        with self.assertRaises(ValueError):
            self.lib.borrow("ravi", "222", self.day)

    def test_same_book_twice_and_loan_limit(self):
        self.lib.borrow("asha", "111", self.day)
        with self.assertRaises(ValueError):
            self.lib.borrow("asha", "111", self.day)
        for isbn in ("a", "b"):
            self.lib.add_book(isbn, 1, isbn)
            self.lib.borrow("asha", isbn, self.day)
        self.lib.add_book("c", 1, "c")
        with self.assertRaises(ValueError):
            self.lib.borrow("asha", "c", self.day)

    def test_fine_only_after_the_due_date(self):
        self.lib.borrow("asha", "111", self.day)
        self.assertEqual(self.lib.return_book("asha", "111", date(2026, 10, 15))[1:], (0, 0))
        self.lib.borrow("asha", "111", self.day)
        self.assertEqual(self.lib.return_book("asha", "111", date(2026, 10, 18))[1:], (3, 6))

    def test_return_of_a_book_not_borrowed(self):
        with self.assertRaises(ValueError):
            self.lib.return_book("ravi", "111", self.day)

    def test_unknown_member_or_book(self):
        with self.assertRaises(ValueError):
            self.lib.borrow("zoya", "111", self.day)
        with self.assertRaises(ValueError):
            self.lib.borrow("asha", "999", self.day)


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "book 111 2 Python Basics\nbook 222 1 Data Structures\nmember Asha\nmember Ravi\nborrow Asha 111 2026-10-01\nborrow Ravi 111 2026-10-02\nborrow Asha 111 2026-10-03\nborrow Ravi 222 2026-10-03\nborrow Asha 222 2026-10-04\nreturn Asha 111 2026-10-20\nreturn Ravi 222 2026-10-10\nstatus\n";
  lessons.push({
    title: "Mini Project 9: Library Management System",
    minutes: 105,
    project: {
      id: "library-management", kind: "MINI", difficulty: "MEDIUM", minutes: 105, packages: [],
      problem: "Build a library system that keeps books with a number of copies and members with loans, lets members borrow and return books under the library's rules (loan period, loan limit, no double borrowing), and charges a fine for late returns.",
      scenario: "A school library lends books on paper cards. Rules are applied inconsistently, fines are forgotten and nobody knows how many copies are on the shelf. A program that enforces the rules and calculates the fines removes the arguments.",
      objectives: ["Model related entities (books, members, loans) with dictionaries and a class", "Implement business rules and validate before changing data", "Work with dates and timedelta for due dates and fines", "Test rules at their boundaries (due day, loan limit)"],
      prerequisites: ["Classes and dictionaries", "datetime.date and timedelta", "Exceptions", "String formatting"],
      requirements: ["book ISBN COPIES TITLE and member NAME add records (no duplicates)", "borrow NAME ISBN DATE: 14-day loan; refuse unknown members or books, a book the member already has, more than 3 loans, and a book with no copy left", "return NAME ISBN DATE: a late return costs 2 per day after the due date; returning on the due date is free", "status lists every book with copies available, ordered by ISBN", "Business rules live in the Library class; dates are passed in (never read from the clock inside the class)", "Every refusal prints Error: with the reason"],
      architecture: chain("Library architecture", "The command loop calls the Library, which owns the books and the members' loans, applies the rules and returns what the loop prints.",
        [{ k: "io", t: "commands" }, { k: "proc", t: "main()" }, { k: "proc", t: "Library\nrules" }, { k: "proc", t: "books +\nloans (dicts)" }, { k: "io", t: "messages,\nstatus" }], { w: 130, gap: 28, hgt: 62 }),
      flowchart: flow("Borrow flowchart", "A borrow request is checked step by step: member, book, duplicate loan, loan limit and available copies; only then is the loan recorded.", ["borrow request", "member and\nbook exist?", "already has it?", "under the limit?", "copy available?", "record loan\nand due date"], { loop: false }),
      schema: null,
      steps: [["List the rules.", "Write each rule as a sentence: 14 days, 3 books, 2 per day, one copy per person."], ["Choose the data.", "books[isbn] = {title, copies}; members[name] = {isbn: due_date}. Availability is computed, not stored, so it cannot get out of step."], ["Write add_book and add_member.", "Reject duplicates and invalid copies."], ["Write borrow().", "Check in a sensible order and raise ValueError with a clear message; only the last step changes data."], ["Write return_book().", "Pop the loan, compute the days late with max(0, (today - due).days) and the fine."], ["Write main().", "Parse each command, convert dates with date.fromisoformat and print results or errors."], ["Test the boundaries.", "Due day exactly, one day late, the third and fourth loan, last copy lent."]],
      files: { "library.py": library, "test_library.py": tests },
      run: "library.py", test: "test_library.py", stdin, sample: { out: "Added book Python Basics.\nAdded book Data Structures.\nAdded member Asha.\nAdded member Ravi.\nAsha borrowed Python Basics, due 2026-10-15.\nRavi borrowed Python Basics, due 2026-10-16.\nError: Asha already has this book\nRavi borrowed Data Structures, due 2026-10-17.\nError: no copies of Data Structures left\nReturned Python Basics. Late by 5 days, fine 10.\nReturned Data Structures.\nPython Basics: 1 of 2 available\nData Structures: 1 of 1 available\n" },
      explain: [["Library.books / members", "Two dictionaries; each member maps ISBN to a due date, which is all a loan needs."], ["available()", "Copies minus the number of members currently holding the book; derived data is never stored twice."], ["borrow()", "Rules in a fixed order. Nothing changes until every rule has passed."], ["return_book()", "Computes lateness from the stored due date, so the caller cannot cheat the fine."], ["Constants", "LOAN_DAYS, FINE_PER_DAY and MAX_LOANS make the policy easy to change."]],
      testing: ["Run the sample and check each line, especially the dates and the fine.", "Run python -m unittest test_library -v", "Try: return on the due date (free), one day late (fine 2), a fourth loan, an unknown member, the same book twice.", "Check that a refused borrow leaves the loans unchanged."],
      bugs: [["A late return is charged when returned on the due date", "Late days are max(0, (today - due).days); the due day itself is on time."], ["Copies go negative", "Check availability before recording the loan."], ["Availability is wrong after returns", "Compute availability from current loans instead of storing a counter."], ["Dates compare as text", "Use date objects (date.fromisoformat), not strings."], ["Fine uses the real clock", "Pass today in, so tests are repeatable."]],
      extensions: ["Renewals (one renewal per loan, not when someone is waiting).", "A reservation queue for books with no copy left.", "Search books by title or author and list a member's loans.", "Persist everything in SQLite with tables for books, members and loans.", "Maximum fine per book."],
      interview: ["Why compute availability instead of storing it?", "Why pass the date into the methods?", "How would you model this in SQL tables?", "What happens if two librarians borrow the last copy at the same moment?", "How do you decide the order in which the rules are checked?"],
      rubric: rubric("Borrowing, returning, limits and fines follow the rules; the sample matches", "Derived data not duplicated; dates injected; nothing changes when a rule fails"),
      tasks: [
        judged("Library: lending rules", "Build the library. Commands: book ISBN COPIES TITLE... (prints Added book TITLE.), member NAME (Added member NAME.), borrow NAME ISBN DATE (prints NAME borrowed TITLE, due DUE. with a 14-day loan), return NAME ISBN DATE (prints Returned TITLE. and, when late, Late by N day(s), fine F. at 2 per day after the due date) and status (TITLE: A of C available for each book ordered by ISBN). Refusals print Error: already has this book, no copies of TITLE left, has reached the limit of 3 books, unknown member NAME, unknown book ISBN or NAME does not have this book (each with the name as shown).", "# Write your library here\n", library, [[stdin, "Added book Python Basics.\nAdded book Data Structures.\nAdded member Asha.\nAdded member Ravi.\nAsha borrowed Python Basics, due 2026-10-15.\nRavi borrowed Python Basics, due 2026-10-16.\nError: Asha already has this book\nRavi borrowed Data Structures, due 2026-10-17.\nError: no copies of Data Structures left\nReturned Python Basics. Late by 5 days, fine 10.\nReturned Data Structures.\nPython Basics: 1 of 2 available\nData Structures: 1 of 1 available"], ["book 1 1 A\nmember x\nborrow x 1 2026-01-01\nreturn x 1 2026-01-15\nreturn x 1 2026-01-16\n", "Added book A.\nAdded member x.\nx borrowed A, due 2026-01-15.\nReturned A.\nError: x does not have this book"], ["book 1 1 A\nmember x\nborrow x 1 2026-01-01\nreturn x 1 2026-01-16\n", "Added book A.\nAdded member x.\nx borrowed A, due 2026-01-15.\nReturned A. Late by 1 day, fine 2."], ["book a 1 A\nbook b 1 B\nbook c 1 C\nbook d 1 D\nmember m\nborrow m a 2026-05-01\nborrow m b 2026-05-01\nborrow m c 2026-05-01\nborrow m d 2026-05-01\nborrow z a 2026-05-01\nborrow m q 2026-05-01\n", "Added book A.\nAdded book B.\nAdded book C.\nAdded book D.\nAdded member m.\nm borrowed A, due 2026-05-15.\nm borrowed B, due 2026-05-15.\nm borrowed C, due 2026-05-15.\nError: m has reached the limit of 3 books\nError: unknown member z\nError: unknown book q"]],
          ["Keep each member's loans as {isbn: due_date}.", "Availability = copies - number of members who hold the book.", "Late days: max(0, (return_date - due_date).days).", "Validate every rule before you change anything."]),
        manual("Library: unit tests", "Test the due day (free), one day late, the loan limit, double borrowing, the last copy and returning a book that was not borrowed.", []),
        manual("Library: publish it", "Create the repository with README and tests; commit in small steps and push; submit the link.", []),
      ],
    },
  });
}

// ---------------------------------------------------------------- 10 Quiz Application
{
  const quiz = `"""A multiple-choice quiz application."""
import sys

QUESTIONS = [
    {"text": 'What does len("abc") return?', "choices": ["2", "3", "4", "0"], "answer": 1},
    {"text": "Which of these types is immutable?", "choices": ["list", "dict", "tuple", "set"], "answer": 2},
    {"text": "What does 7 // 2 give?", "choices": ["3.5", "4", "3", "2"], "answer": 2},
]
LETTERS = "ABCD"


def ask(question, number, answers, out=print):
    """Show a question and return the index of the chosen option (None when the answers run out)."""
    out(f"Q{number}. {question['text']}")
    for letter, choice in zip(LETTERS, question["choices"]):
        out(f"  {letter}) {choice}")
    for raw in answers:
        letter = raw.strip().upper()
        if len(letter) == 1 and letter in LETTERS[: len(question["choices"])]:
            return LETTERS.index(letter)
        out("Please answer A, B, C or D.")
    return None


def run_quiz(questions, answers, out=print):
    answers = iter(answers)
    score = 0
    for number, question in enumerate(questions, 1):
        choice = ask(question, number, answers, out)
        if choice is None:
            out("No answer given.")
        elif choice == question["answer"]:
            out("Correct!")
            score += 1
        else:
            out(f"Wrong. The answer is {LETTERS[question['answer']]}.")
    return score


def verdict(score, total):
    percent = round(100 * score / total)
    message = "Excellent!" if percent >= 80 else "Good effort." if percent >= 50 else "Keep practising."
    return f"Score: {score} of {total} ({percent}%) - {message}"


def main():
    answers = (line for line in sys.stdin)
    score = run_quiz(QUESTIONS, answers)
    print(verdict(score, len(QUESTIONS)))


if __name__ == "__main__":
    main()
`;
  const tests = `import unittest

from quiz import QUESTIONS, ask, run_quiz, verdict


class QuizTests(unittest.TestCase):
    def play(self, answers):
        lines = []
        score = run_quiz(QUESTIONS, answers, out=lines.append)
        return score, lines

    def test_all_correct(self):
        score, lines = self.play(["b", "c", "c"])
        self.assertEqual(score, 3)
        self.assertEqual(lines.count("Correct!"), 3)

    def test_wrong_answer_names_the_right_one(self):
        score, lines = self.play(["a", "c", "c"])
        self.assertEqual(score, 2)
        self.assertIn("Wrong. The answer is B.", lines)

    def test_invalid_answers_are_asked_again(self):
        score, lines = self.play(["x", "7", "b", "c", "c"])
        self.assertEqual(score, 3)
        self.assertEqual(lines.count("Please answer A, B, C or D."), 2)

    def test_missing_answers_count_as_wrong(self):
        score, lines = self.play(["b"])
        self.assertEqual(score, 1)
        self.assertEqual(lines.count("No answer given."), 2)

    def test_ask_returns_the_index_and_ignores_case_and_spaces(self):
        self.assertEqual(ask(QUESTIONS[0], 1, iter([" d \\n"]), out=lambda s: None), 3)

    def test_verdict_bands(self):
        self.assertTrue(verdict(4, 5).endswith("Excellent!"))
        self.assertTrue(verdict(1, 2).endswith("Good effort."))
        self.assertTrue(verdict(0, 3).endswith("Keep practising."))


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "b\nA\nx\nc\n";
  lessons.push({
    title: "Mini Project 10: Quiz Application",
    minutes: 75,
    project: {
      id: "quiz-application", kind: "MINI", difficulty: "EASY", minutes: 75, packages: [],
      problem: "Build a multiple-choice quiz that shows each question with options A to D, reads the player's answers, gives feedback after every question and prints the final score with a short verdict.",
      scenario: "A teacher wants a quick quiz for revision. Questions live in a data structure so they can be changed without touching the logic, and answers may be mistyped, so invalid choices must be asked again instead of marked wrong.",
      objectives: ["Keep data (questions) separate from logic (the quiz engine)", "Loop over data structures and use enumerate and zip", "Validate and re-ask on bad input", "Make interactive code testable with injected answers and output"],
      prerequisites: ["Lists and dictionaries", "Functions and iterators", "String methods (strip, upper)", "Percentages and rounding"],
      requirements: ["Questions are a list of dictionaries (text, choices, answer index)", "Show each question with lettered options", "Accept A to D in any case; ask again after an invalid answer without counting it", "Say Correct! or Wrong. The answer is X.", "If the answers run out, mark the remaining questions as not answered", "Print Score: S of N (P%) with a verdict: Excellent! from 80%, Good effort. from 50%, otherwise Keep practising."],
      architecture: chain("Quiz architecture", "Questions are data; ask() shows one question and reads a valid answer from an iterator; run_quiz() loops over the questions and scores them; verdict() turns the score into a message.",
        [{ k: "io", t: "QUESTIONS\n(data)" }, { k: "proc", t: "run_quiz()\nscore" }, { k: "proc", t: "ask()\nvalidate answer" }, { k: "proc", t: "verdict()" }, { k: "io", t: "feedback +\nfinal score" }], { w: 135, gap: 28, hgt: 62 }),
      flowchart: flow("Quiz flowchart", "For each question show it, read answers until one is valid (or the input ends), check it, give feedback; after the last question print the score.", ["start", "show question", "valid answer?", "check answer", "more questions?", "print score"], { loop: true }),
      schema: null,
      steps: [["Design the data.", "{\"text\", \"choices\", \"answer\"} where answer is the index of the right choice."], ["Write ask().", "Print the question and the lettered options, then read from an iterator of answers until one is a valid letter."], ["Make it injectable.", "ask() takes the answers and an output function; the real program passes standard input and print."], ["Write run_quiz().", "Share one answers iterator across questions so unused answers carry over; count correct answers."], ["Handle the end of input.", "ask() returns None when the answers run out; mark those questions as not answered."], ["Write verdict().", "percent = round(100 * score / total) and three bands."], ["Test.", "All correct, wrong answers, invalid input, missing answers and the verdict bands."]],
      files: { "quiz.py": quiz, "test_quiz.py": tests },
      run: "quiz.py", test: "test_quiz.py", stdin, sample: { out: "Q1. What does len(\"abc\") return?\n  A) 2\n  B) 3\n  C) 4\n  D) 0\nCorrect!\nQ2. Which of these types is immutable?\n  A) list\n  B) dict\n  C) tuple\n  D) set\nWrong. The answer is C.\nQ3. What does 7 // 2 give?\n  A) 3.5\n  B) 4\n  C) 3\n  D) 2\nPlease answer A, B, C or D.\nCorrect!\nScore: 2 of 3 (67%) - Good effort.\n" },
      explain: [["QUESTIONS", "Plain data. Adding a question needs no new code."], ["ask", "Shows one question and loops over the shared answers until it gets a valid letter. Returns the index or None."], ["run_quiz", "Counts correct answers; prints feedback through the out function."], ["verdict", "Percentage and message in one place."], ["main", "Connects real standard input and print."]],
      testing: ["Run the sample and then play by hand with python quiz.py.", "Run python -m unittest test_quiz -v", "Try: lower case answers, answers with spaces, E, 1, an empty line, and ending the input early.", "Change a question's answer index and check that the feedback follows."],
      bugs: [["The same answer is used for every question", "Create one iterator and share it; do not restart the list for each question."], ["Invalid answers count as wrong", "Loop until valid; count the answer only after validation."], ["Lowercase b is rejected", "Convert with .strip().upper() before checking."], ["Percentage shows 66.66666", "Round the percentage for display."], ["ZeroDivisionError for an empty quiz", "Guard against zero questions."]],
      extensions: ["Load questions from a JSON file.", "Shuffle questions and options with a seed for repeatable tests.", "Add a timer per question.", "Keep a leaderboard of the best scores.", "Support multiple-answer and true/false questions."],
      interview: ["Why is the question list data rather than code?", "Why share one iterator across questions?", "How did you make input and output testable?", "How would you add a time limit?", "How would you prevent the answer being visible to the player in a web version?"],
      rubric: rubric("Questions, feedback, re-asking and the final verdict follow the specification; the sample matches", "Data separated from logic; injectable input and output; correct handling of missing answers"),
      tasks: [
        judged("Quiz: score a round", "Build the quiz engine. The three questions are fixed: (1) What does len(\"abc\") return? A) 2 B) 3 C) 4 D) 0 (answer B); (2) Which of these types is immutable? A) list B) dict C) tuple D) set (answer C); (3) What does 7 // 2 give? A) 3.5 B) 4 C) 3 D) 2 (answer C). For each question print Q<n>. <text>, then the four options as two spaces, the letter, a parenthesis, a space and the option, then read answers from standard input (one per line, any case, spaces ignored) until one is a valid letter A to D; each invalid line prints Please answer A, B, C or D. Print Correct! or Wrong. The answer is X.; if the input ends before a valid answer print No answer given. After the last question print Score: S of 3 (P%) - V with P rounded and V Excellent! from 80%, Good effort. from 50%, otherwise Keep practising.", "# Write your quiz here\n", quiz, [[stdin, "Q1. What does len(\"abc\") return?\n  A) 2\n  B) 3\n  C) 4\n  D) 0\nCorrect!\nQ2. Which of these types is immutable?\n  A) list\n  B) dict\n  C) tuple\n  D) set\nWrong. The answer is C.\nQ3. What does 7 // 2 give?\n  A) 3.5\n  B) 4\n  C) 3\n  D) 2\nPlease answer A, B, C or D.\nCorrect!\nScore: 2 of 3 (67%) - Good effort."], ["b\nc\nc\n", "Q1. What does len(\"abc\") return?\n  A) 2\n  B) 3\n  C) 4\n  D) 0\nCorrect!\nQ2. Which of these types is immutable?\n  A) list\n  B) dict\n  C) tuple\n  D) set\nCorrect!\nQ3. What does 7 // 2 give?\n  A) 3.5\n  B) 4\n  C) 3\n  D) 2\nCorrect!\nScore: 3 of 3 (100%) - Excellent!"], ["a\n", "Q1. What does len(\"abc\") return?\n  A) 2\n  B) 3\n  C) 4\n  D) 0\nWrong. The answer is B.\nQ2. Which of these types is immutable?\n  A) list\n  B) dict\n  C) tuple\n  D) set\nNo answer given.\nQ3. What does 7 // 2 give?\n  A) 3.5\n  B) 4\n  C) 3\n  D) 2\nNo answer given.\nScore: 0 of 3 (0%) - Keep practising."], [" B \n e\nD\nC\nz\nC\n", "Q1. What does len(\"abc\") return?\n  A) 2\n  B) 3\n  C) 4\n  D) 0\nCorrect!\nQ2. Which of these types is immutable?\n  A) list\n  B) dict\n  C) tuple\n  D) set\nPlease answer A, B, C or D.\nWrong. The answer is C.\nQ3. What does 7 // 2 give?\n  A) 3.5\n  B) 4\n  C) 3\n  D) 2\nCorrect!\nScore: 2 of 3 (67%) - Good effort."]],
          ["Keep the questions in a list of dictionaries.", "Use one iterator over the input lines for all questions.", "zip(\"ABCD\", choices) prints the lettered options.", "round(100 * score / total) for the percentage."]),
        manual("Quiz: unit tests", "Test a full correct round, a wrong answer, invalid input being asked again, missing answers and the three verdict bands, using injected answers and an output list.", []),
        manual("Quiz: publish it", "Create the repository with README, tests and a sample game; commit in small steps and push; submit the link.", []),
      ],
    },
  });
}

module.exports = { lessons };
