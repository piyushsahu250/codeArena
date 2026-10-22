// E-mail HTML injection. REGRESSION (2026-10 audit): about 25 transactional e-mails put a person's name, a test or pool title, a document remark or an admin-typed message
// straight into HTML, so a crafted value (for example a name containing a link or a tag) became markup in mail sent to students and staff. Every such value is now passed
// through escapeHtml. The helper is tested directly, and a source scan fails the build if one of these values is interpolated into an HTML line without it again.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { escapeHtml } = require("../src/utils/mailer");

test("escapeHtml neutralises markup, quotes and ampersands, and leaves ordinary text alone", () => {
  assert.equal(escapeHtml('<a href="http://evil.example">click</a>'), "&lt;a href=&quot;http://evil.example&quot;&gt;click&lt;/a&gt;");
  assert.equal(escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
  assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(escapeHtml("Asha Rao"), "Asha Rao");
  assert.equal(escapeHtml(42), "42");
  assert.equal(escapeHtml("&lt;"), "&amp;lt;", "already-escaped text is escaped again, never trusted");
});

// Values that people (students, staff, admins) type and that reach an HTML e-mail body.
const USER_VALUES = ["student.name", "user.name", "updated.name", "m.name", "s.name", "r.name", "session.student.name", "pool.name", "assessmentLabel", "testTitle", "examination.title",
  "label", "verifierName", "reason", "test.title", "course.name", "subject.name", "certificate.title", "certificate.certificateCode", "message", "summary"];
const FILES = ["utils/notifications.js", "modules/auth/auth.service.js", "modules/users/users.account.service.js", "routes/interview.js", "utils/emailRetryScheduler.js",
  "modules/tests/tests.service.js", "routes/admin.js"];

test("no e-mail HTML line interpolates a user-supplied value without escapeHtml", () => {
  const offenders = [];
  for (const rel of FILES) {
    const lines = fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/<p>|<strong>/.test(line)) return;
      for (const v of USER_VALUES) if (line.includes("${" + v + "}")) offenders.push(`${rel}:${i + 1} interpolates \${${v}} unescaped`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("the admin broadcast message is escaped before its line breaks become <br/>", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "admin.js"), "utf8");
  assert.ok(src.includes('escapeHtml(message.trim()).replace(/\\n/g, "<br/>")'), "escape first, then convert newlines");
  assert.ok(!src.includes('${message.trim().replace('), "the unescaped form must not come back");
});
