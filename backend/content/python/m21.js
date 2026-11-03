// Phase 7 / Module 21: Python Coding Interview Preparation. Lessons live in m21a.js onward; this file adds the chapters and the module assessment.
"use strict";
const { task } = require("./lib");

const parts = [
  { title: "Method and Arrays", description: "How to solve a problem, then array and prefix-sum patterns.", files: ["./m21a"] },
  { title: "Strings and Hashing", description: "String patterns and dictionary and set patterns.", files: ["./m21b"] },
  { title: "Pointers, Windows and Stacks", description: "Two pointers, sliding windows, stacks, queues and monotonic structures.", files: ["./m21c"] },
  { title: "Searching, Sorting and Recursion", description: "Binary search, sorting, recursion, backtracking, bits and math.", files: ["./m21d"] },
  { title: "Trees and Graphs", description: "Binary trees, graph traversals, shortest paths and spanning trees.", files: ["./m21e"] },
  { title: "Dynamic Programming and Greedy Methods", description: "Dynamic programming, greedy rules, heaps and intervals.", files: ["./m21f"] },
];
const chapters = parts.map((part) => ({ title: part.title, description: part.description, lessons: part.files.flatMap((f) => require(f).lessons) }));

module.exports = {
  module: {
    title: "Phase 7 - Python Coding Interview Preparation",
    description: "A method for solving coding problems and a tagged bank of more than 200 original problems across arrays, strings, hashing, two pointers, stacks, binary search, recursion, trees and graphs, dynamic programming and greedy techniques, each with difficulty, topic and style tags, intended complexity and a learning objective.",
    minProblems: 200,
    chapters,
    assessment: {
      title: "Module 21 Assessment: Coding Interview Preparation",
      description: "Four timed problems that are not in the practice bank.",
      questions: [
        task("Valid Mountain Array", "Read a line of integers. Print yes if the array strictly increases to a single peak and then strictly decreases (the peak is not the first or last element), otherwise print no.", "", `a = list(map(int, input().split()))
n = len(a)
i = 0
while i + 1 < n and a[i] < a[i + 1]:
    i += 1
if i == 0 or i == n - 1:
    print("no")
else:
    while i + 1 < n and a[i] > a[i + 1]:
        i += 1
    print("yes" if i == n - 1 else "no")`, [["0 3 2 1", "yes"], ["3 5 5", "no"], ["1 2 3", "no"], ["2 1", "no"]]),
        task("Count Pairs With Target Sum", "Read a line of integers and then a target. Print how many pairs of positions i < j have a[i] + a[j] equal to the target.", "", `from collections import Counter

a = list(map(int, input().split()))
target = int(input())
seen = Counter()
count = 0
for x in a:
    count += seen[target - x]
    seen[x] += 1
print(count)`, [["1 5 7 -1 5\n6", "3"], ["1 1 1 1\n2", "6"], ["1 2 3\n10", "0"], ["4\n8", "0"]]),
        task("Minimum Deletions for Balanced Brackets", "Read a string of round brackets ( and ). Print the minimum number of characters that must be deleted to make the brackets balanced.", "", `s = input()
open_count = deletions = 0
for ch in s:
    if ch == "(":
        open_count += 1
    elif open_count:
        open_count -= 1
    else:
        deletions += 1
print(deletions + open_count)`, [["())", "1"], ["(((", "3"], ["()()", "0"], [")(", "2"]]),
        task("Longest Common Subsequence Length", "Read two strings on separate lines. Print the length of their longest common subsequence.", "", `a = input()
b = input()
dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
for i in range(1, len(a) + 1):
    for j in range(1, len(b) + 1):
        if a[i - 1] == b[j - 1]:
            dp[i][j] = dp[i - 1][j - 1] + 1
        else:
            dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
print(dp[-1][-1])`, [["abcde\nace", "3"], ["abc\nabc", "3"], ["abc\ndef", "0"], ["AGGTAB\nGXTXAYB", "4"]]),
      ],
    },
  },
};
