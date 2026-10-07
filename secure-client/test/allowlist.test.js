const test = require("node:test");
const assert = require("node:assert");
const { isAllowedUrl, hostAllowed, findBlockedProcesses, DEFAULT_BLOCKED_PROCESSES } = require("../lib/allowlist");

const allowed = ["codearena.site", "api-aws.codearena.site", "*.gstatic.com"];

test("CodeArena hosts are allowed", () => {
  assert.ok(isAllowedUrl("https://codearena.site/learning/java", allowed));
  assert.ok(isAllowedUrl("https://api-aws.codearena.site/api/health", allowed));
  assert.ok(isAllowedUrl("wss://api-aws.codearena.site/socket", allowed));
});

test("wildcard rules match subdomains only", () => {
  assert.ok(isAllowedUrl("https://fonts.gstatic.com/s/x.woff2", allowed));
  assert.ok(!hostAllowed("gstatic.com", ["*.gstatic.com"]));
});

test("search engines, AI sites, code hosts and social media are refused", () => {
  for (const u of ["https://www.google.com/search?q=x", "https://www.bing.com", "https://chat.openai.com", "https://chatgpt.com", "https://claude.ai", "https://gemini.google.com",
    "https://www.perplexity.ai", "https://github.com", "https://stackoverflow.com", "https://www.youtube.com", "https://www.instagram.com", "https://copilot.microsoft.com"]) {
    assert.ok(!isAllowedUrl(u, allowed), u);
  }
});

test("look-alike hosts do not pass (suffix, prefix and userinfo tricks)", () => {
  assert.ok(!isAllowedUrl("https://codearena.site.evil.com/", allowed));
  assert.ok(!isAllowedUrl("https://evilcodearena.site/", allowed));
  assert.ok(!isAllowedUrl("https://codearena.site@evil.com/", allowed));
});

test("dangerous schemes are refused", () => {
  for (const u of ["file:///C:/Windows/System32/cmd.exe", "chrome://settings", "devtools://devtools/bundled/inspector.html", "view-source:https://codearena.site", "javascript:alert(1)", "ftp://codearena.site"]) {
    assert.ok(!isAllowedUrl(u, allowed), u);
  }
});

test("blocked-process detection finds browsers, terminals, editors and AI apps, but not the client itself", () => {
  const found = findBlockedProcesses(["explorer.exe", "Chrome.exe", "powershell.exe", "Code.exe", "ChatGPT.exe", "CodeArena Secure Exam.exe"], DEFAULT_BLOCKED_PROCESSES, "CodeArena Secure Exam.exe");
  assert.deepStrictEqual(found.sort(), ["chatgpt.exe", "chrome.exe", "code.exe", "powershell.exe"]);
  assert.deepStrictEqual(findBlockedProcesses(["explorer.exe", "svchost.exe"]), []);
});
