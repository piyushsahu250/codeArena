// Hidden test cases for the coding questions imported from the company research files.
//
// For each problem there is (a) a reference solution `ref(input) -> output`, (b) for the non-trivial ones an independent, deliberately naive
// `brute(input) -> output`, and (c) `tests(rng)`: the inputs. Expected outputs are NEVER typed by hand: they are produced by `ref`, and the
// pipeline refuses to continue unless `ref` reproduces both visible samples of the question exactly and `brute` (when present) agrees with `ref`
// on every generated input. Inputs avoid cases the problem statement leaves ambiguous (ties, duplicate answers, blank lines).
//
// buildHiddenTests(key) is deterministic, so re-running produces identical tests.

const J = (...lines) => lines.join("\n");
const arr = (a) => a.join(" ");
const ints = (s) => (s.trim() === "" ? [] : s.trim().split(/\s+/).map(Number));
const lines = (s) => s.split("\n");

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rint = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const randArr = (rng, n, lo, hi) => Array.from({ length: n }, () => rint(rng, lo, hi));
const randStr = (rng, n, alphabet) => Array.from({ length: n }, () => alphabet[rint(rng, 0, alphabet.length - 1)]).join("");
const sortedDistinct = (rng, n, lo, hi) => [...new Set(randArr(rng, n * 3, lo, hi))].sort((a, b) => a - b).slice(0, n);
const mat = (m) => m.map((r) => arr(r)).join("\n");
const randMat = (rng, r, c, lo, hi) => Array.from({ length: r }, () => randArr(rng, c, lo, hi));

const P = {};
const def = (key, ref, brute, tests) => { P[key] = { ref, brute, tests }; };

// ---------- matrices ----------
const parseMat = (s) => { const L = lines(s); const [r, c] = ints(L[0]); return { r, c, m: L.slice(1, 1 + r).map(ints) }; };
def("rowColSum",
  (s) => { const { r, c, m } = parseMat(s); let br = -Infinity, bc = -Infinity; for (let i = 0; i < r; i++) br = Math.max(br, m[i].reduce((x, y) => x + y, 0)); for (let j = 0; j < c; j++) { let t = 0; for (let i = 0; i < r; i++) t += m[i][j]; bc = Math.max(bc, t); } return String(br + bc); },
  (s) => { const { r, c, m } = parseMat(s); const rows = m.map((x) => x.reduce((a, b) => a + b, 0)); const cols = Array.from({ length: c }, (_, j) => m.reduce((a, row) => a + row[j], 0)); return String(rows.sort((a, b) => b - a)[0] + cols.sort((a, b) => b - a)[0]); },
  (rng) => [J("1 1", "-5"), J("1 4", "3 -1 2 8"), J("4 1", "1", "-2", "7", "0"), J("3 3", "-1 -2 -3", "-4 -5 -6", "-7 -8 -9"), J("2 2", "1000000 1000000", "1000000 1000000"), J("3 4", mat(randMat(rng, 3, 4, -9, 9))), J("40 40", mat(randMat(rng, 40, 40, -1000, 1000)))]);

def("spiral",
  (s) => { const { r, c, m } = parseMat(s); const out = []; let t = 0, b = r - 1, l = 0, rt = c - 1; while (t <= b && l <= rt) { for (let j = l; j <= rt; j++) out.push(m[t][j]); t++; for (let i = t; i <= b; i++) out.push(m[i][rt]); rt--; if (t <= b) { for (let j = rt; j >= l; j--) out.push(m[b][j]); b--; } if (l <= rt) { for (let i = b; i >= t; i--) out.push(m[i][l]); l++; } } return arr(out); },
  (s) => { const { r, c, m } = parseMat(s); const seen = Array.from({ length: r }, () => Array(c).fill(false)); const dr = [0, 1, 0, -1], dc = [1, 0, -1, 0]; let i = 0, j = 0, d = 0; const out = []; for (let k = 0; k < r * c; k++) { out.push(m[i][j]); seen[i][j] = true; let ni = i + dr[d], nj = j + dc[d]; if (ni < 0 || nj < 0 || ni >= r || nj >= c || seen[ni][nj]) { d = (d + 1) % 4; ni = i + dr[d]; nj = j + dc[d]; } i = ni; j = nj; } return arr(out); },
  (rng) => [J("1 1", "9"), J("1 5", "1 2 3 4 5"), J("5 1", "1", "2", "3", "4", "5"), J("3 4", mat(randMat(rng, 3, 4, 0, 99))), J("4 3", mat(randMat(rng, 4, 3, 0, 99))), J("5 5", mat(randMat(rng, 5, 5, -50, 50))), J("2 2", "1 2", "3 4"), J("30 17", mat(randMat(rng, 30, 17, 0, 9)))]);

// ---------- number theory / math ----------
def("derangements",
  (s) => { const n = Number(s.trim()); let a = 1n, b = 0n; if (n === 0) return "1"; for (let i = 2; i <= n; i++) { const c = BigInt(i - 1) * (a + b); a = b; b = c; } return String(b); },
  (s) => { const n = Number(s.trim()); if (n > 8) return null; let cnt = 0; const p = Array.from({ length: n }, (_, i) => i); const rec = (k, used) => { if (k === n) { cnt++; return; } for (let v = 0; v < n; v++) if (!used[v] && v !== k) { used[v] = true; rec(k + 1, used); used[v] = false; } }; rec(0, []); return String(cnt); },
  () => ["0", "1", "2", "3", "6", "8", "12", "20"].map(String));

def("perfectNumber",
  (s) => { const n = Number(s.trim()); let sum = n === 1 ? 0 : 1; for (let d = 2; d * d <= n; d++) if (n % d === 0) { sum += d; if (d !== n / d) sum += n / d; } return sum === n && n > 1 ? "Yes" : "No"; },
  (s) => { const n = Number(s.trim()); if (n > 20000) return null; let sum = 0; for (let d = 1; d < n; d++) if (n % d === 0) sum += d; return sum === n ? "Yes" : "No"; },
  () => ["1", "2", "6", "28", "496", "8128", "27", "33550336", "999999999", "1000000000"]);

def("reverseDigits",
  (s) => { const n = s.trim(); const neg = n.startsWith("-"); const body = neg ? n.slice(1) : n; const r = BigInt(body.split("").reverse().join("") || "0"); return (neg && r !== 0n ? "-" : "") + String(r); },
  null,
  () => ["0", "7", "-7", "1000000000", "-1000000000", "123456789", "-987654321", "10", "100"]);

def("armstrong",
  (s) => { const t = s.trim(); const k = t.length; let sum = 0n; for (const ch of t) sum += BigInt(ch) ** BigInt(k); return sum === BigInt(t) ? "Yes" : "No"; },
  null,
  () => ["0", "5", "10", "153", "370", "371", "407", "1634", "9474", "9926315", "100", "999999999"]);

def("factorial",
  (s) => { let f = 1n; for (let i = 2n; i <= BigInt(s.trim()); i++) f *= i; return String(f); },
  null,
  () => ["0", "1", "2", "10", "13", "19", "20"]);

def("sieveCount",
  (s) => { const n = Number(s.trim()); if (n < 2) return "0"; const sv = new Uint8Array(n + 1); let c = 0; for (let i = 2; i <= n; i++) { if (!sv[i]) { c++; for (let j = i * i; j <= n; j += i) sv[j] = 1; } } return String(c); },
  (s) => { const n = Number(s.trim()); if (n > 3000) return null; let c = 0; for (let i = 2; i <= n; i++) { let p = true; for (let d = 2; d * d <= i; d++) if (i % d === 0) { p = false; break; } if (p) c++; } return String(c); },
  () => ["1", "2", "3", "100", "1000", "2999", "1000000", "10000000"]);

const isPrime = (n) => { if (n < 2) return false; if (n < 4) return true; if (n % 2 === 0) return false; for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false; return true; };
def("primeCheck",
  (s) => (isPrime(Number(s.trim())) ? "Yes" : "No"),
  (s) => { const n = Number(s.trim()); if (n > 5000) return null; let c = 0; for (let d = 1; d <= n; d++) if (n % d === 0) c++; return c === 2 ? "Yes" : "No"; },
  () => ["1", "2", "3", "4", "97", "1000", "62710561", "999999937", "999999999", "1000000000"]);

def("gcd",
  (s) => { let [a, b] = ints(s); while (b) [a, b] = [b, a % b]; return String(a); },
  (s) => { const [a, b] = ints(s); if (Math.min(a, b) > 2000) return null; let g = 1; for (let d = 1; d <= Math.min(a, b); d++) if (a % d === 0 && b % d === 0) g = d; return String(g); },
  () => ["1 1", "12 12", "100 75", "7 49", "17 13", "1000000000 500000000", "999999937 999999929", "270 192", "1 1000000000"]);

def("powerOfTwo",
  (s) => { const n = BigInt(s.trim()); return n > 0n && (n & (n - 1n)) === 0n ? "Yes" : "No"; },
  null,
  () => ["0", "1", "2", "3", "1024", "1023", "576460752303423488", "576460752303423487", "1000000000000000000"]);

def("fibSeries",
  (s) => { const n = Number(s.trim()); const out = []; let a = 0n, b = 1n; for (let i = 0; i < n; i++) { out.push(String(a)); [a, b] = [b, a + b]; } return arr(out); },
  null,
  () => ["1", "2", "3", "10", "20", "30"]);

def("fibNumber",
  (s) => { const n = Number(s.trim()); let a = 0n, b = 1n; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return String(a); },
  null,
  () => ["0", "1", "2", "3", "20", "50", "89", "90"]);

def("numberTriangle",
  (s) => { const n = Number(s.trim()); const out = []; for (let i = 1; i <= n; i++) out.push(arr(Array.from({ length: i }, (_, k) => k + 1))); return out.join("\n"); },
  null,
  () => ["1", "2", "4", "10", "20"]);

// ---------- arrays: simple ----------
const na = (s) => { const L = lines(s); return ints(L[1]); };
def("sortByFrequency",
  (s) => { const a = na(s); const f = new Map(); a.forEach((x) => f.set(x, (f.get(x) || 0) + 1)); return arr([...a].sort((x, y) => f.get(y) - f.get(x) || x - y)); },
  (s) => { const a = na(s); const out = []; const vals = [...new Set(a)]; const cnt = (v) => a.filter((x) => x === v).length; while (vals.length) { let best = 0; for (let i = 1; i < vals.length; i++) { const ci = cnt(vals[i]), cb = cnt(vals[best]); if (ci > cb || (ci === cb && vals[i] < vals[best])) best = i; } const v = vals.splice(best, 1)[0]; for (let k = cnt(v); k > 0; k--) out.push(v); } return arr(out); },
  (rng) => [J("1", "5"), J("4", "7 7 7 7"), J("6", "1 2 3 4 5 6"), J("8", "-1 -1 2 2 3 -3 3 -3"), J("10", arr(randArr(rng, 10, -3, 3))), J("200", arr(randArr(rng, 200, -20, 20)))]);

def("moveZeros",
  (s) => { const a = na(s); return arr([...a.filter((x) => x !== 0), ...a.filter((x) => x === 0)]); },
  null,
  (rng) => [J("1", "0"), J("1", "5"), J("5", "1 2 3 4 5"), J("6", "0 0 1 0 0 2"), J("7", "-1 0 -2 0 -3 0 0"), J("12", arr(randArr(rng, 12, -2, 2))), J("3000", arr(randArr(rng, 3000, -1, 1)))]);

const secondDistinct = (a) => { const v = [...new Set(a)].sort((x, y) => y - x); return v.length > 1 ? v[1] : null; };
def("secondLargestDistinct",
  (s) => { const v = secondDistinct(na(s)); return v === null ? "-1" : String(v); },
  (s) => { const a = na(s); let m1 = -Infinity; a.forEach((x) => { if (x > m1) m1 = x; }); let m2 = -Infinity; a.forEach((x) => { if (x < m1 && x > m2) m2 = x; }); return m2 === -Infinity ? "-1" : String(m2); },
  (rng) => [J("1", "5"), J("2", "3 3"), J("2", "3 4"), J("5", "-5 -1 -1 -9 -3"), J("6", "100 100 99 99 98 98"), J("4", "1000000000 -1000000000 0 1000000000"), J("300", arr(randArr(rng, 300, -50, 50)))]);

def("secondLargestWithIndex",
  (s) => { const a = na(s); const v = secondDistinct(a); return v === null ? "-1" : `${v} ${a.indexOf(v) + 1}`; },
  null,
  (rng) => [J("1", "5"), J("2", "1 2"), J("5", "5 5 5 5 5"), J("6", "9 8 8 7 7 9"), J("7", "-1 -2 -3 -2 -1 -4 -3"), J("8", "3 9 9 4 9 4 3 2"), J("200", arr(randArr(rng, 200, -30, 30)))]);

def("leaders",
  (s) => { const a = na(s); const out = []; let mx = -Infinity; for (let i = a.length - 1; i >= 0; i--) if (a[i] > mx) { out.push(a[i]); mx = a[i]; } return arr(out.reverse()); },
  (s) => { const a = na(s); const out = []; for (let i = 0; i < a.length; i++) { let ok = true; for (let j = i + 1; j < a.length; j++) if (a[j] >= a[i]) { ok = false; break; } if (ok) out.push(a[i]); } return arr(out); },
  (rng) => [J("1", "7"), J("5", "5 4 3 2 1"), J("5", "1 2 3 4 5"), J("7", "10 22 12 3 0 6 -1"), J("6", "-5 -4 -3 -9 -7 -8"), J("1000", arr(sortedDistinct(rng, 1000, -100000, 100000).reverse())), J("40", arr([...new Set(randArr(rng, 80, -500, 500))].slice(0, 40)))]);

def("evenOdd",
  (s) => { const a = na(s); const e = a.filter((x) => x % 2 === 0).length; return `${e} ${a.length - e}`; },
  null,
  (rng) => [J("1", "0"), J("1", "-7"), J("4", "2 4 6 8"), J("4", "1 3 5 7"), J("6", "-1 -2 -3 -4 0 0"), J("9", arr(randArr(rng, 9, -100, 100))), J("2000", arr(randArr(rng, 2000, -1000000000, 1000000000)))]);

def("rotateRight",
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); const r = k % n; return arr(r === 0 ? a : [...a.slice(n - r), ...a.slice(0, n - r)]); },
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); let a = ints(L[1]); const r = k % n; for (let t = 0; t < r; t++) a = [a[a.length - 1], ...a.slice(0, -1)]; return arr(a); },
  (rng) => [J("1 0", "5"), J("1 1000000000", "5"), J("5 0", "1 2 3 4 5"), J("5 5", "1 2 3 4 5"), J("5 7", "1 2 3 4 5"), J("6 1", "-1 -2 -3 -4 -5 -6"), J("8 1000000000", arr(randArr(rng, 8, -9, 9))), J("500 123456789", arr(randArr(rng, 500, -99, 99)))]);

// ---------- arrays: pairs, sums ----------
def("countPairsSum",
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); const f = new Map(); let c = 0; for (const x of a) { c += f.get(k - x) || 0; f.set(x, (f.get(x) || 0) + 1); } return String(c); },
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); if (a.length > 2500) return null; let c = 0; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (a[i] + a[j] === k) c++; return String(c); },
  (rng) => [J("1 5", "5"), J("2 0", "0 0"), J("4 10", "1 2 3 4"), J("6 0", "1 -1 1 -1 0 0"), J("5 2000000000", "1000000000 1000000000 1000000000 5 6"), J("10 7", arr(randArr(rng, 10, 0, 7))), J("2000 10", arr(randArr(rng, 2000, 0, 10)))]);

const pairSortedUnique = (s) => { const L = lines(s); const a = ints(L[1]); const t = Number(L[2]); let i = 0, j = a.length - 1; while (i < j) { const x = a[i] + a[j]; if (x === t) return `${i + 1} ${j + 1}`; if (x < t) i++; else j--; } return "-1"; };
const pairCount = (a, t) => { let c = 0; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (a[i] + a[j] === t) c++; return c; };
const bruteFirstPair = (s, bySorted) => { const L = lines(s); const a = ints(L[1]); const t = Number(L[2]); if (a.length > 3000) return null; if (pairCount(a, t) > 1) throw new Error("ambiguous pair test generated"); for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (a[i] + a[j] === t) return `${i + 1} ${j + 1}`; return "-1"; };
// a sorted distinct array with exactly one pair summing to t (or none)
const uniquePairCase = (rng, n, wantPair) => {
  for (let attempt = 0; attempt < 500; attempt++) {
    const a = sortedDistinct(rng, n, -1000000000, 1000000000); if (a.length < 2) continue;
    const t = wantPair ? a[rint(rng, 0, a.length - 1)] + a[rint(rng, 0, a.length - 1)] : 4000000000;
    const c = pairCount(a, t); if ((wantPair && c === 1) || (!wantPair && c === 0)) return J(String(a.length), arr(a), String(t));
  }
  throw new Error("could not build unique pair case");
};
def("pairSorted", pairSortedUnique, (s) => bruteFirstPair(s, true),
  (rng) => [J("2", "1 2", "3"), J("2", "1 2", "4"), J("5", "-10 -4 0 3 9", "-7"), J("5", "-10 -4 0 3 9", "-14"), J("6", "1 3 5 7 9 11", "20"), uniquePairCase(rng, 12, true), uniquePairCase(rng, 12, false), uniquePairCase(rng, 800, true)]);

const pairUnsortedFirst = (s) => { const L = lines(s); const a = ints(L[1]); const t = Number(L[2]); const seen = new Map(); for (let j = 0; j < a.length; j++) { if (seen.has(t - a[j])) return `${seen.get(t - a[j]) + 1} ${j + 1}`; if (!seen.has(a[j])) seen.set(a[j], j); } return "-1"; };
const uniquePairUnsorted = (rng, n, wantPair) => {
  for (let attempt = 0; attempt < 500; attempt++) {
    const a = randArr(rng, n, -1000000000, 1000000000);
    const t = wantPair ? a[rint(rng, 0, n - 1)] + a[rint(rng, 0, n - 1)] : 4000000000;
    const c = pairCount(a, t); if ((wantPair && c === 1) || (!wantPair && c === 0)) return J(String(n), arr(a), String(t));
  }
  throw new Error("could not build unique unsorted pair case");
};
def("pairUnsorted", pairUnsortedFirst, (s) => bruteFirstPair(s, false),
  (rng) => [J("2", "5 -5", "0"), J("2", "5 5", "11"), J("4", "3 1 4 2", "6"), J("5", "-3 8 11 -8 20", "0"), J("6", "10 20 30 40 50 60", "1"), uniquePairUnsorted(rng, 15, true), uniquePairUnsorted(rng, 15, false), uniquePairUnsorted(rng, 600, true)]);

def("maxSubarray",
  (s) => { const a = na(s); let best = -Infinity, cur = 0; for (const x of a) { cur = Math.max(x, cur + x); best = Math.max(best, cur); } return String(best); },
  (s) => { const a = na(s); if (a.length > 3000) return null; let best = -Infinity; for (let i = 0; i < a.length; i++) { let sm = 0; for (let j = i; j < a.length; j++) { sm += a[j]; if (sm > best) best = sm; } } return String(best); },
  (rng) => [J("1", "-8"), J("1", "8"), J("4", "-1 -2 -3 -4"), J("5", "1 2 3 4 5"), J("7", "5 -9 6 -2 3 -1 4"), J("6", "-1000000000 5 -1000000000 6 -1000000000 7"), J("30", arr(randArr(rng, 30, -20, 20))), J("2500", arr(randArr(rng, 2500, -100, 100)))]);

def("subarraySumK",
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); const f = new Map([[0, 1]]); let p = 0, c = 0; for (const x of a) { p += x; c += f.get(p - k) || 0; f.set(p, (f.get(p) || 0) + 1); } return String(c); },
  (s) => { const L = lines(s); const [n, k] = ints(L[0]); const a = ints(L[1]); if (a.length > 3000) return null; let c = 0; for (let i = 0; i < a.length; i++) { let sm = 0; for (let j = i; j < a.length; j++) { sm += a[j]; if (sm === k) c++; } } return String(c); },
  (rng) => [J("1 0", "0"), J("1 5", "5"), J("4 0", "0 0 0 0"), J("5 -3", "-1 -1 -1 2 -1"), J("6 3", "1 -1 3 0 0 3"), J("5 1000000000", "1 2 3 4 5"), J("12 5", arr(randArr(rng, 12, -3, 5))), J("2500 7", arr(randArr(rng, 2500, -5, 5)))]);


def("mergeSorted",
  (s) => { const L = lines(s); return arr([...ints(L[1]), ...ints(L[2])].sort((x, y) => x - y)); },
  (s) => { const L = lines(s); const A = ints(L[1]), B = ints(L[2]); const out = []; let i = 0, j = 0; while (i < A.length || j < B.length) { if (j >= B.length || (i < A.length && A[i] <= B[j])) out.push(A[i++]); else out.push(B[j++]); } return arr(out); },
  (rng) => [J("1 1", "1", "2"), J("1 1", "5", "5"), J("3 2", "-5 0 5", "-5 -4"), J("2 4", "10 11", "1 2 3 4"), J("4 4", "1 2 3 4", "5 6 7 8"), J("4 4", "5 6 7 8", "1 2 3 4"), (() => { const A = randArr(rng, 20, -50, 50).sort((x, y) => x - y), B = randArr(rng, 17, -50, 50).sort((x, y) => x - y); return J("20 17", arr(A), arr(B)); })(), (() => { const A = randArr(rng, 2000, -1e6, 1e6).sort((x, y) => x - y), B = randArr(rng, 2500, -1e6, 1e6).sort((x, y) => x - y); return J("2000 2500", arr(A), arr(B)); })()]);

def("binarySearch",
  (s) => { const L = lines(s); const a = ints(L[1]); const t = Number(L[2]); let lo = 0, hi = a.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] === t) return String(m); if (a[m] < t) lo = m + 1; else hi = m - 1; } return "-1"; },
  (s) => { const L = lines(s); const a = ints(L[1]); const t = Number(L[2]); return String(a.indexOf(t)); },
  (rng) => { const big = sortedDistinct(rng, 3000, -1e6, 1e6); return [J("1", "5", "5"), J("1", "5", "4"), J("2", "1 3", "3"), J("2", "1 3", "0"), J("7", "-9 -5 -1 0 4 8 12", "-9"), J("7", "-9 -5 -1 0 4 8 12", "12"), J("7", "-9 -5 -1 0 4 8 12", "5"), J(String(big.length), arr(big), String(big[1234])), J(String(big.length), arr(big), "2000000")]; });


def("kDistinct",
  (s) => { const L = lines(s); const str = L[0]; const k = Number(L[1]); const cnt = new Map(); let l = 0, best = 0; for (let r = 0; r < str.length; r++) { cnt.set(str[r], (cnt.get(str[r]) || 0) + 1); while (cnt.size > k) { const c = cnt.get(str[l]) - 1; if (c === 0) cnt.delete(str[l]); else cnt.set(str[l], c); l++; } best = Math.max(best, r - l + 1); } return String(best); },
  (s) => { const L = lines(s); const str = L[0]; const k = Number(L[1]); if (str.length > 3000) return null; let best = 0; for (let i = 0; i < str.length; i++) { const set = new Set(); for (let j = i; j < str.length; j++) { set.add(str[j]); if (set.size > k) break; best = Math.max(best, j - i + 1); } } return String(best); },
  (rng) => [J("a", "1"), J("abcdef", "26"), J("abcdef", "1"), J("aabbcc", "2"), J("abaccc", "2"), J(randStr(rng, 40, "abcd"), "3"), J(randStr(rng, 2500, "abcdefg"), "4")]);

const lswrc = (s) => { const str = lines(s)[0]; const last = new Map(); let l = 0, best = 0; for (let r = 0; r < str.length; r++) { if (last.has(str[r]) && last.get(str[r]) >= l) l = last.get(str[r]) + 1; last.set(str[r], r); best = Math.max(best, r - l + 1); } return String(best); };
const lswrcBrute = (s) => { const str = lines(s)[0]; if (str.length > 3000) return null; let best = 0; for (let i = 0; i < str.length; i++) { const set = new Set(); for (let j = i; j < str.length; j++) { if (set.has(str[j])) break; set.add(str[j]); best = Math.max(best, j - i + 1); } } return String(best); };
def("lswrc", lswrc, lswrcBrute,
  (rng) => ["a", "ab", "aa", "pwwkew", "dvdf", "abba", "abcdefghijklmnopqrstuvwxyz", randStr(rng, 60, "abcde"), randStr(rng, 2500, "abcdefghijklmnopqrstuvwxyz0123456789")]);

// ---------- strings ----------
def("countVowels",
  (s) => String([...s].filter((c) => "aeiouAEIOU".includes(c)).length),
  null,
  () => ["a", "bcdfg", "AEIOU aeiou", "Programming Language 2026!", "Why? Rhythm, myth, and gym.", "The quick brown fox jumps over the lazy dog"]);

def("vowelsConsonants",
  (s) => { let v = 0, c = 0; for (const ch of s) { if (/[a-zA-Z]/.test(ch)) { if ("aeiouAEIOU".includes(ch)) v++; else c++; } } return `${v} ${c}`; },
  null,
  () => ["a", "z", "AEIOU aeiou", "12345 !@#", "Why do we fall, Master Wayne?", "Hello World", "The Quick Brown Fox Jumps Over The Lazy Dog"]);

def("anagram",
  (s) => { const [a, b] = lines(s); return [...a].sort().join("") === [...b].sort().join("") ? "Yes" : "No"; },
  (s) => { const [a, b] = lines(s); if (a.length !== b.length) return "No"; const cnt = {}; for (const c of a) cnt[c] = (cnt[c] || 0) + 1; for (const c of b) { if (!cnt[c]) return "No"; cnt[c]--; } return "Yes"; },
  (rng) => [J("a", "a"), J("a", "b"), J("ab", "abc"), J("aabb", "abab"), J("aabb", "aabc"), J("racecar", "carrace"), J("abcdefghijklmnopqrstuvwxyz", "zyxwvutsrqponmlkjihgfedcba"), (() => { const a = randStr(rng, 3000, "abcdefg"); return J(a, [...a].reverse().join("")); })(), (() => { const a = randStr(rng, 3000, "abcdefg"); return J(a, a.slice(0, 2999) + (a[2999] === "a" ? "b" : "a")); })()]);

const firstNonRep = (s) => { const t = lines(s)[0]; const f = {}; for (const c of t) f[c] = (f[c] || 0) + 1; for (let i = 0; i < t.length; i++) if (f[t[i]] === 1) return String(i); return "-1"; };
def("firstNonRepeating", firstNonRep,
  (s) => { const t = lines(s)[0]; for (let i = 0; i < t.length; i++) { let ok = true; for (let j = 0; j < t.length; j++) if (j !== i && t[j] === t[i]) { ok = false; break; } if (ok) return String(i); } return "-1"; },
  (rng) => ["a", "aa", "ab", "aabbccd", "dabbcc", "loveleetcode", "abcabc", "zzzzzzzzzzzzzzzzzzzzy", randStr(rng, 1000, "abcdefghijklmnopqrstuvwxyz")]);

def("palindrome",
  (s) => { const t = s.toLowerCase().replace(/[^a-z0-9]/g, ""); return t === [...t].reverse().join("") ? "Yes" : "No"; },
  (s) => { const t = [...s.toLowerCase()].filter((c) => /[a-z0-9]/.test(c)); for (let i = 0, j = t.length - 1; i < j; i++, j--) if (t[i] !== t[j]) return "No"; return "Yes"; },
  () => ["a", "ab", "aba", "Was it a car or a cat I saw?", "No 'x' in Nixon", "Madam, I'm Adam", "0P", "12321", "12345", "Never odd or even", "Hello, World!"]);

def("reverseEachWord",
  (s) => s.split(" ").map((w) => [...w].reverse().join("")).join(" "),
  null,
  () => ["a", "abc", "hello", "one two three", "madam racecar level", "Reverse EACH word 2026", "x y z"]);

def("reverseText",
  (s) => [...s].reverse().join(""),
  null,
  () => ["a", "ab", "hello world", "Level 12321", "TCS Ninja 2026!", "a b c d e", "The quick brown fox", "!@#$%^&*()"]);

def("removeDupTokens",
  (s) => { const L = lines(s); const seen = new Set(); const out = []; for (const t of L[1].trim().split(/\s+/)) if (!seen.has(t)) { seen.add(t); out.push(t); } return arr(out); },
  null,
  (rng) => [J("1", "x"), J("4", "a a a a"), J("5", "a b c d e"), J("8", "b a b c a d c e"), J("6", "10 01 10 1 01 1"), J("10", arr(randArr(rng, 10, 1, 4))), J("3000", arr(randArr(rng, 3000, 1, 500)))]);

def("removeDupChars",
  (s) => { const seen = new Set(); let out = ""; for (const c of lines(s)[0]) if (!seen.has(c)) { seen.add(c); out += c; } return out; },
  null,
  (rng) => ["a", "aaaa", "abcdef", "aAbBaA", "mississippi", "abcabcabc", "Hello,World!", randStr(rng, 1000, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")]);

def("removeDupWords",
  (s) => { const seen = new Set(); const out = []; for (const w of s.split(" ")) if (!seen.has(w)) { seen.add(w); out.push(w); } return out.join(" "); },
  null,
  () => ["a", "a b", "a a", "red green red blue green", "The the THE the", "one two three four five", "x y x y x y z"]);

def("charFrequency",
  (s) => { const t = lines(s)[0]; const f = new Map(); for (const c of t) f.set(c, (f.get(c) || 0) + 1); return [...f.keys()].sort().map((c) => c + f.get(c)).join(" "); },
  null,
  (rng) => ["a", "zzzz", "abcabc", "Hello", "aAbB09", "mississippi", "programming", randStr(rng, 500, "abcxyzXYZ019")]);

def("positionalDigitSums",
  (s) => { const t = lines(s)[0]; let r = 0; for (let i = 0; i < t.length; i++) r += (i % 2 === 0 ? 1 : -1) * Number(t[i]); return String(r); },
  null,
  () => ["0", "9", "10", "99", "123456789", "000000", "9090909090", "5".repeat(100), "1234567890".repeat(10)]);

def("longestCommonPrefix",
  (s) => { const L = lines(s); const n = Number(L[0]); const w = L.slice(1, 1 + n); let p = w[0]; for (const x of w) { while (!x.startsWith(p)) p = p.slice(0, -1); } return p === "" ? "-1" : p; },
  (s) => { const L = lines(s); const n = Number(L[0]); const w = L.slice(1, 1 + n); let i = 0; for (;; i++) { if (w.some((x) => i >= x.length || x[i] !== w[0][i])) break; } return i === 0 ? "-1" : w[0].slice(0, i); },
  () => [J("1", "alone"), J("2", "same", "same"), J("2", "ab", "abc"), J("3", "interview", "internet", "interval"), J("3", "apple", "banana", "cherry"), J("4", "prefix", "pre", "prefixes", "prelude"), J("2", "a", "b"), J("3", "abcdefghij", "abcdefghix", "abcdefghiz")]);

def("balancedBrackets",
  (s) => { const st = []; const m = { ")": "(", "]": "[", "}": "{" }; for (const c of s) { if ("([{".includes(c)) st.push(c); else { if (st.pop() !== m[c]) return "No"; } } return st.length === 0 ? "Yes" : "No"; },
  (s) => { let t = s; let prev; do { prev = t; t = t.replace("()", "").replace("[]", "").replace("{}", ""); } while (t !== prev); return t === "" ? "Yes" : "No"; },
  (rng) => ["()", "(", ")", "([{}])", "([)]", "((()))", "(()", "())", "{[()()]}[]", "]", (() => "(".repeat(1500) + ")".repeat(1500))(), (() => "(".repeat(1500) + ")".repeat(1499) + "]")()]);

// ---------- list / structure ----------
def("reverseList",
  (s) => arr(ints(lines(s)[1]).reverse()),
  null,
  (rng) => [J("1", "7"), J("2", "1 2"), J("5", "-1 -2 -3 -4 -5"), J("6", "10 20 30 40 50 60"), J("8", arr(randArr(rng, 8, -99, 99))), J("3000", arr(randArr(rng, 3000, -1000, 1000)))]);

def("insertNode",
  (s) => { const L = lines(s); const a = ints(L[1]); const [pos, val] = ints(L[2]); a.splice(pos - 1, 0, val); return arr(a); },
  null,
  () => [J("1", "5", "1 9"), J("1", "5", "2 9"), J("4", "1 2 3 4", "1 0"), J("4", "1 2 3 4", "5 0"), J("4", "1 2 3 4", "3 -7"), J("6", "10 20 30 40 50 60", "4 35"), J("0", "", "1 5")]);

def("mergeIntervals",
  (s) => { const L = lines(s); const n = Number(L[0]); const iv = L.slice(1, 1 + n).map(ints).sort((a, b) => a[0] - b[0] || a[1] - b[1]); const out = []; for (const [l, r] of iv) { if (out.length && l <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], r); else out.push([l, r]); } return out.map((x) => arr(x)).join("\n"); },
  (s) => { const L = lines(s); const n = Number(L[0]); let iv = L.slice(1, 1 + n).map(ints); let changed = true; while (changed) { changed = false; outer: for (let i = 0; i < iv.length; i++) for (let j = i + 1; j < iv.length; j++) { if (iv[i][0] <= iv[j][1] && iv[j][0] <= iv[i][1]) { iv[i] = [Math.min(iv[i][0], iv[j][0]), Math.max(iv[i][1], iv[j][1])]; iv.splice(j, 1); changed = true; break outer; } } } return iv.sort((a, b) => a[0] - b[0]).map((x) => arr(x)).join("\n"); },
  (rng) => [J("1", "5 5"), J("2", "1 2", "3 4"), J("2", "1 10", "2 3"), J("3", "5 6", "1 3", "2 4"), J("4", "-5 -1", "-2 2", "3 3", "2 3"), J("3", "1000000000 1000000000", "-1000000000 -1000000000", "0 0"), (() => { const rows = Array.from({ length: 40 }, () => { const l = rint(rng, -100, 100); return `${l} ${l + rint(rng, 0, 15)}`; }); return J("40", ...rows); })(), (() => { const rows = Array.from({ length: 300 }, () => { const l = rint(rng, -3000, 3000); return `${l} ${l + rint(rng, 0, 5)}`; }); return J("300", ...rows); })()]);

def("majority",
  (s) => { const L = lines(s); const n = Number(L[0]); const t = L[1].trim().split(/\s+/); const f = new Map(); for (const x of t) f.set(x, (f.get(x) || 0) + 1); for (const [k, v] of f) if (v > Math.floor(n / 2)) return k; return "-1"; },
  (s) => { const L = lines(s); const n = Number(L[0]); const t = L[1].trim().split(/\s+/); let cand = null, c = 0; for (const x of t) { if (c === 0) { cand = x; c = 1; } else if (x === cand) c++; else c--; } return t.filter((x) => x === cand).length > Math.floor(n / 2) ? cand : "-1"; },
  (rng) => [J("1", "9"), J("2", "5 5"), J("2", "5 6"), J("5", "a a b b a"), J("6", "1 1 1 2 2 2"), J("7", "3 3 4 2 4 4 4"), J("9", "7 8 7 8 7 8 7 8 9"), (() => { const t = Array.from({ length: 2001 }, (_, i) => (i % 2 === 0 ? "k" : "x" + rint(rng, 1, 50))); return J("2001", arr(t)); })(), (() => { const t = Array.from({ length: 2000 }, (_, i) => (i % 2 === 0 ? "k" : "x" + rint(rng, 1, 50))); return J("2000", arr(t)); })()]);

// ---------- DP / graph ----------
def("lis",
  (s) => { const a = na(s); const t = []; for (const x of a) { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; } t[lo] = x; } return String(t.length); },
  (s) => { const a = na(s); if (a.length > 3000) return null; const dp = a.map(() => 1); let best = 0; for (let i = 0; i < a.length; i++) { for (let j = 0; j < i; j++) if (a[j] < a[i]) dp[i] = Math.max(dp[i], dp[j] + 1); best = Math.max(best, dp[i]); } return String(best); },
  (rng) => [J("1", "5"), J("5", "5 4 3 2 1"), J("5", "1 2 3 4 5"), J("8", "0 8 4 12 2 10 6 14"), J("7", "-5 -4 -4 -3 -3 -2 -1"), J("9", "3 10 2 1 20 4 5 6 7"), J("40", arr(randArr(rng, 40, -30, 30))), J("2500", arr(randArr(rng, 2500, -1e6, 1e6)))]);

def("coinChange",
  (s) => { const L = lines(s); const c = ints(L[1]); const amt = Number(L[2]); const dp = Array(amt + 1).fill(Infinity); dp[0] = 0; for (let a = 1; a <= amt; a++) for (const x of c) if (x <= a && dp[a - x] + 1 < dp[a]) dp[a] = dp[a - x] + 1; return dp[amt] === Infinity ? "-1" : String(dp[amt]); },
  (s) => { const L = lines(s); const c = ints(L[1]); const amt = Number(L[2]); const dist = new Array(amt + 1).fill(-1); dist[0] = 0; const q = [0]; for (let h = 0; h < q.length; h++) { const v = q[h]; for (const x of c) { const w = v + x; if (w <= amt && dist[w] === -1) { dist[w] = dist[v] + 1; q.push(w); } } } return String(dist[amt]); },
  (rng) => [J("1", "1", "1"), J("1", "7", "13"), J("1", "7", "14"), J("3", "1 3 4", "6"), J("3", "2 5 10", "3"), J("4", "186 419 83 408", "6249"), J("3", "5 10 25", "10000"), J("5", "3 7 11 13 17", String(rint(rng, 100, 2000)))]);

const parseGrid = (s) => { const L = lines(s); const [r, c] = ints(L[0]); return { r, c, g: L.slice(1, 1 + r) }; };
def("islands",
  (s) => { const { r, c, g } = parseGrid(s); const seen = Array.from({ length: r }, () => Array(c).fill(false)); let n = 0; for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) if (g[i][j] === "1" && !seen[i][j]) { n++; const st = [[i, j]]; seen[i][j] = true; while (st.length) { const [x, y] = st.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < r && ny < c && g[nx][ny] === "1" && !seen[nx][ny]) { seen[nx][ny] = true; st.push([nx, ny]); } } } } return String(n); },
  (s) => { const { r, c, g } = parseGrid(s); const p = Array.from({ length: r * c }, (_, i) => i); const find = (x) => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; }; for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) if (g[i][j] === "1") { if (i + 1 < r && g[i + 1][j] === "1") p[find(i * c + j)] = find((i + 1) * c + j); if (j + 1 < c && g[i][j + 1] === "1") p[find(i * c + j)] = find(i * c + j + 1); } const roots = new Set(); for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) if (g[i][j] === "1") roots.add(find(i * c + j)); return String(roots.size); },
  (rng) => [J("1 1", "1"), J("1 5", "10101"), J("5 1", "1", "0", "1", "1", "0"), J("3 3", "111", "111", "111"), J("3 3", "101", "010", "101"), J("4 4", "1100", "0011", "0100", "1001"), (() => { const rows = Array.from({ length: 12 }, () => randStr(rng, 15, "0011")); return J("12 15", ...rows); })(), (() => { const rows = Array.from({ length: 60 }, () => randStr(rng, 60, "001")); return J("60 60", ...rows); })()]);

def("knapsack",
  (s) => { const L = lines(s); const [n, W] = ints(L[0]); const w = ints(L[1]), v = ints(L[2]); const dp = Array(W + 1).fill(0); for (let i = 0; i < n; i++) for (let c = W; c >= w[i]; c--) dp[c] = Math.max(dp[c], dp[c - w[i]] + v[i]); return String(dp[W]); },
  (s) => { const L = lines(s); const [n, W] = ints(L[0]); const w = ints(L[1]), v = ints(L[2]); if (n > 14) return null; let best = 0; for (let m = 0; m < (1 << n); m++) { let tw = 0, tv = 0; for (let i = 0; i < n; i++) if (m & (1 << i)) { tw += w[i]; tv += v[i]; } if (tw <= W && tv > best) best = tv; } return String(best); },
  (rng) => { const mk = (n, W, wl, wh, vl, vh) => J(`${n} ${W}`, arr(randArr(rng, n, wl, wh)), arr(randArr(rng, n, vl, vh))); return [J("1 10", "10", "5"), J("1 9", "10", "5"), J("3 10", "5 5 5", "10 10 10"), J("4 7", "1 3 4 5", "1 4 5 7"), mk(10, 30, 1, 15, 1, 40), mk(12, 50, 5, 25, 10, 90), mk(150, 3000, 1, 400, 1, 500)]; });

def("minJumps",
  (s) => { const a = na(s); const n = a.length; if (n === 1) return "0"; let jumps = 0, end = 0, far = 0; for (let i = 0; i < n - 1; i++) { far = Math.max(far, i + a[i]); if (i === end) { if (far <= i) return "-1"; jumps++; end = far; if (end >= n - 1) break; } } return end >= n - 1 ? String(jumps) : "-1"; },
  (s) => { const a = na(s); const n = a.length; if (a.length > 3000) return null; const dp = Array(n).fill(Infinity); dp[0] = 0; for (let i = 0; i < n; i++) { if (dp[i] === Infinity) continue; for (let j = 1; j <= a[i] && i + j < n; j++) dp[i + j] = Math.min(dp[i + j], dp[i] + 1); } return dp[n - 1] === Infinity ? "-1" : String(dp[n - 1]); },
  (rng) => [J("1", "0"), J("1", "5"), J("2", "0 5"), J("2", "1 0"), J("6", "1 1 1 1 1 1"), J("6", "5 0 0 0 0 0"), J("7", "2 3 1 1 2 4 2"), J("8", "1 2 0 1 0 1 0 1"), (() => { const a = Array.from({ length: 40 }, () => rint(rng, 1, 5)); return J("40", arr(a)); })(), (() => { const a = Array.from({ length: 2500 }, () => rint(rng, 0, 6)); a[0] = 3; return J("2500", arr(a)); })()]);

// ---------- registry: question id -> problem key ----------
const MAP = {
  "COG-ELEVATE-R1-001": "rowColSum", "COG-ELEVATE-R1-002": "derangements", "COG-ELEVATE-R1-003": "spiral", "COG-ELEVATE-R1-004": "sortByFrequency", "COG-ELEVATE-R1-005": "longestCommonPrefix",
  "COG-GENC-R2-006": "countVowels", "COG-GENC-R2-007": "anagram", "COG-NEXT-R1-005": "firstNonRepeating", "COG-NEXT-R1-006": "countPairsSum", "COG-NEXT-R1-007": "moveZeros",
  "INFY-DSE-R2-001": "secondLargestWithIndex", "INFY-DSE-R2-002": "perfectNumber", "INFY-DSE-R2-003": "reverseDigits",
  "INFY-SP-R1-001": "lis", "INFY-SP-R1-002": "coinChange", "INFY-SP-R1-003": "islands", "INFY-SP-R1-004": "knapsack", "INFY-SP-R1-005": "minJumps",
  "INFY-SE-R2-001": "armstrong", "INFY-SE-R2-002": "reverseList", "INFY-SE-R2-003": "fibSeries",
  "WIPRO-ELITE-R3-001": "factorial", "WIPRO-ELITE-R3-002": "sieveCount", "WIPRO-ELITE-R3-003": "insertNode", "WIPRO-ELITE-R3-004": "numberTriangle",
  "WIPRO-TURBO-R2-001": "lswrc", "WIPRO-TURBO-R2-002": "balancedBrackets", "WIPRO-TURBO-R2-003": "mergeSorted", "WIPRO-TURBO-R2-004": "maxSubarray", "WIPRO-TURBO-R2-005": "pairSorted",
  "ACN-AASE-R3-001": "leaders", "ACN-AASE-R3-004": "pairUnsorted", "ACN-AASE-R3-005": "lswrc",
  "ACN-ASE-R3-001": "palindrome", "ACN-ASE-R3-002": "secondLargestDistinct", "ACN-ASE-R3-003": "reverseEachWord", "ACN-ASE-R3-004": "gcd",
  "CAP-SA-R3-001": "palindrome", "CAP-SA-R3-002": "fibSeries", "CAP-SA-R3-003": "removeDupTokens", "CAP-SA-R3-004": "vowelsConsonants", "CAP-SA-R3-005": "majority",
  "HCL-GET-R1-009": "firstNonRepeating", "HCL-GET-R1-010": "maxSubarray", "HCL-GET-R1-011": "binarySearch", "HCL-GET-R1-012": "powerOfTwo",
  "LTM-GET-R1-017": "removeDupTokens", "LTM-GET-R1-018": "binarySearch",
  "TEM-ASE-R3-001": "reverseText", "TEM-ASE-R3-002": "primeCheck", "TEM-ASE-R3-003": "evenOdd", "TEM-ASE-R3-004": "charFrequency", "TEM-ASE-R3-005": "secondLargestDistinct",
  "TCS-NINJA-R2-001": "positionalDigitSums", "TCS-NINJA-R2-002": "primeCheck", "TCS-NINJA-R2-003": "secondLargestDistinct", "TCS-NINJA-R2-004": "reverseText",
  "TCS-DIGITAL-R2-001": "fibNumber", "TCS-DIGITAL-R2-002": "removeDupChars", "TCS-DIGITAL-R2-003": "rotateRight",
  "TCS-PRIME-R1-001": "kDistinct", "TCS-PRIME-R1-002": "removeDupWords", "TCS-PRIME-R1-003": "mergeIntervals", "TCS-PRIME-R1-004": "subarraySumK",
};

function problemFor(questionId) { return MAP[questionId] || null; }

// Returns { inputs, tests } for a question's problem, running the ref (and brute) on every input.
function buildHiddenTests(questionId, seed = 20261010) {
  const key = MAP[questionId];
  if (!key) throw new Error(`no hidden-test generator for ${questionId}`);
  const p = P[key];
  const rng = mulberry32(seed + [...key].reduce((a, c) => a + c.charCodeAt(0), 0));
  const inputs = p.tests(rng);
  const tests = inputs.map((input) => {
    const expected = p.ref(input);
    if (p.brute) {
      const b = p.brute(input);
      if (b !== null && b !== expected) throw new Error(`${key}: reference and brute force disagree on ${JSON.stringify(input.slice(0, 80))}: ${expected} vs ${b}`);
    }
    return { input, expected, isHidden: true };
  });
  const seen = new Set();
  for (const t of tests) { if (seen.has(t.input)) throw new Error(`${key}: duplicate hidden input`); seen.add(t.input); }
  return { key, tests };
}

// The visible samples of a question must be reproduced by the reference exactly.
function checkSamples(questionId, samples) {
  const p = P[MAP[questionId]];
  const bad = [];
  for (const s of samples) {
    const got = p.ref(s.input);
    if (got !== String(s.expected !== undefined ? s.expected : s.output).trim()) bad.push({ input: s.input, expected: s.expected !== undefined ? s.expected : s.output, got });
  }
  return bad;
}

module.exports = { buildHiddenTests, checkSamples, problemFor, MAP, PROBLEMS: P, mulberry32 };
