// Hidden-test generators, part 2: the problems of the 15 companies imported from the master question bank. Registered into the same registry as
// researchHiddenTests.js (same rules: expected outputs come from `ref`, an independent `brute` must agree where present, the reference must reproduce both
// visible samples, and inputs avoid anything the statement leaves ambiguous).
const base = require("./researchHiddenTests");

const P = base.PROBLEMS;
const MAP = base.MAP;
const J = (...lines) => lines.join("\n");
const arr = (a) => a.join(" ");
const ints = (s) => (s.trim() === "" ? [] : s.trim().split(/\s+/).map(Number));
const lines = (s) => s.split("\n");
const rint = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const randArr = (rng, n, lo, hi) => Array.from({ length: n }, () => rint(rng, lo, hi));
const randStr = (rng, n, alphabet) => Array.from({ length: n }, () => alphabet[rint(rng, 0, alphabet.length - 1)]).join("");
const def = (key, ref, brute, tests, opts = {}) => { P[key] = { ref, brute, tests, ...opts }; };
const na = (s) => ints(lines(s)[1]);
const pop = (x) => { let c = 0; let v = BigInt(x); while (v > 0n) { c += Number(v & 1n); v >>= 1n; } return c; };
const randTree = (rng, n) => Array.from({ length: n - 1 }, (_, i) => `${rint(rng, 0, i)} ${i + 1}`);

// ---------- arrays and strings ----------
def("groupAnagrams",
  (s) => { const L = lines(s); const n = Number(L[0]); return String(new Set(L.slice(1, 1 + n).map((w) => [...w].sort().join(""))).size); },
  (s) => { const L = lines(s); const n = Number(L[0]); const ws = L.slice(1, 1 + n); const seen = []; for (const w of ws) { const k = [...w].sort().join(""); if (!seen.includes(k)) seen.push(k); } return String(seen.length); },
  (rng) => [J("1", "a"), J("3", "abc", "bca", "cab"), J("3", "abc", "abd", "abe"), J("5", "listen", "silent", "enlist", "google", "gogole"), J("6", "aab", "aba", "baa", "abb", "bab", "bba"), J("60", ...Array.from({ length: 60 }, () => randStr(rng, rint(rng, 1, 5), "abc")))]);

def("sort012",
  (s) => arr([...na(s)].sort((a, b) => a - b)),
  (s) => { const a = na(s); const c = [0, 0, 0]; a.forEach((x) => c[x]++); return arr([...Array(c[0]).fill(0), ...Array(c[1]).fill(1), ...Array(c[2]).fill(2)]); },
  (rng) => [J("1", "2"), J("3", "0 0 0"), J("5", "2 2 1 1 0"), J("6", "0 1 2 0 1 2"), J("30", arr(randArr(rng, 30, 0, 2))), J("3000", arr(randArr(rng, 3000, 0, 2)))]);

def("treeDiameter",
  (s) => { const L = lines(s); const n = Number(L[0]); const adj = Array.from({ length: n }, () => []); for (let i = 1; i < n; i++) { const [u, v] = ints(L[i]); adj[u].push(v); adj[v].push(u); } const far = (src) => { const d = Array(n).fill(-1); d[src] = 0; const q = [src]; let last = src; for (let h = 0; h < q.length; h++) { const x = q[h]; last = x; for (const y of adj[x]) if (d[y] < 0) { d[y] = d[x] + 1; q.push(y); } } return [last, d[last]]; }; return String(far(far(0)[0])[1]); },
  (s) => { const L = lines(s); const n = Number(L[0]); if (n > 400) return null; const adj = Array.from({ length: n }, () => []); for (let i = 1; i < n; i++) { const [u, v] = ints(L[i]); adj[u].push(v); adj[v].push(u); } let best = 0; for (let st = 0; st < n; st++) { const d = Array(n).fill(-1); d[st] = 0; const q = [st]; for (let h = 0; h < q.length; h++) for (const y of adj[q[h]]) if (d[y] < 0) { d[y] = d[q[h]] + 1; q.push(y); } best = Math.max(best, ...d); } return String(best); },
  (rng) => [J("1"), J("2", "0 1"), J("5", "0 1", "0 2", "0 3", "0 4"), J("6", "0 1", "1 2", "2 3", "3 4", "4 5"), J("7", "3 1", "1 0", "0 5", "5 6", "1 2", "2 4"), J("30", ...randTree(rng, 30)), J("400", ...randTree(rng, 400))]);

def("patternCount",
  (s) => { const [t, p] = lines(s); let c = 0; for (let i = t.indexOf(p); i !== -1; i = t.indexOf(p, i + 1)) c++; return String(c); },
  (s) => { const [t, p] = lines(s); let c = 0; for (let i = 0; i + p.length <= t.length; i++) if (t.slice(i, i + p.length) === p) c++; return String(c); },
  (rng) => [J("a", "a"), J("a", "b"), J("abc", "abcd"), J("aaaaa", "aa"), J("ababababa", "aba"), J("mississippi", "issi"), J(randStr(rng, 3000, "ab"), "abab"), J(randStr(rng, 50, "abc"), "ab")]);

def("nextGreater",
  (s) => { const a = na(s); const out = Array(a.length).fill(-1); const st = []; for (let i = 0; i < a.length; i++) { while (st.length && a[st[st.length - 1]] < a[i]) out[st.pop()] = a[i]; st.push(i); } return arr(out); },
  (s) => { const a = na(s); if (a.length > 3000) return null; return arr(a.map((x, i) => { for (let j = i + 1; j < a.length; j++) if (a[j] > x) return a[j]; return -1; })); },
  (rng) => [J("1", "5"), J("4", "1 2 3 4"), J("4", "4 3 2 1"), J("6", "2 2 2 3 3 1"), J("7", "-1 -5 0 -2 7 7 3"), J("20", arr(randArr(rng, 20, -9, 9))), J("2500", arr(randArr(rng, 2500, -1e6, 1e6)))]);

def("topKFrequent",
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); const f = new Map(); a.forEach((x) => f.set(x, (f.get(x) || 0) + 1)); return arr([...f.keys()].sort((x, y) => f.get(y) - f.get(x) || x - y).slice(0, k)); },
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); const vals = [...new Set(a)]; const out = []; while (out.length < k) { let best = null; for (const v of vals) { if (out.includes(v)) continue; const c = a.filter((x) => x === v).length; if (best === null || c > best.c || (c === best.c && v < best.v)) best = { v, c }; } out.push(best.v); } return arr(out); },
  (rng) => [J("1 1", "7"), J("6 2", "1 1 1 2 2 3"), J("5 3", "4 4 5 5 6"), J("7 1", "3 3 3 -1 -1 2 2"), J("8 4", "9 8 7 6 5 4 3 3"), (() => { const a = randArr(rng, 200, -8, 8); const d = new Set(a).size; return J(`200 ${Math.min(5, d)}`, arr(a)); })()]);

def("slidingMax",
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); const dq = []; const out = []; for (let i = 0; i < n; i++) { while (dq.length && a[dq[dq.length - 1]] <= a[i]) dq.pop(); dq.push(i); if (dq[0] <= i - k) dq.shift(); if (i >= k - 1) out.push(a[dq[0]]); } return arr(out); },
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); if (n > 3000) return null; const out = []; for (let i = 0; i + k <= n; i++) out.push(Math.max(...a.slice(i, i + k))); return arr(out); },
  (rng) => [J("1 1", "5"), J("4 4", "3 1 4 1"), J("5 1", "5 4 3 2 1"), J("6 2", "-1 -3 -2 -5 -4 -4"), J("7 3", "1 3 1 2 0 5 5"), J("30 5", arr(randArr(rng, 30, -20, 20))), J("2500 40", arr(randArr(rng, 2500, -1e6, 1e6)))]);

def("trappingWater",
  (s) => { const h = na(s); let l = 0, r = h.length - 1, lm = 0, rm = 0, w = 0; while (l < r) { if (h[l] < h[r]) { lm = Math.max(lm, h[l]); w += lm - h[l]; l++; } else { rm = Math.max(rm, h[r]); w += rm - h[r]; r--; } } return String(w); },
  (s) => { const h = na(s); let w = 0; for (let i = 0; i < h.length; i++) w += Math.max(0, Math.min(Math.max(...h.slice(0, i + 1)), Math.max(...h.slice(i))) - h[i]); return String(w); },
  (rng) => [J("1", "5"), J("2", "3 3"), J("5", "5 4 3 2 1"), J("5", "1 2 3 4 5"), J("9", "0 1 0 2 1 0 1 3 2"), J("5", "4 2 0 3 2"), J("25", arr(randArr(rng, 25, 0, 9))), J("2000", arr(randArr(rng, 2000, 0, 1000)))]);

def("meetingRooms",
  (s) => { const L = lines(s); const n = Number(L[0]); const iv = L.slice(1, 1 + n).map(ints); const st = iv.map((x) => x[0]).sort((a, b) => a - b), en = iv.map((x) => x[1]).sort((a, b) => a - b); let rooms = 0, best = 0, j = 0; for (let i = 0; i < n; i++) { while (en[j] <= st[i]) { j++; rooms--; } rooms++; best = Math.max(best, rooms); } return String(best); },
  (s) => { const L = lines(s); const n = Number(L[0]); const iv = L.slice(1, 1 + n).map(ints); let best = 0; for (const [t] of iv) best = Math.max(best, iv.filter(([a, b]) => a <= t && t < b).length); return String(best); },
  (rng) => [J("1", "5 9"), J("2", "1 5", "5 9"), J("3", "1 10", "2 9", "3 8"), J("4", "0 5", "5 10", "10 15", "2 12"), J("5", "7 10", "2 4", "1 3", "3 6", "6 9"), (() => { const rows = Array.from({ length: 60 }, () => { const a = rint(rng, 0, 100); return `${a} ${a + rint(rng, 1, 20)}`; }); return J("60", ...rows); })(), (() => { const rows = Array.from({ length: 800 }, () => { const a = rint(rng, 0, 5000); return `${a} ${a + rint(rng, 1, 50)}`; }); return J("800", ...rows); })()]);

def("wordBreak",
  (s) => { const L = lines(s); const str = L[0]; const words = new Set(L[2].trim().split(/\s+/)); const dp = Array(str.length + 1).fill(false); dp[0] = true; for (let i = 1; i <= str.length; i++) for (let j = 0; j < i; j++) if (dp[j] && words.has(str.slice(j, i))) { dp[i] = true; break; } return dp[str.length] ? "Yes" : "No"; },
  (s) => { const L = lines(s); const str = L[0]; const words = L[2].trim().split(/\s+/); const seen = new Set([0]); const q = [0]; for (let h = 0; h < q.length; h++) for (const w of words) if (str.startsWith(w, q[h]) && !seen.has(q[h] + w.length)) { seen.add(q[h] + w.length); q.push(q[h] + w.length); } return seen.has(str.length) ? "Yes" : "No"; },
  (rng) => [J("a", "1", "a"), J("ab", "1", "a"), J("aaaa", "2", "a aa"), J("leetcode", "2", "leet code"), J("catsandog", "5", "cats dog sand and cat"), J("abcd", "4", "a abc b cd"), J("aaaaaaaaaaaaaaaaaaaab", "2", "a aa"), J(randStr(rng, 200, "ab"), "3", "a ab ba")]);

def("editDistance",
  (s) => { const [a, b] = lines(s); const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 0; j <= b.length; j++) dp[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return String(dp[a.length][b.length]); },
  (s) => { const [a, b] = lines(s); if (a.length > 9 || b.length > 9) return null; const memo = new Map(); const f = (i, j) => { const k = i * 20 + j; if (memo.has(k)) return memo.get(k); let r; if (i === a.length) r = b.length - j; else if (j === b.length) r = a.length - i; else if (a[i] === b[j]) r = f(i + 1, j + 1); else r = 1 + Math.min(f(i + 1, j), f(i, j + 1), f(i + 1, j + 1)); memo.set(k, r); return r; }; return String(f(0, 0)); },
  (rng) => [J("a", "a"), J("a", "b"), J("abc", "abc"), J("intention", "execution"), J("sunday", "saturday"), J("kitten", "sitting"), J("abcdefgh", "hgfedcba"), J(randStr(rng, 8, "abc"), randStr(rng, 7, "abc")), J(randStr(rng, 400, "abcd"), randStr(rng, 380, "abcd"))]);

def("courseSchedule",
  (s) => { const L = lines(s); const [n, m] = ints(L[0]); const adj = Array.from({ length: n }, () => []); const indeg = Array(n).fill(0); for (let i = 1; i <= m; i++) { const [u, v] = ints(L[i]); adj[u].push(v); indeg[v]++; } const q = []; indeg.forEach((x, i) => { if (x === 0) q.push(i); }); let seen = 0; for (let h = 0; h < q.length; h++) { seen++; for (const v of adj[q[h]]) if (--indeg[v] === 0) q.push(v); } return seen === n ? "Yes" : "No"; },
  (s) => { const L = lines(s); const [n, m] = ints(L[0]); const adj = Array.from({ length: n }, () => []); for (let i = 1; i <= m; i++) { const [u, v] = ints(L[i]); adj[u].push(v); } const color = Array(n).fill(0); const dfs = (u) => { color[u] = 1; for (const v of adj[u]) { if (color[v] === 1) return true; if (color[v] === 0 && dfs(v)) return true; } color[u] = 2; return false; }; for (let i = 0; i < n; i++) if (color[i] === 0 && dfs(i)) return "No"; return "Yes"; },
  (rng) => [J("1 0"), J("1 1", "0 0"), J("3 0"), J("3 3", "0 1", "1 2", "2 0"), J("4 4", "0 1", "0 2", "1 3", "2 3"), J("5 5", "0 1", "1 2", "2 3", "3 4", "4 2"), (() => { const rows = Array.from({ length: 40 }, () => { const a = rint(rng, 0, 18); return `${a} ${rint(rng, a + 1, 19)}`; }); return J("20 40", ...rows); })(), (() => { const rows = Array.from({ length: 40 }, () => { const a = rint(rng, 0, 18); return `${a} ${rint(rng, a + 1, 19)}`; }); rows.push("19 0"); return J("20 41", ...rows); })()]);

def("productExceptSelf",
  (s) => { const a = na(s).map(BigInt); const n = a.length; const out = Array(n).fill(1n); let p = 1n; for (let i = 0; i < n; i++) { out[i] = p; p *= a[i]; } p = 1n; for (let i = n - 1; i >= 0; i--) { out[i] *= p; p *= a[i]; } return arr(out); },
  (s) => { const a = na(s).map(BigInt); if (a.length > 300) return null; return arr(a.map((_, i) => a.reduce((acc, x, j) => (j === i ? acc : acc * x), 1n))); },
  (rng) => [J("2", "3 4"), J("2", "0 0"), J("4", "1 2 3 4"), J("4", "-1 1 0 -3"), J("5", "2 3 4 5 6"), J("6", "0 2 0 3 4 5"), J("25", arr(randArr(rng, 25, -3, 3))), J("200", arr(randArr(rng, 200, 0, 1)))]);

def("kthLargest",
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); return String([...ints(L[1])].sort((a, b) => b - a)[k - 1]); },
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); let a = ints(L[1]); for (let i = 0; i < k - 1; i++) { const m = Math.max(...a); a.splice(a.indexOf(m), 1); } return String(Math.max(...a)); },
  (rng) => [J("1 1", "5"), J("3 3", "1 2 3"), J("5 1", "9 9 1 2 3"), J("6 3", "5 5 5 4 4 1"), J("7 4", "-1 -2 -3 -4 -5 -6 -7"), J("40 17", arr(randArr(rng, 40, -50, 50))), J("2000 777", arr(randArr(rng, 2000, -1e5, 1e5)))]);

def("rotatedSearch",
  (s) => { const L = lines(s); const a = ints(L[1]); const t = Number(L[2]); let lo = 0, hi = a.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] === t) return String(m); if (a[lo] <= a[m]) { if (a[lo] <= t && t < a[m]) hi = m - 1; else lo = m + 1; } else if (a[m] < t && t <= a[hi]) lo = m + 1; else hi = m - 1; } return "-1"; },
  (s) => { const L = lines(s); return String(ints(L[1]).indexOf(Number(L[2]))); },
  (rng) => { const mk = (n, rot, target) => { const sorted = Array.from({ length: n }, (_, i) => i * 3 - 20); const r = rot % n; const a = [...sorted.slice(r), ...sorted.slice(0, r)]; return J(String(n), arr(a), String(target === "in" ? a[rint(rng, 0, n - 1)] : 2)); }; return [J("1", "5", "5"), J("1", "5", "4"), mk(2, 1, "in"), mk(7, 0, "in"), mk(7, 3, "in"), mk(8, 5, "in"), mk(9, 4, "out"), mk(500, 123, "in"), mk(2000, 1500, "in")]; });

def("circularMaxSubarray",
  (s) => { const a = na(s); let cur = 0, best = -Infinity, curMin = 0, worst = Infinity, total = 0; for (const x of a) { cur = Math.max(x, cur + x); best = Math.max(best, cur); curMin = Math.min(x, curMin + x); worst = Math.min(worst, curMin); total += x; } return String(best < 0 ? best : Math.max(best, total - worst)); },
  (s) => { const a = na(s); const n = a.length; if (n > 600) return null; let best = -Infinity; for (let i = 0; i < n; i++) { let sm = 0; for (let len = 1; len <= n; len++) { sm += a[(i + len - 1) % n]; best = Math.max(best, sm); } } return String(best); },
  (rng) => [J("1", "-4"), J("1", "6"), J("2", "5 -2"), J("4", "8 -8 9 -9"), J("5", "-1 -2 -3 -4 -5"), J("6", "3 -1 2 -1 4 -9"), J("30", arr(randArr(rng, 30, -9, 9))), J("500", arr(randArr(rng, 500, -50, 60)))]);

const robber = (a) => { let p = 0, q = 0; for (const x of a) { [p, q] = [q, Math.max(q, p + x)]; } return q; };
def("houseRobber",
  (s) => String(robber(na(s))),
  (s) => { const a = na(s); if (a.length > 18) return null; let best = 0; for (let m = 0; m < (1 << a.length); m++) { if (m & (m >> 1)) continue; let t = 0; for (let i = 0; i < a.length; i++) if (m & (1 << i)) t += a[i]; best = Math.max(best, t); } return String(best); },
  (rng) => [J("1", "0"), J("2", "3 9"), J("3", "5 1 5"), J("5", "2 1 1 2 9"), J("6", "100 1 1 100 1 1"), J("14", arr(randArr(rng, 14, 0, 50))), J("3000", arr(randArr(rng, 3000, 0, 1000)))]);

const lruRef = (s) => { const L = lines(s); const cap = Number(L[0]); const q = Number(L[1]); const m = new Map(); const out = []; for (let i = 0; i < q; i++) { const [op, k, v] = L[2 + i].split(" "); if (op === "put") { if (m.has(k)) m.delete(k); else if (m.size >= cap) m.delete(m.keys().next().value); m.set(k, v); } else if (m.has(k)) { const val = m.get(k); m.delete(k); m.set(k, val); out.push(val); } else out.push("-1"); } return out.join(" "); };
def("lru", lruRef,
  (s) => { const L = lines(s); const cap = Number(L[0]); const q = Number(L[1]); const list = []; const out = []; for (let i = 0; i < q; i++) { const [op, k, v] = L[2 + i].split(" "); const idx = list.findIndex((e) => e.k === k); if (op === "put") { if (idx >= 0) list.splice(idx, 1); else if (list.length >= cap) list.shift(); list.push({ k, v }); } else if (idx >= 0) { const e = list.splice(idx, 1)[0]; list.push(e); out.push(e.v); } else out.push("-1"); } return out.join(" "); },
  (rng) => { const mk = (cap, q, keys) => { const ops = Array.from({ length: q }, () => (rng() < 0.5 ? `put ${rint(rng, 1, keys)} ${rint(rng, 1, 99)}` : `get ${rint(rng, 1, keys)}`)); ops.push("get 1"); return J(String(cap), String(q + 1), ...ops); }; return [J("1", "3", "put 1 7", "put 1 8", "get 1"), J("2", "3", "get 5", "put 5 1", "get 5"), J("2", "6", "put 1 1", "put 2 2", "get 1", "put 3 3", "get 2", "get 1"), J("3", "7", "put 1 1", "put 2 2", "put 3 3", "get 1", "put 4 4", "get 2", "get 3"), mk(2, 20, 5), mk(3, 60, 6), mk(4, 300, 9), mk(50, 800, 80)]; });

def("matchingEndpoints",
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); const pre = [0]; a.forEach((x) => pre.push(pre[pre.length - 1] + x)); let best = null; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(a[i] - a[j]) === k) { const sm = pre[j + 1] - pre[i]; if (best === null || sm > best) best = sm; } return best === null ? "-1" : String(best); },
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); if (n > 80) return null; let best = null; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(a[i] - a[j]) === k) { let sm = 0; for (let t = i; t <= j; t++) sm += a[t]; if (best === null || sm > best) best = sm; } return best === null ? "-1" : String(best); },
  (rng) => [J("2 1", "4 5"), J("2 3", "4 5"), J("4 4", "-2 2 -3 2"), J("5 1", "1 2 3 -10 4"), J("6 5", "0 5 5 -5 0 10"), J("40 3", arr(randArr(rng, 40, -9, 9))), J("1500 4", arr(randArr(rng, 1500, -50, 50)))]);

def("shortestPaths",
  (s) => { const L = lines(s); const [n, m] = ints(L[0]); const adj = Array.from({ length: n }, () => []); for (let i = 1; i <= m; i++) { const [u, v, w] = ints(L[i]); adj[u].push([v, w]); adj[v].push([u, w]); } const src = Number(L[m + 1]); const dist = Array(n).fill(Infinity); dist[src] = 0; const done = Array(n).fill(false); for (let it = 0; it < n; it++) { let u = -1; for (let i = 0; i < n; i++) if (!done[i] && (u === -1 || dist[i] < dist[u])) u = i; if (u === -1 || dist[u] === Infinity) break; done[u] = true; for (const [v, w] of adj[u]) if (dist[u] + w < dist[v]) dist[v] = dist[u] + w; } return arr(dist.map((x) => (x === Infinity ? -1 : x))); },
  (s) => { const L = lines(s); const [n, m] = ints(L[0]); const edges = []; for (let i = 1; i <= m; i++) { const [u, v, w] = ints(L[i]); edges.push([u, v, w], [v, u, w]); } const src = Number(L[m + 1]); const dist = Array(n).fill(Infinity); dist[src] = 0; for (let it = 0; it < n; it++) for (const [u, v, w] of edges) if (dist[u] + w < dist[v]) dist[v] = dist[u] + w; return arr(dist.map((x) => (x === Infinity ? -1 : x))); },
  (rng) => { const mk = (n, m, src) => { const es = Array.from({ length: m }, () => `${rint(rng, 0, n - 1)} ${rint(rng, 0, n - 1)} ${rint(rng, 1, 9)}`); return J(`${n} ${m}`, ...es, String(src)); }; return [J("1 0", "0"), J("2 0", "1"), J("3 2", "0 1 5", "1 2 5", "2"), J("4 3", "0 1 1", "0 1 7", "2 3 2", "0"), J("5 5", "0 1 2", "1 2 2", "0 2 5", "2 3 1", "3 4 1", "4"), mk(12, 14, 3), mk(40, 80, 0), mk(300, 700, 5)]; });

def("equalPartition",
  (s) => { const a = na(s); const total = a.reduce((x, y) => x + y, 0); if (total % 2) return "No"; const half = total / 2; const dp = Array(half + 1).fill(false); dp[0] = true; for (const x of a) for (let c = half; c >= x; c--) if (dp[c - x]) dp[c] = true; return dp[half] ? "Yes" : "No"; },
  (s) => { const a = na(s); if (a.length > 16) return null; const total = a.reduce((x, y) => x + y, 0); for (let m = 0; m < (1 << a.length); m++) { let t = 0; for (let i = 0; i < a.length; i++) if (m & (1 << i)) t += a[i]; if (t * 2 === total) return "Yes"; } return "No"; },
  (rng) => [J("1", "4"), J("2", "3 3"), J("2", "3 4"), J("4", "1 5 11 5"), J("5", "1 2 3 4 5"), J("6", "2 2 2 2 2 2"), J("12", arr(randArr(rng, 12, 1, 20))), J("16", arr(randArr(rng, 16, 1, 9))), J("120", arr(randArr(rng, 120, 1, 60)))]);

def("lca",
  (s) => { const L = lines(s); const n = Number(L[0]); const par = ints(L[1]); const [u0, v0] = ints(L[2]); const depth = (x) => { let d = 0; while (par[x] !== -1) { x = par[x]; d++; } return d; }; let u = u0, v = v0, du = depth(u), dv = depth(v); while (du > dv) { u = par[u]; du--; } while (dv > du) { v = par[v]; dv--; } while (u !== v) { u = par[u]; v = par[v]; } return String(u); },
  (s) => { const L = lines(s); const par = ints(L[1]); let [u, v] = ints(L[2]); const anc = new Set(); for (let x = u; x !== -1; x = par[x]) anc.add(x); for (let x = v; x !== -1; x = par[x]) if (anc.has(x)) return String(x); return "-1"; },
  (rng) => { const mk = (n) => { const par = [-1]; for (let i = 1; i < n; i++) par.push(rint(rng, 0, i - 1)); return J(String(n), arr(par), `${rint(rng, 0, n - 1)} ${rint(rng, 0, n - 1)}`); }; return [J("1", "-1", "0 0"), J("2", "-1 0", "0 1"), J("5", "-1 0 0 1 1", "3 4"), J("5", "-1 0 0 1 1", "2 3"), J("6", "-1 0 1 2 3 4", "5 2"), J("7", "-1 0 0 1 1 2 2", "3 6"), mk(20), mk(300), mk(3000)]; });

// ---------- price, greedy and grid problems ----------
def("bestTime",
  (s) => { const p = na(s); let lo = Infinity, best = 0; for (const x of p) { lo = Math.min(lo, x); best = Math.max(best, x - lo); } return String(best); },
  (s) => { const p = na(s); if (p.length > 3000) return null; let best = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) best = Math.max(best, p[j] - p[i]); return String(best); },
  (rng) => [J("1", "5"), J("2", "1 2"), J("2", "2 1"), J("5", "5 4 3 2 1"), J("6", "7 1 5 3 6 4"), J("7", "2 4 1 7 3 9 0"), J("30", arr(randArr(rng, 30, 1, 99))), J("2500", arr(randArr(rng, 2500, 1, 100000)))]);

def("stockMany",
  (s) => { const p = na(s); let t = 0; for (let i = 1; i < p.length; i++) t += Math.max(0, p[i] - p[i - 1]); return String(t); },
  (s) => { const p = na(s); let hold = -Infinity, cash = 0; for (const x of p) { const nc = Math.max(cash, hold + x); hold = Math.max(hold, cash - x); cash = nc; } return String(cash); },
  (rng) => [J("1", "5"), J("2", "1 5"), J("4", "5 4 3 2"), J("5", "1 2 3 4 5"), J("7", "3 3 5 0 0 3 1"), J("30", arr(randArr(rng, 30, 1, 50))), J("3000", arr(randArr(rng, 3000, 1, 1000)))]);

def("firstMissingPositive",
  (s) => { const set = new Set(na(s)); let i = 1; while (set.has(i)) i++; return String(i); },
  (s) => { const a = na(s); for (let i = 1; ; i++) if (!a.includes(i)) return String(i); },
  (rng) => [J("1", "1"), J("1", "2"), J("1", "-5"), J("4", "7 8 9 11"), J("5", "1 2 0 4 5"), J("6", "3 4 -1 1 5 2"), J("30", arr(randArr(rng, 30, -3, 35))), J("1500", arr(Array.from({ length: 1500 }, (_, i) => i + 1).filter((x) => x !== 777)))]);

def("cycleLength",
  (s) => { const L = lines(s); const [n, st] = ints(L[0]); const a = ints(L[1]); const seen = new Map(); let i = st, step = 0; while (i >= 0 && i < n) { if (seen.has(i)) return String(step - seen.get(i)); seen.set(i, step++); i = a[i]; } return "-1"; },
  (s) => { const L = lines(s); const [n, st] = ints(L[0]); const a = ints(L[1]); let i = st; for (let k = 0; k <= n; k++) { if (i < 0 || i >= n) return "-1"; i = a[i]; } let len = 1, j = a[i]; while (j !== i) { j = a[j]; len++; } return String(len); },
  (rng) => [J("1 0", "0"), J("1 0", "5"), J("3 1", "1 2 0"), J("4 0", "1 2 3 -1"), J("5 0", "1 2 3 4 2"), J("6 5", "1 0 3 2 5 4"), J("8 0", "1 2 3 4 5 6 7 3"), (() => { const n = 500; const a = Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 : i + 1)); return J(`${n} 0`, arr(a)); })(), (() => { const n = 500; const a = Array.from({ length: n }, (_, i) => (i === n - 1 ? n : i + 1)); return J(`${n} 0`, arr(a)); })()]);

def("maxCoinsGrid",
  (s) => { const L = lines(s); const [r, c] = ints(L[0]); const g = L.slice(1, 1 + r).map(ints); const dp = Array.from({ length: r }, () => Array(c).fill(-Infinity)); for (let i = r - 1; i >= 0; i--) for (let j = 0; j < c; j++) { if (i === r - 1 && j === 0) dp[i][j] = g[i][j]; else dp[i][j] = g[i][j] + Math.max(i + 1 < r ? dp[i + 1][j] : -Infinity, j > 0 ? dp[i][j - 1] : -Infinity); } return String(dp[0][c - 1]); },
  (s) => { const L = lines(s); const [r, c] = ints(L[0]); const g = L.slice(1, 1 + r).map(ints); if (r + c > 11) return null; const f = (i, j) => (i === 0 && j === c - 1 ? g[i][j] : g[i][j] + Math.max(i > 0 ? f(i - 1, j) : -Infinity, j < c - 1 ? f(i, j + 1) : -Infinity)); return String(f(r - 1, 0)); },
  (rng) => { const mk = (r, c, lo, hi) => J(`${r} ${c}`, ...Array.from({ length: r }, () => arr(randArr(rng, c, lo, hi)))); return [J("1 1", "-4"), J("1 4", "1 2 3 4"), J("4 1", "1", "2", "3", "4"), J("2 2", "1 2", "3 4"), mk(3, 4, 0, 9), mk(4, 4, -5, 9), mk(5, 5, 0, 20), mk(60, 60, 0, 100)]; });

def("trimPalindrome",
  (s) => { const t = lines(s)[0]; let best = 0; for (let c = 0; c < t.length; c++) for (const [l0, r0] of [[c, c], [c, c + 1]]) { let l = l0, r = r0; while (l >= 0 && r < t.length && t[l] === t[r]) { l--; r++; } best = Math.max(best, r - l - 1); } return String(t.length - best); },
  (s) => { const t = lines(s)[0]; if (t.length > 300) return null; let best = 0; for (let i = 0; i < t.length; i++) for (let j = i; j < t.length; j++) { const sub = t.slice(i, j + 1); if (sub === [...sub].reverse().join("")) best = Math.max(best, sub.length); } return String(t.length - best); },
  (rng) => ["a", "ab", "aa", "abba", "xabcbay", "abcdef", "racecarxyz", "zzabacabaqq", randStr(rng, 30, "ab"), randStr(rng, 250, "abc"), randStr(rng, 1800, "abcd")]);

def("koko",
  (s) => { const L = lines(s); const [n, h] = ints(L[0]); const p = ints(L[1]); let lo = 1, hi = Math.max(...p); while (lo < hi) { const m = (lo + hi) >> 1; const t = p.reduce((a, x) => a + Math.ceil(x / m), 0); if (t <= h) hi = m; else lo = m + 1; } return String(lo); },
  (s) => { const L = lines(s); const [n, h] = ints(L[0]); const p = ints(L[1]); for (let k = 1; ; k++) if (p.reduce((a, x) => a + Math.ceil(x / k), 0) <= h) return String(k); },
  (rng) => [J("1 1", "1"), J("1 4", "100"), J("3 3", "7 7 7"), J("4 8", "3 6 7 11"), J("5 5", "30 11 23 4 20"), J("5 6", "30 11 23 4 20"), J("8 40", arr(randArr(rng, 8, 1, 200))), J("500 700", arr(randArr(rng, 500, 1, 1000)))]);

def("containerWater",
  (s) => { const h = na(s); let l = 0, r = h.length - 1, best = 0; while (l < r) { best = Math.max(best, Math.min(h[l], h[r]) * (r - l)); if (h[l] < h[r]) l++; else r--; } return String(best); },
  (s) => { const h = na(s); if (h.length > 3000) return null; let best = 0; for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) best = Math.max(best, Math.min(h[i], h[j]) * (j - i)); return String(best); },
  (rng) => [J("2", "0 0"), J("2", "5 9"), J("3", "4 1 4"), J("5", "1 2 3 4 5"), J("6", "6 5 4 3 2 1"), J("8", "2 3 4 5 18 17 6 1"), J("40", arr(randArr(rng, 40, 0, 99))), J("2500", arr(randArr(rng, 2500, 0, 10000)))]);

def("candy",
  (s) => { const r = na(s); const n = r.length; const c = Array(n).fill(1); for (let i = 1; i < n; i++) if (r[i] > r[i - 1]) c[i] = c[i - 1] + 1; for (let i = n - 2; i >= 0; i--) if (r[i] > r[i + 1]) c[i] = Math.max(c[i], c[i + 1] + 1); return String(c.reduce((a, x) => a + x, 0)); },
  (s) => { const r = na(s); const n = r.length; const c = Array(n).fill(1); let ch = true; while (ch) { ch = false; for (let i = 0; i < n; i++) { if (i > 0 && r[i] > r[i - 1] && c[i] <= c[i - 1]) { c[i] = c[i - 1] + 1; ch = true; } if (i < n - 1 && r[i] > r[i + 1] && c[i] <= c[i + 1]) { c[i] = c[i + 1] + 1; ch = true; } } } return String(c.reduce((a, x) => a + x, 0)); },
  (rng) => [J("1", "5"), J("2", "1 2"), J("4", "5 5 5 5"), J("5", "1 2 3 4 5"), J("5", "5 4 3 2 1"), J("6", "1 3 2 2 1 4"), J("30", arr(randArr(rng, 30, 1, 9))), J("2000", arr(randArr(rng, 2000, 1, 50)))]);

def("groupTransactions",
  (s) => { const L = lines(s); const n = Number(L[0]); const m = new Map(); for (let i = 1; i <= n; i++) { const [d, a] = L[i].split(" "); m.set(d, (m.get(d) || 0) + Number(a)); } return [...m.keys()].sort().map((d) => `${d} ${m.get(d)}`).join("\n"); },
  (s) => { const L = lines(s); const n = Number(L[0]); const tot = {}; for (let i = 1; i <= n; i++) { const [d, a] = L[i].split(" "); tot[d] = (tot[d] || 0) + Number(a); } return Object.keys(tot).sort().map((d) => `${d} ${tot[d]}`).join("\n"); },
  (rng) => { const dates = ["2026-01-05", "2026-01-06", "2025-12-31", "2026-02-01", "2026-01-05"]; const mk = (n) => J(String(n), ...Array.from({ length: n }, () => `${dates[rint(rng, 0, dates.length - 1)]} ${rint(rng, -50, 200)}`)); return [J("1", "2026-05-05 0"), J("2", "2026-05-05 7", "2026-05-05 -7"), J("3", "2026-03-01 5", "2026-02-01 6", "2026-03-01 1"), mk(10), mk(300)]; });

def("inversionCount",
  (s) => { const a = [...na(s)]; const tmp = Array(a.length); const sortCount = (lo, hi) => { if (hi - lo < 2) return 0; const mid = (lo + hi) >> 1; let c = sortCount(lo, mid) + sortCount(mid, hi); let i = lo, j = mid, k = lo; while (i < mid && j < hi) { if (a[i] <= a[j]) tmp[k++] = a[i++]; else { tmp[k++] = a[j++]; c += mid - i; } } while (i < mid) tmp[k++] = a[i++]; while (j < hi) tmp[k++] = a[j++]; for (let t = lo; t < hi; t++) a[t] = tmp[t]; return c; }; return String(sortCount(0, a.length)); },
  (s) => { const a = na(s); let c = 0; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (a[i] > a[j]) c++; return String(c); },
  (rng) => [J("1", "4"), J("2", "1 2"), J("2", "2 1"), J("5", "5 4 3 2 1"), J("5", "3 3 3 3 3"), J("6", "1 20 6 4 5 4"), J("40", arr(randArr(rng, 40, -9, 9))), J("2000", arr(randArr(rng, 2000, -1e5, 1e5)))]);

def("rotateMatrix",
  (s) => { const L = lines(s); const n = Number(L[0]); const m = L.slice(1, 1 + n).map((r) => r.split(" ")); const out = []; for (let j = 0; j < n; j++) out.push(Array.from({ length: n }, (_, i) => m[n - 1 - i][j]).join(" ")); return out.join("\n"); },
  (s) => { const L = lines(s); const n = Number(L[0]); let m = L.slice(1, 1 + n).map((r) => r.split(" ")); const t = m[0].map((_, j) => m.map((row) => row[j])); return t.map((row) => [...row].reverse().join(" ")).join("\n"); },
  (rng) => { const mk = (n) => J(String(n), ...Array.from({ length: n }, () => arr(randArr(rng, n, -99, 99)))); return [J("1", "5"), mk(2), mk(3), mk(4), mk(5), mk(40)]; });

def("minWindow",
  (s) => { const [t, p] = lines(s); const need = {}; for (const c of p) need[c] = (need[c] || 0) + 1; let missing = p.length, l = 0, best = Infinity; for (let r = 0; r < t.length; r++) { if (need[t[r]] !== undefined) { if (need[t[r]] > 0) missing--; need[t[r]]--; } while (missing === 0) { best = Math.min(best, r - l + 1); if (need[t[l]] !== undefined) { need[t[l]]++; if (need[t[l]] > 0) missing++; } l++; } } return best === Infinity ? "0" : String(best); },
  (s) => { const [t, p] = lines(s); if (t.length > 120) return null; const ok = (sub) => { const c = {}; for (const ch of sub) c[ch] = (c[ch] || 0) + 1; return [...p].every((ch) => { c[ch] = (c[ch] || 0) - 1; return c[ch] >= 0; }); }; let best = Infinity; for (let i = 0; i < t.length; i++) for (let j = i + p.length; j <= t.length; j++) if (ok(t.slice(i, j))) best = Math.min(best, j - i); return best === Infinity ? "0" : String(best); },
  (rng) => [J("a", "a"), J("a", "b"), J("ab", "ba"), J("aab", "aab"), J("ADOBECODEBANC", "ABC"), J("abcabdebac", "cda"), J("aaflslflsldkalskaaa", "aaa"), J(randStr(rng, 100, "abcd"), "abcdd"), J(randStr(rng, 3000, "abcdef"), "abcdefa")]);

def("validPalindromeOne",
  (s) => { const t = lines(s)[0]; const isP = (l, r) => { while (l < r) { if (t[l] !== t[r]) return false; l++; r--; } return true; }; let l = 0, r = t.length - 1; while (l < r) { if (t[l] !== t[r]) return isP(l + 1, r) || isP(l, r - 1) ? "Yes" : "No"; l++; r--; } return "Yes"; },
  (s) => { const t = lines(s)[0]; if (t.length > 500) return null; const p = (x) => x === [...x].reverse().join(""); if (p(t)) return "Yes"; for (let i = 0; i < t.length; i++) if (p(t.slice(0, i) + t.slice(i + 1))) return "Yes"; return "No"; },
  (rng) => ["a", "ab", "abc", "aba", "abca", "abcda", "deeee", "eeeed", "racecars", "abcdefgfedcba", randStr(rng, 40, "ab"), randStr(rng, 400, "ab"), "a".repeat(3000) + "b" + "a".repeat(3000)]);

def("gridBfs",
  (s) => { const L = lines(s); const [r, c] = ints(L[0]); const g = L.slice(1, 1 + r); if (g[0][0] === "#" || g[r - 1][c - 1] === "#") return "-1"; const d = Array.from({ length: r }, () => Array(c).fill(-1)); d[0][0] = 1; const q = [[0, 0]]; for (let h = 0; h < q.length; h++) { const [x, y] = q[h]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < r && ny < c && g[nx][ny] === "." && d[nx][ny] < 0) { d[nx][ny] = d[x][y] + 1; q.push([nx, ny]); } } } return String(d[r - 1][c - 1]); },
  (s) => { const L = lines(s); const [r, c] = ints(L[0]); const g = L.slice(1, 1 + r); if (r * c > 100) return null; if (g[0][0] === "#" || g[r - 1][c - 1] === "#") return "-1"; let dist = Array.from({ length: r }, () => Array(c).fill(Infinity)); dist[0][0] = 1; let ch = true; while (ch) { ch = false; for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) { if (g[i][j] !== ".") continue; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + dx, nj = j + dy; if (ni >= 0 && nj >= 0 && ni < r && nj < c && g[ni][nj] === "." && dist[ni][nj] + 1 < dist[i][j]) { dist[i][j] = dist[ni][nj] + 1; ch = true; } } } } return dist[r - 1][c - 1] === Infinity ? "-1" : String(dist[r - 1][c - 1]); },
  (rng) => { const mk = (r, c, pWall) => { const g = Array.from({ length: r }, () => Array.from({ length: c }, () => (rng() < pWall ? "#" : ".")).join("")); return J(`${r} ${c}`, ...g); }; return [J("1 1", "."), J("1 1", "#"), J("1 3", "..."), J("3 3", "#..", "...", "..."), J("3 3", "...", "###", "..."), J("4 4", "....", ".##.", ".#..", "...."), mk(6, 8, 0.25), mk(9, 9, 0.3), mk(40, 40, 0.2)]; });

def("lcs",
  (s) => { const [a, b] = lines(s); const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0)); for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]); return String(dp[a.length][b.length]); },
  (s) => { const [a, b] = lines(s); if (a.length > 12 || b.length > 12) return null; const memo = new Map(); const f = (i, j) => { const k = i * 20 + j; if (memo.has(k)) return memo.get(k); const r = i === a.length || j === b.length ? 0 : a[i] === b[j] ? 1 + f(i + 1, j + 1) : Math.max(f(i + 1, j), f(i, j + 1)); memo.set(k, r); return r; }; return String(f(0, 0)); },
  (rng) => [J("a", "a"), J("a", "b"), J("abcde", "ace"), J("abc", "def"), J("abcbdab", "bdcaba"), J("aaaa", "aa"), J(randStr(rng, 11, "abc"), randStr(rng, 12, "abc")), J(randStr(rng, 500, "abcd"), randStr(rng, 450, "abcd"))]);

def("boundedRange",
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); const mx = [], mn = []; let l = 0, best = 0; for (let r = 0; r < n; r++) { while (mx.length && a[mx[mx.length - 1]] <= a[r]) mx.pop(); mx.push(r); while (mn.length && a[mn[mn.length - 1]] >= a[r]) mn.pop(); mn.push(r); while (a[mx[0]] - a[mn[0]] > k) { l++; if (mx[0] < l) mx.shift(); if (mn[0] < l) mn.shift(); } best = Math.max(best, r - l + 1); } return String(best); },
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); if (n > 3000) return null; let best = 0; for (let i = 0; i < n; i++) { let lo = a[i], hi = a[i]; for (let j = i; j < n; j++) { lo = Math.min(lo, a[j]); hi = Math.max(hi, a[j]); if (hi - lo > k) break; best = Math.max(best, j - i + 1); } } return String(best); },
  (rng) => [J("1 0", "5"), J("3 0", "4 4 4"), J("3 0", "1 2 3"), J("5 100", "1 2 3 4 5"), J("6 3", "1 4 2 6 5 3"), J("8 2", "10 1 2 4 7 2 5 3"), J("40 5", arr(randArr(rng, 40, 0, 30))), J("2500 10", arr(randArr(rng, 2500, 0, 60)))]);

// ---------- numbers, bits, formatting ----------
def("reverseByte", (s) => { const n = Number(s.trim()); let r = 0; for (let i = 0; i < 8; i++) if (n & (1 << i)) r |= 1 << (7 - i); return String(r); }, (s) => parseInt(Number(s.trim()).toString(2).padStart(8, "0").split("").reverse().join(""), 2).toString(), () => ["0", "1", "2", "13", "128", "170", "255", "100", "37"]);
def("swapNibbles", (s) => { const n = Number(s.trim()); return String(((n & 15) << 4) | (n >> 4)); }, (s) => { const h = Number(s.trim()).toString(16).padStart(2, "0"); return String(parseInt(h[1] + h[0], 16)); }, () => ["0", "1", "15", "16", "26", "100", "170", "240", "255"]);
def("setBitRange", (s) => { let [n, l, r] = s.trim().split(/\s+/).map(BigInt); for (let i = l; i <= r; i++) n |= 1n << (i - 1n); return String(n); }, (s) => { const [n, l, r] = s.trim().split(/\s+/).map(Number); const bits = n.toString(2).padStart(31, "0").split("").reverse(); for (let i = l; i <= r; i++) bits[i - 1] = "1"; return String(parseInt(bits.reverse().join(""), 2)); },
  () => ["0 1 1", "0 2 4", "5 1 1", "8 1 3", "1073741823 5 30", "1 31 31", "1000000 3 12", "0 1 31", "2147483647 7 9"]);
def("singleNumber", (s) => String(na(s).reduce((a, b) => a ^ b, 0)), (s) => { const a = na(s); const c = new Map(); a.forEach((x) => c.set(x, (c.get(x) || 0) + 1)); return String([...c].find(([, v]) => v === 1)[0]); },
  (rng) => { const mk = (pairs) => { const vals = Array.from({ length: pairs }, () => rint(rng, 1, 1000)); const single = 2000 + pairs; const a = [...vals, ...vals, single].sort(() => rng() - 0.5); return J(String(a.length), arr(a)); }; return [J("1", "9"), J("3", "2 2 1"), J("5", "4 1 2 1 2"), mk(5), mk(40), mk(1000)]; });
def("lowestSetBit", (s) => { const n = BigInt(s.trim()); return String(n & -n); }, (s) => { let n = Number(s.trim()); let v = 1; while (!(n & 1)) { n = Math.floor(n / 2); v *= 2; } return String(v); }, () => ["1", "2", "3", "12", "40", "1024", "1000000", "2147483647", "1073741824"]);
def("byteOrder", (s) => { const n = BigInt(s.trim()); return [0n, 8n, 16n, 24n].map((sh) => (n >> sh) & 255n).join(" "); }, (s) => { const h = BigInt(s.trim()).toString(16).padStart(8, "0"); return [6, 4, 2, 0].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" "); }, () => ["0", "1", "255", "256", "65535", "305419896", "4294967295", "16909060", "2882400001"]);
def("flipBit", (s) => { const [n, k] = s.trim().split(/\s+/).map(BigInt); return String(n ^ (1n << (k - 1n))); }, (s) => { const [n, k] = s.trim().split(/\s+/).map(Number); const bits = n.toString(2).padStart(32, "0").split("").reverse(); bits[k - 1] = bits[k - 1] === "1" ? "0" : "1"; return String(parseInt(bits.reverse().join(""), 2)); }, () => ["0 1", "10 3", "7 1", "8 4", "1073741823 30", "5 31", "2147483647 31", "1000000 8", "0 31"]);
def("countSetBits", (s) => String(pop(s.trim())), (s) => String(Number(s.trim()).toString(2).split("").filter((c) => c === "1").length), () => ["0", "1", "2", "13", "255", "1023", "1000000", "2147483647", "1431655765"]);
def("parityBits", (s) => (pop(s.trim()) % 2 ? "Odd" : "Even"), null, () => ["0", "1", "3", "7", "8", "255", "1023", "2147483647", "1431655765"]);
def("hamming", (s) => { const [a, b] = s.trim().split(/\s+/).map(BigInt); return String(pop(a ^ b)); }, (s) => { const [a, b] = s.trim().split(/\s+/).map(Number); const x = a.toString(2).padStart(31, "0"), y = b.toString(2).padStart(31, "0"); let c = 0; for (let i = 0; i < 31; i++) if (x[i] !== y[i]) c++; return String(c); }, () => ["0 0", "1 4", "7 7", "0 2147483647", "255 0", "1000 999", "2147483647 2147483646", "123456789 987654321"]);
def("gcdLcm", (s) => { let [a, b] = s.trim().split(/\s+/).map(BigInt); let x = a, y = b; while (y) [x, y] = [y, x % y]; return `${x} ${(a / x) * b}`; }, (s) => { const [a, b] = s.trim().split(/\s+/).map(Number); if (Math.min(a, b) > 3000) return null; let g = 1; for (let d = 1; d <= Math.min(a, b); d++) if (a % d === 0 && b % d === 0) g = d; return `${g} ${(BigInt(a) / BigInt(g)) * BigInt(b)}`; }, () => ["1 1", "12 18", "7 5", "100 75", "17 13", "36 36", "1000000000 999999999", "999999937 1000000000", "48 180"]);
def("digitSum", (s) => String([...s.trim()].reduce((a, c) => a + Number(c), 0)), null, () => ["0", "9", "10", "12345", "99999", "100000", "9".repeat(100), "1234567890".repeat(10), "7".repeat(37)]);
def("time12to24", (s) => { const m = /^(\d\d):(\d\d):(\d\d)(AM|PM)$/.exec(s.trim()); let h = Number(m[1]) % 12; if (m[4] === "PM") h += 12; return `${String(h).padStart(2, "0")}:${m[2]}:${m[3]}`; }, null, () => ["12:00:00AM", "12:00:00PM", "12:59:59AM", "12:59:59PM", "01:00:00AM", "01:30:15PM", "11:59:59AM", "11:59:59PM", "07:05:45PM", "06:00:00AM"]);
def("fizzbuzz", (s) => { const n = Number(s.trim()); const out = []; for (let i = 1; i <= n; i++) out.push(i % 15 === 0 ? "FizzBuzz" : i % 3 === 0 ? "Fizz" : i % 5 === 0 ? "Buzz" : String(i)); return out.join("\n"); }, null, () => ["1", "2", "3", "5", "10", "15", "16", "30", "100", "1000"]);
def("linearCount", (s) => { const L = lines(s); return String(ints(L[1]).filter((x) => x === Number(L[2])).length); }, null, (rng) => [J("1", "5", "5"), J("1", "5", "4"), J("5", "2 2 2 2 2", "2"), J("6", "1 2 3 4 5 6", "7"), J("7", "-1 0 -1 0 -1 0 -1", "-1"), J("40", arr(randArr(rng, 40, 0, 5)), "3"), J("3000", arr(randArr(rng, 3000, 0, 9)), "7")]);
def("maxOnes", (s) => { let best = 0, cur = 0; for (const x of na(s)) { cur = x === 1 ? cur + 1 : 0; best = Math.max(best, cur); } return String(best); }, (s) => { const runs = na(s).join("").split("0"); return String(Math.max(...runs.map((r) => r.length))); }, (rng) => [J("1", "0"), J("1", "1"), J("4", "1 1 1 1"), J("5", "0 0 0 0 0"), J("8", "1 0 1 1 0 1 1 1"), J("9", "1 1 0 0 1 1 1 0 1"), J("50", arr(randArr(rng, 50, 0, 1))), J("3000", arr(randArr(rng, 3000, 0, 1)))]);
def("lettersDigits", (s) => { const t = s.replace(/\r/g, ""); return `${(t.match(/[A-Za-z]/g) || []).length} ${(t.match(/[0-9]/g) || []).length}`; }, null, () => ["a", "7", "!", "abc123", "Hello, World 2026!", "###", "A1b2C3d4", "x".repeat(50) + "9".repeat(20), "No digits here", "1234567890"]);
def("pyramid", (s) => { const n = Number(s.trim()); const out = []; for (let i = 1; i <= n; i++) out.push(" ".repeat(n - i) + "*".repeat(2 * i - 1)); return out.join("\n"); }, null, () => ["1", "2", "3", "4", "5", "8", "12", "20", "30"], { loose: true, rewriteSamples: true });
def("diagonalSums", (s) => { const L = lines(s); const n = Number(L[0]); const m = L.slice(1, 1 + n).map(ints); let t = 0; for (let i = 0; i < n; i++) { t += m[i][i]; if (i !== n - 1 - i) t += m[i][n - 1 - i]; } return String(t); }, (s) => { const L = lines(s); const n = Number(L[0]); const m = L.slice(1, 1 + n).map(ints); let t = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i === j || i + j === n - 1) t += m[i][j]; return String(t); }, (rng) => { const mk = (n) => J(String(n), ...Array.from({ length: n }, () => arr(randArr(rng, n, -99, 99)))); return [J("1", "5"), mk(2), mk(3), mk(4), mk(5), mk(30)]; });
def("transpose", (s) => { const L = lines(s); const [r, c] = ints(L[0]); const m = L.slice(1, 1 + r).map((x) => x.split(" ")); return Array.from({ length: c }, (_, j) => m.map((row) => row[j]).join(" ")).join("\n"); }, null, (rng) => { const mk = (r, c) => J(`${r} ${c}`, ...Array.from({ length: r }, () => arr(randArr(rng, c, -99, 99)))); return [J("1 1", "5"), mk(1, 5), mk(5, 1), mk(2, 3), mk(4, 4), mk(3, 7), mk(50, 20)]; });
def("missingNumber", (s) => { const L = lines(s); const n = Number(L[0]); return String((n * (n + 1)) / 2 - ints(L[1]).reduce((a, b) => a + b, 0)); }, (s) => { const L = lines(s); const n = Number(L[0]); let x = 0; for (let i = 1; i <= n; i++) x ^= i; ints(L[1]).forEach((v) => { x ^= v; }); return String(x); }, (rng) => { const mk = (n, missing) => J(String(n), arr(Array.from({ length: n }, (_, i) => i + 1).filter((v) => v !== missing).sort(() => rng() - 0.5))); return [J("2", "1"), J("2", "2"), mk(3, 1), mk(5, 5), mk(10, 4), mk(100, 57), mk(5000, 2500)]; });
def("lastStone", (s) => { const a = [...na(s)].sort((x, y) => x - y); while (a.length > 1) { const x = a.pop(), y = a.pop(); if (x !== y) { a.push(x - y); a.sort((p, q) => p - q); } } return String(a.length ? a[0] : 0); }, (s) => { let a = na(s); while (a.length > 1) { a.sort((x, y) => y - x); const d = a[0] - a[1]; a = a.slice(2); if (d) a.push(d); } return String(a.length ? a[0] : 0); }, (rng) => [J("1", "5"), J("2", "3 3"), J("2", "9 4"), J("3", "2 2 2"), J("6", "2 7 4 1 8 1"), J("5", "10 10 10 10 10"), J("20", arr(randArr(rng, 20, 1, 30))), J("400", arr(randArr(rng, 400, 1, 1000)))]);
def("accountBalance", (s) => { const L = lines(s); let bal = Number(L[0]); const n = Number(L[1]); let declined = 0; for (let i = 0; i < n; i++) { const [t, a] = L[2 + i].split(" "); const amt = Number(a); if (t === "D") bal += amt; else if (amt > bal) declined++; else bal -= amt; } return declined ? `${bal}\n${Array(declined).fill("DECLINED").join(" ")}` : String(bal); }, null, () => [J("0", "1", "D 5"), J("10", "1", "W 10"), J("10", "1", "W 11"), J("100", "3", "D 50", "W 500", "W 20"), J("50", "4", "W 20", "D 5", "W 30", "D 1"), J("1000", "5", "W 100", "W 200", "D 50", "W 300", "W 350"), J("5", "3", "W 5", "D 10", "W 3")]);
def("filterApi", (s) => { const L = lines(s); const n = Number(L[0]); const [fm, fs] = L[n + 1].split(" "); const out = []; for (let i = 1; i <= n; i++) { const [m, p, st] = L[i].split(" "); if (m === fm && st === fs) out.push(p); } return out.length ? out.join(" ") : "NONE"; }, null, () => [J("1", "GET /a 200", "GET 200"), J("1", "GET /a 200", "POST 200"), J("3", "GET /a 200", "POST /b 500", "GET /c 200", "GET 200"), J("4", "GET /x 404", "GET /y 404", "GET /z 200", "GET /x 404", "GET 404"), J("2", "DELETE /u/1 204", "DELETE /u/2 500", "DELETE 500"), J("5", "PUT /a 200", "PUT /b 200", "GET /c 200", "PUT /d 201", "PUT /e 200", "PUT 200")]);

// ---------- question id -> problem ----------
// Not generated on purpose: GOO-SWE-R3-001 and ZOH-SD-R3-004 ("count coin combinations") have sample outputs copied from the minimum-coins problem
// (3 and -1 for coins 1,2,5 / amount 11 and coin 2 / amount 3), which contradict their own statement. They stay pending until the samples are corrected.
Object.assign(MAP, {
  "ADB-MTS-R1-001": "pairUnsorted", "ADB-MTS-R1-002": "groupAnagrams", "ADB-MTS-R1-003": "subarraySumK", "ADB-MTS-R1-004": "sort012", "ADB-MTS-R1-005": "reverseList",
  "ADB-MTS-R1-006": "treeDiameter", "ADB-MTS-R1-008": "binarySearch", "ADB-MTS-R5-001": "maxSubarray", "ADB-MTS-R5-002": "patternCount", "ADB-MTS-R4-001": "nextGreater",
  "AMZ-SDE1-R1-001": "topKFrequent", "AMZ-SDE1-R1-002": "slidingMax", "AMZ-SDE1-R1-003": "trappingWater", "AMZ-SDE1-R1-004": "meetingRooms", "AMZ-SDE1-R1-005": "wordBreak",
  "AMZ-SDE1-R1-006": "editDistance", "AMZ-SDE1-R1-007": "courseSchedule", "AMZ-SDE1-R1-008": "productExceptSelf", "AMZ-SDE1-R1-009": "mergeIntervals", "AMZ-SDE1-R1-010": "kthLargest",
  "AMZ-SDE1-R2-001": "rotatedSearch", "AMZ-SDE1-R2-002": "circularMaxSubarray", "AMZ-SDE1-R2-003": "houseRobber", "AMZ-SDE1-R2-004": "lru", "AMZ-SDE1-R3-001": "matchingEndpoints",
  "AMZ-SDE1-R3-002": "islands", "AMZ-SDE1-R3-003": "shortestPaths", "AMZ-SDE1-R3-004": "equalPartition", "AMZ-SDE1-R4-001": "lca",
  "CSC-SE-R1-012": "courseSchedule", "CSC-SE-R1-013": "coinChange", "CSC-SE-R1-014": "lcs", "CSC-SE-R1-017": "boundedRange", "CSC-SE-R1-018": "gridBfs", "CSC-SE-R1-019": "kthLargest",
  "CSC-SE-R1-020": "mergeIntervals", "CSC-SE-R2-012": "lswrc",
  "DLT-SWE-R1-013": "lettersDigits", "DLT-SWE-R1-014": "vowelsConsonants", "DLT-SWE-R1-015": "fizzbuzz", "DLT-SWE-R2-001": "linearCount", "DLT-SWE-R2-003": "reverseList", "DLT-SWE-R2-004": "maxOnes",
  "GS-SWE-R1-001": "bestTime", "GS-SWE-R1-002": "firstMissingPositive", "GS-SWE-R1-003": "lswrc", "GS-SWE-R2-001": "cycleLength", "GS-SWE-R2-002": "maxCoinsGrid", "GS-SWE-R2-003": "islands",
  "GS-SWE-R2-004": "trimPalindrome", "GS-SWE-R2-005": "koko", "GS-SWE-R2-006": "coinChange", "GS-SWE-R2-008": "containerWater", "GS-SWE-R2-009": "candy", "GS-SWE-R2-010": "stockMany",
  "GS-SWE-R3-013": "groupTransactions",
  "GOO-SWE-R1-003": "inversionCount", "GOO-SWE-R1-005": "rotateMatrix", "GOO-SWE-R2-003": "boundedRange", "GOO-SWE-R2-004": "courseSchedule", "GOO-SWE-R2-006": "knapsack",
  "GOO-SWE-R3-003": "trappingWater", "GOO-SWE-R3-004": "meetingRooms", "GOO-SWE-R3-005": "lru", "GOO-STEP-R2-005": "validPalindromeOne", "GOO-STEP-R3-004": "islands",
  "GOO-STEP-R4-001": "minWindow", "GOO-STEP-R4-003": "spiral",
  "IBM-ASE-R4-006": "palindrome", "IBM-ASE-R4-007": "secondLargestDistinct",
  "INT-EMB-R2-001": "reverseByte", "INT-EMB-R2-002": "swapNibbles", "INT-EMB-R2-003": "setBitRange", "INT-EMB-R2-004": "singleNumber", "INT-EMB-R2-005": "lowestSetBit", "INT-EMB-R2-006": "byteOrder",
  "INT-GTI-R2-001": "flipBit", "INT-GTI-R2-002": "countSetBits",
  "JPM-SWE-R1-001": "filterApi", "JPM-SWE-R2-001": "lru", "JPM-SWE-R2-002": "pairUnsorted", "JPM-SWE-R2-003": "balancedBrackets", "JPM-SWE-R3-001": "accountBalance", "JPM-SWE-R3-003": "rotateRight",
  "MSF-SDE-R2-003": "houseRobber", "MSF-SDE-R4-007": "minWindow",
  "NVD-SWE-R1-012": "lastStone", "NVD-SWE-R2-001": "hamming", "NVD-SWE-R2-002": "powerOfTwo", "NVD-SWE-R2-003": "missingNumber", "NVD-SWE-R3-012": "transpose", "NVD-SWE-R3-013": "knapsack",
  "ORA-ASD-R2-009": "anagram", "ORA-ASD-R2-010": "gcdLcm", "ORA-ASD-R4-007": "groupAnagrams",
  "QCM-SWE-R2-009": "missingNumber", "QCM-SWE-R3-003": "swapNibbles", "QCM-SWE-R3-004": "digitSum", "QCM-VAL-R1-004": "parityBits", "QCM-VAL-R3-001": "setBitRange",
  "SAP-AD-R3-002": "time12to24", "SAP-AD-R1-008": "reverseList", "SAP-AD-R1-009": "moveZeros", "SAP-AD-R3-004": "houseRobber",
  "ZOH-SD-R2-001": "armstrong", "ZOH-SD-R2-002": "perfectNumber", "ZOH-SD-R2-006": "charFrequency", "ZOH-SD-R2-007": "pyramid", "ZOH-SD-R2-010": "diagonalSums",
});
// Armstrong is defined here for 1 <= n; the shared family also probes 0, which this question excludes.
base.EXCLUDE["ZOH-SD-R2-001"] = ["0"];
