const { test, expect } = require("@playwright/test");
const { data, users, login } = require("./helpers");

// "Letters turn into UPPERCASE while typing code" investigation. Real Chromium, the real Monaco editor, a real timed test. For every supported language, code made of lowercase words that
// are also the names of that language's built-in types and globals (string, map, date, vector, list ...: exactly what an autocomplete popup offers, in another case) is typed key by key
// at a realistic speed, and the text the editor then holds must equal the text that was typed: same letters, same case.
// Every mismatch is collected and reported together, so one run lists all of them.

async function openCodingTest(page) {
  await login(page, users.student);
  await page.goto(`/test/${data.codingTestId}`);
  await expect(page.getByRole("button", { name: /Begin Assessment/ })).toBeVisible({ timeout: 20000 });
  await page.getByLabel("I have read and understood the instructions.").check();
  await expect(page.getByRole("button", { name: /Begin Assessment/ })).toBeEnabled({ timeout: 8000 });
  await page.getByRole("button", { name: /Begin Assessment/ }).click();
  await expect(page.locator("h2", { hasText: /Code (Full|Function)/ }).first()).toBeVisible({ timeout: 20000 });
  const wanted = page.locator("h2", { hasText: /Code Full/ }).first();
  if (!(await wanted.isVisible())) await page.getByRole("button", { name: /Next/ }).first().click();
  await expect(wanted).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
}

const readEditor = () => {
  const lines = [...document.querySelectorAll(".monaco-editor .view-lines .view-line")].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
  return lines.map((l) => l.textContent.replace(/ /g, " ")).join("\n");
};
async function stableText(page) {
  let prev = null; let same = 0;
  for (let i = 0; i < 40; i++) {
    const t = await page.evaluate(readEditor);
    if (t === prev) { if (++same >= 3) return t; } else { same = 0; prev = t; }
    await page.waitForTimeout(100);
  }
  return prev;
}
async function clearEditor(page) {
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(150);
}

const SNIPPETS = {
  javascript: [
    'const string = "x"; let map = new Map(); map.set(1, 2); console.log(string.length, map.size);',
    "let date = new Date(); let array = []; array.push(1); let math = Math.max(1, 2); let json = JSON.stringify({ a: 1 });",
    "let promise = Promise.resolve(1); let object = {}; let number = 1; let boolean = true; let set = new Set(); let error = 1;",
  ],
  java: [
    'string name = "a"; scanner sc = new scanner(system.in); int max = math.max(1, 2); system.out.println(name);',
    "list<integer> list = new arraylist<>(); hashmap<string, integer> map = new hashmap<>(); string builder; stringbuilder sb;",
  ],
  python: [
    "import sys; input = sys.stdin.readline; print(max(1, 2), len([]), str(1), int(2), list(), dict(), set())",
    "def solve(self, nums): return sorted(nums) if true else none; x = false; string = 1; list = 2; type = 3",
  ],
  c: [
    '#include <stdio.h> int main(void) { int a, b; scanf("%d %d", &a, &b); printf("%d", a + b); return 0; }',
    "file *f; size_t n; char string[10]; int main = 1; void list; long date; double map;",
  ],
  cpp: [
    "#include <bits/stdc++.h> using namespace std; int main() { vector<int> v; map<int, int> m; string s; cin >> s; cout << s << endl; return 0; }",
    "vector<string> list; unordered_map<int, int> map; set<int> set; pair<int, int> pair; queue<int> queue; stack<int> stack; string string;",
  ],
};
const MIXED = ["aBc DeF ghI jKL", "camelCase snake_case PascalCase UPPER lower MiXeD"];

test("typing code keeps every letter exactly as typed, in every language (no case changes by autocomplete)", async ({ page }) => {
  test.setTimeout(8 * 60 * 1000);
  await openCodingTest(page);
  const mismatches = [];
  for (const [language, snippets] of Object.entries(SNIPPETS)) {
    await page.locator("select.mono").first().selectOption(language);
    for (const typed of [...snippets, ...MIXED]) {
      await clearEditor(page);
      await page.keyboard.type(typed, { delay: 25 });
      const got = await stableText(page);
      if (got !== typed) mismatches.push(`[${language}] typed ${JSON.stringify(typed)} -> editor holds ${JSON.stringify(got)}`);
    }
  }
  expect(mismatches, mismatches.join("  ||  ")).toEqual([]);
});
