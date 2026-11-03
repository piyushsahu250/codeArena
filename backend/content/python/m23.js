// Phase 7 / Module 23: Placement Assessment Preparation. Lessons live in m23a.js and m23b.js; this file adds the chapters,
// the module assessment and four timed mock tests. A mock is a ModuleCodingTest (a Level on the module's first chapter) with its own time limit.
// The mock names describe the style of test practised; none of them is claimed to be a real company's test.
"use strict";
const { task } = require("./lib");

const a = require("./m23a").lessons;
const b = require("./m23b").lessons;
const chapters = [
  { title: "Test Strategy and Concept Practice", description: "How online assessments work, then multiple-choice and output-prediction practice.", lessons: [a[0], a[1], a[2]] },
  { title: "Errors, Completion and Debugging", description: "Find the error, complete the code and fix broken programs.", lessons: [b[0], b[1], b[2]] },
  { title: "Interview Simulation", description: "Technical, project and HR rounds.", lessons: [b[3]] },
];

const MOCK_INSTRUCTIONS = "Timed practice test. Write a complete Python program for each problem that reads standard input and prints to standard output. Marks are given in proportion to the hidden test cases you pass, so attempt every problem. Work alone and without outside help, exactly as you would in a real assessment. This is a practice test in the style named in its title.";

const withLevel = (t, difficulty) => ({ ...t, difficulty });

module.exports = {
  module: {
    title: "Phase 7 - Placement Assessment Preparation",
    description: "How online placement assessments work, practice sets for multiple-choice, output-prediction, find-the-error and code-completion questions, debugging challenges, an interview simulation, and four timed mock tests in the style of campus, service-company, product-company and contest assessments.",
    chapters,
    assessment: {
      title: "Module 23 Assessment: Placement Readiness Check",
      description: "Four short problems that are not in the practice sets or mock tests.",
      questions: [
        task("Count Vowels per Word", "Read a line of words. For each word print the word and the number of vowels (a, e, i, o, u, either case) it contains. One line per word.", "", `for word in input().split():
    print(word, sum(1 for ch in word.lower() if ch in "aeiou"))`, [["banana orange sky", "banana 3\norange 3\nsky 0"], ["AEIOU", "AEIOU 5"], ["rhythm", "rhythm 0"], ["idea queue", "idea 3\nqueue 4"]]),
        task("Rank the Students", "Read n and then n lines of name and integer score. Print one line per student as rank name score, ordered by score from high to low and by name for equal scores. Students with equal scores share a rank, and the next rank skips accordingly (1, 1, 3).", "", `n = int(input())
rows = [input().split() for _ in range(n)]
rows = sorted(((-int(score), name) for name, score in rows))
rank = 0
previous = None
for position, (neg, name) in enumerate(rows, 1):
    if neg != previous:
        rank = position
        previous = neg
    print(rank, name, -neg)`, [["4\nasha 90\nravi 85\nzoya 90\nkabir 70", "1 asha 90\n1 zoya 90\n3 ravi 85\n4 kabir 70"], ["1\nx 5", "1 x 5"], ["3\nb 1\na 1\nc 2", "1 c 2\n2 a 1\n2 b 1"], ["2\nq 10\nr 10", "1 q 10\n1 r 10"]]),
        task("Bank Account Simulator", "Process commands read until the end of input: deposit X adds X to the balance, withdraw X removes X if the balance is enough (otherwise it prints insufficient funds and changes nothing), and balance prints the current balance. The balance starts at 0.", "", `import sys

balance = 0
for line in sys.stdin.read().splitlines():
    parts = line.split()
    if not parts:
        continue
    if parts[0] == "deposit":
        balance += int(parts[1])
    elif parts[0] == "withdraw":
        if int(parts[1]) > balance:
            print("insufficient funds")
        else:
            balance -= int(parts[1])
    else:
        print(balance)`, [["deposit 100\nwithdraw 30\nbalance\nwithdraw 100\nbalance", "70\ninsufficient funds\n70"], ["balance", "0"], ["deposit 50\ndeposit 25\nbalance", "75"], ["withdraw 5", "insufficient funds"]]),
        task("Days Between Dates", "Read two dates written as YYYY-MM-DD on one line. Print the number of days between them (always non-negative).", "", `from datetime import date

a, b = (date.fromisoformat(x) for x in input().split())
print(abs((b - a).days))`, [["2026-01-31 2026-03-01", "29"], ["2026-01-01 2026-01-01", "0"], ["2024-02-28 2024-03-01", "2"], ["2000-01-01 1999-12-31", "1"]]),
      ],
    },
    mocks: [
      {
        title: "Mock Test 1: Campus Online-Assessment Style (45 minutes)",
        description: "Three problems in the style of a first-round campus coding test: two easy and one medium.",
        timeLimitMin: 45, passingPercent: 50, difficulty: "Beginner", securityLevel: "STANDARD", instructions: MOCK_INSTRUCTIONS,
        questions: [
          withLevel(task("Digit Frequency Report", "Read a string of digits. For every digit that occurs, in ascending order, print the digit, a colon, a space and how many times it occurs, one digit per line.", "", `s = input()
for d in sorted(set(s)):
    print(f"{d}: {s.count(d)}")`, [["1123", "1: 2\n2: 1\n3: 1"], ["0", "0: 1"], ["9990", "0: 1\n9: 3"], ["5", "5: 1"]]), "EASY"),
          withLevel(task("Leap Years in a Range", "Read two years a and b (a <= b) on one line. Print how many leap years lie between them, both included. A year is a leap year if it is divisible by 4, except years divisible by 100 that are not divisible by 400.", "", `a, b = map(int, input().split())
print(sum(1 for y in range(a, b + 1) if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)))`, [["2000 2020", "6"], ["1900 1900", "0"], ["2024 2024", "1"], ["1896 1904", "2"]]), "EASY"),
          withLevel(task("Equal Digit Sum Pairs", "Read a line of positive integers. Print how many pairs of positions i < j have numbers with the same digit sum.", "", `from collections import Counter

counts = Counter(sum(map(int, n)) for n in input().split())
print(sum(c * (c - 1) // 2 for c in counts.values()))`, [["12 21 3 30", "6"], ["10 19 28", "1"], ["5", "0"], ["1 10 100 1000 11", "6"]]), "MEDIUM"),
        ],
      },
      {
        title: "Mock Test 2: Service-Company Online-Test Style (75 minutes)",
        description: "Four problems in the style of a longer online test used for large-scale campus hiring: three easy and one medium.",
        timeLimitMin: 75, passingPercent: 50, difficulty: "Beginner", securityLevel: "STANDARD", instructions: MOCK_INSTRUCTIONS,
        questions: [
          withLevel(task("Sum of Primes Below N", "Read an integer n. Print the sum of all prime numbers smaller than n (0 if there are none).", "", `n = int(input())
sieve = [True] * max(n, 2)
total = 0
for i in range(2, n):
    if sieve[i]:
        total += i
        for j in range(i * i, n, i):
            sieve[j] = False
print(total)`, [["10", "17"], ["2", "0"], ["3", "2"], ["30", "129"]]), "EASY"),
          withLevel(task("Reverse Each Word", "Read a sentence of words separated by single spaces. Print the sentence with every word reversed but the order of the words unchanged.", "", `print(*(w[::-1] for w in input().split()))`, [["hello world", "olleh dlrow"], ["a", "a"], ["Python is fun", "nohtyP si nuf"], ["ab cd ef", "ba dc fe"]]), "EASY"),
          withLevel(task("Diagonal Difference", "Read n and then an n by n matrix of integers. Print the absolute difference between the sum of the main diagonal and the sum of the anti-diagonal.", "", `n = int(input())
m = [list(map(int, input().split())) for _ in range(n)]
print(abs(sum(m[i][i] for i in range(n)) - sum(m[i][n - 1 - i] for i in range(n))))`, [["3\n11 2 4\n4 5 6\n10 8 -12", "15"], ["1\n7", "0"], ["2\n1 2\n3 4", "0"], ["2\n1 0\n0 5", "6"]]), "EASY"),
          withLevel(task("Longest Alphabetical Run", "Read a lower-case string. Print its longest substring in which the letters never go backwards in the alphabet (each letter is at least the one before it). If several are equally long print the first.", "", `s = input()
best = s[0]
start = 0
for i in range(1, len(s) + 1):
    if i == len(s) or s[i] < s[i - 1]:
        if i - start > len(best):
            best = s[start:i]
        start = i
print(best)`, [["abcabcd", "abcd"], ["zyx", "z"], ["aabbcc", "aabbcc"], ["azbycx", "az"]]), "MEDIUM"),
        ],
      },
      {
        title: "Mock Test 3: Product-Company Interview Style (60 minutes)",
        description: "Three medium problems in the style of a technical screening round: merging, dependencies and intervals.",
        timeLimitMin: 60, passingPercent: 60, difficulty: "Intermediate", securityLevel: "PROCTORED", instructions: MOCK_INSTRUCTIONS,
        questions: [
          withLevel(task("Merge K Sorted Lists", "Read k and then k lines, each a sorted list of integers. Print all the numbers merged into one sorted line.", "", `import heapq

k = int(input())
lists = [list(map(int, input().split())) for _ in range(k)]
print(*heapq.merge(*lists))`, [["3\n1 4 5\n1 3 4\n2 6", "1 1 2 3 4 4 5 6"], ["1\n5 6", "5 6"], ["2\n1\n2", "1 2"], ["2\n1 1\n1 1", "1 1 1 1"]]), "MEDIUM"),
          withLevel(task("Project Duration", "Read n and m, then n task durations, then m dependencies u v meaning task u must finish before task v can start. Independent tasks can run at the same time. Print the least total time to finish all tasks (the length of the longest chain of dependent tasks).", "", `from collections import deque

n, m = map(int, input().split())
dur = list(map(int, input().split()))
adj = [[] for _ in range(n)]
indeg = [0] * n
for _ in range(m):
    u, v = map(int, input().split())
    adj[u].append(v)
    indeg[v] += 1
finish = dur[:]
queue = deque(i for i in range(n) if indeg[i] == 0)
while queue:
    u = queue.popleft()
    for v in adj[u]:
        finish[v] = max(finish[v], finish[u] + dur[v])
        indeg[v] -= 1
        if indeg[v] == 0:
            queue.append(v)
print(max(finish))`, [["4 3\n3 2 4 1\n0 1\n0 2\n1 3", "7"], ["1 0\n5", "5"], ["3 0\n2 7 4", "7"], ["3 2\n1 1 1\n0 1\n1 2", "3"]]), "MEDIUM"),
          withLevel(task("Maximum Simultaneous Events", "Read n and then n events as start and end times; an event is active from its start up to but not including its end. Print the largest number of events that are active at the same moment.", "", `n = int(input())
points = []
for _ in range(n):
    start, end = map(int, input().split())
    points.append((start, 1))
    points.append((end, -1))
points.sort()
active = best = 0
for _, delta in points:
    active += delta
    best = max(best, active)
print(best)`, [["3\n1 5\n2 6\n5 8", "2"], ["1\n1 2", "1"], ["3\n1 3\n1 3\n1 3", "3"], ["2\n1 2\n2 3", "1"]]), "MEDIUM"),
        ],
      },
      {
        title: "Mock Test 4: Advanced Contest Style (90 minutes)",
        description: "Three harder problems in the style of an advanced coding round: counting subsets, strings and a matrix.",
        timeLimitMin: 90, passingPercent: 60, difficulty: "Advanced", securityLevel: "PROCTORED", instructions: MOCK_INSTRUCTIONS,
        questions: [
          withLevel(task("Count Subsets With Target Sum", "Read a line of non-negative integers and a target. Print the number of subsets (chosen by position, so equal numbers at different places count separately, and the empty subset counts when the target is 0) whose sum equals the target.", "", `nums = list(map(int, input().split()))
target = int(input())
dp = [1] + [0] * target
for x in nums:
    for s in range(target, x - 1, -1):
        dp[s] += dp[s - x]
print(dp[target])`, [["1 2 3 4 5\n5", "3"], ["1 1 1\n2", "3"], ["2\n3", "0"], ["0 0\n0", "4"]]), "MEDIUM"),
          withLevel(task("Longest Common Substring", "Read two strings on separate lines. Print the length of the longest substring (contiguous characters) that appears in both.", "", `a = input()
b = input()
best = 0
prev = [0] * (len(b) + 1)
for i in range(1, len(a) + 1):
    cur = [0] * (len(b) + 1)
    for j in range(1, len(b) + 1):
        if a[i - 1] == b[j - 1]:
            cur[j] = prev[j - 1] + 1
            best = max(best, cur[j])
    prev = cur
print(best)`, [["abcdxyz\nxyzabcd", "4"], ["abc\ndef", "0"], ["aaaa\naa", "2"], ["pythonic\nthonic", "6"]]), "MEDIUM"),
          withLevel(task("Maximal Rectangle of Ones", "Read r and c and then r rows of 0 and 1 characters. Print the area of the largest rectangle made only of 1s.", "", `r, c = map(int, input().split())
heights = [0] * c
best = 0
for _ in range(r):
    row = input()
    heights = [h + 1 if ch == "1" else 0 for h, ch in zip(heights, row)]
    stack = []
    for i, h in enumerate(heights + [0]):
        while stack and heights[stack[-1]] >= h:
            height = heights[stack.pop()]
            width = i if not stack else i - stack[-1] - 1
            best = max(best, height * width)
        stack.append(i)
print(best)`, [["4 5\n10100\n10111\n11111\n10010", "6"], ["1 1\n1", "1"], ["2 2\n00\n00", "0"], ["2 3\n111\n111", "6"]]), "HARD"),
        ],
      },
    ],
  },
};
