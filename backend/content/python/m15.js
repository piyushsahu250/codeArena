// Phase 3 / Module 15: Core Data Structures. Assembled from chapter files, one chapter per theme.
"use strict";
const { task } = require("./lib");
const chapters = [require("./m15a"), require("./m15b"), require("./m15c"), require("./m15d")];

module.exports = {
  module: {
    title: "Phase 3 - Module 15: Core Data Structures",
    description: "Arrays and strings, two pointers, sliding window, hashing, stacks, queues, linked lists, trees, heaps, graphs, recursion and backtracking, dynamic programming and greedy algorithms, with coding patterns and interview problems for every topic.",
    chapters: chapters.map((c) => ({ title: c.title, description: c.description, lessons: c.lessons })),
    assessment: {
      title: "Module 15 Assessment: Core Data Structures",
      description: "Mixed problems: subset sums, grid paths, robbing houses and edit distance.",
      questions: [
        task("Count subsets with a given sum", "Read a line of positive integers and a target. Print the number of subsets (any choice of items, order does not matter) whose sum equals the target.", "", `nums = list(map(int, input().split()))\ntarget = int(input())\nways = [1] + [0] * target\nfor x in nums:\n    for s in range(target, x - 1, -1):\n        ways[s] += ways[s - x]\nprint(ways[target])`, [["1 2 3 4 5\n5", "3"], ["2 4\n3", "0"]], [["1 2 3 4 5\n5", "3"], ["2 4\n3", "0"], ["1 1 1 1\n2", "6"], ["5\n5", "1"], ["3 34 4 12 5 2\n9", "2"]]),
        task("Minimum path sum", "Read r and c, then r lines of c non-negative integers. Moving only right or down from the top-left to the bottom-right, print the smallest possible sum of the cells visited.", "", `r, c = map(int, input().split())\ngrid = [list(map(int, input().split())) for _ in range(r)]\nfor i in range(r):\n    for j in range(c):\n        if i == 0 and j == 0:\n            continue\n        up = grid[i - 1][j] if i else float("inf")\n        left = grid[i][j - 1] if j else float("inf")\n        grid[i][j] += min(up, left)\nprint(grid[-1][-1])`, [["3 3\n1 3 1\n1 5 1\n4 2 1", "7"], ["1 3\n1 2 3", "6"]], [["3 3\n1 3 1\n1 5 1\n4 2 1", "7"], ["1 3\n1 2 3", "6"], ["2 2\n1 2\n1 1", "3"], ["1 1\n9", "9"], ["3 1\n4\n5\n6", "15"]]),
        task("House robber", "Read a line of non-negative integers: the money in a row of houses. You cannot rob two neighbouring houses. Print the largest total you can take.", "", `take, skip = 0, 0\nfor h in map(int, input().split()):\n    take, skip = skip + h, max(take, skip)\nprint(max(take, skip))`, [["2 7 9 3 1", "12"], ["1 2 3 1", "4"]], [["2 7 9 3 1", "12"], ["1 2 3 1", "4"], ["5", "5"], ["2 1 1 2", "4"], ["10 1 1 10", "20"], ["0 0 0", "0"]]),
        task("Edit distance", "Read two words (one per line). Print the minimum number of single-character insertions, deletions and replacements that turn the first word into the second.", "", `a = input()\nb = input()\nprev = list(range(len(b) + 1))\nfor i in range(1, len(a) + 1):\n    cur = [i]\n    for j in range(1, len(b) + 1):\n        cost = 0 if a[i - 1] == b[j - 1] else 1\n        cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost))\n    prev = cur\nprint(prev[-1])`, [["kitten\nsitting", "3"], ["abc\nabc", "0"]], [["kitten\nsitting", "3"], ["abc\nabc", "0"], ["horse\nros", "3"], ["intention\nexecution", "5"], ["a\nb", "1"], ["abc\nabcd", "1"]]),
      ],
    },
  },
};
