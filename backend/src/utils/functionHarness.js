/**
 * LeetCode-style "function signature" evaluation mode.
 *
 * In STDIO mode (the platform's original and still-default mode) the student's submitted code
 * IS the whole program: it reads stdin, writes stdout, same as any competitive-programming judge.
 * In FUNCTION mode the student writes only the body of one method — no main(), no I/O — matching
 * a signature the question author defines (method name, return type, parameter names/types). This
 * module generates two things from that signature:
 *   1. generateStarterCode() — the empty class/function skeleton shown in the editor.
 *   2. wrapFunctionCode() — at judge time, concatenates an auto-generated driver (reads stdin per
 *      the test case's input, calls the student's method, prints the result in the same format
 *      the question's `expected` field is written in) around the student's method/class code, so
 *      the result is a complete, compilable program — exactly what judge.js's existing
 *      prepare()/execute() pipeline already expects. No changes needed there beyond passing the
 *      wrapped source instead of the raw student code.
 *
 * Test case input/output format (line-based, not JSON — trivial to parse with zero extra
 * dependencies in every supported language): one line per parameter, in signature order. A
 * scalar's line is the raw value ("42", "true", "hello"). An array's line is its values separated
 * by single spaces ("1 2 3"), or an empty line for a zero-length array. The expected output
 * follows the same rule for the single return value.
 *
 * Scope: scalars (int, long, double, boolean, string) and 1D arrays of each, single return value.
 * This covers ordinary array/string/DP/recursion-style problems (the bulk of an intro-to-DSA
 * question bank) but NOT linked-list/tree/graph node types — those need custom, structure-specific
 * (de)serialization that's a materially different, larger problem (this is true even for LeetCode
 * itself, which built dedicated infrastructure per structure type). Question authors needing
 * those should use STDIO mode and write their own I/O, same as before this feature existed.
 *
 * Boolean formatting is canonicalized to lowercase "true"/"false" everywhere (Python's default
 * str(bool) is "True"/"False", C++'s default cout of a bool is "1"/"0" — both are overridden here)
 * so a single `expected` string works regardless of which language a student submits in. Doubles
 * are printed via each language's ordinary numeric-to-string conversion, which can differ in
 * trailing-zero/precision presentation across languages — question authors should prefer
 * int/long/string/boolean (and arrays thereof) for reliable exact-match auto-grading, or fall back
 * to STDIO mode with their own tolerance-based comparison if they need epsilon-accurate floats.
 */

const { ServiceError } = require("./serviceError");

const SCALAR_TYPES = ["int", "long", "double", "boolean", "string"];
const ARRAY_TYPES = ["int[]", "long[]", "double[]", "string[]", "boolean[]"];
const SUPPORTED_TYPES = [...SCALAR_TYPES, ...ARRAY_TYPES];

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function isArrayType(type) {
  return type.endsWith("[]");
}

// Throws a descriptive error (surfaced to the question author as a validation failure, and to
// judge.js as a COMPILE_ERROR-shaped result if it somehow reaches judge time unvalidated).
function validateSignature(signature) {
  if (!signature || typeof signature !== "object") throw new Error("A function signature is required for Function-based questions");
  const { methodName, returnType, params } = signature;
  if (!methodName || !IDENTIFIER_RE.test(methodName)) throw new Error("Method name must be a valid identifier (letters, numbers, underscore, not starting with a number)");
  if (!SUPPORTED_TYPES.includes(returnType)) throw new Error(`Unsupported return type "${returnType}" — use one of: ${SUPPORTED_TYPES.join(", ")}`);
  if (!Array.isArray(params)) throw new Error("Parameters must be a list");
  for (const p of params) {
    if (!p.name || !IDENTIFIER_RE.test(p.name)) throw new Error(`Parameter name "${p.name}" must be a valid identifier`);
    if (!SUPPORTED_TYPES.includes(p.type)) throw new Error(`Unsupported parameter type "${p.type}" for "${p.name}" — use one of: ${SUPPORTED_TYPES.join(", ")}`);
  }
}

// C has no classes and no native array-with-length convention that matches the other four
// languages (a C function needs an explicit length parameter and/or an out-parameter for
// returning an array — a fundamentally different signature shape) — so array-typed signatures
// simply aren't offered in C. Scalar-only signatures still work fine in C.
function languagesSupportedBy(signature) {
  // C supports scalars and 1D arrays of int/long/double/boolean (pointer + length convention, see C_ARRAY below). Only string[] has no sensible C shape here.
  const usesStringArray = signature.returnType === "string[]" || signature.params.some((p) => p.type === "string[]");
  const all = ["java", "python", "cpp", "javascript", "c"];
  return usesStringArray ? all.filter((l) => l !== "c") : all;
}

// ---- Starter code (the empty skeleton shown in the editor) ----

const JAVA_TYPE = { int: "int", long: "long", double: "double", boolean: "boolean", string: "String", "int[]": "int[]", "long[]": "long[]", "double[]": "double[]", "string[]": "String[]", "boolean[]": "boolean[]" };
const CPP_TYPE = { int: "int", long: "long long", double: "double", boolean: "bool", string: "string", "int[]": "vector<int>", "long[]": "vector<long long>", "double[]": "vector<double>", "string[]": "vector<string>", "boolean[]": "vector<bool>" };
const C_TYPE = { int: "int", long: "long", double: "double", boolean: "int", string: "char*" };
// 1D arrays in C follow the LeetCode convention: an array PARAMETER is a pointer plus a length parameter named <name>Size; an array RETURN is a malloc'd pointer and
// the function sets *returnSize. Element types: boolean[] is an array of int (0/1). string[] is not offered in C.
const C_ARRAY = { "int[]": "int", "long[]": "long", "double[]": "double", "boolean[]": "int" };
const cArrayType = (t) => `${C_ARRAY[t]}*`;
function cParamList(params, returnType) {
  const parts = [];
  for (const p of params) {
    if (isArrayType(p.type)) { parts.push(`${cArrayType(p.type)} ${p.name}`, `int ${p.name}Size`); } else parts.push(`${C_TYPE[p.type]} ${p.name}`);
  }
  if (isArrayType(returnType)) parts.push("int* returnSize");
  return parts.join(", ");
}

function generateStarterCode(language, signature) {
  validateSignature(signature);
  const { methodName, returnType, params } = signature;
  switch (language) {
    case "java": {
      const paramList = params.map((p) => `${JAVA_TYPE[p.type]} ${p.name}`).join(", ");
      return `import java.util.*;\n\nclass Solution {\n    public ${JAVA_TYPE[returnType]} ${methodName}(${paramList}) {\n        // Write your code here\n        \n    }\n}\n`;
    }
    case "python": {
      const paramList = ["self", ...params.map((p) => p.name)].join(", ");
      return `class Solution:\n    def ${methodName}(${paramList}):\n        # Write your code here\n        pass\n`;
    }
    case "cpp": {
      const paramList = params.map((p) => `${CPP_TYPE[p.type]}${isArrayType(p.type) ? "&" : ""} ${p.name}`).join(", ");
      return `#include <bits/stdc++.h>\nusing namespace std;\n\nclass Solution {\npublic:\n    ${CPP_TYPE[returnType]} ${methodName}(${paramList}) {\n        // Write your code here\n        \n    }\n};\n`;
    }
    case "javascript": {
      const paramList = params.map((p) => p.name).join(", ");
      const jsdoc = [...params.map((p) => ` * @param {${p.type}} ${p.name}`), ` * @return {${returnType}}`].join("\n");
      return `/**\n${jsdoc}\n */\nvar ${methodName} = function(${paramList}) {\n    // Write your code here\n    \n};\n`;
    }
    case "c": {
      if (returnType === "string[]" || params.some((p) => p.type === "string[]")) {
        throw new Error("C doesn't support string[] in Function-based signatures — use STDIO mode, or a language other than C for this question");
      }
      const paramList = cParamList(params, returnType);
      if (isArrayType(returnType)) {
        return `#include <stdio.h>\n#include <stdlib.h>\n\n// Return a malloc'd array of ${C_ARRAY[returnType]} and set *returnSize to its length.\n${cArrayType(returnType)} ${methodName}(${paramList}) {\n    // Write your code here\n    *returnSize = 0;\n    return NULL;\n}\n`;
      }
      return `#include <stdio.h>\n\n${C_TYPE[returnType]} ${methodName}(${paramList}) {\n    // Write your code here\n    \n}\n`;
    }
    default:
      throw new Error(`Unsupported language "${language}"`);
  }
}

// ---- Driver generation (judge-time only — never shown to the student) ----

function javaDriver(signature) {
  const { methodName, returnType, params } = signature;
  const decls = params.map((p) => {
    const t = JAVA_TYPE[p.type];
    if (p.type === "int") return `        int ${p.name} = Integer.parseInt(br.readLine().trim());`;
    if (p.type === "long") return `        long ${p.name} = Long.parseLong(br.readLine().trim());`;
    if (p.type === "double") return `        double ${p.name} = Double.parseDouble(br.readLine().trim());`;
    if (p.type === "boolean") return `        boolean ${p.name} = Boolean.parseBoolean(br.readLine().trim());`;
    if (p.type === "string") return `        String ${p.name} = br.readLine();`;
    if (p.type === "int[]") return `        int[] ${p.name} = __parseIntArray(br.readLine());`;
    if (p.type === "long[]") return `        long[] ${p.name} = __parseLongArray(br.readLine());`;
    if (p.type === "double[]") return `        double[] ${p.name} = __parseDoubleArray(br.readLine());`;
    if (p.type === "string[]") return `        String[] ${p.name} = __parseStringArray(br.readLine());`;
    if (p.type === "boolean[]") return `        boolean[] ${p.name} = __parseBooleanArray(br.readLine());`;
    throw new Error(`Unsupported type ${p.type}`);
  }).join("\n");
  const argList = params.map((p) => p.name).join(", ");
  const printResult = isArrayType(returnType)
    ? `        System.out.println(__format${returnType === "boolean[]" ? "Boolean" : returnType[0].toUpperCase() + returnType.slice(1, -2)}Array(result));`
    : returnType === "boolean"
    ? `        System.out.println(String.valueOf(result));`
    : `        System.out.println(result);`;

  // Deliberately zero import statements of its own (java.io types below are fully qualified
  // instead) — see wrapFunctionCode()'s java case for why: the assembled file places the
  // student's code (which always starts with its own "import java.util.*;" in the generated
  // starter) before this driver, and Java requires every import in a file to precede all of its
  // type declarations. Giving this driver its own imports would put them after the student's
  // "class Solution { ... }", which is a compile error — not hypothetical, this was a real,
  // platform-wide bug: every Java FUNCTION-mode submission that kept its starter code's import
  // failed with javac's generic "class, interface, enum, or record expected".
  return `public class Main {
    public static void main(String[] args) throws java.io.IOException {
        java.io.BufferedReader br = new java.io.BufferedReader(new java.io.InputStreamReader(System.in));
${decls}
        Solution __sol = new Solution();
        ${JAVA_TYPE[returnType]} result = __sol.${methodName}(${argList});
${printResult}
    }

    static int[] __parseIntArray(String line) { line = line == null ? "" : line.trim(); if (line.isEmpty()) return new int[0]; String[] p = line.split("\\\\s+"); int[] a = new int[p.length]; for (int i = 0; i < p.length; i++) a[i] = Integer.parseInt(p[i]); return a; }
    static long[] __parseLongArray(String line) { line = line == null ? "" : line.trim(); if (line.isEmpty()) return new long[0]; String[] p = line.split("\\\\s+"); long[] a = new long[p.length]; for (int i = 0; i < p.length; i++) a[i] = Long.parseLong(p[i]); return a; }
    static double[] __parseDoubleArray(String line) { line = line == null ? "" : line.trim(); if (line.isEmpty()) return new double[0]; String[] p = line.split("\\\\s+"); double[] a = new double[p.length]; for (int i = 0; i < p.length; i++) a[i] = Double.parseDouble(p[i]); return a; }
    static String[] __parseStringArray(String line) { line = line == null ? "" : line.trim(); if (line.isEmpty()) return new String[0]; return line.split("\\\\s+"); }
    static boolean[] __parseBooleanArray(String line) { line = line == null ? "" : line.trim(); if (line.isEmpty()) return new boolean[0]; String[] p = line.split("\\\\s+"); boolean[] a = new boolean[p.length]; for (int i = 0; i < p.length; i++) a[i] = Boolean.parseBoolean(p[i]); return a; }
    static String __formatIntArray(int[] a) { StringBuilder sb = new StringBuilder(); for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(" "); sb.append(a[i]); } return sb.toString(); }
    static String __formatLongArray(long[] a) { StringBuilder sb = new StringBuilder(); for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(" "); sb.append(a[i]); } return sb.toString(); }
    static String __formatDoubleArray(double[] a) { StringBuilder sb = new StringBuilder(); for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(" "); sb.append(a[i]); } return sb.toString(); }
    static String __formatStringArray(String[] a) { return String.join(" ", a); }
    static String __formatBooleanArray(boolean[] a) { StringBuilder sb = new StringBuilder(); for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(" "); sb.append(a[i]); } return sb.toString(); }
}
`;
}

function pythonDriver(signature) {
  const { methodName, returnType, params } = signature;
  const lines = [
    "import sys",
    "__lines = sys.stdin.read().split(chr(10))",
    "__idx = 0",
    "def __next_line():",
    "    global __idx",
    "    v = __lines[__idx] if __idx < len(__lines) else \"\"",
    "    __idx += 1",
    "    return v",
    "",
  ];
  for (const p of params) {
    if (p.type === "int" || p.type === "long") lines.push(`${p.name} = int(__next_line().strip())`);
    else if (p.type === "double") lines.push(`${p.name} = float(__next_line().strip())`);
    else if (p.type === "boolean") lines.push(`${p.name} = __next_line().strip().lower() == "true"`);
    else if (p.type === "string") lines.push(`${p.name} = __next_line()`);
    else if (p.type === "int[]" || p.type === "long[]") lines.push(`${p.name} = [int(x) for x in __next_line().split()]`);
    else if (p.type === "double[]") lines.push(`${p.name} = [float(x) for x in __next_line().split()]`);
    else if (p.type === "string[]") lines.push(`${p.name} = __next_line().split()`);
    else if (p.type === "boolean[]") lines.push(`${p.name} = [x.lower() == "true" for x in __next_line().split()]`);
    else throw new Error(`Unsupported type ${p.type}`);
  }
  const argList = params.map((p) => p.name).join(", ");
  lines.push("__sol = Solution()");
  lines.push(`__result = __sol.${methodName}(${argList})`);
  if (isArrayType(returnType)) {
    if (returnType === "boolean[]") lines.push('print(" ".join(str(x).lower() for x in __result))');
    else lines.push('print(" ".join(str(x) for x in __result))');
  } else if (returnType === "boolean") {
    lines.push("print(str(__result).lower())");
  } else {
    lines.push("print(__result)");
  }
  return lines.join("\n") + "\n";
}

function cppDriver(signature) {
  const { methodName, returnType, params } = signature;
  const decls = params.map((p) => {
    if (p.type === "int") return `    getline(cin, __line); int ${p.name} = __parseInt(__line);`;
    if (p.type === "long") return `    getline(cin, __line); long long ${p.name} = __parseLong(__line);`;
    if (p.type === "double") return `    getline(cin, __line); double ${p.name} = __parseDouble(__line);`;
    if (p.type === "boolean") return `    getline(cin, __line); bool ${p.name} = __parseBool(__line);`;
    if (p.type === "string") return `    getline(cin, __line); string ${p.name} = __line;`;
    if (p.type === "int[]") return `    getline(cin, __line); vector<int> ${p.name} = __parseIntArr(__line);`;
    if (p.type === "long[]") return `    getline(cin, __line); vector<long long> ${p.name} = __parseLongArr(__line);`;
    if (p.type === "double[]") return `    getline(cin, __line); vector<double> ${p.name} = __parseDoubleArr(__line);`;
    if (p.type === "string[]") return `    getline(cin, __line); vector<string> ${p.name} = __split(__line);`;
    if (p.type === "boolean[]") return `    getline(cin, __line); vector<bool> ${p.name} = __parseBoolArr(__line);`;
    throw new Error(`Unsupported type ${p.type}`);
  }).join("\n");
  const argList = params.map((p) => p.name).join(", ");
  const printResult = returnType === "boolean"
    ? `    cout << __formatBool(result) << endl;`
    : returnType === "boolean[]"
    ? `    cout << __formatBoolArr(result) << endl;`
    : isArrayType(returnType)
    ? `    cout << __formatArr(result) << endl;`
    : `    cout << result << endl;`;

  return `#include <bits/stdc++.h>
using namespace std;

vector<string> __split(const string& s) { vector<string> t; istringstream iss(s); string tok; while (iss >> tok) t.push_back(tok); return t; }
int __parseInt(const string& s) { return s.empty() ? 0 : stoi(s); }
long long __parseLong(const string& s) { return s.empty() ? 0 : stoll(s); }
double __parseDouble(const string& s) { return s.empty() ? 0 : stod(s); }
bool __parseBool(const string& s) { string t = s; for (auto& c : t) c = tolower(c); return t.find("true") != string::npos; }
vector<int> __parseIntArr(const string& line) { vector<int> r; for (auto& t : __split(line)) r.push_back(stoi(t)); return r; }
vector<long long> __parseLongArr(const string& line) { vector<long long> r; for (auto& t : __split(line)) r.push_back(stoll(t)); return r; }
vector<double> __parseDoubleArr(const string& line) { vector<double> r; for (auto& t : __split(line)) r.push_back(stod(t)); return r; }
vector<bool> __parseBoolArr(const string& line) { vector<bool> r; for (auto& t : __split(line)) { for (auto& c : t) c = tolower(c); r.push_back(t.find("true") != string::npos); } return r; }
string __formatBool(bool b) { return b ? "true" : "false"; }
string __formatBoolArr(const vector<bool>& v) { ostringstream oss; for (size_t i = 0; i < v.size(); i++) { if (i) oss << " "; oss << (v[i] ? "true" : "false"); } return oss.str(); }
template<typename T> string __formatArr(const vector<T>& v) { ostringstream oss; for (size_t i = 0; i < v.size(); i++) { if (i) oss << " "; oss << v[i]; } return oss.str(); }

<<<STUDENT_CODE>>>

int main() {
    string __line;
${decls}
    Solution __sol;
    auto result = __sol.${methodName}(${argList});
${printResult}
    return 0;
}
`;
}

function jsDriver(signature) {
  const { methodName, returnType, params } = signature;
  const lines = [
    "const __input = require('fs').readFileSync(0, 'utf8').split('\\n');",
    "let __idx = 0;",
    "function __nextLine() { return __input[__idx++] || ''; }",
  ];
  for (const p of params) {
    if (p.type === "int" || p.type === "long" || p.type === "double") lines.push(`const ${p.name} = Number(__nextLine().trim());`);
    else if (p.type === "boolean") lines.push(`const ${p.name} = __nextLine().trim().toLowerCase() === 'true';`);
    else if (p.type === "string") lines.push(`const ${p.name} = __nextLine();`);
    else if (p.type === "int[]" || p.type === "long[]" || p.type === "double[]") lines.push(`const ${p.name} = __nextLine().trim().split(/\\s+/).filter(Boolean).map(Number);`);
    else if (p.type === "string[]") lines.push(`const ${p.name} = __nextLine().trim().split(/\\s+/).filter(Boolean);`);
    else if (p.type === "boolean[]") lines.push(`const ${p.name} = __nextLine().trim().split(/\\s+/).filter(Boolean).map(s => s.toLowerCase() === 'true');`);
    else throw new Error(`Unsupported type ${p.type}`);
  }
  const argList = params.map((p) => p.name).join(", ");
  lines.push(`const __result = ${methodName}(${argList});`);
  if (isArrayType(returnType)) {
    if (returnType === "boolean[]") lines.push("console.log(__result.map(x => String(x)).join(' '));");
    else lines.push("console.log(__result.join(' '));");
  } else if (returnType === "boolean") {
    lines.push("console.log(String(__result));");
  } else {
    lines.push("console.log(__result);");
  }
  return lines.join("\n") + "\n";
}

// Prints a double with the SHORTEST precision that round-trips (the same idea as Python's repr), instead of printf's default %g which keeps only 6 significant digits
// and so turned 3.14159265 into 3.14159. Needs <stdio.h>, <stdlib.h> and <string.h>, which the drivers include before the student's code.
const C_DOUBLE_HELPER = `static void __printDouble(double v) {
    char b[40]; int p;
    for (p = 1; p <= 17; p++) { snprintf(b, sizeof b, "%.*g", p, v); if (strtod(b, NULL) == v) break; }
    printf("%s", b);
}`;

function cDriver(signature) {
  const { methodName, returnType, params } = signature;
  if (returnType === "string[]" || params.some((p) => p.type === "string[]")) {
    throw new Error("C doesn't support string[] in Function-based signatures");
  }
  const usesArrays = isArrayType(returnType) || params.some((p) => isArrayType(p.type));
  const argList = params.flatMap((p) => (isArrayType(p.type) ? [p.name, `${p.name}Size`] : [p.name])).concat(isArrayType(returnType) ? ["&__returnSize"] : []).join(", ");

  if (!usesArrays) {
    // Scalar-only signatures: unchanged reading convention (whitespace-separated scanf tokens), only the double formatting is safer than before.
    const decls = params.map((p) => {
      if (p.type === "int") return `    int ${p.name}; scanf("%d", &${p.name});`;
      if (p.type === "long") return `    long ${p.name}; scanf("%ld", &${p.name});`;
      if (p.type === "double") return `    double ${p.name}; scanf("%lf", &${p.name});`;
      if (p.type === "boolean") return `    char __buf_${p.name}[16]; scanf("%15s", __buf_${p.name}); int ${p.name} = (strcmp(__buf_${p.name}, "true") == 0);`;
      if (p.type === "string") return `    char ${p.name}[4096]; scanf(" %4095[^\\n]", ${p.name});`;
      throw new Error(`Unsupported type ${p.type}`);
    }).join("\n");
    const printResult = returnType === "boolean"
      ? `    printf("%s\\n", result ? "true" : "false");`
      : returnType === "double"
      ? `    __printDouble(result); printf("\\n");`
      : returnType === "string"
      ? `    printf("%s\\n", result);`
      : `    printf("%ld\\n", (long)result);`;
    return `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

${C_DOUBLE_HELPER}

<<<STUDENT_CODE>>>

int main() {
${decls}
    ${C_TYPE[returnType]} result = ${methodName}(${argList});
${printResult}
    return 0;
}
`;
  }

  // Signatures with arrays: one parameter per input line (the same convention every other language's driver uses), arrays as space-separated values on their line.
  const decls = params.map((p) => {
    const n = p.name;
    switch (p.type) {
      case "int": return `    __readLine(); int ${n} = (int)strtol(__line, NULL, 10);`;
      case "long": return `    __readLine(); long ${n} = strtol(__line, NULL, 10);`;
      case "double": return `    __readLine(); double ${n} = strtod(__line, NULL);`;
      case "boolean": return `    __readLine(); int ${n} = __isTrue(__line);`;
      case "string": return `    char ${n}[4096]; __readLine(); __stripEol(__line); strncpy(${n}, __line, sizeof(${n}) - 1); ${n}[sizeof(${n}) - 1] = 0;`;
      case "int[]": return `    __readLine(); int* ${n}; int ${n}Size = __parseArr(__line, 'i', (void**)&${n});`;
      case "long[]": return `    __readLine(); long* ${n}; int ${n}Size = __parseArr(__line, 'l', (void**)&${n});`;
      case "double[]": return `    __readLine(); double* ${n}; int ${n}Size = __parseArr(__line, 'd', (void**)&${n});`;
      case "boolean[]": return `    __readLine(); int* ${n}; int ${n}Size = __parseArr(__line, 'b', (void**)&${n});`;
      default: throw new Error(`Unsupported type ${p.type}`);
    }
  }).join("\n");

  let call;
  if (isArrayType(returnType)) {
    const kind = { "int[]": "i", "long[]": "l", "double[]": "d", "boolean[]": "b" }[returnType];
    call = `    int __returnSize = 0;
    ${cArrayType(returnType)} result = ${methodName}(${argList});
    if (result == NULL) __returnSize = 0;
    __printArr(result, __returnSize, '${kind}');`;
  } else {
    const printResult = returnType === "boolean"
      ? `    printf("%s\\n", result ? "true" : "false");`
      : returnType === "double"
      ? `    __printDouble(result); printf("\\n");`
      : returnType === "string"
      ? `    printf("%s\\n", result);`
      : `    printf("%ld\\n", (long)result);`;
    call = `    ${C_TYPE[returnType]} result = ${methodName}(${argList});
${printResult}`;
  }

  return `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

${C_DOUBLE_HELPER}

static char __line[1 << 22];
static void __readLine(void) { if (!fgets(__line, sizeof __line, stdin)) __line[0] = 0; }
static void __stripEol(char* s) { size_t n = strlen(s); while (n > 0 && (s[n - 1] == '\\n' || s[n - 1] == '\\r')) s[--n] = 0; }
static int __isTrue(const char* s) { while (*s == ' ' || *s == '\\t') s++; return tolower((unsigned char)s[0]) == 't' && tolower((unsigned char)s[1]) == 'r' && tolower((unsigned char)s[2]) == 'u' && tolower((unsigned char)s[3]) == 'e'; }
// Parses whitespace-separated values of one kind ('i' int, 'l' long, 'd' double, 'b' boolean) into a malloc'd array; returns the count (0 for an empty line).
static int __parseArr(const char* s, char kind, void** out) {
    int cap = 16, n = 0;
    size_t sz = (kind == 'l') ? sizeof(long) : (kind == 'd') ? sizeof(double) : sizeof(int);
    char* a = (char*)malloc(cap * sz);
    for (;;) {
        while (*s == ' ' || *s == '\\t' || *s == '\\r' || *s == '\\n') s++;
        if (!*s) break;
        const char* start = s;
        if (n == cap) { cap *= 2; a = (char*)realloc(a, cap * sz); }
        if (kind == 'i') { char* e; long v = strtol(s, &e, 10); if (e == s) break; ((int*)a)[n++] = (int)v; s = e; }
        else if (kind == 'l') { char* e; long v = strtol(s, &e, 10); if (e == s) break; ((long*)a)[n++] = v; s = e; }
        else if (kind == 'd') { char* e; double v = strtod(s, &e); if (e == s) break; ((double*)a)[n++] = v; s = e; }
        else { int t = __isTrue(s); while (*s && *s != ' ' && *s != '\\t' && *s != '\\r' && *s != '\\n') s++; ((int*)a)[n++] = t; if (s == start) break; }
    }
    *out = a;
    return n;
}
static void __printArr(const void* v, int n, char kind) {
    for (int i = 0; i < n; i++) {
        if (i) printf(" ");
        if (kind == 'i') printf("%d", ((const int*)v)[i]);
        else if (kind == 'l') printf("%ld", ((const long*)v)[i]);
        else if (kind == 'd') __printDouble(((const double*)v)[i]);
        else printf("%s", ((const int*)v)[i] ? "true" : "false");
    }
    printf("\\n");
}

<<<STUDENT_CODE>>>

int main() {
${decls}
${call}
    return 0;
}
`;
}

// For Java/C++/C, the generated driver is prepended (or wrapped around) the student's own code,
// so a compiler line number reported against the assembled file is offset from what the student
// actually sees in their editor — e.g. their own line 2 gets reported as "line 25" once ~23 lines
// of invisible driver/helper code are counted too. Locating the student's code verbatim inside the
// assembled file and counting newlines before it gives the exact offset to subtract, without
// hand-deriving a line count per driver template (which would silently drift if a driver template
// is ever edited). Python/JS drivers are appended *after* the student's code, so no offset applies
// there — their compiler/interpreter line numbers already match the student's own lines.
function computeStudentCodeOffset(assembledCode, studentCode) {
  // Guard against the degenerate empty-submission case: String.prototype.indexOf("") always
  // returns 0 (matches immediately), which would silently report "no offset" instead of "student
  // code wasn't found" — and 0 is never a legitimate match position here anyway, since every
  // driver template has non-empty content before the student's code.
  if (!studentCode) return 0;
  const idx = assembledCode.indexOf(studentCode);
  if (idx <= 0) return 0;
  return (assembledCode.slice(0, idx).match(/\n/g) || []).length;
}

// FUNCTION-mode questions now accept EITHER shape of submission: a bare method/class body (the
// starter-code convention, wrapped with the generated driver below) OR a complete, self-contained
// program that reads its own input and prints its own output — a student shouldn't have to
// discover which one a question wants by trial and error, or be blocked from writing the style
// they're more comfortable with. judge.js calls this BEFORE attempting to wrap the submission;
// when it returns true, the code is compiled/run as-is via the ordinary STDIO path instead, against
// the exact same test cases (their `input` already has one value per line per parameter, which
// every language's own idiomatic reading pattern here tolerates: Scanner/cin/scanf all treat any
// whitespace — including a newline — as a token separator; a Python full program just needs to
// read one value per input()/stdin line rather than splitting one line, which is what the sample
// test cases displayed to the student already show).
//
// Deliberately conservative per language — only flags a shape that's unambiguous, mirroring the
// same markers wrapFunctionCode()'s own java case already used to detect and reject this exact
// shape before this feature existed. Java/C/C++ key off literal main()/class declarations that a
// bare method body could never contain. Python keys off the ABSENCE of the required `class
// Solution` the starter code and driver both depend on — code that doesn't define it can never be
// valid function-mode code regardless of intent, so treating it as a full-program attempt (and
// letting Python's own interpreter report whatever's actually wrong) is a strict improvement over
// a confusing driver-time NameError. JavaScript keys off explicit stdin-reading calls, since its
// FUNCTION-mode shape (`var name = function(...)`) has no class/main marker to check instead.
function looksLikeFullProgram(language, code) {
  switch (language) {
    case "java":
      return /\bpublic\s+class\s+\w+/.test(code) || /\bpublic\s+static\s+void\s+main\s*\(/.test(code);
    case "cpp":
    case "c":
      return /\bint\s+main\s*\(/.test(code);
    case "python":
      return !/\bclass\s+Solution\b/.test(code);
    case "javascript":
      return /require\(\s*['"](?:fs|readline)['"]\s*\)|process\.stdin/.test(code);
    default:
      return false;
  }
}

// Concatenates the student's method/class code with the auto-generated driver into one complete,
// compilable/runnable source string. Returns { code, studentCodeOffset } — judge.js uses `code` to
// compile/run, and subtracts `studentCodeOffset` from any compiler-reported line number so the
// line shown to the student matches their own editor, not the invisible generated driver.
function wrapFunctionCode(language, signature, studentCode) {
  validateSignature(signature);
  if (!languagesSupportedBy(signature).includes(language)) {
    throw new Error(`This question's signature isn't available in ${language} (string[] isn't supported in C)`);
  }
  switch (language) {
    case "java": {
      // Guards against a specific, confusing failure: a question can be switched from STDIO to
      // FUNCTION mode after a student has already autosaved a full STDIO-style program (their own
      // `public class Main` with its own `main()`) — e.g. via the platform-wide FUNCTION-mode
      // migration converting an already-live question out from under an in-progress attempt. On
      // resume, that stale code is correctly restored to the editor (autosave must never silently
      // drop real work), but naively concatenating it alongside the driver's own `public class
      // Main` produces a file with two conflicting `public class` declarations — Java allows only
      // one per file, so javac's actual error ("class, interface, enum, or record expected" or
      // similar) is a generic parser message that doesn't point at anything actionable for the
      // student. Detecting the shape here and failing with a clear, specific message (routed
      // through the same COMPILE_ERROR path as any other wrapFunctionCode() throw — see judge.js's
      // catch around this call) is far more actionable than letting the raw compiler output through.
      if (/\bpublic\s+class\s+\w+/.test(studentCode) || /\bpublic\s+static\s+void\s+main\s*\(/.test(studentCode)) {
        throw new Error(
          "This looks like a full Java program (with its own \"public class\" and/or main() method), but this question now expects only a method body inside \"class Solution { ... }\" — no class declaration or main() of your own. " +
          "This usually happens when a question is switched to function-based grading after you already started writing a full program. Replace your solution with just the method body shown in the starter code."
        );
      }
      // Student's `class Solution { ... }` (package-private) coexists with the driver's
      // `public class Main` in one file — Java only requires the public class to match the
      // filename (checked, not position), so multiple top-level classes in either order compile
      // identically. Order here is NOT arbitrary though: studentCode goes FIRST specifically
      // because the generated starter code always begins with "import java.util.*;", and Java
      // requires every import in a file to precede all of its type declarations. Putting the
      // driver first (as this used to do) placed that import after the driver's own `public class
      // Main { ... }`, which is a guaranteed compile error for every single Java FUNCTION-mode
      // submission that kept its starter code's import — not a rare edge case, the default state
      // of the editor for every student. studentCode first avoids this entirely, and as a bonus
      // gets a free correct-by-construction studentCodeOffset of 0 (javaDriver() itself now has no
      // imports of its own to require, see its comment).
      const code = `${studentCode}\n\n${javaDriver(signature)}`;
      return { code, studentCodeOffset: computeStudentCodeOffset(code, studentCode) };
    }
    case "python":
      // Python executes top-to-bottom, so the class must be defined first, then used. Student's
      // own code is first in the file, so its line numbers already match — no offset.
      return { code: `${studentCode}\n\n${pythonDriver(signature)}`, studentCodeOffset: 0 };
    case "cpp": {
      // A function replacer (not a plain string) is required here: String.replace() treats a
      // string replacement's "$&"/"$`"/"$'"/"$$" sequences as special patterns even when the
      // search value is a plain string — a student's own code containing a literal "$" (e.g. a
      // string literal like "Cost: $5") would otherwise silently corrupt the compiled source. A
      // function's return value is always inserted verbatim, with no pattern substitution.
      const code = cppDriver(signature).replace("<<<STUDENT_CODE>>>", () => studentCode);
      return { code, studentCodeOffset: computeStudentCodeOffset(code, studentCode) };
    }
    case "javascript":
      return { code: `${studentCode}\n\n${jsDriver(signature)}`, studentCodeOffset: 0 };
    case "c": {
      // See the cpp case above — function replacer avoids $-pattern corruption from student code.
      const code = cDriver(signature).replace("<<<STUDENT_CODE>>>", () => studentCode);
      return { code, studentCodeOffset: computeStudentCodeOffset(code, studentCode) };
    }
    default:
      throw new Error(`Unsupported language "${language}"`);
  }
}


// ---- test case format check -----------------------------------------------------------------------------------------------------------------------------------
// REGRESSION (2026-10 audit, the 2026-10-26 Coding Test): two function questions were saved with LeetCode-style cases ("[7,1,5,3,6,4]" for an int[] parameter, "[1,6,8,10,15,18]" as
// the expected array). The driver reads one line per parameter with array values separated by spaces, so it crashed parsing every input and NO solution could pass a single hidden
// case: 124 students scored 1 mark between them, and a correct reference solution scored 0/7 on the stored cases and 7/7 on the same cases in the line format. Nothing at authoring
// time compared the cases with the signature. This does, using exactly the rules the generated drivers parse with.
const INT_RE = /^[+-]?\d+$/;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const BOOL_RE = /^(true|false)$/i;
const ARRAY_HINT = "arrays are written as the values separated by single spaces, without brackets or commas (for example 7 1 5 3)";

function badValue(type, text) {
  const base = isArrayType(type) ? type.slice(0, -2) : type;
  const check = base === "int" || base === "long" ? INT_RE : base === "double" ? NUMBER_RE : base === "boolean" ? BOOL_RE : null;
  if (!check) return null; // strings are taken as they are
  const trimmed = String(text).trim();
  const tokens = isArrayType(type) ? (trimmed === "" ? [] : trimmed.split(/\s+/)) : [trimmed];
  if (tokens.every((tok) => check.test(tok))) return null;
  return isArrayType(type) ? `is not a list of ${base} values; ${ARRAY_HINT}` : `is not a ${base} value`;
}

// Returns a list of human-readable problems (empty when every case matches the signature). `cases` are { input, expected, isHidden }.
function functionCaseProblems(signature, cases) {
  const problems = [];
  if (!signature || !Array.isArray(signature.params) || !Array.isArray(cases)) return problems;
  const params = signature.params;
  cases.forEach((tc, i) => {
    const label = `Test case ${i + 1}${tc.isHidden === false ? " (sample)" : tc.isHidden === true ? " (hidden)" : ""}`;
    const lines = String(tc.input ?? "").replace(/\r\n/g, "\n").split("\n");
    params.forEach((p, k) => {
      const line = lines[k];
      if (line === undefined) {
        if (!(isArrayType(p.type) || p.type === "string")) problems.push(`${label}: the input has no line for parameter "${p.name}" (${p.type}); the input needs one line per parameter`);
        return;
      }
      const why = badValue(p.type, line);
      if (why) problems.push(`${label}: line ${k + 1} (parameter "${p.name}", ${p.type}) ${why}`);
    });
    if (lines.slice(params.length).some((l) => l.trim() !== "")) problems.push(`${label}: the input has more lines than the ${params.length} parameter(s); the input needs exactly one line per parameter`);
    const why = badValue(signature.returnType, tc.expected ?? "");
    if (why) problems.push(`${label}: the expected output (${signature.returnType}) ${why}`);
  });
  return problems;
}
// FUNCTION-mode questions always get their starterCodeByLanguage regenerated server-side from the
// signature, rather than trusting whatever the client sent — this is the guarantee that keeps the
// starter code the student sees in sync with the signature judge.js's driver-wrapper actually
// compiles against. Drifting out of sync (e.g. an admin edits the signature but the old starter
// code sticks around) would silently break every submission for that question. Shared by every
// coding-question admin CRUD route (Question/Test bank, Module Coding Test, InterviewQuestion,
// PracticeQuestion) so this guarantee holds identically everywhere FUNCTION mode is offered.
function resolveCodingFields({ evaluationType, functionSignature, starterCodeByLanguage, testCases }) {
  const mode = evaluationType === "FUNCTION" ? "FUNCTION" : "STDIO";
  if (mode !== "FUNCTION") {
    return { evaluationType: "STDIO", functionSignature: null, starterCodeByLanguage: starterCodeByLanguage ?? undefined };
  }
  validateSignature(functionSignature);
  if (Array.isArray(testCases)) {
    const problems = functionCaseProblems(functionSignature, testCases);
    if (problems.length > 0) throw new ServiceError(400, `The test cases do not match the function signature, so no solution could pass them. ${problems.slice(0, 3).join(" | ")}${problems.length > 3 ? ` (and ${problems.length - 3} more)` : ""}`);
  }
  const supported = languagesSupportedBy(functionSignature);
  const generated = {};
  for (const lang of supported) generated[lang] = generateStarterCode(lang, functionSignature);
  return { evaluationType: "FUNCTION", functionSignature, starterCodeByLanguage: generated };
}

module.exports = { functionCaseProblems, SUPPORTED_TYPES, SCALAR_TYPES, ARRAY_TYPES, validateSignature, languagesSupportedBy, generateStarterCode, wrapFunctionCode, looksLikeFullProgram, resolveCodingFields };
