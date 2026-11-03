// Phase 6, mini projects 11-15: File Management Automation, Weather API Application, CSV Data Analyzer,
// Web Scraping Demonstration (permitted public data), Personal Portfolio CLI Application.
// Network projects are tested against a local server, so they run offline and never touch a real website.
"use strict";
const { chain, flow } = require("./render");
const { task, rubric } = require("./lib");

const judged = (title, statement, starter, solution, cases, hints) => ({ ...task(title, statement, starter, solution, cases), hints });
const manual = (title, instructions, hints) => ({ title, instructions, hints });
// JSON with non-ASCII characters written as \uXXXX escapes, so the test input is plain ASCII on every platform
const ascii = (o) => JSON.stringify(o).replace(/[^\x00-\x7f]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const lessons = [];

// ---------------------------------------------------------------- 11 File Management Automation
{
  const organizer = `"""Sort the files of a folder into sub-folders by type, with a dry-run plan first."""
import shutil
import sys
import tempfile
from pathlib import Path

CATEGORIES = {
    "images": {".jpg", ".jpeg", ".png", ".gif"},
    "documents": {".pdf", ".doc", ".docx", ".txt"},
    "spreadsheets": {".csv", ".xlsx"},
    "code": {".py", ".js", ".html"},
    "archives": {".zip", ".tar"},
}


def category_for(filename):
    suffix = Path(filename).suffix.lower()
    for category, suffixes in CATEGORIES.items():
        if suffix in suffixes:
            return category
    return "other"


def plan_moves(filenames):
    """Return [(filename, folder)] for every visible file, sorted by folder and name."""
    visible = [name for name in filenames if not name.startswith(".")]
    return sorted(((name, category_for(name)) for name in visible), key=lambda m: (m[1], m[0].lower()))


def free_name(folder, name):
    target = folder / name
    counter = 1
    while target.exists():
        target = folder / f"{Path(name).stem}_{counter}{Path(name).suffix}"
        counter += 1
    return target


def apply_plan(base, plan, dry_run=False):
    """Move the files; never overwrite an existing file. Return the number of files moved."""
    moved = 0
    for name, category in plan:
        if dry_run:
            continue
        folder = Path(base) / category
        folder.mkdir(exist_ok=True)
        shutil.move(str(Path(base) / name), str(free_name(folder, name)))
        moved += 1
    return moved


def tree(base):
    for folder in sorted(p for p in Path(base).iterdir() if p.is_dir()):
        print(f"{folder.name}: {', '.join(sorted(f.name for f in folder.iterdir()))}")


def demo():
    names = ["holiday.JPG", "resume.pdf", "notes.txt", "budget.xlsx", "script.py", "archive.zip", "README", "photo.png", ".hidden"]
    with tempfile.TemporaryDirectory() as folder:
        for name in names:
            (Path(folder) / name).touch()
        files = [p.name for p in Path(folder).iterdir() if p.is_file()]
        plan = plan_moves(files)
        print("Planned moves:")
        for name, category in plan:
            print(f"  {name} -> {category}/")
        print(f"Skipped hidden files: {len(files) - len(plan)}")
        print(f"Moved {apply_plan(folder, plan)} files.")
        tree(folder)


if __name__ == "__main__":
    demo()
`;
  const tests = `import tempfile
import unittest
from pathlib import Path

from organizer import apply_plan, category_for, free_name, plan_moves


class OrganizerTests(unittest.TestCase):
    def test_category_ignores_case_and_defaults_to_other(self):
        self.assertEqual([category_for(n) for n in ("a.PNG", "b.Txt", "c.py", "d", "e.unknown")], ["images", "documents", "code", "other", "other"])

    def test_plan_skips_hidden_files_and_is_sorted(self):
        plan = plan_moves([".env", "b.png", "A.png", "x.csv"])
        self.assertEqual(plan, [("A.png", "images"), ("b.png", "images"), ("x.csv", "spreadsheets")])

    def test_apply_moves_files_into_folders(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "a.txt").write_text("hello")
            self.assertEqual(apply_plan(folder, plan_moves(["a.txt"])), 1)
            self.assertEqual((Path(folder) / "documents" / "a.txt").read_text(), "hello")
            self.assertFalse((Path(folder) / "a.txt").exists())

    def test_dry_run_changes_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "a.txt").touch()
            self.assertEqual(apply_plan(folder, plan_moves(["a.txt"]), dry_run=True), 0)
            self.assertTrue((Path(folder) / "a.txt").exists())

    def test_existing_files_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "documents").mkdir()
            (Path(folder) / "documents" / "a.txt").write_text("old")
            (Path(folder) / "a.txt").write_text("new")
            apply_plan(folder, plan_moves(["a.txt"]))
            self.assertEqual((Path(folder) / "documents" / "a.txt").read_text(), "old")
            self.assertEqual((Path(folder) / "documents" / "a_1.txt").read_text(), "new")

    def test_free_name_counts_up(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            (base / "a.txt").touch()
            (base / "a_1.txt").touch()
            self.assertEqual(free_name(base, "a.txt").name, "a_2.txt")


if __name__ == "__main__":
    unittest.main()
`;
  lessons.push({
    title: "Mini Project 11: File Management Automation",
    minutes: 90,
    project: {
      id: "file-organizer", kind: "MINI", difficulty: "MEDIUM", minutes: 90, packages: [],
      problem: "Write a program that sorts the files of a messy folder (like Downloads) into sub-folders by type: images, documents, spreadsheets, code, archives and other. It must show a plan first, skip hidden files and never overwrite an existing file.",
      scenario: "A student's Downloads folder holds hundreds of files. Sorting them by hand is boring and error-prone, and a careless script could overwrite or lose files. A tool that plans first, moves safely and never overwrites is automation you can trust.",
      objectives: ["Use pathlib and shutil to work with files and folders", "Separate planning (pure function) from doing (side effects)", "Protect data: dry run, no overwriting, skipping hidden files", "Test file operations in temporary folders"],
      prerequisites: ["Dictionaries and sets", "Sorting with keys", "pathlib basics", "Exceptions and context managers"],
      requirements: ["Classify a file by its extension, ignoring case; unknown extensions go to other", "plan_moves(filenames) returns the sorted plan and skips hidden files (names starting with a dot)", "apply_plan moves the files into sub-folders, creating them as needed", "A dry run changes nothing", "An existing file is never overwritten: use a numbered name such as report_1.txt", "The demo prints the plan, the number of moved files and the resulting folders"],
      architecture: chain("File organizer architecture", "A folder listing is turned into a plan by a pure function; the plan can be printed or applied; applying it moves files with shutil into category folders without overwriting.",
        [{ k: "io", t: "folder\nlisting" }, { k: "proc", t: "plan_moves()\npure" }, { k: "proc", t: "category_for()\nextension map" }, { k: "proc", t: "apply_plan()\nshutil.move" }, { k: "io", t: "sorted\nfolders" }], { w: 135, gap: 28, hgt: 62 }),
      flowchart: flow("File organizer flowchart", "List the files, skip hidden ones, decide a category for each, show the plan, and move each file to a free name in its category folder.", ["start", "list the files", "hidden file?", "choose a category", "dry run?", "move to a free name"], { loop: false }),
      schema: null,
      steps: [["Map extensions to categories.", "A dictionary of sets: category -> extensions. Look up Path(name).suffix.lower()."], ["Plan before acting.", "plan_moves() is a pure function from names to (name, category) pairs. It is easy to test and to print."], ["Skip hidden files.", "Names starting with a dot are configuration, not clutter."], ["Never overwrite.", "free_name() tries name, name_1, name_2 ... until the target does not exist."], ["Move safely.", "Create the category folder with mkdir(exist_ok=True) and use shutil.move."], ["Add a dry run.", "With dry_run=True the plan is returned without touching the disk."], ["Demonstrate in a temporary folder.", "tempfile.TemporaryDirectory creates and deletes a sandbox so the demo and the tests are safe."], ["Test.", "Categories, the plan, moving, the dry run and the collision rule."]],
      files: { "organizer.py": organizer, "test_organizer.py": tests },
      run: "organizer.py", test: "test_organizer.py", stdin: "", sample: { out: "Planned moves:\n  archive.zip -> archives/\n  script.py -> code/\n  notes.txt -> documents/\n  resume.pdf -> documents/\n  holiday.JPG -> images/\n  photo.png -> images/\n  README -> other/\n  budget.xlsx -> spreadsheets/\nSkipped hidden files: 1\nMoved 8 files.\narchives: archive.zip\ncode: script.py\ndocuments: notes.txt, resume.pdf\nimages: holiday.JPG, photo.png\nother: README\nspreadsheets: budget.xlsx\n" },
      explain: [["CATEGORIES", "Data, not code: adding a file type means adding an extension to a set."], ["plan_moves", "Pure and deterministic: the same names always give the same plan, sorted by folder and name."], ["free_name", "Protects existing files by choosing a free numbered name."], ["apply_plan", "The only function that changes the disk; dry_run makes it safe to preview."], ["demo", "Builds a temporary sandbox so you can run the program without touching your real files."]],
      testing: ["Run python organizer.py and compare with the sample.", "Run python -m unittest test_organizer -v", "Run it on a copy of a real folder first, never on the only copy of your files.", "Try: upper-case extensions, files without extensions, two files with the same name in different runs, an empty folder."],
      bugs: [["Photos with .JPG are not sorted", "Lower-case the suffix before looking it up."], ["A file was overwritten", "Check that the target exists and pick a free name."], ["PermissionError or WinError 32", "The file is open in another program; skip it and report it."], ["FileExistsError creating a folder", "Use mkdir(exist_ok=True)."], ["Folders are listed as files", "Filter with is_file() before planning."]],
      extensions: ["Take the folder from the command line and add a --dry-run flag.", "Sort by modification month into folders such as 2026-11.", "Write an undo log so the move can be reversed.", "Detect duplicate files by hashing their content.", "Run automatically with a scheduler (cron or Task Scheduler)."],
      interview: ["Why plan first and act second?", "How do you avoid destroying files in an automation script?", "What is the difference between os.path and pathlib?", "How would you undo the moves?", "How do you test code that changes the file system?"],
      rubric: rubric("Files are classified, planned and moved correctly; the demo output matches", "Dry run; no overwriting; hidden files skipped; tests use temporary folders"),
      tasks: [
        judged("File organizer: plan the moves", "Write the planning step. Read file names, one per line, until the end of the input. Hidden names (starting with a dot) are skipped. Each other name goes to a folder by its extension, ignoring case: images (.jpg .jpeg .png .gif), documents (.pdf .doc .docx .txt), spreadsheets (.csv .xlsx), code (.py .js .html), archives (.zip .tar) or other. Print NAME -> FOLDER/ for each file ordered by folder name and then by file name ignoring case, then Skipped hidden files: N.", "# Write the planner here\n", `import sys
from pathlib import Path

CATEGORIES = {"images": {".jpg", ".jpeg", ".png", ".gif"}, "documents": {".pdf", ".doc", ".docx", ".txt"}, "spreadsheets": {".csv", ".xlsx"}, "code": {".py", ".js", ".html"}, "archives": {".zip", ".tar"}}


def category_for(name):
    suffix = Path(name).suffix.lower()
    return next((c for c, s in CATEGORIES.items() if suffix in s), "other")


names = [line.strip() for line in sys.stdin if line.strip()]
visible = [n for n in names if not n.startswith(".")]
for name, category in sorted(((n, category_for(n)) for n in visible), key=lambda m: (m[1], m[0].lower())):
    print(f"{name} -> {category}/")
print(f"Skipped hidden files: {len(names) - len(visible)}")`, [["holiday.JPG\nresume.pdf\nnotes.txt\nbudget.xlsx\nscript.py\narchive.zip\nREADME\nphoto.png\n.hidden\n", "archive.zip -> archives/\nscript.py -> code/\nnotes.txt -> documents/\nresume.pdf -> documents/\nholiday.JPG -> images/\nphoto.png -> images/\nREADME -> other/\nbudget.xlsx -> spreadsheets/\nSkipped hidden files: 1"], [".a\n.b\n", "Skipped hidden files: 2"], ["b.png\nA.png\nc.GIF\n", "A.png -> images/\nb.png -> images/\nc.GIF -> images/\nSkipped hidden files: 0"], ["archive.tar.gz\nnotes\ndata.CSV\n", "archive.tar.gz -> other/\nnotes -> other/\ndata.CSV -> spreadsheets/\nSkipped hidden files: 0"]],
          ["Path(name).suffix.lower() gives the extension.", "Sort with key=(folder, name.lower()).", "Count hidden names separately."]),
        manual("File organizer: the safe mover", "Write apply_plan(base, plan, dry_run) that creates folders, moves files with shutil.move, never overwrites (use numbered names) and returns the number of files moved. Test it in a temporary folder, including a collision.", ["tempfile.TemporaryDirectory is deleted automatically.", "Path.exists() tells whether a target is free."]),
        manual("File organizer: publish it", "Create the repository with README, tests and a warning to try the tool on a copy first; commit in small steps and push; submit the link.", []),
      ],
    },
  });
}

// ---------------------------------------------------------------- 12 Weather API Application
{
  const weather = `"""Show the current weather for a place using the free Open-Meteo forecast API (no key needed)."""
import json
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_URL = "https://api.open-meteo.com/v1/forecast"


class WeatherError(Exception):
    pass


def build_url(base, latitude, longitude):
    query = urllib.parse.urlencode({"latitude": latitude, "longitude": longitude, "current": "temperature_2m,wind_speed_10m"})
    return f"{base}?{query}"


def parse_current(data):
    try:
        current, units = data["current"], data["current_units"]
        return {
            "time": current["time"],
            "temperature": current["temperature_2m"],
            "wind": current["wind_speed_10m"],
            "temperature_unit": units["temperature_2m"].replace("\\u00b0", ""),
            "wind_unit": units["wind_speed_10m"],
        }
    except (KeyError, TypeError, AttributeError):
        raise WeatherError("the weather service sent an unexpected answer") from None


def get_weather(base, latitude, longitude, timeout=5):
    if not -90 <= latitude <= 90:
        raise WeatherError("latitude must be between -90 and 90")
    if not -180 <= longitude <= 180:
        raise WeatherError("longitude must be between -180 and 180")
    try:
        with urllib.request.urlopen(build_url(base, latitude, longitude), timeout=timeout) as response:
            return parse_current(json.load(response))
    except urllib.error.HTTPError as error:
        raise WeatherError(f"the weather service returned an error (HTTP {error.code})") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise WeatherError("could not reach the weather service") from None
    except json.JSONDecodeError:
        raise WeatherError("the weather service sent an unreadable answer") from None


def describe(place, w):
    return f"{place}: {w['temperature']} {w['temperature_unit']}, wind {w['wind']} {w['wind_unit']} ({w['time']})"


class FakeService(BaseHTTPRequestHandler):
    """A local stand-in for the API so that the demo and the tests work offline."""

    def do_GET(self):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if query.get("latitude") == ["1.0"]:
            self.send_response(503)
            self.end_headers()
            return
        body = json.dumps({
            "current_units": {"temperature_2m": "\\u00b0C", "wind_speed_10m": "km/h"},
            "current": {"time": "2026-11-03T10:00", "temperature_2m": 24.5, "wind_speed_10m": 7.2},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def start_fake_service():
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeService)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}/v1/forecast"


def show(base, place, latitude, longitude):
    try:
        print(describe(place, get_weather(base, latitude, longitude)))
    except WeatherError as error:
        print(f"Error: {error}.")


def main(argv):
    if len(argv) == 2 and argv[1] == "--demo":
        server, base = start_fake_service()
        show(base, "Pune", 18.52, 73.86)
        show(base, "Nowhere", 91, 0)
        show(base, "Broken", 1.0, 1.0)
        show("http://127.0.0.1:1/v1/forecast", "Offline", 10, 10)
        server.shutdown()
    elif len(argv) == 4:
        show(BASE_URL, f"({argv[1]}, {argv[2]})", float(argv[1]), float(argv[2]))
    else:
        print("Usage: python weather.py LATITUDE LONGITUDE   (or --demo)")


if __name__ == "__main__":
    main(sys.argv)
`;
  const tests = `import unittest

import weather
from weather import WeatherError, build_url, get_weather, parse_current


class WeatherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server, cls.base = weather.start_fake_service()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_build_url_encodes_the_query(self):
        url = build_url("http://x/v1", 18.5, -73.8)
        self.assertIn("latitude=18.5", url)
        self.assertIn("longitude=-73.8", url)
        self.assertIn("current=temperature_2m%2Cwind_speed_10m", url)

    def test_parse_current(self):
        data = {"current_units": {"temperature_2m": "\\u00b0C", "wind_speed_10m": "km/h"}, "current": {"time": "t", "temperature_2m": 1.5, "wind_speed_10m": 2}}
        self.assertEqual(parse_current(data)["temperature_unit"], "C")
        self.assertEqual(parse_current(data)["wind"], 2)

    def test_parse_rejects_unexpected_shapes(self):
        for bad in ({}, {"current": {}}, [], None):
            with self.assertRaises(WeatherError):
                parse_current(bad)

    def test_successful_request(self):
        result = get_weather(self.base, 18.52, 73.86)
        self.assertEqual((result["temperature"], result["wind"]), (24.5, 7.2))

    def test_http_error_is_reported(self):
        with self.assertRaises(WeatherError) as ctx:
            get_weather(self.base, 1.0, 1.0)
        self.assertIn("HTTP 503", str(ctx.exception))

    def test_invalid_coordinates_never_reach_the_network(self):
        for lat, lon in ((91, 0), (-91, 0), (0, 181)):
            with self.assertRaises(WeatherError):
                get_weather("http://127.0.0.1:1/x", lat, lon)

    def test_unreachable_service(self):
        with self.assertRaises(WeatherError) as ctx:
            get_weather("http://127.0.0.1:1/v1/forecast", 10, 10, timeout=1)
        self.assertIn("could not reach", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
`;
  lessons.push({
    title: "Mini Project 12: Weather API Application",
    minutes: 105,
    project: {
      id: "weather-app", kind: "MINI", difficulty: "MEDIUM", minutes: 105, packages: [],
      problem: "Write a command-line application that asks a public weather API for the current temperature and wind at a latitude and longitude and prints a one-line summary. It must handle a service that is down, slow, returns an error or sends an unexpected answer.",
      scenario: "Apps depend on other services, and services fail. A good API client validates its input, sets a timeout, turns every kind of failure into a clear message and is tested without calling the real service.",
      objectives: ["Call an HTTP API with the standard library (urllib) and read JSON", "Build a query string safely with urlencode", "Handle HTTP errors, network errors, timeouts and bad JSON", "Test network code against a local fake server instead of the internet"],
      prerequisites: ["JSON and dictionaries", "Exceptions and custom exception classes", "HTTP basics (Module 17)", "Threads (to run the fake server)"],
      requirements: ["Call the Open-Meteo forecast endpoint with latitude, longitude and the current variables temperature_2m and wind_speed_10m", "Print Place: TEMP UNIT, wind SPEED UNIT (TIME)", "Reject latitudes outside -90..90 and longitudes outside -180..180 before making any request", "Use a timeout; map HTTP errors, unreachable service and bad JSON to short Error: messages", "Include --demo, which starts a local fake service so the program works offline", "Never crash with a traceback on a network failure"],
      architecture: chain("Weather app architecture", "The command line gives coordinates; get_weather validates them, builds the URL, calls the service with a timeout and parses the JSON; show prints a summary or an error. In the tests a local fake service replaces the real API.",
        [{ k: "io", t: "latitude,\nlongitude" }, { k: "proc", t: "get_weather()\nvalidate + request" }, { k: "io", t: "weather API\n(or fake server)" }, { k: "proc", t: "parse_current()" }, { k: "io", t: "summary or\nError:" }], { w: 140, gap: 28, hgt: 62 }),
      flowchart: flow("Weather request flowchart", "Validate the coordinates, send the request with a timeout, then handle each kind of failure separately before parsing and printing.", ["start", "coordinates valid?", "send request\nwith timeout", "HTTP or network\nerror?", "parse the JSON", "print summary\nor Error:"], { loop: false }),
      schema: null,
      steps: [["Read the API documentation.", "The forecast endpoint takes latitude, longitude and a list of current variables, and returns current and current_units objects. Check the live documentation before relying on any field name."], ["Build the URL safely.", "urllib.parse.urlencode escapes values; never concatenate query strings by hand."], ["Write parse_current().", "Pull out only the fields you need and raise one clear error if the shape is unexpected."], ["Write get_weather().", "Validate the numbers first, then urlopen with a timeout, then json.load; translate HTTPError, URLError, TimeoutError and JSONDecodeError into WeatherError."], ["Build a fake service.", "A tiny http.server handler in a thread returns canned JSON (and an HTTP 503 for one special latitude) so you can test without the internet."], ["Write show() and main().", "show prints a line or Error: message; --demo runs the four scenarios."], ["Test everything.", "URL building, parsing, success, HTTP error, invalid coordinates and unreachable service."]],
      files: { "weather.py": weather, "test_weather.py": tests },
      run: "weather.py", args: "--demo", test: "test_weather.py", stdin: "", sample: { out: "Pune: 24.5 C, wind 7.2 km/h (2026-11-03T10:00)\nError: latitude must be between -90 and 90.\nError: the weather service returned an error (HTTP 503).\nError: could not reach the weather service.\n" },
      explain: [["build_url", "Uses urlencode so special characters are escaped correctly."], ["parse_current", "The only place that knows the shape of the response; everything else uses a simple dictionary."], ["get_weather", "Validation first, then the request, then one except clause per failure type, so the user sees a short message and not a traceback."], ["FakeService", "A local stand-in for the API (also used by the tests). It makes the project work offline and deterministic."], ["--demo", "Runs success, bad input, an HTTP error and an unreachable service."]],
      testing: ["Run python weather.py --demo and compare with the sample.", "Run python -m unittest test_weather -v", "With internet access you can try python weather.py 18.52 73.86 (the real API; the answer will differ).", "Turn the network off and run the real command: you should see Error: could not reach the weather service."],
      bugs: [["The program hangs for a long time", "You did not set a timeout; pass timeout= to urlopen."], ["Traceback with HTTPError", "Catch urllib.error.HTTPError (it is a subclass of URLError, so catch it first)."], ["KeyError: 'current'", "The response shape differs from what you expected; check the API documentation and handle it."], ["Wrong location", "Latitude comes before longitude."], ["Tests need the internet", "Use a local fake server so tests are fast and repeatable."]],
      extensions: ["Look up the coordinates of a city name with the geocoding API.", "Show an hourly forecast table.", "Cache results for ten minutes.", "Add retries with exponential backoff.", "Switch to the requests library and compare the code."],
      interview: ["Why set a timeout on every network call?", "Why is HTTPError caught before URLError?", "How do you test code that calls an external API?", "Why validate the coordinates before making the request?", "What would you do if the API changed its response format?"],
      rubric: rubric("Valid requests print the summary; every failure gives a clear Error:; the demo matches the sample", "Timeout; one exception type per failure; fake server tests; no real network in tests"),
      tasks: [
        judged("Weather: format the report", "Write the display part of the weather application. Read the place name on the first line and then a JSON document in the Open-Meteo style (an object with current_units and current). Print PLACE: T U, wind W V (TIME), where T and W are the temperature_2m and wind_speed_10m values, U is the temperature unit with the degree sign removed, V is the wind unit and TIME is the time. If the document does not have the expected shape print Error: the weather service sent an unexpected answer.", "# Write the formatter here\n", `import json
import sys

place = sys.stdin.readline().strip()
try:
    data = json.loads(sys.stdin.read())
    current, units = data["current"], data["current_units"]
    unit = units["temperature_2m"].replace("\\u00b0", "")
    print(f"{place}: {current['temperature_2m']} {unit}, wind {current['wind_speed_10m']} {units['wind_speed_10m']} ({current['time']})")
except (KeyError, TypeError, AttributeError, json.JSONDecodeError):
    print("Error: the weather service sent an unexpected answer")`, [["Pune\n" + ascii({ current_units: { temperature_2m: "°C", wind_speed_10m: "km/h" }, current: { time: "2026-11-03T10:00", temperature_2m: 24.5, wind_speed_10m: 7.2 } }) + "\n", "Pune: 24.5 C, wind 7.2 km/h (2026-11-03T10:00)"], ["Oslo\n" + ascii({ current_units: { temperature_2m: "°F", wind_speed_10m: "mph" }, current: { time: "t", temperature_2m: -3, wind_speed_10m: 12 } }) + "\n", "Oslo: -3 F, wind 12 mph (t)"], ["X\n{}\n", "Error: the weather service sent an unexpected answer"], ["X\nnot json\n", "Error: the weather service sent an unexpected answer"]],
          ["json.loads parses the text; the units hold the degree sign.", "str.replace removes the degree sign.", "Catch KeyError, TypeError and JSONDecodeError together."]),
        manual("Weather: test against a local server", "Write a fake service with http.server in a thread and test success, an HTTP 503, invalid coordinates and an unreachable port. Your tests must not use the internet.", ["ThreadingHTTPServer((\"127.0.0.1\", 0), Handler) picks a free port.", "Call server.shutdown() in tearDownClass."]),
        manual("Weather: publish it", "Create the repository with README (explain that the real API needs internet and link its documentation), tests and sample output; commit in small steps and push; submit the link.", []),
      ],
    },
  });
}

// ---------------------------------------------------------------- 13 CSV Data Analyzer
{
  const analyzer = `"""Summarise a CSV file: numbers get statistics, text columns get counts."""
import csv
import io
import sys
from collections import Counter
from statistics import mean, median


def to_number(text):
    try:
        return float(text)
    except ValueError:
        return None


def analyze(text):
    """Return (row_count, [summary lines]) for CSV text with a header row."""
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise ValueError("the file has no data rows")
    lines = []
    for column in rows[0].keys():
        values = [row[column].strip() for row in rows if row[column] is not None and row[column].strip()]
        missing = len(rows) - len(values)
        numbers = [to_number(v) for v in values]
        if values and all(n is not None for n in numbers):
            lines.append(
                f"{column}: count {len(numbers)}, missing {missing}, min {min(numbers):g}, max {max(numbers):g}, "
                f"mean {mean(numbers):.2f}, median {median(numbers):g}"
            )
        else:
            top, count = Counter(values).most_common(1)[0] if values else ("-", 0)
            lines.append(f"{column}: text, {len(set(values))} unique, most common: {top} ({count})")
    return len(rows), lines


def main():
    try:
        count, lines = analyze(sys.stdin.read())
    except ValueError as error:
        print(f"Error: {error}")
        return
    print(f"Rows: {count}, columns: {len(lines)}")
    print("\\n".join(lines))


if __name__ == "__main__":
    main()
`;
  const tests = `import unittest

from analyzer import analyze, to_number

SAMPLE = "name,dept,marks,attendance\\nAsha,CSE,82,91\\nRavi,ECE,67,\\nZoya,CSE,91,96\\nKabir,ME,55,60\\nMeera,ECE,74,85\\n"


class AnalyzerTests(unittest.TestCase):
    def test_numeric_summary(self):
        count, lines = analyze(SAMPLE)
        self.assertEqual(count, 5)
        self.assertEqual(lines[2], "marks: count 5, missing 0, min 55, max 91, mean 73.80, median 74")

    def test_missing_values_are_counted_and_skipped(self):
        _, lines = analyze(SAMPLE)
        self.assertEqual(lines[3], "attendance: count 4, missing 1, min 60, max 96, mean 83.00, median 88")

    def test_text_column(self):
        _, lines = analyze(SAMPLE)
        self.assertEqual(lines[1], "dept: text, 3 unique, most common: CSE (2)")

    def test_mixed_column_is_text(self):
        _, lines = analyze("x\\n1\\nabc\\n")
        self.assertTrue(lines[0].startswith("x: text"))

    def test_empty_file_and_all_missing_column(self):
        with self.assertRaises(ValueError):
            analyze("a,b\\n")
        _, lines = analyze("a,b\\n1,\\n2,\\n")
        self.assertEqual(lines[1], "b: text, 0 unique, most common: - (0)")

    def test_to_number(self):
        self.assertEqual((to_number("3.5"), to_number("x")), (3.5, None))


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "name,dept,marks,attendance\nAsha,CSE,82,91\nRavi,ECE,67,\nZoya,CSE,91,96\nKabir,ME,55,60\nMeera,ECE,74,85\n";
  lessons.push({
    title: "Mini Project 13: CSV Data Analyzer",
    minutes: 90,
    project: {
      id: "csv-analyzer", kind: "MINI", difficulty: "MEDIUM", minutes: 90, packages: [],
      problem: "Build a tool that reads CSV data and prints a summary of every column: for number columns the count, missing values, minimum, maximum, mean and median; for text columns the number of unique values and the most common one.",
      scenario: "Before analysing a dataset you must understand it: how many rows, what is missing, what do the columns look like. A quick summary tool shows problems early, such as a column that was meant to be numeric but contains text.",
      objectives: ["Read CSV with the csv module (DictReader) and handle missing values", "Detect numeric versus text columns", "Compute statistics with the statistics module and format them", "Test with small inline CSV strings"],
      prerequisites: ["Lists, dictionaries and comprehensions", "csv and statistics modules", "Counter", "Exceptions"],
      requirements: ["Read CSV text with a header row from standard input", "A column is numeric when every non-empty value is a number", "For numeric columns print count, missing, min, max, mean (2 decimals) and median", "For text columns print the number of unique values and the most common value with its count", "Count empty cells as missing", "Report an Error: for a file without data rows"],
      architecture: chain("CSV analyzer architecture", "CSV text is parsed into rows; each column is classified as numeric or text; a summary line is built with statistics or a Counter; main prints the row count and the lines.",
        [{ k: "io", t: "CSV text\n(stdin)" }, { k: "proc", t: "csv.DictReader" }, { k: "proc", t: "classify\ncolumn" }, { k: "proc", t: "statistics /\nCounter" }, { k: "io", t: "summary\nlines" }], { w: 130, gap: 28, hgt: 62 }),
      flowchart: flow("CSV analyzer flowchart", "Parse the rows, then for each column collect the non-empty values, decide whether all are numbers, and build the right summary line.", ["start", "parse the rows", "any rows?", "next column", "all numbers?", "numeric or text\nsummary"], { loop: true }),
      schema: null,
      steps: [["Parse with DictReader.", "Each row becomes a dictionary keyed by the header names. Use io.StringIO to read from a string."], ["Collect values per column.", "Strip each cell and drop empty ones; missing = rows - values."], ["Detect numbers.", "to_number() returns a float or None; a column is numeric if no value gives None."], ["Summarise numbers.", "min, max, statistics.mean and statistics.median; format with :g to drop .0 and :.2f for the mean."], ["Summarise text.", "Counter(values).most_common(1) gives the top value; len(set(values)) the unique count."], ["Guard the edges.", "No data rows is an error; a column with no values is reported as text with 0 unique."], ["Test.", "Numbers, missing values, text, mixed columns, empty file and all-missing column."]],
      files: { "analyzer.py": analyzer, "test_analyzer.py": tests },
      run: "analyzer.py", test: "test_analyzer.py", stdin, sample: { out: "Rows: 5, columns: 4\nname: text, 5 unique, most common: Asha (1)\ndept: text, 3 unique, most common: CSE (2)\nmarks: count 5, missing 0, min 55, max 91, mean 73.80, median 74\nattendance: count 4, missing 1, min 60, max 96, mean 83.00, median 88\n" },
      explain: [["analyze", "Pure function from CSV text to a summary; no files or printing, so it is easy to test."], ["to_number", "Turns a cell into a float or None; the single place that defines 'numeric'."], ["missing", "rows minus non-empty cells, so blanks and spaces count as missing."], ["format codes", ":g prints 55 instead of 55.0; :.2f fixes the mean to two decimals."], ["main", "Reads standard input, so you can run python analyzer.py < data.csv."]],
      testing: ["Run python analyzer.py < data.csv with the sample data.", "Run python -m unittest test_analyzer -v", "Try: a quoted value with a comma, a column with one text cell among numbers, only a header, and a blank column.", "Compare the numbers with a spreadsheet."],
      bugs: [["A numeric column is reported as text", "One bad cell (for example n/a) makes it text; decide whether to skip such cells or clean the data."], ["Mean is wrong when cells are blank", "Remove empty cells before converting; do not treat them as 0."], ["Median of an even number of values is not a middle value", "That is correct: it is the average of the two middle values."], ["UnicodeDecodeError for a file", "Open files with encoding=\"utf-8\" or utf-8-sig for spreadsheets exported from Excel."], ["Columns shifted", "Rows with extra commas inside text need quoting; the csv module handles quoted fields."]],
      extensions: ["Read a file path from the command line instead of standard input.", "Detect dates and report the earliest and latest.", "Group a numeric column by a text column (mean marks per department).", "Print a text histogram for a numeric column.", "Rewrite the analysis with pandas and compare."],
      interview: ["How do you decide whether a column is numeric?", "What is the difference between mean and median, and when does it matter?", "How do you handle missing values, and what are the risks of filling them?", "Why return data from analyze() instead of printing?", "How would you analyse a file too big for memory?"],
      rubric: rubric("Every column is classified and summarised correctly; missing values counted; the sample matches", "Pure analyze(); correct statistics formatting; edge cases (empty file, all-missing column)"),
      tasks: [
        judged("CSV analyzer: summarise the columns", "Read CSV text (a header row and data rows) from standard input. Print Rows: N, columns: C, and then one line per column in file order. A column whose non-empty values are all numbers prints NAME: count K, missing M, min A, max B, mean X.XX, median D, where the min, max and median use the shortest form (55 not 55.0; use the g format) and missing counts empty cells. Any other column prints NAME: text, U unique, most common: VALUE (COUNT), where the first value in the file wins ties. If there are no data rows print Error: the file has no data rows.", "# Write your analyzer here\n", analyzer, [[stdin, "Rows: 5, columns: 4\nname: text, 5 unique, most common: Asha (1)\ndept: text, 3 unique, most common: CSE (2)\nmarks: count 5, missing 0, min 55, max 91, mean 73.80, median 74\nattendance: count 4, missing 1, min 60, max 96, mean 83.00, median 88"], ["a,b\n", "Error: the file has no data rows"], ["x,y\n1,a\n2.5,b\n,a\n", "Rows: 3, columns: 2\nx: count 2, missing 1, min 1, max 2.5, mean 1.75, median 1.75\ny: text, 2 unique, most common: a (2)"], ["v\n1\nabc\n3\n", "Rows: 3, columns: 1\nv: text, 3 unique, most common: 1 (1)"]],
          ["csv.DictReader(io.StringIO(text)) gives dictionaries per row.", "A value is numeric if float(value) succeeds.", "statistics.mean and statistics.median.", "Counter.most_common(1) keeps the first value on ties."]),
        manual("CSV analyzer: unit tests", "Test the numeric summary, missing values, text columns, a mixed column, an empty file and an all-missing column using small inline CSV strings.", []),
        manual("CSV analyzer: publish it", "Create the repository with README, a small sample CSV file, tests and sample output; commit in small steps and push; submit the link.", []),
      ],
    },
  });
}

// ---------------------------------------------------------------- 14 Web Scraping Demonstration
{
  const scraper = `"""A polite scraping demonstration: respect robots.txt, identify yourself, extract headlines, links and a table."""
import sys
import time
import urllib.parse
import urllib.request
import urllib.robotparser
from html.parser import HTMLParser

USER_AGENT = "CodeArenaCourseBot/1.0 (learning exercise)"
BASE = "https://example.org"

DEMO_ROBOTS = "User-agent: *\\nDisallow: /private/\\n"
DEMO_HTML = """<html><body>
<h1>Campus News</h1>
<article><h2>Placement drive begins</h2><p>Details: <a href="/news/placement">read more</a></p></article>
<article><h2>Library open late</h2><a href="/news/library">read more</a></article>
<table><tr><th>Company type</th><th>Offers</th></tr><tr><td>Product</td><td>12</td></tr><tr><td>Service</td><td>40</td></tr></table>
<a href="/private/admin">admin</a>
</body></html>"""


class PageParser(HTMLParser):
    """Collect <h2> headlines, <a> links and table rows from an HTML page."""

    def __init__(self):
        super().__init__()
        self.headlines, self.links, self.rows = [], [], []
        self._tag = self._href = self._row = None
        self._text = []

    def handle_starttag(self, tag, attrs):
        if tag in ("h2", "a", "td", "th"):
            self._tag, self._text = tag, []
        if tag == "a":
            self._href = dict(attrs).get("href")
        if tag == "tr":
            self._row = []

    def handle_data(self, data):
        if self._tag:
            self._text.append(data)

    def handle_endtag(self, tag):
        text = " ".join("".join(self._text).split())
        if tag == "h2" and text:
            self.headlines.append(text)
        elif tag == "a" and self._href:
            self.links.append((text, self._href))
        elif tag in ("td", "th") and self._row is not None:
            self._row.append(text)
        elif tag == "tr" and self._row:
            self.rows.append(self._row)
            self._row = None
        if tag in ("h2", "a", "td", "th"):
            self._tag = None


def allowed(robots_text, url):
    rules = urllib.robotparser.RobotFileParser()
    rules.parse(robots_text.splitlines())
    return rules.can_fetch(USER_AGENT, url)


def fetch(url, delay=1.0):
    """Fetch a page only if robots.txt allows it; wait before the request and identify the bot."""
    parts = urllib.parse.urlparse(url)
    robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
    request = urllib.request.Request(robots_url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=5) as response:
        robots = response.read().decode("utf-8", "replace")
    if not allowed(robots, url):
        raise PermissionError(f"robots.txt does not allow {parts.path}")
    time.sleep(delay)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=5) as response:
        return response.read().decode("utf-8", "replace")


def demo():
    for path in ("/news/placement", "/private/admin"):
        print(f"robots.txt allows {path}: {'yes' if allowed(DEMO_ROBOTS, BASE + path) else 'no'}")
    parser = PageParser()
    parser.feed(DEMO_HTML)
    print("Headlines:")
    for headline in parser.headlines:
        print(f"  - {headline}")
    print("Links to follow (allowed by robots.txt):")
    for text, href in parser.links:
        if allowed(DEMO_ROBOTS, urllib.parse.urljoin(BASE, href)):
            print(f"  - {text} -> {href}")
    print("Table:")
    for row in parser.rows:
        print("  " + " | ".join(row))


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1].startswith("http"):
        parser = PageParser()
        parser.feed(fetch(sys.argv[1]))
        print("\\n".join(parser.headlines))
    else:
        demo()
`;
  const tests = `import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import scraper
from scraper import PageParser, allowed, fetch

SEEN = []


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        SEEN.append((self.path, self.headers.get("User-Agent")))
        body = b"User-agent: *\\nDisallow: /private/\\n" if self.path == "/robots.txt" else b"<h2>Local headline</h2>"
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class ScraperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_parser_extracts_headlines_links_and_rows(self):
        parser = PageParser()
        parser.feed(scraper.DEMO_HTML)
        self.assertEqual(parser.headlines, ["Placement drive begins", "Library open late"])
        self.assertIn(("read more", "/news/library"), parser.links)
        self.assertEqual(parser.rows[1], ["Product", "12"])

    def test_robots_rules(self):
        self.assertTrue(allowed(scraper.DEMO_ROBOTS, "https://example.org/news/a"))
        self.assertFalse(allowed(scraper.DEMO_ROBOTS, "https://example.org/private/x"))

    def test_fetch_checks_robots_first_and_sends_a_user_agent(self):
        SEEN.clear()
        self.assertEqual(fetch(self.base + "/news", delay=0), "<h2>Local headline</h2>")
        self.assertEqual([path for path, _ in SEEN], ["/robots.txt", "/news"])
        self.assertTrue(all(agent == scraper.USER_AGENT for _, agent in SEEN))

    def test_fetch_refuses_disallowed_paths_without_requesting_them(self):
        SEEN.clear()
        with self.assertRaises(PermissionError):
            fetch(self.base + "/private/secret", delay=0)
        self.assertEqual([path for path, _ in SEEN], ["/robots.txt"])


if __name__ == "__main__":
    unittest.main()
`;
  lessons.push({
    title: "Mini Project 14: Web Scraping Demonstration (permitted public data)",
    minutes: 105,
    project: {
      id: "web-scraping-demo", kind: "MINI", difficulty: "MEDIUM", minutes: 105, packages: [],
      problem: "Build a small, polite web scraper that checks robots.txt before fetching a page, identifies itself with a User-Agent, waits between requests, and extracts the headlines, links and a table from the HTML. The demonstration runs on a local sample page, and the tests run against a local server, so no real website is ever contacted.",
      scenario: "Data sometimes exists only on web pages. Scraping can be legitimate (public data that the site allows you to collect) but it can also overload servers or break a site's rules. A responsible scraper reads the site's rules first, is gentle, and collects only data it is allowed to use.",
      objectives: ["Parse HTML with the standard library's html.parser", "Respect robots.txt with urllib.robotparser", "Identify the program honestly and limit the request rate", "Understand the legal and ethical limits of scraping", "Test network code against a local server"],
      prerequisites: ["HTTP basics (Module 17)", "Classes and inheritance (HTMLParser is a class you extend)", "Strings and lists", "Threads (for the local test server)"],
      requirements: ["PageParser collects <h2> headlines, <a> links and table rows", "allowed(robots_text, url) tells whether robots.txt allows a URL for this bot", "fetch(url) reads robots.txt first, refuses disallowed paths without requesting them, waits before the request and sends a User-Agent", "The demo prints the robots decisions, headlines, allowed links and the table", "Only scrape data that is public, that the site's terms and robots.txt allow, and that contains no personal information"],
      architecture: chain("Scraper architecture", "fetch reads robots.txt, asks allowed(), waits, requests the page with a User-Agent and returns the HTML; PageParser turns the HTML into headlines, links and rows; the demo prints them.",
        [{ k: "io", t: "URL" }, { k: "proc", t: "fetch()\nrobots + delay" }, { k: "proc", t: "allowed()\nRobotFileParser" }, { k: "proc", t: "PageParser\nhtml.parser" }, { k: "io", t: "headlines,\nlinks, table" }], { w: 135, gap: 28, hgt: 62 }),
      flowchart: flow("Polite scraping flowchart", "Read robots.txt, stop if the path is disallowed, wait, fetch the page with an honest User-Agent, parse it and print what you collected.", ["start", "read robots.txt", "path allowed?", "wait, then fetch\nwith User-Agent", "parse the HTML", "print results"], { loop: false }),
      schema: null,
      steps: [["Read the rules first.", "Before writing code, read the site's terms of use and robots.txt. If scraping is not allowed, stop and use an official API or ask for permission."], ["Choose permitted data.", "Public, non-personal data that the site allows to be collected. This demo uses a page we wrote ourselves."], ["Extend HTMLParser.", "handle_starttag, handle_data and handle_endtag collect text inside h2, a, td and th elements and group cells into rows."], ["Check robots.txt.", "RobotFileParser.parse() takes the lines of robots.txt; can_fetch(user_agent, url) answers yes or no."], ["Write fetch().", "Request /robots.txt with your User-Agent, refuse disallowed paths, sleep, then request the page."], ["Be gentle.", "One request at a time, a delay between requests, a clear User-Agent, and cache results instead of asking again."], ["Test with a local server.", "A thread running http.server serves robots.txt and a page; the test checks the order of requests and the User-Agent."]],
      files: { "scraper.py": scraper, "test_scraper.py": tests },
      run: "scraper.py", test: "test_scraper.py", stdin: "", sample: { out: "robots.txt allows /news/placement: yes\nrobots.txt allows /private/admin: no\nHeadlines:\n  - Placement drive begins\n  - Library open late\nLinks to follow (allowed by robots.txt):\n  - read more -> /news/placement\n  - read more -> /news/library\nTable:\n  Company type | Offers\n  Product | 12\n  Service | 40\n" },
      explain: [["PageParser", "A state machine over HTML events: it remembers which tag it is inside and gathers the text; at the end tag it stores the cleaned text."], ["allowed", "Wraps RobotFileParser so the decision is a simple yes or no."], ["fetch", "The polite sequence: robots.txt, decision, delay, request with User-Agent."], ["USER_AGENT", "Names the program and says it is a learning exercise, so a site owner can recognise and contact you."], ["DEMO_HTML / DEMO_ROBOTS", "Local sample data so that the demo is repeatable and contacts nobody."]],
      testing: ["Run python scraper.py and compare with the sample.", "Run python -m unittest test_scraper -v", "Check in the test that robots.txt is requested before the page and that a disallowed path is never requested.", "Never point this tool at a site whose terms forbid scraping."],
      bugs: [["Headlines contain extra spaces or line breaks", "Join the text pieces and normalise whitespace with ' '.join(text.split())."], ["Links without an href are listed", "Check that the attribute exists before storing the link."], ["A table row is missing", "Close the row only if it has cells; reset the row after storing it."], ["Garbled characters", "Decode the response bytes as UTF-8 (with errors=\"replace\")."], ["The scraper is blocked", "You may be sending requests too fast or without a User-Agent; slow down, or stop if you are not welcome."]],
      extensions: ["Follow only the allowed links (depth 1) with a delay and a cap on pages.", "Store the extracted rows in CSV or SQLite.", "Respect Crawl-delay from robots.txt if present.", "Use a tested library such as BeautifulSoup and compare the code.", "Look for an official API instead of scraping."],
      interview: ["Is web scraping legal? What should you check first?", "What is robots.txt and is it enforced?", "How do you avoid overloading a server?", "Why identify your bot with a User-Agent?", "When is an API better than scraping?"],
      rubric: rubric("The parser extracts headlines, links and table rows; robots.txt is respected; the demo matches the sample", "Ethics: robots check before fetching, delay, honest User-Agent, no real site in tests"),
      tasks: [
        judged("Scraper: extract the headlines and links", "Read an HTML page from standard input. Print every <h2> headline's text, one per line, prefixed with Headline: , and then every link as Link: TEXT -> HREF in the order they appear. Collapse whitespace inside the text (spaces, tabs and line breaks become single spaces). Use the html.parser module from the standard library.", "# Write your parser here\n", `import sys
from html.parser import HTMLParser


class Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.out = []
        self.tag = self.href = None
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag in ("h2", "a"):
            self.tag, self.text = tag, []
            self.href = dict(attrs).get("href") if tag == "a" else None

    def handle_data(self, data):
        if self.tag:
            self.text.append(data)

    def handle_endtag(self, tag):
        text = " ".join("".join(self.text).split())
        if tag == "h2" and text:
            self.out.append(f"Headline: {text}")
        elif tag == "a" and self.href:
            self.out.append(f"Link: {text} -> {self.href}")
        if tag in ("h2", "a"):
            self.tag = None


parser = Parser()
parser.feed(sys.stdin.read())
print("\\n".join(parser.out))`, [["<html><body><h2>Placement drive begins</h2><a href=\"/news/placement\">read more</a><h2>Library\n   open late</h2></body></html>\n", "Headline: Placement drive begins\nLink: read more -> /news/placement\nHeadline: Library open late"], ["<a href=\"https://a.example/x\">First</a> text <a>no link</a><a href=\"/b\">  Second\n item </a>", "Link: First -> https://a.example/x\nLink: Second item -> /b"], ["<h2></h2><h2>Only</h2>", "Headline: Only"], ["<p>nothing here</p><h2> A   B </h2>", "Headline: A B"]],
          ["Subclass HTMLParser and override handle_starttag, handle_data and handle_endtag.", "Remember which tag you are inside and collect the text pieces.", "Normalise whitespace with ' '.join(text.split()).", "Print in document order, so collect lines in one list."]),
        manual("Scraper: check robots.txt", "Write allowed(robots_text, url) with urllib.robotparser and fetch(url) that reads robots.txt first, refuses disallowed paths without requesting them, waits and sends a User-Agent. Test it against a local server that records the requests it receives.", ["RobotFileParser().parse(text.splitlines()) loads rules without a network call.", "The test server can append each request path to a list."]),
        manual("Scraper: write the ethics note", "In your README write a short section: what data you collect, why it is permitted, which rules you checked (terms of use, robots.txt), how you limit the request rate, and why the data contains no personal information. Publish the repository and submit the link.", ["If you cannot answer 'is this permitted?', do not scrape."]),
      ],
    },
  });
}

// ---------------------------------------------------------------- 15 Personal Portfolio CLI Application
{
  const portfolio = `"""A command-line portfolio: your profile, skills and projects, shown as text or exported as Markdown."""
import sys


class Portfolio:
    def __init__(self):
        self.name = ""
        self.headline = ""
        self.skills = []
        self.projects = []

    def add_skill(self, skill):
        if skill.lower() in (s.lower() for s in self.skills):
            raise ValueError("Skill already listed.")
        self.skills.append(skill)

    def remove_skill(self, skill):
        matches = [s for s in self.skills if s.lower() == skill.lower()]
        if not matches:
            raise ValueError(f"No such skill: {skill}")
        self.skills.remove(matches[0])

    def add_project(self, text):
        parts = [p.strip() for p in text.split("|")]
        if len(parts) not in (3, 4) or not all(parts[:3]):
            raise ValueError("a project needs: title | description | link | tags (tags are optional)")
        title, description, link = parts[:3]
        if not link.startswith("https://"):
            raise ValueError("the link must start with https://")
        tags = [t.strip() for t in parts[3].split(",") if t.strip()] if len(parts) == 4 else []
        self.projects.append({"title": title, "description": description, "link": link, "tags": tags})
        return title

    def sorted_skills(self):
        return sorted(self.skills, key=str.lower)

    def show(self):
        lines = [self.name.upper() or "(no name)", self.headline or "(no headline)", "Skills: " + (", ".join(self.sorted_skills()) or "none"), "Projects:"]
        for number, p in enumerate(self.projects, 1):
            tags = f" [{', '.join(p['tags'])}]" if p["tags"] else ""
            lines.append(f"  {number}. {p['title']} - {p['description']} ({p['link']}){tags}")
        return lines

    def markdown(self):
        lines = [f"# {self.name}", "", f"*{self.headline}*", "", "## Skills"] + [f"- {s}" for s in self.sorted_skills()] + ["", "## Projects"]
        for p in self.projects:
            tags = f" | tags: {', '.join(p['tags'])}" if p["tags"] else ""
            lines += [f"### {p['title']}", p["description"], f"[Link]({p['link']}){tags}", ""]
        return lines


def main():
    book = Portfolio()
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        command, _, rest = line.partition(" ")
        try:
            if command == "name" and rest:
                book.name = rest
                print("Name set.")
            elif command == "headline" and rest:
                book.headline = rest
                print("Headline set.")
            elif command == "skill" and rest:
                book.add_skill(rest)
                print(f"Added skill {rest}.")
            elif command == "unskill" and rest:
                book.remove_skill(rest)
                print(f"Removed skill {rest}.")
            elif command == "project" and rest:
                print(f"Added project {book.add_project(rest)}.")
            elif command == "show":
                print("\\n".join(book.show()))
            elif command == "export":
                print("\\n".join(book.markdown()))
            else:
                print("Commands: name | headline | skill | unskill | project TITLE | DESCRIPTION | LINK | TAGS | show | export")
        except ValueError as error:
            print(f"Error: {error}")


if __name__ == "__main__":
    main()
`;
  const tests = `import unittest

from portfolio import Portfolio


class PortfolioTests(unittest.TestCase):
    def setUp(self):
        self.p = Portfolio()
        self.p.name, self.p.headline = "Asha Rao", "Python developer"

    def test_skills_are_unique_ignoring_case_and_sorted_for_display(self):
        for skill in ("python", "SQL", "git"):
            self.p.add_skill(skill)
        with self.assertRaises(ValueError):
            self.p.add_skill("PYTHON")
        self.assertEqual(self.p.sorted_skills(), ["git", "python", "SQL"])

    def test_remove_skill_ignores_case(self):
        self.p.add_skill("SQL")
        self.p.remove_skill("sql")
        self.assertEqual(self.p.skills, [])
        with self.assertRaises(ValueError):
            self.p.remove_skill("sql")

    def test_project_parsing_and_validation(self):
        self.assertEqual(self.p.add_project("Calc | Safe evaluator | https://x.io/c | python, ast"), "Calc")
        self.assertEqual(self.p.projects[0]["tags"], ["python", "ast"])
        for bad in ("only title", "A | B | http://insecure", "A |  | https://x.io", "A | B | https://x.io | t | extra"):
            with self.assertRaises(ValueError):
                self.p.add_project(bad)

    def test_show_and_markdown(self):
        self.p.add_skill("python")
        self.p.add_project("Calc | Safe evaluator | https://x.io/c")
        self.assertEqual(self.p.show()[0], "ASHA RAO")
        self.assertIn("  1. Calc - Safe evaluator (https://x.io/c)", self.p.show())
        self.assertIn("[Link](https://x.io/c)", self.p.markdown())

    def test_empty_portfolio_has_placeholders(self):
        self.assertEqual(Portfolio().show()[:3], ["(no name)", "(no headline)", "Skills: none"])


if __name__ == "__main__":
    unittest.main()
`;
  const stdin = "name Asha Rao\nheadline Python developer\nskill python\nskill SQL\nskill git\nskill python\nunskill sql\nproject Calculator | A safe expression evaluator | https://github.com/asha/calculator | python, ast\nproject Notes | Terminal notes | http://insecure.example\nshow\nexport\n";
  lessons.push({
    title: "Mini Project 15: Personal Portfolio CLI Application",
    minutes: 90,
    project: {
      id: "portfolio-cli", kind: "MINI", difficulty: "EASY", minutes: 90, packages: [],
      problem: "Build a command-line application in which you enter your name, headline, skills and projects, and which shows the portfolio as text and exports it as Markdown that you can paste into your GitHub profile README.",
      scenario: "Recruiters look at a short, honest portfolio: who you are, what you can do and links to real work. Building the tool that produces your portfolio is itself a portfolio piece, and the Markdown it exports is something you will actually use.",
      objectives: ["Design a small class API (add, remove, show, export)", "Parse a simple text format (title | description | link | tags)", "Validate input and give helpful error messages", "Generate Markdown from data"],
      prerequisites: ["Classes and methods", "Lists and dictionaries", "String methods (split, strip, partition)", "Sorting with key=str.lower"],
      requirements: ["name TEXT and headline TEXT set the profile", "skill TEXT adds a skill (no duplicates ignoring case); unskill TEXT removes one", "project TITLE | DESCRIPTION | LINK | TAGS adds a project; the link must start with https:// and tags are optional", "show prints the profile with skills sorted ignoring case and numbered projects", "export prints the portfolio as Markdown", "Invalid input prints Error: with a helpful message"],
      architecture: chain("Portfolio architecture", "The command loop sends each line to the Portfolio object, which stores the profile, skills and projects and renders them either as plain text (show) or as Markdown (export).",
        [{ k: "io", t: "commands" }, { k: "proc", t: "main()\nparse" }, { k: "proc", t: "Portfolio\nprofile + lists" }, { k: "proc", t: "show() /\nmarkdown()" }, { k: "io", t: "text or\nMarkdown" }], { w: 130, gap: 28, hgt: 62 }),
      flowchart: flow("Portfolio flowchart", "Split each line into a command and its text, update the portfolio (validating first) or render it, and report errors.", ["start", "read a line", "command known?", "validate and\nupdate", "error?", "print result\nor Error:"], { loop: true }),
      schema: null,
      steps: [["Plan the data.", "name, headline, a list of skills and a list of project dictionaries (title, description, link, tags)."], ["Write the skill methods.", "Compare in lower case so Python and python are the same skill; keep the text as typed."], ["Parse the project line.", "Split on |, strip each part, require three or four parts, validate the link, split the tags on commas."], ["Render text.", "show() returns lines, so it can be tested and reused."], ["Render Markdown.", "Headings, a list of skills and a section per project with a link."], ["Write main().", "line.partition(' ') separates the command from the rest of the line; catch ValueError and print it."], ["Test.", "Duplicates, removal, project validation, both renderers and the empty portfolio."]],
      files: { "portfolio.py": portfolio, "test_portfolio.py": tests },
      run: "portfolio.py", test: "test_portfolio.py", stdin, sample: { out: "Name set.\nHeadline set.\nAdded skill python.\nAdded skill SQL.\nAdded skill git.\nError: Skill already listed.\nRemoved skill sql.\nAdded project Calculator.\nError: the link must start with https://\nASHA RAO\nPython developer\nSkills: git, python\nProjects:\n  1. Calculator - A safe expression evaluator (https://github.com/asha/calculator) [python, ast]\n# Asha Rao\n\n*Python developer*\n\n## Skills\n- git\n- python\n\n## Projects\n### Calculator\nA safe expression evaluator\n[Link](https://github.com/asha/calculator) | tags: python, ast\n\n" },
      explain: [["add_skill / remove_skill", "Case-insensitive comparison, case-preserving storage."], ["add_project", "Parses and validates one line of text and returns the title for the confirmation message."], ["show", "Plain text for the terminal; returns a list of lines."], ["markdown", "The same data as a Markdown document ready for a README."], ["main", "Uses str.partition to split command from argument without breaking multi-word values."]],
      testing: ["Run the sample and check every line, including the blank lines of the Markdown.", "Run python -m unittest test_portfolio -v", "Try: a project without a link, with http://, with extra fields, a skill that exists in a different case, show on an empty portfolio.", "Paste the export into a Markdown preview and check how it looks."],
      bugs: [["Duplicate skills in different case", "Compare lower-cased text."], ["Link check passes for http://", "Check startswith(\"https://\")."], ["Tags are one string", "Split on commas and strip each tag."], ["Names with several words are cut", "Use partition(\" \") and keep the rest of the line."], ["Export has no blank lines", "Add empty strings to the list of lines where Markdown needs them."]],
      extensions: ["Save and load the portfolio as JSON.", "Add an education and experience section.", "Generate a simple HTML page as well as Markdown.", "Add a command that checks that each project link responds (using a timeout).", "Use your real portfolio as the project README on GitHub."],
      interview: ["How did you design the Portfolio class API?", "Why return lists of lines instead of printing?", "How do you compare strings ignoring case but keep the original?", "How would you store the portfolio permanently?", "What makes a good portfolio project description?"],
      rubric: rubric("Profile, skills and projects are managed correctly; show and export match the sample", "Case-insensitive uniqueness; link validation; renderers return lines; Markdown is correct"),
      tasks: [
        judged("Portfolio: build the Markdown", "Read the commands name TEXT, headline TEXT, skill TEXT (duplicates ignoring case print Error: Skill already listed.), and finally export. For every accepted skill print Added skill TEXT. For name and headline print Name set. and Headline set. The export prints a Markdown document: a line # NAME, a blank line, *HEADLINE*, a blank line, ## Skills, one - SKILL line per skill sorted ignoring case, and a blank line. There are no projects in this milestone.", "# Write your portfolio here\n", `import sys

name = headline = ""
skills = []
for raw in sys.stdin:
    command, _, rest = raw.strip().partition(" ")
    if command == "name" and rest:
        name = rest
        print("Name set.")
    elif command == "headline" and rest:
        headline = rest
        print("Headline set.")
    elif command == "skill" and rest:
        if rest.lower() in (s.lower() for s in skills):
            print("Error: Skill already listed.")
        else:
            skills.append(rest)
            print(f"Added skill {rest}.")
    elif command == "export":
        print("\\n".join([f"# {name}", "", f"*{headline}*", "", "## Skills"] + [f"- {s}" for s in sorted(skills, key=str.lower)] + [""]))`, [["name Asha Rao\nheadline Python developer\nskill python\nskill SQL\nskill git\nskill python\nexport\n", "Name set.\nHeadline set.\nAdded skill python.\nAdded skill SQL.\nAdded skill git.\nError: Skill already listed.\n# Asha Rao\n\n*Python developer*\n\n## Skills\n- git\n- python\n- SQL\n"], ["name Z\nheadline h\nexport\n", "Name set.\nHeadline set.\n# Z\n\n*h*\n\n## Skills\n"], ["skill A\nskill a\nskill B\nexport\n", "Added skill A.\nError: Skill already listed.\nAdded skill B.\n# \n\n**\n\n## Skills\n- A\n- B\n"], ["skill Zed\nskill alpha\nexport\n", "Added skill Zed.\nAdded skill alpha.\n# \n\n**\n\n## Skills\n- alpha\n- Zed\n"]],
          ["Use line.partition(\" \") to split the command from the rest.", "Keep skills in a list and compare lower-cased text for duplicates.", "sorted(skills, key=str.lower)", "Join the Markdown lines with a newline."]),
        manual("Portfolio: projects and validation", "Add the project command with parsing of title | description | link | tags, link validation (https:// only) and the numbered show output. Write unit tests for the valid and invalid forms.", []),
        manual("Portfolio: make it real", "Use your tool to create your own portfolio, put the exported Markdown into a README of a new GitHub repository named after your username (it appears on your profile) and submit the link. Include only work that is yours.", ["Be honest: list only skills and projects you can explain."]),
      ],
    },
  });
}

module.exports = { lessons };
