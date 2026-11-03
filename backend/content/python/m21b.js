// Phase 7 / Module 21, lessons 3-4: string patterns and hashing patterns, with tagged practice problems.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, prob: p } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 3
lessons.push({
  title: "String Problems: Palindromes, Anagrams, Windows and Pattern Matching",
  minutes: 90,
  learn: ["Use two ends, centre expansion and counting for string problems", "Build strings efficiently and parse input safely", "Apply a sliding window and the prefix-function (KMP) idea", "Solve string problems with dynamic programming"],
  why: "Strings are everywhere in interviews and real software: usernames, logs, URLs, DNA, search. String tasks test careful indexing, edge cases and your knowledge of Python's string tools.",
  realWorld: "Search boxes normalise text, spell checkers compare edit distance, log tools match patterns, and plagiarism checkers look for repeated substrings. All of them use the ideas below.",
  simple: "A Python string is an <strong>immutable</strong> sequence of characters. Most problems reduce to: look at both ends, grow from a centre, count characters, slide a window, or compare prefixes of two strings.",
  detail: `<h3>Python string toolbox</h3>
${table(["Need", "Use"], [["clean and split", "<code>s.strip()</code>, <code>s.split()</code>, <code>s.lower()</code>, <code>s.casefold()</code>"], ["test characters", "<code>ch.isalpha()</code>, <code>isdigit()</code>, <code>isalnum()</code>"], ["search", "<code>s.find(x)</code> (-1 if missing), <code>x in s</code>, <code>s.startswith(...)</code>"], ["build", "<code>\"\".join(list_of_parts)</code> (never repeated <code>+=</code> in a long loop)"], ["reverse and slice", "<code>s[::-1]</code>, <code>s[i:j]</code> (a new string, O(length))"], ["count", "<code>collections.Counter(s)</code>, <code>s.count(x)</code>"], ["characters and codes", "<code>ord('a')</code>, <code>chr(97)</code>"]])}
<h3>Patterns</h3>
<ul><li><strong>Two pointers from the ends</strong>: palindromes, reversing.</li><li><strong>Expand around the centre</strong>: every palindrome has a centre (a character or a gap between two), so try 2n - 1 centres and grow while the ends match: O(n^2) time, O(1) space.</li><li><strong>Counting</strong>: anagrams, first unique character, ransom notes. Compare <code>Counter</code>s or 26-slot arrays.</li><li><strong>Sliding window</strong>: the shortest or longest substring that satisfies a rule (minimum window, longest without repeats). Expand the right end, shrink the left end while the window is valid or invalid.</li><li><strong>Prefix function (KMP)</strong>: <code>pi[i]</code> is the length of the longest proper prefix of <code>p[:i+1]</code> that is also its suffix. It lets a search continue without re-reading text: O(n + m).</li><li><strong>Dynamic programming</strong>: edit distance, regular-expression matching, longest common subsequence use a table indexed by prefixes of the two strings.</li><li><strong>Simulation</strong>: count-and-say, zigzag, big-number addition and multiplication (digit by digit with a carry).</li></ul>
<h3>Pitfalls</h3>
<ul><li>Off-by-one in slices: <code>s[i:j]</code> excludes <code>j</code>.</li><li>Case, spaces and punctuation: clarify whether they count.</li><li>Unicode: <code>casefold</code> is better than <code>lower</code> for comparing text; for interview problems assume lowercase letters unless told otherwise.</li><li>Big numbers: Python integers are unlimited, but problems that forbid <code>int()</code> conversion want the manual algorithm.</li></ul>`,
  syntax: { code: `from collections import Counter\nCounter(a) == Counter(b)          # anagram\ns == s[::-1]                      # palindrome\n"".join(parts)                    # build\ns.find(sub)                       # index or -1`, note: "Counter for anagrams, join to build, slicing for reversal." },
  diagram: chain("Expand around a centre", "Left to right: choose a centre, compare the characters on both sides, expand while they match, and record the longest palindrome seen.",
    [{ k: "proc", t: "pick a centre\n(2n - 1 of them)" }, { k: "dec", t: "left char ==\nright char?" }, { k: "proc", t: "expand one\nstep each way" }, { k: "term", t: "keep the\nlongest" }], { w: 160, gap: 36, hgt: 62 }),
  example: { code: `from collections import Counter


def longest_palindrome(s):
    best = ""
    for center in range(len(s)):
        for lo, hi in ((center, center), (center, center + 1)):
            while lo >= 0 and hi < len(s) and s[lo] == s[hi]:
                lo -= 1
                hi += 1
            if hi - lo - 1 > len(best):
                best = s[lo + 1:hi]
    return best


def is_anagram(a, b):
    return Counter(a) == Counter(b)


def rle(s):
    out, i = [], 0
    while i < len(s):
        j = i
        while j < len(s) and s[j] == s[i]:
            j += 1
        out.append(f"{s[i]}{j - i}")
        i = j
    return "".join(out)


def prefix_function(p):
    pi = [0] * len(p)
    k = 0
    for i in range(1, len(p)):
        while k and p[i] != p[k]:
            k = pi[k - 1]
        if p[i] == p[k]:
            k += 1
        pi[i] = k
    return pi


print(longest_palindrome("babad"), longest_palindrome("forgeeksskeegfor"))
print(is_anagram("listen", "silent"), is_anagram("rat", "car"))
print(rle("aaabccdddd"))
print(prefix_function("abcabcd"), prefix_function("aabaaab"))`, out: `bab geeksskeeg
True False
a3b1c2d4
[0, 0, 0, 1, 2, 3, 0] [0, 1, 0, 1, 2, 2, 3]` },
  lineByLine: [["longest_palindrome", "For each centre two expansions run: an odd one (lo = hi) and an even one (hi = lo + 1). The palindrome is s[lo+1:hi] when the loop stops; only a strictly longer one replaces the best, so the first of equal length wins (bab, not aba)."], ["is_anagram", "Two strings are anagrams exactly when their character counts are equal."], ["rle", "A run starts at i; j walks to the first different character; the run length is j - i."], ["prefix_function", "pi[i] is the length of the longest proper prefix of p[:i+1] that is also a suffix. After a mismatch k falls back to pi[k - 1] instead of restarting, which is why the total work is linear."], ["abcabcd", "pi = 0 0 0 1 2 3 0: after abcabc the prefix abc is also a suffix (3); the final d breaks it."]],
  dryRun: { intro: "Centre expansion on <code>babad</code> from the centre at index 1 (a):", headers: ["lo", "hi", "s[lo] == s[hi]", "action"], rows: [["1", "1", "a == a", "expand"], ["0", "2", "b == b", "expand"], ["-1", "3", "out of range", "stop: palindrome s[0:3] = bab"]] },
  realExample: { intro: "Normalising text before counting: split, strip punctuation, lower-case, count, and compare in a case-insensitive way.", code: `from collections import Counter

text = "  Python, python; PYTHON!  is fun.  "
words = [w.strip(".,;!").lower() for w in text.split()]
print(words)
print(Counter(words).most_common(2))
print("-".join(sorted(set(words))))
print("racecar"[::-1] == "racecar", "Stra\\u00dfe".casefold() == "STRASSE".casefold())`, out: `['python', 'python', 'python', 'is', 'fun']
[('python', 3), ('is', 1)]
fun-is-python
True True` },
  mistakes: ["Building a long string with repeated <code>+=</code> (use join).", "Forgetting the even-length palindromes when expanding.", "Comparing <code>lower()</code> results when <code>casefold()</code> is needed.", "Off-by-one when slicing the final window.", "Assuming the input has no spaces or punctuation without asking."],
  practices: ["Clarify the alphabet and case rules.", "Write the brute force, then name the pattern that removes the waste.", "Test the empty string, one character and all-equal strings.", "Print intermediate windows while debugging."],
  interview: ["How do you check for a palindrome ignoring punctuation?", "Explain the sliding window for the minimum window substring.", "What does the KMP prefix function compute?", "How would you multiply two big numbers given as strings?"],
  practiceQs: ["What is pi for ababc?", "How many centres does a string of length 5 have?", "Why is s += ch in a loop risky?", "What does s.find return when the text is missing?"],
  revision: ["Two ends, centre expansion, counting, window, prefix function.", "Anagram = equal Counter.", "join instead of +=.", "Clarify case, spaces, alphabet."],
  hinglish: "String ke sawalon mein aam taur par do sire se milana, centre se failna, characters ginna ya window slide karna kaam aata hai. Palindrome ke liye 2n-1 centres hote hain. Lambi string banane ke liye += ki jagah join use karo.",
  quiz: [
    mcq("How many centres should you try when expanding for palindromes in a string of length n?", ["n", "2n - 1", "n squared", "log n"], 1, "n characters plus n - 1 gaps between them."),
    mcq("Which check decides whether two words are anagrams?", ["Same length only", "Equal character counts", "Same first letter", "Equal sorted order of positions"], 1, "Counter(a) == Counter(b) (or sorted(a) == sorted(b))."),
    mcq("What is the complexity of the KMP search after building the prefix function?", ["O(n x m)", "O(n + m)", "O(n^2)", "O(m^2)"], 1, "The text pointer never moves backwards."),
    mcq("Why is building a result with result += ch inside a loop over 10^6 characters risky?", ["Strings are mutable", "Each += may copy the whole string, giving O(n^2)", "It raises an error", "It changes the characters"], 1, "Collect parts in a list and join once."),
    mcq("Which approach suits 'smallest substring containing all characters of t'?", ["Two nested loops over all substrings", "A sliding window with character counts", "Recursion without memo", "Sorting the string"], 1, "Expand the right end until valid, then shrink the left end.")
  ],
  tasks: [
    p({ t: "Valid Palindrome Ignoring Punctuation", d: "E", tags: ["string", "two-pointers"], tc: "O(n)", sc: "O(n)", goal: "Filter the characters that matter, normalise case and compare with the reverse.", hint: "Keep only letters and digits, lower-case them, and compare the list with its reverse.",
      s: "Read one line of text. Ignoring case and every character that is not a letter or digit, print yes if it reads the same forwards and backwards, otherwise no.", inp: "One line of text.", out: "yes or no.", edge: "only punctuation, mixed case",
      sol: `s = input()
t = [ch.lower() for ch in s if ch.isalnum()]
print("yes" if t == t[::-1] else "no")`, c: [["A man, a plan, a canal: Panama", "yes"], ["race a car", "no"], ["!?", "yes"], ["0P", "no"]] }),
    p({ t: "Reverse the Words", d: "E", tags: ["string", "parsing"], tc: "O(n)", sc: "O(n)", goal: "Split on whitespace so repeated spaces collapse, then reverse the list of words.", hint: "split() with no argument ignores repeated spaces; reverse the list and join.",
      s: "Read one line of words separated by one or more spaces. Print the words in reverse order separated by single spaces.", inp: "One line.", out: "The words reversed.", edge: "a single word, repeated spaces",
      sol: `print(*reversed(input().split()))`, c: [["the sky is blue", "blue is sky the"], ["a good   example", "example good a"], ["word", "word"], ["x y z", "z y x"]] }),
    p({ t: "Valid Anagram", d: "E", tags: ["string", "counting"], tc: "O(n)", sc: "O(k)", goal: "Compare character frequencies rather than sorting.", hint: "Two strings are anagrams exactly when their character counts match.",
      s: "Read two strings on separate lines. Print yes if the second is an anagram of the first, otherwise no.", inp: "Two lines.", out: "yes or no.", edge: "different lengths, repeated letters",
      sol: `from collections import Counter

a = input()
b = input()
print("yes" if Counter(a) == Counter(b) else "no")`, c: [["anagram\nnagaram", "yes"], ["rat\ncar", "no"], ["a\na", "yes"], ["ab\na", "no"]] }),
    p({ t: "First Unique Character", d: "E", tags: ["string", "counting"], tc: "O(n)", sc: "O(k)", goal: "Count first, then scan again in the original order.", hint: "One pass to count, a second pass to find the first character whose count is 1.",
      s: "Read a string. Print the index of its first character that appears exactly once, or -1 if there is none.", inp: "One line.", out: "An index or -1.", edge: "no unique character",
      sol: `from collections import Counter

s = input()
counts = Counter(s)
for i, ch in enumerate(s):
    if counts[ch] == 1:
        print(i)
        break
else:
    print(-1)`, c: [["leetcode", "0"], ["loveleetcode", "2"], ["aabb", "-1"], ["z", "0"]] }),
    p({ t: "Longest Common Prefix", d: "E", tags: ["string", "scan"], tc: "O(total characters)", sc: "O(1)", goal: "Shrink a candidate prefix until every word starts with it.", hint: "Start with the first word and cut characters off its end until the next word starts with it.",
      s: "Read n and then n words (one per line). Print the longest prefix shared by all of them, or none if there is no common prefix.", inp: "Line 1: n. Then n words.", out: "The prefix or none.", edge: "one word, no common prefix",
      sol: `n = int(input())
words = [input() for _ in range(n)]
prefix = words[0]
for w in words[1:]:
    while not w.startswith(prefix):
        prefix = prefix[:-1]
print(prefix or "none")`, c: [["3\nflower\nflow\nflight", "fl"], ["3\ndog\nracecar\ncar", "none"], ["1\nalone", "alone"], ["2\ninterview\ninternet", "inter"]] }),
    p({ t: "Is Subsequence", d: "E", tags: ["string", "two-pointers"], tc: "O(n)", sc: "O(1)", goal: "Walk through the long string once while advancing a pointer in the short one.", hint: "Advance the pointer in s each time the current character of t matches.",
      s: "Read two strings s and t on separate lines. Print yes if s is a subsequence of t (its characters appear in t in the same order, not necessarily next to each other), otherwise no.", inp: "Two lines.", out: "yes or no.", edge: "s longer than t",
      sol: `s = input()
t = input()
i = 0
for ch in t:
    if i < len(s) and ch == s[i]:
        i += 1
print("yes" if i == len(s) else "no")`, c: [["abc\nahbgdc", "yes"], ["axc\nahbgdc", "no"], ["a\na", "yes"], ["abc\nab", "no"]] }),
    p({ t: "Roman Numeral to Integer", d: "E", tags: ["string", "parsing"], tc: "O(n)", sc: "O(1)", goal: "Handle the subtractive rule by comparing a symbol with the next one.", hint: "If a symbol is smaller than the one after it, subtract it; otherwise add it.",
      s: "Read a Roman numeral (symbols I, V, X, L, C, D, M with the usual subtractive pairs) and print its integer value.", inp: "One Roman numeral.", out: "An integer.", edge: "IV, IX, XC, CM pairs",
      sol: `values = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
s = input()
total = 0
for i, ch in enumerate(s):
    if i + 1 < len(s) and values[ch] < values[s[i + 1]]:
        total -= values[ch]
    else:
        total += values[ch]
print(total)`, c: [["III", "3"], ["LVIII", "58"], ["MCMXCIV", "1994"], ["IX", "9"]] }),
    p({ t: "Run-Length Encoding", d: "E", tags: ["string", "simulation"], tc: "O(n)", sc: "O(n)", goal: "Group equal neighbouring characters with two indices.", hint: "For each run, append the character and the run length.",
      s: "Read a string. Print its run-length encoding: every maximal run of one character written as the character followed by the run length (aaab becomes a3b1).", inp: "One line.", out: "The encoded string.", edge: "no repeats, long runs",
      sol: `s = input()
out = []
i = 0
while i < len(s):
    j = i
    while j < len(s) and s[j] == s[i]:
        j += 1
    out.append(s[i] + str(j - i))
    i = j
print("".join(out))`, c: [["aaabccdddd", "a3b1c2d4"], ["a", "a1"], ["abc", "a1b1c1"], ["zzzzzzzzzzzz", "z12"]] }),
    p({ t: "Rotation Check", d: "E", tags: ["string", "trick"], tc: "O(n)", sc: "O(n)", goal: "Use the doubled-string trick to test rotations.", hint: "A rotation of a is always a substring of a + a, and the lengths must match.",
      s: "Read two strings a and b on separate lines. Print yes if b can be obtained by rotating a (moving some leading characters to the end), otherwise no.", inp: "Two lines.", out: "yes or no.", edge: "different lengths",
      sol: `a = input()
b = input()
print("yes" if len(a) == len(b) and b in a + a else "no")`, c: [["abcde\ncdeab", "yes"], ["abcde\nabced", "no"], ["a\na", "yes"], ["ab\nba", "yes"]] }),
    p({ t: "Longest Palindromic Substring", d: "M", tags: ["string", "expand-around-center"], tc: "O(n^2)", sc: "O(1)", goal: "Try every centre, odd and even, and keep the longest palindrome found.", hint: "For each index expand outwards with lo = hi and with hi = lo + 1; keep the longest, replacing only when strictly longer.",
      s: "Read a string. Print its longest palindromic substring; if several have the same length print the one that starts first.", inp: "One line.", out: "The substring.", edge: "single character, even-length palindromes",
      sol: `s = input()
best = ""
for center in range(len(s)):
    for lo, hi in ((center, center), (center, center + 1)):
        while lo >= 0 and hi < len(s) and s[lo] == s[hi]:
            lo -= 1
            hi += 1
        if hi - lo - 1 > len(best):
            best = s[lo + 1:hi]
print(best)`, c: [["babad", "bab"], ["cbbd", "bb"], ["a", "a"], ["forgeeksskeegfor", "geeksskeeg"]] }),
    p({ t: "Group the Anagrams", d: "M", tags: ["string", "hashing", "sorting"], tc: "O(n x k log k)", sc: "O(n x k)", goal: "Use a canonical key (the sorted letters) to bucket words.", hint: "The sorted letters of a word are the same for all its anagrams; use them as a dictionary key.",
      s: "Read n and then n words. Group words that are anagrams of each other. Print one group per line: the words of a group sorted alphabetically and separated by spaces, with the groups ordered alphabetically by their first word.", inp: "Line 1: n. Then n words.", out: "One line per group.", edge: "a single word, no anagrams",
      sol: `n = int(input())
groups = {}
for _ in range(n):
    w = input()
    groups.setdefault("".join(sorted(w)), []).append(w)
for g in sorted(sorted(ws) for ws in groups.values()):
    print(*g)`, c: [["6\neat\ntea\ntan\nate\nnat\nbat", "ate eat tea\nbat\nnat tan"], ["1\na", "a"], ["3\nabc\ncab\nxyz", "abc cab\nxyz"], ["4\nlisten\nsilent\nenlist\nbanana", "banana\nenlist listen silent"]] }),
    p({ t: "Count Palindromic Substrings", d: "M", tags: ["string", "expand-around-center"], tc: "O(n^2)", sc: "O(1)", goal: "Count every successful expansion from every centre.", hint: "Each expansion step that still matches is one more palindromic substring.",
      s: "Read a string. Print how many of its substrings (counted by position, so equal substrings at different places count separately) are palindromes.", inp: "One line.", out: "An integer.", edge: "all equal characters",
      sol: `s = input()
count = 0
for center in range(len(s)):
    for lo, hi in ((center, center), (center, center + 1)):
        while lo >= 0 and hi < len(s) and s[lo] == s[hi]:
            count += 1
            lo -= 1
            hi += 1
print(count)`, c: [["abc", "3"], ["aaa", "6"], ["a", "1"], ["abba", "6"]] }),
    p({ t: "String to Integer (atoi)", d: "M", tags: ["string", "parsing"], tc: "O(n)", sc: "O(1)", goal: "Parse carefully: sign, leading digits, stop at the first non-digit, then clamp to the 32-bit range.", hint: "Read an optional sign, then digits until something else appears; clamp to -2^31 .. 2^31 - 1.",
      s: "Read a line. Convert the leading integer to a number: an optional + or - sign, then digits; stop at the first character that is not a digit; if there are no digits the value is 0. Clamp the result to the range -2147483648 to 2147483647 and print it.", inp: "One line.", out: "An integer.", edge: "no digits, overflow",
      sol: `s = input().strip()
i, sign = 0, 1
if s and s[0] in "+-":
    sign = -1 if s[0] == "-" else 1
    i = 1
value = 0
while i < len(s) and s[i].isdigit():
    value = value * 10 + int(s[i])
    i += 1
value *= sign
print(max(-2**31, min(2**31 - 1, value)))`, c: [["42", "42"], ["-91283472332", "-2147483648"], ["4193 with words", "4193"], ["words and 987", "0"]] }),
    p({ t: "Count and Say", d: "M", tags: ["string", "simulation"], tc: "O(L)", sc: "O(L)", goal: "Generate each term by reading the previous term as runs.", hint: "Term n is obtained by describing the runs of term n - 1: two 1s becomes 21.",
      s: "The sequence starts with the term 1 and every next term describes the previous one by reading its runs of equal digits aloud (1, 11, 21, 1211, 111221, ...). Read n and print the nth term.", inp: "One integer n (1-based).", out: "The nth term.", edge: "n = 1",
      sol: `n = int(input())
term = "1"
for _ in range(n - 1):
    out = []
    i = 0
    while i < len(term):
        j = i
        while j < len(term) and term[j] == term[i]:
            j += 1
        out.append(str(j - i) + term[i])
        i = j
    term = "".join(out)
print(term)`, c: [["1", "1"], ["4", "1211"], ["5", "111221"], ["6", "312211"]] }),
    p({ t: "Zigzag Conversion", d: "M", tags: ["string", "simulation"], tc: "O(n)", sc: "O(n)", goal: "Distribute characters over rows by bouncing a row index up and down.", hint: "Keep a row index and a direction that flips at the first and last row.",
      s: "Read a string and a number of rows. Write the string in a zigzag pattern down and up across that many rows (P A Y P A L I S H I R I N G on 3 rows) and print the text read row by row.", inp: "Line 1: the string. Line 2: the number of rows.", out: "The converted string.", edge: "one row, more rows than characters",
      sol: `s = input()
rows = int(input())
if rows == 1 or rows >= len(s):
    print(s)
else:
    lines = [[] for _ in range(rows)]
    r, step = 0, 1
    for ch in s:
        lines[r].append(ch)
        if r == 0:
            step = 1
        elif r == rows - 1:
            step = -1
        r += step
    print("".join("".join(line) for line in lines))`, c: [["PAYPALISHIRING\n3", "PAHNAPLSIIGYIR"], ["PAYPALISHIRING\n4", "PINALSIGYAHRPI"], ["AB\n1", "AB"], ["ABCD\n2", "ACBD"]] }),
    p({ t: "Add Binary Strings", d: "M", tags: ["string", "math", "simulation"], tc: "O(max(n, m))", sc: "O(max(n, m))", goal: "Add digit by digit from the right with a carry, as on paper.", hint: "Walk both strings from the end, add the two digits and the carry, write total % 2, carry total // 2.",
      s: "Read two binary numbers as strings on separate lines. Print their sum as a binary string without using int(x, 2).", inp: "Two lines of 0/1 characters.", out: "The sum in binary.", edge: "carry out of the last digit, zeros",
      sol: `a = input()
b = input()
i, j, carry = len(a) - 1, len(b) - 1, 0
out = []
while i >= 0 or j >= 0 or carry:
    total = carry
    if i >= 0:
        total += int(a[i])
        i -= 1
    if j >= 0:
        total += int(b[j])
        j -= 1
    out.append(str(total % 2))
    carry = total // 2
print("".join(reversed(out)))`, c: [["11\n1", "100"], ["1010\n1011", "10101"], ["0\n0", "0"], ["1111\n1", "10000"]] }),
    p({ t: "Multiply Big Numbers", d: "M", tags: ["string", "math", "simulation"], tc: "O(n x m)", sc: "O(n + m)", goal: "Implement schoolbook multiplication with a result array indexed by digit position.", hint: "The product of digits i and j lands in positions i + j and i + j + 1 of the result array.",
      s: "Read two non-negative integers as strings on separate lines. Print their product as a string, computing it digit by digit instead of converting the whole numbers.", inp: "Two lines of digits.", out: "The product.", edge: "multiplication by 0",
      sol: `a = input()
b = input()
res = [0] * (len(a) + len(b))
for i in range(len(a) - 1, -1, -1):
    for j in range(len(b) - 1, -1, -1):
        total = int(a[i]) * int(b[j]) + res[i + j + 1]
        res[i + j + 1] = total % 10
        res[i + j] += total // 10
text = "".join(map(str, res)).lstrip("0")
print(text or "0")`, c: [["2\n3", "6"], ["123\n456", "56088"], ["0\n9999", "0"], ["99\n99", "9801"]] }),
    p({ t: "Word Pattern Match", d: "M", tags: ["string", "hashing"], tc: "O(n)", sc: "O(n)", goal: "Check a bijection between pattern letters and words in both directions.", hint: "The number of distinct letters, distinct words and distinct (letter, word) pairs must all be equal.",
      s: "Read a pattern of letters and then a sentence of words. Print yes if the sentence follows the pattern, meaning each pattern letter always stands for the same word and different letters stand for different words; otherwise print no.", inp: "Line 1: the pattern. Line 2: the words.", out: "yes or no.", edge: "different lengths, same word for two letters",
      sol: `pattern = input()
words = input().split()
ok = len(pattern) == len(words) and len(set(pattern)) == len(set(words)) == len(set(zip(pattern, words)))
print("yes" if ok else "no")`, c: [["abba\ndog cat cat dog", "yes"], ["abba\ndog cat cat fish", "no"], ["aaaa\ndog cat cat dog", "no"], ["abc\nb c a", "yes"]] }),
    p({ t: "Minimum Window Substring", d: "H", tags: ["string", "sliding-window", "hashing"], tc: "O(n + m)", sc: "O(k)", goal: "Expand until the window is valid, then shrink from the left while it stays valid, tracking the smallest.", hint: "Keep a count of needed characters and how many are still missing; shrink the left side when nothing is missing.",
      s: "Read a string s and a string t. Print the shortest substring of s that contains every character of t (with multiplicity). If several have the same length print the leftmost. If there is none, print none.", inp: "Two lines.", out: "The window or none.", edge: "t longer than s, repeated characters in t",
      sol: `from collections import Counter

s = input()
t = input()
need = Counter(t)
missing = len(t)
best = None
left = 0
for right, ch in enumerate(s):
    if need[ch] > 0:
        missing -= 1
    need[ch] -= 1
    if missing == 0:
        while need[s[left]] < 0:
            need[s[left]] += 1
            left += 1
        if best is None or right - left < best[1] - best[0]:
            best = (left, right)
        need[s[left]] += 1
        missing += 1
        left += 1
print(s[best[0]:best[1] + 1] if best else "none")`, c: [["AAXBYCABC\nABC", "CAB"], ["a\na", "a"], ["a\naa", "none"], ["aab\nab", "ab"]] }),
    p({ t: "Find the Needle (KMP)", d: "H", tags: ["string", "kmp", "pattern-matching"], tc: "O(n + m)", sc: "O(m)", goal: "Build the prefix function and use it to avoid re-reading text after a mismatch.", hint: "pi[i] = longest proper prefix of needle[:i+1] that is also a suffix; on mismatch fall back k = pi[k - 1].",
      s: "Read a haystack string and a needle string. Print the index of the first occurrence of the needle in the haystack, or -1. Aim for linear time.", inp: "Two lines.", out: "An index or -1.", edge: "needle longer than haystack, repeated prefixes",
      sol: `hay = input()
needle = input()
pi = [0] * len(needle)
k = 0
for i in range(1, len(needle)):
    while k and needle[i] != needle[k]:
        k = pi[k - 1]
    if needle[i] == needle[k]:
        k += 1
    pi[i] = k
k = 0
answer = -1
for i, ch in enumerate(hay):
    while k and ch != needle[k]:
        k = pi[k - 1]
    if ch == needle[k]:
        k += 1
    if k == len(needle):
        answer = i - k + 1
        break
print(answer)`, c: [["sadbutsad\nsad", "0"], ["leetcode\nleeto", "-1"], ["hello\nll", "2"], ["aaaaab\naab", "3"]] }),
    p({ t: "Regular Expression Matching", d: "H", tags: ["string", "dp"], tc: "O(n x m)", sc: "O(n x m)", goal: "Define dp over suffixes of the text and pattern and handle the star as zero or more repeats.", hint: "dp[i][j] says whether s[i:] matches p[j:]. For a star, either skip the starred item (j + 2) or consume one matching character and stay.",
      s: "Read a text s and a pattern p. The pattern may contain . (any single character) and * (zero or more of the preceding item). Print yes if the pattern matches the entire text, otherwise no.", inp: "Two lines.", out: "yes or no.", edge: "star at the start of a group, empty matches",
      sol: `s = input()
p = input()
m, n = len(s), len(p)
dp = [[False] * (n + 1) for _ in range(m + 1)]
dp[m][n] = True
for i in range(m, -1, -1):
    for j in range(n - 1, -1, -1):
        first = i < m and p[j] in (s[i], ".")
        if j + 1 < n and p[j + 1] == "*":
            dp[i][j] = dp[i][j + 2] or (first and dp[i + 1][j])
        else:
            dp[i][j] = first and dp[i + 1][j + 1]
print("yes" if dp[0][0] else "no")`, c: [["aa\na", "no"], ["aa\na*", "yes"], ["mississippi\nmis*is*p*.", "no"], ["aab\nc*a*b", "yes"]] }),
  ],
});

// ---------------------------------------------------------------- 4
lessons.push({
  title: "Hashing Problems: Dictionaries, Sets and Counting",
  minutes: 90,
  learn: ["Replace nested loops with a dictionary or set lookup", "Count with Counter and group with defaultdict", "Combine hashing with prefix sums and sliding windows", "Design simple caches such as an LRU cache"],
  why: "Hash tables turn many O(n^2) searches into O(n). Hashing is the most frequently useful interview tool after sorting, and Python's dict and set make it a one-liner.",
  realWorld: "Caches, session stores, deduplication, word counts, fraud detection by repeated identifiers, and database indexes all rely on hashing.",
  simple: "A dictionary answers &quot;have I seen this before, and what do I know about it?&quot; in constant time on average. Ask that question while you scan and many problems collapse into one pass.",
  detail: `<h3>Toolbox</h3>
${table(["Need", "Use"], [["membership", "<code>x in some_set</code> (average O(1))"], ["frequency", "<code>Counter(items)</code>, <code>counts[x] += 1</code> with <code>defaultdict(int)</code>"], ["group by key", "<code>defaultdict(list)</code>; key may be a tuple or a sorted string"], ["first index of a value", "<code>seen.setdefault(x, i)</code> or store on first sight"], ["set algebra", "<code>a &amp; b</code>, <code>a | b</code>, <code>a - b</code>, <code>a ^ b</code>"], ["ordered dictionary / LRU", "<code>OrderedDict.move_to_end</code>, <code>popitem(last=False)</code>"]])}
<p>Keys must be hashable: numbers, strings, tuples of hashables (not lists). Average lookup is O(1); a very bad hash collision case is O(n), which interviews ignore.</p>
<h3>Patterns</h3>
<ul><li><strong>Complement lookup</strong>: for each x, check whether <code>target - x</code> was seen (two sum, pairs with a difference).</li><li><strong>Frequency tables</strong>: majority element, top-k, ransom note, anagrams.</li><li><strong>Prefix sums in a dictionary</strong>: store how often each prefix value has occurred to count subarrays with a given sum or divisibility (<code>seen[s - k]</code>). Balance trick: turn 0 into -1 so equal 0/1 counts become balance 0.</li><li><strong>Canonical keys</strong>: sorted letters, a normalised slope (dx, dy) divided by gcd, a tuple of counts.</li><li><strong>Sets for existence</strong>: longest consecutive sequence starts only from numbers whose predecessor is missing, so total work is O(n).</li><li><strong>Hash + sliding window</strong>: at most k distinct values; exactly k = at most k minus at most k - 1.</li><li><strong>Hash + linked order</strong>: an LRU cache is a dictionary plus recency order.</li></ul>
<h3>Cautions</h3>
<ul><li>Python sets and dicts do not guarantee a printing order for sets; sort before printing. (Dictionaries keep insertion order since 3.7.)</li><li>Floating-point keys are risky; use integers or reduced fractions such as (dx, dy) / gcd.</li><li>Modifying a dictionary while iterating over it raises an error; iterate over a copy of the keys.</li></ul>`,
  syntax: { code: `from collections import Counter, defaultdict\nseen = {}\nfor i, x in enumerate(nums):\n    if target - x in seen:\n        return seen[target - x], i\n    seen[x] = i`, note: "Look up the complement before you store the current value." },
  diagram: chain("Complement lookup", "Left to right: take the next number, ask the dictionary whether target minus the number was seen, answer if yes, otherwise store the number and continue.",
    [{ k: "proc", t: "next number x" }, { k: "dec", t: "target - x\nin seen?" }, { k: "term", t: "yes: answer\nfound" }, { k: "proc", t: "no: store x\nin seen" }], { w: 150, gap: 36, hgt: 62 }),
  example: { code: `from collections import Counter, defaultdict


def two_sum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        if target - x in seen:
            return seen[target - x], i
        seen[x] = i


print(two_sum([2, 7, 11, 15], 9))

words = ["eat", "tea", "tan", "ate", "nat", "bat"]
groups = defaultdict(list)
for w in words:
    groups["".join(sorted(w))].append(w)
print(sorted(groups.values()))

print(Counter("mississippi").most_common(3))
a, b = {1, 2, 3, 4}, {3, 4, 5}
print(a & b, a | b, a - b, a ^ b)
print(len({(1, 2), (2, 1), (1, 2)}))`, out: `(0, 1)
[['bat'], ['eat', 'tea', 'ate'], ['tan', 'nat']]
[('i', 4), ('s', 4), ('p', 2)]
{3, 4} {1, 2, 3, 4, 5} {1, 2} {1, 2, 5}
2` },
  lineByLine: [["two_sum", "For 7 the complement 2 was seen at index 0, so the answer is (0, 1). Each element is visited once."], ["groups[sorted letters]", "eat, tea and ate share the key aet, so they land in one list."], ["Counter.most_common", "Highest counts first; equal counts keep the order in which letters first appeared (i before s)."], ["set operators", "Intersection, union, difference and symmetric difference."], ["{(1, 2), (2, 1), (1, 2)}", "Tuples are hashable and order matters: (1, 2) and (2, 1) differ; the repeated (1, 2) is stored once. The set has 2 items."]],
  dryRun: { intro: "Two sum on <code>[3, 2, 4]</code> with target 6:", headers: ["i", "x", "target - x", "seen before", "result"], rows: [["0", "3", "3", "{}", "store 3 -> 0"], ["1", "2", "4", "{3: 0}", "store 2 -> 1"], ["2", "4", "2", "{3: 0, 2: 1}", "found: indices 1 and 2"]] },
  realExample: { intro: "An LRU cache is a dictionary that also remembers which key was used least recently: OrderedDict keeps that order for you.", code: `from collections import OrderedDict

CAPACITY = 2
cache = OrderedDict()


def put(key, value):
    if key in cache:
        cache.move_to_end(key)
    cache[key] = value
    if len(cache) > CAPACITY:
        cache.popitem(last=False)


put(1, 1)
put(2, 2)
cache.move_to_end(1)
put(3, 3)
print(list(cache.items()))`, out: `[(1, 1), (3, 3)]` },
  mistakes: ["Storing the current element before checking for its complement (matching an element with itself).", "Using a list as a key.", "Counting pairs twice (ordered versus unordered).", "Printing a set directly and expecting a stable order.", "Forgetting the empty prefix (seen[0] = 1) in prefix-sum counting."],
  practices: ["Say which question the dictionary answers.", "Decide first what the key and the value are.", "Sort before printing sets.", "Check the one-element and all-equal inputs."],
  interview: ["How do you solve two sum in one pass?", "How do you count subarrays with sum k?", "How would you implement an LRU cache?", "What is the average and worst-case cost of a dictionary lookup?"],
  practiceQs: ["What goes in the dictionary for subarray sum divisible by k?", "Why start seen with {0: 1}?", "What makes a valid dictionary key?", "How do you find the most frequent element?"],
  revision: ["Complement lookup, frequency tables, canonical keys.", "Prefix sums + dictionary count ranges.", "Sets for existence; sort before printing.", "LRU = dict + recency order."],
  hinglish: "Dictionary ya set se pooch sakte ho: kya ye cheez pehle dikh chuki hai? Isse O(n^2) wale sawal O(n) ban jaate hain. Two sum mein har number ke liye target - x pehle dekha hua hai ya nahi, ye check karo, aur prefix sum ko dictionary mein ginkar subarrays ginte hain.",
  quiz: [
    mcq("What is the average cost of looking up a key in a Python dictionary?", ["O(n)", "O(log n)", "O(1)", "O(n^2)"], 2, "Hashing locates the bucket directly."),
    mcq("Which of these cannot be a dictionary key?", ["(1, 2)", "\"abc\"", "[1, 2]", "42"], 2, "Lists are mutable and unhashable."),
    mcq("Why does subarray-sum counting start with seen[0] = 1?", ["To avoid errors", "A subarray starting at index 0 uses the empty prefix with sum 0", "Python requires it", "To sort the keys"], 1, "The empty prefix lets a prefix that equals k count as a subarray from the start."),
    mcq("How do you count subarrays with exactly k distinct values using a sliding window?", ["at_most(k) - at_most(k - 1)", "at_most(k) + at_most(k - 1)", "Sort first", "Recursion"], 0, "Subtract the windows with fewer than k distinct values."),
    mcq("Which structure gives an LRU cache O(1) get and put in Python?", ["A plain list", "OrderedDict with move_to_end and popitem(last=False)", "A sorted list", "A tuple"], 1, "It stores items in order and supports fast reordering.")
  ],
  tasks: [
    p({ t: "Two Sum Indices", d: "E", tags: ["hashing", "array"], tc: "O(n)", sc: "O(n)", goal: "Replace a pair search by one dictionary lookup per element.", hint: "For each element check whether target - x was already seen, then store the element.",
      s: "Read a line of integers and a target. Exactly one pair of different positions adds up to the target. Print their two indices (0-based) in ascending order.", inp: "Line 1: the array. Line 2: the target.", out: "Two indices.", edge: "equal numbers, negatives",
      sol: `nums = list(map(int, input().split()))
target = int(input())
seen = {}
for i, x in enumerate(nums):
    if target - x in seen:
        print(seen[target - x], i)
        break
    seen[x] = i`, c: [["2 7 11 15\n9", "0 1"], ["3 2 4\n6", "1 2"], ["3 3\n6", "0 1"], ["1 5 5 8\n10", "1 2"]] }),
    p({ t: "Contains Duplicate", d: "E", tags: ["hashing", "array"], tc: "O(n)", sc: "O(n)", goal: "Use the size of a set to detect repetition.", hint: "If the set has fewer elements than the list, something repeats.",
      s: "Read a line of integers. Print yes if any value appears at least twice, otherwise no.", inp: "One line.", out: "yes or no.", edge: "single element",
      sol: `a = input().split()
print("yes" if len(set(a)) < len(a) else "no")`, c: [["1 2 3 1", "yes"], ["1 2 3 4", "no"], ["5", "no"], ["7 7", "yes"]] }),
    p({ t: "Majority Element", d: "E", tags: ["hashing", "voting"], tc: "O(n)", sc: "O(1)", goal: "Learn the Boyer-Moore voting idea, which finds a majority with constant memory.", hint: "Keep a candidate and a counter: matching values add one, others subtract one, and reset the candidate when the counter hits zero.",
      s: "Read a line of integers in which one value appears more than n/2 times. Print that value.", inp: "One line.", out: "The majority value.", edge: "single element",
      sol: `a = list(map(int, input().split()))
candidate, count = None, 0
for x in a:
    if count == 0:
        candidate = x
    count += 1 if x == candidate else -1
print(candidate)`, c: [["3 2 3", "3"], ["2 2 1 1 1 2 2", "2"], ["1", "1"], ["6 6 6 7 7", "6"]] }),
    p({ t: "Intersection of Two Arrays", d: "E", tags: ["hashing", "sets"], tc: "O(n + m)", sc: "O(n + m)", goal: "Use set intersection and print a deterministic order.", hint: "Convert both to sets, intersect, sort for printing.",
      s: "Read two lines of integers. Print the distinct values that appear in both lines in ascending order, or none.", inp: "Two lines.", out: "Sorted common values or none.", edge: "no common values",
      sol: `a = set(map(int, input().split()))
b = set(map(int, input().split()))
common = sorted(a & b)
print(*common if common else ["none"])`, c: [["1 2 2 1\n2 2", "2"], ["4 9 5\n9 4 9 8 4", "4 9"], ["1 2\n3 4", "none"], ["5\n5", "5"]] }),
    p({ t: "Ransom Note", d: "E", tags: ["hashing", "counting"], tc: "O(n + m)", sc: "O(k)", goal: "Compare letter budgets with Counter subtraction.", hint: "Counter(note) - Counter(magazine) is empty exactly when the magazine has enough of every letter.",
      s: "Read a ransom note and then a magazine (each a single word of letters). Print yes if the note can be built from the magazine's letters, each letter used at most once, otherwise no.", inp: "Two lines.", out: "yes or no.", edge: "magazine shorter than the note",
      sol: `from collections import Counter

note = input()
magazine = input()
print("yes" if not (Counter(note) - Counter(magazine)) else "no")`, c: [["a\nb", "no"], ["aa\naab", "yes"], ["aab\nbaa", "yes"], ["abc\nab", "no"]] }),
    p({ t: "Isomorphic Strings", d: "E", tags: ["hashing", "string"], tc: "O(n)", sc: "O(k)", goal: "Check that a character mapping is one-to-one in both directions.", hint: "The number of distinct pairs must equal the number of distinct characters in each string.",
      s: "Read two strings of equal length. Print yes if the characters of the first can be replaced consistently (one-to-one) to give the second, otherwise no.", inp: "Two lines.", out: "yes or no.", edge: "two characters mapping to the same one",
      sol: `a = input()
b = input()
print("yes" if len(set(zip(a, b))) == len(set(a)) == len(set(b)) else "no")`, c: [["egg\nadd", "yes"], ["foo\nbar", "no"], ["paper\ntitle", "yes"], ["ab\naa", "no"]] }),
    p({ t: "Happy Number", d: "E", tags: ["hashing", "math", "cycle-detection"], tc: "O(log n) per step", sc: "O(log n)", goal: "Detect a repeating cycle with a set of seen values.", hint: "Replace the number by the sum of the squares of its digits until it is 1 or a value repeats.",
      s: "Read a positive integer. Repeatedly replace it by the sum of the squares of its digits. Print yes if this reaches 1, or no if it loops forever.", inp: "One integer.", out: "yes or no.", edge: "1, numbers that cycle",
      sol: `n = int(input())
seen = set()
while n != 1 and n not in seen:
    seen.add(n)
    n = sum(int(d) ** 2 for d in str(n))
print("yes" if n == 1 else "no")`, c: [["19", "yes"], ["2", "no"], ["1", "yes"], ["7", "yes"]] }),
    p({ t: "Single Number", d: "E", tags: ["hashing", "bit-manipulation"], tc: "O(n)", sc: "O(1)", goal: "Use the fact that x xor x is 0 to cancel pairs.", hint: "XOR of all numbers cancels every value that appears twice.",
      s: "Read a line of integers where every value appears twice except one. Print the value that appears once.", inp: "One line.", out: "The single value.", edge: "single element, negatives",
      sol: `result = 0
for x in map(int, input().split()):
    result ^= x
print(result)`, c: [["2 2 1", "1"], ["4 1 2 1 2", "4"], ["1", "1"], ["7 3 7", "3"]] }),
    p({ t: "First Repeating Element", d: "E", tags: ["hashing", "array"], tc: "O(n)", sc: "O(n)", goal: "Combine counting with a second ordered scan.", hint: "Count every value, then scan from the left and print the first value whose count exceeds one.",
      s: "Read a line of integers. Among the values that appear more than once, print the one whose first occurrence is leftmost; print none if no value repeats.", inp: "One line.", out: "A value or none.", edge: "no repeats",
      sol: `from collections import Counter

a = list(map(int, input().split()))
counts = Counter(a)
for x in a:
    if counts[x] > 1:
        print(x)
        break
else:
    print("none")`, c: [["10 5 3 4 3 5 6", "5"], ["1 2 3 4", "none"], ["6 10 5 4 9 120 4 6 10", "6"], ["2 1 2 1", "2"]] }),
    p({ t: "Top K Frequent Elements", d: "M", tags: ["hashing", "counting", "sorting"], tc: "O(n log n)", sc: "O(n)", goal: "Count, then sort by frequency with a deterministic tie-break.", hint: "Sort the (value, count) pairs by (-count, value) and take the first k.",
      s: "Read a line of integers and then k. Print the k most frequent values, most frequent first; values with the same frequency are ordered from smaller to larger.", inp: "Line 1: the array. Line 2: k.", out: "k values.", edge: "ties",
      sol: `from collections import Counter

a = list(map(int, input().split()))
k = int(input())
ranked = sorted(Counter(a).items(), key=lambda pair: (-pair[1], pair[0]))
print(*(value for value, _ in ranked[:k]))`, c: [["1 1 1 2 2 3\n2", "1 2"], ["1\n1", "1"], ["4 4 5 5 6\n2", "4 5"], ["-1 -1 2 2 3\n1", "-1"]] }),
    p({ t: "Longest Consecutive Sequence", d: "M", tags: ["hashing", "sets"], tc: "O(n)", sc: "O(n)", goal: "Start counting only from numbers that begin a run, which keeps the total work linear.", hint: "Put all numbers in a set; for each x whose predecessor x - 1 is missing, count upwards.",
      s: "Read a line of integers. Print the length of the longest run of consecutive integers (such as 3 4 5 6) that can be formed from the values, in O(n) time.", inp: "One line.", out: "An integer.", edge: "duplicates, single element",
      sol: `nums = set(map(int, input().split()))
best = 0
for x in nums:
    if x - 1 not in nums:
        y = x
        while y + 1 in nums:
            y += 1
        best = max(best, y - x + 1)
print(best)`, c: [["100 4 200 1 3 2", "4"], ["0 3 7 2 5 8 4 6 0 1", "9"], ["5", "1"], ["1 2 0 1", "3"]] }),
    p({ t: "Four Sum Count", d: "M", tags: ["hashing", "meet-in-the-middle"], tc: "O(n^2)", sc: "O(n^2)", goal: "Split four lists into two pairs and count complementary sums.", hint: "Count every a + b in a dictionary, then for each c + d add the count of -(c + d).",
      s: "Read four lines of n integers each (lists A, B, C and D). Print the number of tuples (i, j, k, l) with A[i] + B[j] + C[k] + D[l] equal to 0.", inp: "Four lines.", out: "An integer.", edge: "n = 1, all zero",
      sol: `from collections import Counter

a, b, c, d = (list(map(int, input().split())) for _ in range(4))
sums = Counter(x + y for x in a for y in b)
print(sum(sums[-(x + y)] for x in c for y in d))`, c: [["1 2\n-2 -1\n-1 2\n0 2", "2"], ["0\n0\n0\n0", "1"], ["1 1\n1 1\n-1 -1\n-1 -1", "16"], ["1\n2\n3\n4", "0"]] }),
    p({ t: "Subarrays Divisible by K", d: "M", tags: ["hashing", "prefix-sum", "modulo"], tc: "O(n)", sc: "O(k)", goal: "Two prefix sums with the same remainder bound a subarray whose sum is divisible by k.", hint: "Track prefix sum % k; count how many earlier prefixes had the same remainder.",
      s: "Read a line of integers and then k. Print how many contiguous subarrays have a sum divisible by k.", inp: "Line 1: the array. Line 2: k.", out: "An integer.", edge: "negative numbers",
      sol: `from collections import defaultdict

a = list(map(int, input().split()))
k = int(input())
seen = defaultdict(int)
seen[0] = 1
total = count = 0
for x in a:
    total = (total + x) % k
    count += seen[total]
    seen[total] += 1
print(count)`, c: [["4 5 0 -2 -3 1\n5", "7"], ["5\n9", "0"], ["2 -2 2\n2", "6"], ["1 2 3\n3", "3"]] }),
    p({ t: "Contiguous Array", d: "M", tags: ["hashing", "prefix-sum"], tc: "O(n)", sc: "O(n)", goal: "Turn 'equal zeros and ones' into 'balance returns to a previous value'.", hint: "Add +1 for a one and -1 for a zero; the same balance at two indices means the part between them is balanced.",
      s: "Read a line of 0s and 1s. Print the length of the longest contiguous subarray that contains the same number of 0s and 1s (0 if none).", inp: "One line.", out: "An integer.", edge: "no balanced part",
      sol: `a = list(map(int, input().split()))
first = {0: -1}
balance = best = 0
for i, x in enumerate(a):
    balance += 1 if x == 1 else -1
    if balance in first:
        best = max(best, i - first[balance])
    else:
        first[balance] = i
print(best)`, c: [["0 1", "2"], ["0 1 0", "2"], ["0 0 1 0 0 0 1 1", "6"], ["1 1 1", "0"]] }),
    p({ t: "Valid Sudoku Board", d: "M", tags: ["hashing", "matrix"], tc: "O(81)", sc: "O(81)", goal: "Track rows, columns and 3 x 3 boxes with one set of keys.", hint: "Store a key for (row, digit), (column, digit) and (box, digit); a repeated key is a violation.",
      s: "Read 9 lines of 9 characters each, a digit 1-9 or a dot for an empty cell. Print yes if no row, column or 3 x 3 box contains the same digit twice (the board need not be solvable), otherwise no.", inp: "9 lines of 9 characters.", out: "yes or no.", edge: "duplicate inside a box only",
      sol: `board = [input() for _ in range(9)]
seen = set()
ok = True
for r in range(9):
    for c in range(9):
        ch = board[r][c]
        if ch == ".":
            continue
        keys = [("row", r, ch), ("col", c, ch), ("box", r // 3, c // 3, ch)]
        if any(key in seen for key in keys):
            ok = False
        seen.update(keys)
print("yes" if ok else "no")`, c: [["53..7....\n6..195...\n.98....6.\n8...6...3\n4..8.3..1\n7...2...6\n.6....28.\n...419..5\n....8..79", "yes"], ["53..7....\n8..195...\n.98....6.\n8...6...3\n4..8.3..1\n7...2...6\n.6....28.\n...419..5\n....8..79", "no"], ["53..7....\n6.3195...\n.98....6.\n8...6...3\n4..8.3..1\n7...2...6\n.6....28.\n...419..5\n....8..79", "no"], ["53..7...3\n6..195...\n.98....6.\n8...6...3\n4..8.3..1\n7...2...6\n.6....28.\n...419..5\n....8..79", "no"]] }),
    p({ t: "Anagram Start Indices", d: "M", tags: ["hashing", "sliding-window"], tc: "O(n)", sc: "O(k)", goal: "Maintain letter counts of a fixed-size window instead of recounting.", hint: "Add the new right character, compare the counts with the pattern's, then remove the left character.",
      s: "Read a string s and a pattern p. Print the start indices (0-based, ascending, separated by spaces) of every substring of s that is an anagram of p, or none.", inp: "Two lines.", out: "Indices or none.", edge: "pattern longer than s",
      sol: `from collections import Counter

s = input()
p = input()
need = Counter(p)
window = Counter(s[:len(p) - 1])
out = []
for i in range(len(p) - 1, len(s)):
    window[s[i]] += 1
    if window == need:
        out.append(i - len(p) + 1)
    left = s[i - len(p) + 1]
    window[left] -= 1
    if window[left] == 0:
        del window[left]
print(*out if out else ["none"])`, c: [["cbaebabacd\nabc", "0 6"], ["abab\nab", "0 1 2"], ["a\nb", "none"], ["aa\naa", "0"]] }),
    p({ t: "Pairs With Given Difference", d: "M", tags: ["hashing", "sets"], tc: "O(n)", sc: "O(n)", goal: "Count pairs of distinct values by testing x + k in a set.", hint: "For every distinct value x, check whether x + k is also present.",
      s: "Read a line of integers and a positive difference k. Print how many pairs of distinct values (a, b) in the array have b - a equal to k; equal values count once.", inp: "Line 1: the array. Line 2: k.", out: "An integer.", edge: "duplicates",
      sol: `values = set(map(int, input().split()))
k = int(input())
print(sum(1 for x in values if x + k in values))`, c: [["1 5 3 4 2\n2", "3"], ["8 12 16 4 0 20\n4", "5"], ["1 1 1\n1", "0"], ["1 2\n5", "0"]] }),
    p({ t: "Top Words by Frequency", d: "M", tags: ["hashing", "counting", "sorting"], tc: "O(n log n)", sc: "O(n)", goal: "Rank words with a two-part sort key: frequency descending, then alphabetical.", hint: "Sort Counter items by (-count, word).",
      s: "Read a line of lower-case words and then k. Print the k most frequent words, one per line as word count, most frequent first and alphabetical among equal counts.", inp: "Line 1: the words. Line 2: k.", out: "k lines.", edge: "ties, k larger than the number of distinct words",
      sol: `from collections import Counter

counts = Counter(input().split())
k = int(input())
for word, count in sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[:k]:
    print(word, count)`, c: [["the cat and the dog and the bird\n2", "the 3\nand 2"], ["a b c\n3", "a 1\nb 1\nc 1"], ["x x y\n1", "x 2"], ["b a b a c\n2", "a 2\nb 2"]] }),
    p({ t: "LRU Cache Simulation", d: "H", tags: ["hashing", "design", "ordered-dict"], tc: "O(1) per operation", sc: "O(capacity)", goal: "Combine a hash table with recency order to get constant-time get and put with eviction.", hint: "Use OrderedDict: move a key to the end on every get or put, and pop from the front when the capacity is exceeded.",
      s: "Read the capacity and then operations, one per line, until the input ends: put KEY VALUE or get KEY. When the cache is full, putting a new key removes the least recently used key (a get or a put makes a key most recent). For every get print its value, or -1 if the key is absent.", inp: "Line 1: capacity. Then operations.", out: "One line per get.", edge: "updating an existing key, capacity 1",
      sol: `import sys
from collections import OrderedDict

lines = sys.stdin.read().split("\\n")
capacity = int(lines[0])
cache = OrderedDict()
for line in lines[1:]:
    parts = line.split()
    if not parts:
        continue
    if parts[0] == "put":
        key, value = int(parts[1]), int(parts[2])
        if key in cache:
            cache.move_to_end(key)
        cache[key] = value
        if len(cache) > capacity:
            cache.popitem(last=False)
    else:
        key = int(parts[1])
        if key in cache:
            cache.move_to_end(key)
            print(cache[key])
        else:
            print(-1)`, c: [["2\nput 1 1\nput 2 2\nget 1\nput 3 3\nget 2\nput 4 4\nget 1\nget 3\nget 4", "1\n-1\n-1\n3\n4"], ["1\nput 1 1\nput 2 2\nget 1\nget 2", "-1\n2"], ["2\nput 1 1\nput 1 5\nget 1", "5"], ["2\nput 1 1\nput 2 2\nput 1 10\nput 3 3\nget 2\nget 1", "-1\n10"]] }),
    p({ t: "Maximum Points on a Line", d: "H", tags: ["hashing", "geometry", "gcd"], tc: "O(n^2)", sc: "O(n)", goal: "Represent slopes as reduced integer pairs so equal slopes collide exactly, with no floating point.", hint: "For each anchor point count other points by the direction (dx, dy) divided by gcd and normalised in sign.",
      s: "Read n and then n distinct points x y. Print the largest number of points that lie on one straight line.", inp: "Line 1: n. Then n points.", out: "An integer.", edge: "n = 1, vertical lines",
      sol: `from math import gcd

n = int(input())
pts = [tuple(map(int, input().split())) for _ in range(n)]
best = 1
for i in range(n):
    slopes = {}
    for j in range(i + 1, n):
        dx, dy = pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]
        g = gcd(dx, dy)
        dx, dy = dx // g, dy // g
        if dx < 0 or (dx == 0 and dy < 0):
            dx, dy = -dx, -dy
        slopes[(dx, dy)] = slopes.get((dx, dy), 0) + 1
        best = max(best, slopes[(dx, dy)] + 1)
print(best)`, c: [["3\n1 1\n2 2\n3 3", "3"], ["6\n1 1\n3 2\n5 3\n4 1\n2 3\n1 4", "4"], ["1\n0 0", "1"], ["2\n0 0\n5 7", "2"]] }),
    p({ t: "Subarrays With K Different Integers", d: "H", tags: ["hashing", "sliding-window"], tc: "O(n)", sc: "O(n)", goal: "Turn an exact-count problem into the difference of two at-most problems, each solved with a window.", hint: "exactly(k) = atMost(k) - atMost(k - 1); atMost uses a window that shrinks while it has more than k distinct values.",
      s: "Read a line of integers and then k. Print the number of contiguous subarrays that contain exactly k distinct values.", inp: "Line 1: the array. Line 2: k.", out: "An integer.", edge: "k larger than the number of distinct values",
      sol: `from collections import defaultdict

a = list(map(int, input().split()))
k = int(input())


def at_most(limit):
    count = defaultdict(int)
    left = total = 0
    for right, x in enumerate(a):
        count[x] += 1
        while len(count) > limit:
            count[a[left]] -= 1
            if count[a[left]] == 0:
                del count[a[left]]
            left += 1
        total += right - left + 1
    return total


print(at_most(k) - at_most(k - 1))`, c: [["1 2 1 2 3\n2", "7"], ["1 2 1 3 4\n3", "3"], ["1\n1", "1"], ["1 1 1\n1", "6"]] }),
  ],
});

module.exports = { lessons };
