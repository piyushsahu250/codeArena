// Phase 7 / Module 21, lessons 10-11: dynamic programming, and greedy methods with heaps and intervals, with tagged practice problems.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, prob: p } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 10
lessons.push({
  title: "Dynamic Programming: States, Transitions and Tables",
  minutes: 100,
  learn: ["Recognise overlapping subproblems and optimal substructure", "Define the state, the transition and the base case", "Write top-down (memoised) and bottom-up solutions", "Apply standard families: 1D, grid, knapsack, subsequence, interval and string DP"],
  why: "Dynamic programming (DP) turns exponential searches into polynomial ones by reusing answers to smaller problems. It is the topic candidates fear most, and a clear four-step routine makes it manageable.",
  realWorld: "Spell checkers (edit distance), diff tools (longest common subsequence), route planners, resource allocation (knapsack), text segmentation and many scheduling and finance calculations use DP.",
  simple: "If a problem breaks into smaller versions of itself that <em>repeat</em>, solve each small version <strong>once</strong>, store the answer, and build bigger answers from stored ones.",
  detail: `<h3>The four-step routine</h3>
<ol><li><strong>State</strong>: what does <code>dp[i]</code> (or <code>dp[i][j]</code>) mean in words? Example: &quot;the fewest coins to make amount i&quot;.</li><li><strong>Transition</strong>: how is a state computed from smaller states? Example: <code>dp[i] = min(dp[i - c] + 1 for each coin c)</code>.</li><li><strong>Base case</strong>: the states you know directly (<code>dp[0] = 0</code>).</li><li><strong>Answer and order</strong>: which state is the final answer, and in what order do you fill the table so dependencies are ready?</li></ol>
<h3>Two styles</h3>
<ul><li><strong>Top-down</strong>: write the recursion, add <code>@lru_cache(None)</code> (memoisation). Easy to get right; recursion depth can be a limit.</li><li><strong>Bottom-up</strong>: fill a table with loops. Faster and allows <em>space optimisation</em> (keep only the previous row or the last two values).</li></ul>
<h3>Families</h3>
${table(["Family", "State", "Examples"], [["linear 1D", "<code>dp[i]</code> best for the first i items", "climbing stairs, house robber, decode ways, word break, LIS (n^2 or n log n)"], ["grid", "<code>dp[r][c]</code>", "unique paths, minimum path sum, maximal square, triangle"], ["knapsack", "<code>dp[w]</code> over a capacity or target", "coin change (min / ways), partition equal subset, target sum"], ["two strings", "<code>dp[i][j]</code> over prefixes", "edit distance, longest common subsequence, distinct subsequences"], ["interval", "<code>dp[l][r]</code>", "burst balloons, palindromic subsequence"], ["state machine", "a few named states per day", "stock trading with cooldown or k transactions"]])}
<h3>Common transitions</h3>
<ul><li>Take or skip: <code>dp[i] = max(dp[i-1], dp[i-2] + a[i])</code> (house robber).</li><li>Unbounded items (coins): loop amounts upwards; 0/1 items: loop capacity <em>downwards</em> so each item is used once.</li><li>Strings: if the characters match <code>dp[i][j] = dp[i-1][j-1] + ...</code> else take the best of dropping a character from either side.</li></ul>
<h3>Checking your DP</h3>
<p>Verify against a brute force on small inputs, print the table for a tiny example, and ask whether greedy would work (often it does not: greedy coin change fails for coins 1, 3, 4 and amount 6).</p>`,
  syntax: { code: `from functools import lru_cache\n@lru_cache(None)\ndef f(i): ...\n\ndp = [base] * (n + 1)\nfor i in range(1, n + 1):\n    dp[i] = best(dp[i - 1], ...)`, note: "State, transition, base case, order." },
  diagram: chain("The DP routine", "Left to right: define the state in words, write the transition from smaller states, set the base cases, then fill the table in dependency order and read the answer.",
    [{ k: "proc", t: "define the\nstate" }, { k: "proc", t: "write the\ntransition" }, { k: "proc", t: "base\ncases" }, { k: "proc", t: "fill in\norder" }, { k: "term", t: "read the\nanswer" }], { w: 125, gap: 28, hgt: 62 }),
  example: { code: `from bisect import bisect_left


def climb(n):
    a, b = 1, 1
    for _ in range(n - 1):
        a, b = b, a + b
    return b


def coin_change(coins, amount):
    inf = float("inf")
    dp = [0] + [inf] * amount
    for i in range(1, amount + 1):
        for c in coins:
            if c <= i:
                dp[i] = min(dp[i], dp[i - c] + 1)
    return dp[amount] if dp[amount] != inf else -1


def lis(a):
    tails = []
    for x in a:
        i = bisect_left(tails, x)
        if i == len(tails):
            tails.append(x)
        else:
            tails[i] = x
    return len(tails)


def edit_distance(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        dp[i][0] = i
    for j in range(len(b) + 1):
        dp[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[-1][-1]


print(climb(10), coin_change([1, 2, 5], 11), coin_change([2], 3), lis([10, 9, 2, 5, 3, 7, 101, 18]), edit_distance("horse", "ros"))`, out: `89 3 -1 4 3` },
  lineByLine: [["climb", "The number of ways to reach step n is the ways to reach n - 1 plus the ways to reach n - 2: Fibonacci. Only the last two values are kept (space optimisation)."], ["coin_change", "dp[i] is the fewest coins for amount i. Each coin c extends the best for i - c. 11 = 5 + 5 + 1 needs 3 coins; 3 cannot be made from 2s, so -1."], ["lis", "tails[k] is the smallest possible last value of an increasing subsequence of length k + 1. bisect keeps it sorted, so the length of tails is the answer in O(n log n)."], ["edit_distance", "dp[i][j] is the cost of turning the first i letters of a into the first j letters of b. A match is free; otherwise take the cheapest of delete, insert and replace plus one."], ["output", "89 ways to climb 10 steps; 3 coins; impossible; LIS length 4 (2 3 7 18); edit distance horse -> ros is 3."]],
  dryRun: { intro: "<code>coin_change([1, 2, 5], 11)</code>, first entries of dp:", headers: ["amount", "0", "1", "2", "3", "4", "5", "6", "7", "11"], rows: [["fewest coins", "0", "1", "1", "2", "2", "1", "2", "2", "3"]] },
  realExample: { intro: "0/1 knapsack in one array (loop the capacity downwards so each item is used once) and a memoised top-down grid count.", code: `from functools import lru_cache


def knapsack(weights, values, capacity):
    dp = [0] * (capacity + 1)
    for w, v in zip(weights, values):
        for cap in range(capacity, w - 1, -1):
            dp[cap] = max(dp[cap], dp[cap - w] + v)
    return dp[capacity]


@lru_cache(None)
def paths(r, c):
    if r == 1 or c == 1:
        return 1
    return paths(r - 1, c) + paths(r, c - 1)


print(knapsack([1, 3, 4, 5], [1, 4, 5, 7], 7), paths(3, 7))`, out: `9 28` },
  mistakes: ["Not defining the state in words first.", "Wrong loop order in knapsack (item reused or skipped).", "Forgetting base cases or off-by-one on the table size.", "Using greedy where only DP is correct.", "Recursion without memoisation, giving exponential time."],
  practices: ["Write the state sentence in a comment.", "Fill a small table by hand and compare.", "Compare against brute force for tiny inputs.", "Reduce memory only after it is correct."],
  interview: ["How do you know a problem needs DP?", "Memoisation versus tabulation?", "Explain the coin-change DP.", "How do you reduce DP memory?"],
  practiceQs: ["What is the state for the longest common subsequence?", "Why loop capacity downwards in 0/1 knapsack?", "What is the time complexity of edit distance?", "Why does greedy fail for coins 1, 3, 4 and amount 6?"],
  revision: ["State, transition, base case, order.", "Top-down with lru_cache or bottom-up tables.", "Families: 1D, grid, knapsack, two strings, interval, state machine.", "Verify with brute force."],
  hinglish: "Dynamic programming mein chhote subproblems ka jawab ek baar nikaal kar store karte hain. Pehle state shabdon mein likho, phir transition, base case aur fill karne ka order. Coin change, LCS, edit distance, knapsack jaise sawal isi routine se hote hain.",
  quiz: [
    mcq("What does a good DP state definition look like?", ["A vague idea", "A precise sentence such as 'the fewest coins to make amount i'", "A loop", "The final answer only"], 1, "Everything else follows from a precise state."),
    mcq("Why loop the capacity downwards in 0/1 knapsack with a single array?", ["It is faster", "So each item is used at most once", "To sort the items", "Python requires it"], 1, "Going downwards reads values from before the current item was added."),
    mcq("What is memoisation?", ["Writing notes", "Caching the results of a recursive function by its arguments", "Sorting inputs", "Compiling code"], 1, "It removes repeated work in overlapping subproblems."),
    mcq("Which statement about greedy versus DP for coin change with coins 1, 3, 4 is true?", ["Greedy always works", "Greedy fails for amount 6 (4+1+1) while DP finds 3+3", "DP fails", "Both give 3 coins"], 1, "Greedy picks 4 first; the optimum is two 3-coins."),
    mcq("What is the time complexity of the edit-distance DP for strings of length n and m?", ["O(n + m)", "O(n x m)", "O(2^n)", "O(log n)"], 1, "The table has (n + 1) x (m + 1) cells, each computed in constant time.")
  ],
  tasks: [
    p({ t: "Climbing Stairs", d: "E", tags: ["dp", "fibonacci"], tc: "O(n)", sc: "O(1)", goal: "Recognise the Fibonacci recurrence in a counting problem.", hint: "ways(n) = ways(n - 1) + ways(n - 2), with ways(1) = 1 and ways(2) = 2.",
      s: "Read n, the number of steps. You climb 1 or 2 steps at a time. Print the number of distinct ways to reach the top.", inp: "One integer.", out: "An integer.", edge: "n = 1",
      sol: `n = int(input())
a, b = 1, 1
for _ in range(n - 1):
    a, b = b, a + b
print(b)`, c: [["2", "2"], ["3", "3"], ["1", "1"], ["10", "89"]] }),
    p({ t: "House Robber", d: "E", tags: ["dp", "1d"], tc: "O(n)", sc: "O(1)", goal: "Choose between skipping a house and robbing it plus the best from two houses back.", hint: "best[i] = max(best[i-1], best[i-2] + a[i]).",
      s: "Read a line of non-negative integers, the money in a row of houses. You cannot take from two adjacent houses. Print the most money you can take.", inp: "One line.", out: "An integer.", edge: "single house",
      sol: `a = list(map(int, input().split()))
prev, cur = 0, 0
for x in a:
    prev, cur = cur, max(cur, prev + x)
print(cur)`, c: [["1 2 3 1", "4"], ["2 7 9 3 1", "12"], ["5", "5"], ["2 1 1 2", "4"]] }),
    p({ t: "Min Cost Climbing Stairs", d: "E", tags: ["dp", "1d"], tc: "O(n)", sc: "O(1)", goal: "Model paying a cost to leave a step, with the start allowed at step 0 or 1.", hint: "The cost to stand on step i is cost[i] plus the cheaper of the two previous steps.",
      s: "Read a line of step costs. You may start from step 0 or step 1, pay the cost of a step to leave it, and climb 1 or 2 steps at a time. The top is just beyond the last step. Print the minimum total cost to reach the top.", inp: "One line.", out: "An integer.", edge: "two steps",
      sol: `cost = list(map(int, input().split()))
a, b = 0, 0
for c in cost:
    a, b = b, min(a, b) + c
print(min(a, b))`, c: [["10 15 20", "15"], ["1 100 1 1 1 100 1 1 100 1", "6"], ["0 0", "0"], ["5 5 5 5", "10"]] }),
    p({ t: "Pascal Triangle Row", d: "E", tags: ["dp", "math"], tc: "O(n^2)", sc: "O(n)", goal: "Build each row from the previous one.", hint: "Every inner entry is the sum of the two entries above it.",
      s: "Read a row index n (starting at 0). Print the nth row of Pascal's triangle on one line.", inp: "One integer.", out: "The row.", edge: "n = 0",
      sol: `n = int(input())
row = [1]
for _ in range(n):
    row = [1] + [row[i] + row[i + 1] for i in range(len(row) - 1)] + [1]
print(*row)`, c: [["4", "1 4 6 4 1"], ["0", "1"], ["1", "1 1"], ["5", "1 5 10 10 5 1"]] }),
    p({ t: "Unique Paths", d: "E", tags: ["dp", "grid"], tc: "O(m x n)", sc: "O(n)", goal: "Fill a grid where each cell is the sum of the cell above and the cell to the left.", hint: "paths[r][c] = paths[r-1][c] + paths[r][c-1]; the first row and column are all 1.",
      s: "Read the number of rows m and columns n of a grid. A robot starts at the top-left corner and can move only right or down. Print the number of different paths to the bottom-right corner.", inp: "One line: m n.", out: "An integer.", edge: "a single row",
      sol: `m, n = map(int, input().split())
row = [1] * n
for _ in range(m - 1):
    for j in range(1, n):
        row[j] += row[j - 1]
print(row[-1])`, c: [["3 7", "28"], ["3 2", "3"], ["1 1", "1"], ["7 3", "28"]] }),
    p({ t: "Unique Paths With Obstacles", d: "M", tags: ["dp", "grid"], tc: "O(r x c)", sc: "O(c)", goal: "Add the blocked-cell rule to the grid DP: a blocked cell has zero paths.", hint: "Set paths to 0 on obstacle cells; otherwise add the top and left values.",
      s: "Read r and c and then an r by c grid of 0 (free) and 1 (obstacle). A robot moves only right or down from the top-left to the bottom-right cell. Print the number of paths that avoid obstacles.", inp: "Line 1: r c. Then r rows.", out: "An integer.", edge: "obstacle at the start",
      sol: `r, c = map(int, input().split())
grid = [list(map(int, input().split())) for _ in range(r)]
dp = [0] * c
dp[0] = 1 if grid[0][0] == 0 else 0
for i in range(r):
    for j in range(c):
        if grid[i][j] == 1:
            dp[j] = 0
        elif j > 0:
            dp[j] += dp[j - 1]
print(dp[-1])`, c: [["3 3\n0 0 0\n0 1 0\n0 0 0", "2"], ["2 2\n0 1\n0 0", "1"], ["1 1\n1", "0"], ["2 2\n0 0\n0 0", "2"]] }),
    p({ t: "Minimum Path Sum", d: "M", tags: ["dp", "grid"], tc: "O(r x c)", sc: "O(c)", goal: "Take the cheaper of the top and left predecessors at every cell.", hint: "cost[r][c] = grid[r][c] + min(cost[r-1][c], cost[r][c-1]).",
      s: "Read r and c and then an r by c grid of non-negative integers. Moving only right or down from the top-left to the bottom-right cell, print the smallest possible sum of the numbers on the path.", inp: "Line 1: r c. Then r rows.", out: "An integer.", edge: "single row or column",
      sol: `r, c = map(int, input().split())
grid = [list(map(int, input().split())) for _ in range(r)]
dp = [float("inf")] * c
dp[0] = 0
for i in range(r):
    for j in range(c):
        best = dp[j] if i > 0 or j == 0 else float("inf")
        if j > 0:
            best = min(best, dp[j - 1])
        dp[j] = best + grid[i][j]
print(dp[-1])`, c: [["3 3\n1 3 1\n1 5 1\n4 2 1", "7"], ["2 3\n1 2 3\n4 5 6", "12"], ["1 1\n5", "5"], ["1 3\n1 2 3", "6"]] }),
    p({ t: "Coin Change Minimum Coins", d: "M", tags: ["dp", "knapsack"], tc: "O(amount x coins)", sc: "O(amount)", goal: "Define dp[i] as the fewest coins for amount i and relax it with every coin.", hint: "dp[i] = min(dp[i - c] + 1) over coins c <= i, with dp[0] = 0.",
      s: "Read a line of coin values (unlimited supply of each) and an amount. Print the fewest coins that make the amount exactly, or -1 if it is impossible.", inp: "Line 1: coins. Line 2: amount.", out: "An integer.", edge: "amount 0",
      sol: `coins = list(map(int, input().split()))
amount = int(input())
inf = float("inf")
dp = [0] + [inf] * amount
for i in range(1, amount + 1):
    for c in coins:
        if c <= i and dp[i - c] + 1 < dp[i]:
            dp[i] = dp[i - c] + 1
print(dp[amount] if dp[amount] != inf else -1)`, c: [["1 2 5\n11", "3"], ["2\n3", "-1"], ["1\n0", "0"], ["2 5 10 1\n27", "4"]] }),
    p({ t: "Coin Change Ways", d: "M", tags: ["dp", "knapsack", "counting"], tc: "O(amount x coins)", sc: "O(amount)", goal: "Count combinations (not orderings) by looping coins on the outside.", hint: "Loop coins in the outer loop and amounts in the inner loop so each combination is counted once.",
      s: "Read a line of coin values (unlimited supply) and an amount. Print the number of different combinations of coins that make the amount (order does not matter).", inp: "Line 1: coins. Line 2: amount.", out: "An integer.", edge: "amount 0",
      sol: `coins = list(map(int, input().split()))
amount = int(input())
ways = [1] + [0] * amount
for c in coins:
    for i in range(c, amount + 1):
        ways[i] += ways[i - c]
print(ways[amount])`, c: [["1 2 5\n5", "4"], ["2\n3", "0"], ["10\n10", "1"], ["1 2 5\n0", "1"]] }),
    p({ t: "Longest Increasing Subsequence", d: "M", tags: ["dp", "binary-search"], tc: "O(n log n)", sc: "O(n)", goal: "Keep the smallest tail of each subsequence length and place each number with binary search.", hint: "tails[k] is the smallest end value of an increasing subsequence of length k + 1; replace the first tail >= x.",
      s: "Read a line of integers. Print the length of the longest strictly increasing subsequence (elements need not be adjacent).", inp: "One line.", out: "An integer.", edge: "all equal, single element",
      sol: `from bisect import bisect_left

tails = []
for x in map(int, input().split()):
    i = bisect_left(tails, x)
    if i == len(tails):
        tails.append(x)
    else:
        tails[i] = x
print(len(tails))`, c: [["10 9 2 5 3 7 101 18", "4"], ["0 1 0 3 2 3", "4"], ["7 7 7 7", "1"], ["5", "1"]] }),
    p({ t: "Edit Distance", d: "M", tags: ["dp", "string"], tc: "O(n x m)", sc: "O(n x m)", goal: "Define dp over prefixes of two strings and take the cheapest of insert, delete and replace.", hint: "If the last characters match copy the diagonal; otherwise 1 + min(left, up, diagonal).",
      s: "Read two non-empty strings. Print the minimum number of single-character insertions, deletions and replacements needed to turn the first into the second.", inp: "Two lines.", out: "An integer.", edge: "equal strings",
      sol: `a = input()
b = input()
dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
for i in range(len(a) + 1):
    dp[i][0] = i
for j in range(len(b) + 1):
    dp[0][j] = j
for i in range(1, len(a) + 1):
    for j in range(1, len(b) + 1):
        if a[i - 1] == b[j - 1]:
            dp[i][j] = dp[i - 1][j - 1]
        else:
            dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
print(dp[-1][-1])`, c: [["horse\nros", "3"], ["intention\nexecution", "5"], ["a\na", "0"], ["ab\nb", "1"]] }),
    p({ t: "Word Break", d: "M", tags: ["dp", "string"], tc: "O(n^2)", sc: "O(n)", goal: "dp[i] says whether the first i characters can be segmented; extend from every earlier true position.", hint: "dp[i] is true if some j < i has dp[j] true and s[j:i] is a dictionary word.",
      s: "Read a string s, then n, then n dictionary words. Print yes if s can be split into a sequence of dictionary words (words may be reused), otherwise no.", inp: "Line 1: s. Line 2: n. Then n words.", out: "yes or no.", edge: "word reused",
      sol: `s = input()
n = int(input())
words = {input() for _ in range(n)}
dp = [True] + [False] * len(s)
for i in range(1, len(s) + 1):
    for j in range(i):
        if dp[j] and s[j:i] in words:
            dp[i] = True
            break
print("yes" if dp[-1] else "no")`, c: [["leetcode\n2\nleet\ncode", "yes"], ["applepenapple\n2\napple\npen", "yes"], ["catsandog\n5\ncats\ndog\nsand\nand\ncat", "no"], ["a\n1\nb", "no"]] }),
    p({ t: "Partition Equal Subset Sum", d: "M", tags: ["dp", "knapsack", "bitset"], tc: "O(n x S)", sc: "O(S)", goal: "Reduce partitioning to subset-sum reachability and use a bitset for speed.", hint: "If the total is odd it is impossible; otherwise check whether a subset sums to total / 2.",
      s: "Read a line of positive integers. Print yes if they can be split into two groups with equal sums, otherwise no.", inp: "One line.", out: "yes or no.", edge: "odd total",
      sol: `nums = list(map(int, input().split()))
total = sum(nums)
if total % 2:
    print("no")
else:
    reach = 1
    for x in nums:
        reach |= reach << x
    print("yes" if (reach >> (total // 2)) & 1 else "no")`, c: [["1 5 11 5", "yes"], ["1 2 3 5", "no"], ["2 2", "yes"], ["1", "no"]] }),
    p({ t: "Decode Ways", d: "M", tags: ["dp", "string"], tc: "O(n)", sc: "O(1)", goal: "Count decodings with one- and two-digit steps while handling zeros correctly.", hint: "A single digit 1-9 adds ways[i-1]; a two-digit number 10-26 adds ways[i-2].",
      s: "A message of letters A-Z was encoded as 1-26 (A=1 ... Z=26) and written as a string of digits. Read the digit string and print the number of different ways it can be decoded (0 if none).", inp: "One line of digits.", out: "An integer.", edge: "leading zero, 10 and 20",
      sol: `s = input()
prev, cur = 0, 1
for i, ch in enumerate(s):
    new = 0
    if ch != "0":
        new += cur
    if i > 0 and 10 <= int(s[i - 1:i + 1]) <= 26:
        new += prev
    prev, cur = cur, new
print(cur)`, c: [["12", "2"], ["226", "3"], ["06", "0"], ["10", "1"]] }),
    p({ t: "Longest Palindromic Subsequence", d: "M", tags: ["dp", "string"], tc: "O(n^2)", sc: "O(n^2)", goal: "Use an interval table: matching ends extend the inner answer, otherwise drop one end.", hint: "dp[i][j] = dp[i+1][j-1] + 2 if s[i] == s[j] else max(dp[i+1][j], dp[i][j-1]).",
      s: "Read a string. Print the length of its longest palindromic subsequence (characters need not be adjacent).", inp: "One line.", out: "An integer.", edge: "single character",
      sol: `s = input()
n = len(s)
dp = [[0] * n for _ in range(n)]
for i in range(n - 1, -1, -1):
    dp[i][i] = 1
    for j in range(i + 1, n):
        if s[i] == s[j]:
            dp[i][j] = dp[i + 1][j - 1] + 2
        else:
            dp[i][j] = max(dp[i + 1][j], dp[i][j - 1])
print(dp[0][n - 1])`, c: [["bbbab", "4"], ["cbbd", "2"], ["a", "1"], ["abcd", "1"]] }),
    p({ t: "Triangle Minimum Path", d: "M", tags: ["dp", "grid"], tc: "O(n^2)", sc: "O(n)", goal: "Work bottom-up so each cell only needs the two cells below it.", hint: "Start from the last row; each cell becomes its value plus the smaller of the two cells below.",
      s: "Read n and then a triangle of n rows (row i has i + 1 integers). Starting at the top and moving each step to an adjacent number in the row below, print the smallest possible path sum.", inp: "Line 1: n. Then the rows.", out: "An integer.", edge: "a single row",
      sol: `n = int(input())
rows = [list(map(int, input().split())) for _ in range(n)]
dp = rows[-1][:]
for i in range(n - 2, -1, -1):
    dp = [rows[i][j] + min(dp[j], dp[j + 1]) for j in range(i + 1)]
print(dp[0])`, c: [["4\n2\n3 4\n6 5 7\n4 1 8 3", "11"], ["1\n-10", "-10"], ["2\n1\n2 3", "3"], ["3\n1\n1 1\n1 1 1", "3"]] }),
    p({ t: "Maximal Square", d: "M", tags: ["dp", "grid"], tc: "O(r x c)", sc: "O(c)", goal: "A cell's largest square ending there is one more than the smallest of its three neighbours' squares.", hint: "dp[i][j] = 1 + min(up, left, diagonal) when the cell is 1.",
      s: "Read r and c and then r rows of 0 and 1 characters. Print the area of the largest square made only of 1s.", inp: "Line 1: r c. Then r rows.", out: "An integer.", edge: "all zeros",
      sol: `r, c = map(int, input().split())
grid = [input() for _ in range(r)]
dp = [[0] * (c + 1) for _ in range(r + 1)]
best = 0
for i in range(1, r + 1):
    for j in range(1, c + 1):
        if grid[i - 1][j - 1] == "1":
            dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
            best = max(best, dp[i][j])
print(best * best)`, c: [["4 5\n10100\n10111\n11111\n10010", "4"], ["2 2\n01\n10", "1"], ["1 1\n0", "0"], ["3 3\n111\n111\n111", "9"]] }),
    p({ t: "Stock Trading With Cooldown", d: "M", tags: ["dp", "state-machine"], tc: "O(n)", sc: "O(1)", goal: "Model each day as one of three states and move between them with simple rules.", hint: "States: holding a stock, just sold (cooldown next day), resting. Update them from the previous day.",
      s: "Read a line of daily stock prices. You may buy and sell many times but hold at most one share, and after selling you must wait one day before buying again. Print the maximum profit.", inp: "One line.", out: "An integer.", edge: "falling prices",
      sol: `prices = list(map(int, input().split()))
hold, sold, rest = float("-inf"), 0, 0
for price in prices:
    prev_sold = sold
    sold = hold + price
    hold = max(hold, rest - price)
    rest = max(rest, prev_sold)
print(max(sold, rest))`, c: [["1 2 3 0 2", "3"], ["1", "0"], ["6 1 3 2 4 7", "6"], ["2 1", "0"]] }),
    p({ t: "Target Sum Ways", d: "M", tags: ["dp", "knapsack", "counting"], tc: "O(n x S)", sc: "O(S)", goal: "Count sign assignments by tracking how many ways reach each running total.", hint: "Keep a dictionary from running total to number of ways; each number either adds or subtracts.",
      s: "Read a line of non-negative integers and a target. Put a + or - in front of every number. Print how many sign assignments make the total equal to the target.", inp: "Line 1: the numbers. Line 2: the target.", out: "An integer.", edge: "zeros double the count",
      sol: `from collections import defaultdict

nums = list(map(int, input().split()))
target = int(input())
ways = {0: 1}
for x in nums:
    nxt = defaultdict(int)
    for total, count in ways.items():
        nxt[total + x] += count
        nxt[total - x] += count
    ways = nxt
print(ways.get(target, 0))`, c: [["1 1 1 1 1\n3", "5"], ["1\n1", "1"], ["1 0\n1", "2"], ["2 2\n0", "2"]] }),
    p({ t: "Burst Balloons", d: "H", tags: ["dp", "interval"], tc: "O(n^3)", sc: "O(n^2)", goal: "Choose which balloon bursts last in an interval, so the two sides become independent subproblems.", hint: "dp[l][r] = max over k of dp[l][k-1] + nums[l-1]*nums[k]*nums[r+1] + dp[k+1][r], where k bursts last.",
      s: "Read a line of integers, the balloons. Bursting balloon i earns left * i * right coins where left and right are its current neighbours (a missing neighbour counts as 1). Print the maximum coins from bursting all balloons.", inp: "One line.", out: "An integer.", edge: "single balloon",
      sol: `nums = [1] + list(map(int, input().split())) + [1]
n = len(nums)
dp = [[0] * n for _ in range(n)]
for length in range(2, n):
    for left in range(n - length):
        right = left + length
        for k in range(left + 1, right):
            dp[left][right] = max(dp[left][right], dp[left][k] + dp[k][right] + nums[left] * nums[k] * nums[right])
print(dp[0][n - 1])`, c: [["3 1 5 8", "167"], ["1 5", "10"], ["7", "7"], ["9 76 64 21", "116718"]] }),
    p({ t: "Longest Valid Parentheses", d: "H", tags: ["dp", "stack", "string"], tc: "O(n)", sc: "O(n)", goal: "Track the index before the current valid run on a stack of positions.", hint: "Keep a stack of indices starting with -1; on a mismatch reset the base, on a match the valid length is i - stack[-1].",
      s: "Read a string of ( and ) characters. Print the length of the longest substring that is a valid (balanced) bracket sequence.", inp: "One line.", out: "An integer.", edge: "no valid substring",
      sol: `s = input()
stack = [-1]
best = 0
for i, ch in enumerate(s):
    if ch == "(":
        stack.append(i)
    else:
        stack.pop()
        if not stack:
            stack.append(i)
        else:
            best = max(best, i - stack[-1])
print(best)`, c: [["(()", "2"], [")()())", "4"], ["()(())", "6"], ["))", "0"]] }),
    p({ t: "Distinct Subsequences", d: "H", tags: ["dp", "string"], tc: "O(n x m)", sc: "O(m)", goal: "Count the ways the prefix of t can be matched inside the prefix of s, using a one-dimensional table.", hint: "When s[i] == t[j], ways[j] += ways[j-1] (use it) on top of the existing count (skip it); iterate j downwards.",
      s: "Read strings s and t. Print the number of distinct subsequences of s that equal t.", inp: "Two lines.", out: "An integer.", edge: "t longer than s",
      sol: `s = input()
t = input()
ways = [1] + [0] * len(t)
for ch in s:
    for j in range(len(t), 0, -1):
        if t[j - 1] == ch:
            ways[j] += ways[j - 1]
print(ways[len(t)])`, c: [["rabbbit\nrabbit", "3"], ["babgbag\nbag", "5"], ["a\na", "1"], ["abc\nd", "0"]] }),
    p({ t: "Stock Trading With K Transactions", d: "H", tags: ["dp", "state-machine"], tc: "O(n x k)", sc: "O(k)", goal: "Keep, for each transaction number, the best balance while holding and after selling.", hint: "For each j keep buy[j] (best after the jth buy) and sell[j] (best after the jth sell).",
      s: "Read k and then a line of daily prices. You may complete at most k transactions (a buy followed by a sell) and hold at most one share at a time. Print the maximum profit.", inp: "Line 1: k. Line 2: prices.", out: "An integer.", edge: "k larger than needed",
      sol: `k = int(input())
prices = list(map(int, input().split()))
buy = [float("-inf")] * (k + 1)
sell = [0] * (k + 1)
for price in prices:
    for j in range(1, k + 1):
        buy[j] = max(buy[j], sell[j - 1] - price)
        sell[j] = max(sell[j], buy[j] + price)
print(sell[k])`, c: [["2\n2 4 1", "2"], ["2\n3 2 6 5 0 3", "7"], ["1\n1", "0"], ["3\n1 2 3 4 5", "4"]] }),
  ],
});

// ---------------------------------------------------------------- 11
lessons.push({
  title: "Greedy Methods, Heaps and Intervals: Pattern Problems",
  minutes: 90,
  learn: ["Recognise when a locally best choice gives a globally best answer", "Prove or test a greedy rule with an exchange argument and counterexamples", "Use heapq for priority queues: k-th largest, scheduling, merging, streaming medians", "Solve interval problems by sorting by start or by end"],
  why: "Greedy solutions are short and fast but only correct for the right problems. Heaps and sorted intervals appear in scheduling, resource allocation and ranking, and knowing when greedy works (and when it does not) is a classic interview discriminator.",
  realWorld: "Meeting-room booking, CPU and job scheduling, merging log streams, finding the top-k trending items, and delivery routing heuristics all use these ideas.",
  simple: "A <strong>greedy</strong> algorithm makes the best choice available now and never reconsiders. A <strong>heap</strong> gives you the smallest (or largest) item in O(log n), which is exactly what many greedy algorithms need at each step.",
  detail: `<h3>Greedy: how to decide it is safe</h3>
<ol><li>Guess a rule (earliest end time, largest first, cheapest first).</li><li>Try to <strong>break it</strong> with small examples. Greedy coin change fails for coins 4, 3, 1 and amount 6.</li><li>Argue by <em>exchange</em>: any optimal solution can be changed to use your first choice without getting worse.</li><li>If you cannot argue it, use dynamic programming.</li></ol>
<h3>Classic greedy rules</h3>
${table(["Problem", "Rule"], [["max non-overlapping intervals", "sort by end time, keep an interval if it starts after the last kept end"], ["meeting rooms, platforms", "sort by start; a min-heap of end times says when a room frees"], ["jump game", "track the farthest reachable index"], ["gas station", "if total gas &gt;= total cost a start exists; restart after a negative tank"], ["task scheduler", "the most frequent task decides the frame length"], ["assign cookies", "give the smallest sufficient cookie to the least greedy child"], ["candy distribution", "two passes: left to right, then right to left"], ["partition labels", "extend the current part to the last occurrence of its letters"]])}
<h3>heapq in Python</h3>
<ul><li><code>heapq</code> is a <strong>min-heap</strong> on a list: <code>heappush(h, x)</code>, <code>heappop(h)</code>, <code>h[0]</code> is the smallest, all O(log n) or O(1).</li><li>Max-heap: push negatives. Heap of tasks: push tuples <code>(priority, tie-break, item)</code>.</li><li><code>heapq.nlargest(k, items)</code> / <code>nsmallest</code> for one-off top-k.</li><li>Top-k largest of a stream: keep a min-heap of size k; the root is the k-th largest. Cost O(n log k).</li><li>Running median: a max-heap for the lower half and a min-heap for the upper half, kept within one element of each other.</li><li>Merge k sorted lists: heap of (value, list index, position); also <code>heapq.merge</code>.</li></ul>
<h3>Interval toolkit</h3>
<p>Sort first. By start for merging and rooms; by end for the maximum number of non-overlapping intervals and for minimum arrows. Decide whether touching intervals (end == next start) overlap; the statement says.</p>`,
  syntax: { code: `import heapq\nheap = []\nheapq.heappush(heap, (end, start))\nsmallest = heapq.heappop(heap)\nheapq.nlargest(3, nums)\nheapq.heappush(heap, -x)   # max-heap`, note: "heapq is a min-heap; push negatives for a max-heap." },
  diagram: chain("Greedy with a heap", "Left to right: sort or heapify the items, repeatedly take the best available item, update the state, and push any new candidates back into the heap.",
    [{ k: "proc", t: "sort or\nheapify" }, { k: "proc", t: "take the best\navailable item" }, { k: "proc", t: "update the\nanswer" }, { k: "dec", t: "more\ncandidates?" }, { k: "term", t: "done" }], { w: 130, gap: 28, hgt: 62 }),
  example: { code: `import heapq


def max_non_overlapping(intervals):
    count, last_end = 0, float("-inf")
    for start, end in sorted(intervals, key=lambda iv: iv[1]):
        if start >= last_end:
            count += 1
            last_end = end
    return count


def can_jump(nums):
    reach = 0
    for i, x in enumerate(nums):
        if i > reach:
            return False
        reach = max(reach, i + x)
    return True


print(max_non_overlapping([(1, 3), (2, 4), (3, 5), (0, 6), (5, 7), (8, 9), (5, 9)]))
print(can_jump([2, 3, 1, 1, 4]), can_jump([3, 2, 1, 0, 4]))

heap = []
for x in [3, 2, 1, 5, 6, 4]:
    heapq.heappush(heap, x)
    if len(heap) > 2:
        heapq.heappop(heap)
print(heap[0])
print(heapq.nsmallest(3, [5, 1, 8, 3, 9, 2]), heapq.nlargest(2, [5, 1, 8, 3, 9, 2]))`, out: `4
True False
5
[1, 2, 3] [9, 8]` },
  lineByLine: [["max_non_overlapping", "Sorted by end time, the interval that finishes first leaves the most room for the rest: 1-3, 3-5, 5-7 and 8-9, four meetings."], ["can_jump", "reach is the farthest index reachable so far; if the loop arrives at an index beyond it, the end is unreachable. In [3, 2, 1, 0, 4] every path gets stuck on the 0."], ["heap of size 2", "After pushing 3 2 1 5 6 4 and popping whenever there are more than two, the heap holds the two largest numbers (5 and 6); the root is the second largest, 5."], ["nsmallest / nlargest", "One-line top-k helpers, O(n log k)."]],
  dryRun: { intro: "The size-2 min-heap while reading <code>3 2 1 5 6 4</code>:", headers: ["x", "heap after push", "after trimming to 2"], rows: [["3", "[3]", "[3]"], ["2", "[2, 3]", "[2, 3]"], ["1", "[1, 3, 2]", "[2, 3]"], ["5", "[2, 3, 5]", "[3, 5]"], ["6", "[3, 5, 6]", "[5, 6]"], ["4", "[4, 6, 5]", "[5, 6]"]] },
  realExample: { intro: "Greedy is not always right: for ordinary coin systems it works, for coins 4, 3, 1 it does not, and dynamic programming finds the true minimum.", code: `def greedy_coins(coins, amount):
    count = 0
    for c in sorted(coins, reverse=True):
        count += amount // c
        amount %= c
    return count


def optimal_coins(coins, amount):
    inf = float("inf")
    dp = [0] + [inf] * amount
    for i in range(1, amount + 1):
        for c in coins:
            if c <= i:
                dp[i] = min(dp[i], dp[i - c] + 1)
    return dp[amount]


print(greedy_coins([25, 10, 5, 1], 63), greedy_coins([4, 3, 1], 6), optimal_coins([4, 3, 1], 6))`, out: `6 3 2` },
  mistakes: ["Assuming greedy is right without testing a counterexample.", "Sorting by start when the rule needs end time (and vice versa).", "Forgetting that heapq is a min-heap.", "Pushing unorderable items (use tuples with a tie-break).", "Ignoring whether touching intervals overlap."],
  practices: ["Write the greedy rule and one counterexample attempt.", "Sort first, then scan once.", "Keep the heap small (size k) when only the top k matter.", "State complexity with the heap factor log n."],
  interview: ["When does a greedy algorithm give the optimal answer?", "How do you find the kth largest element in a stream?", "How many meeting rooms are needed?", "How does the running-median structure work?"],
  practiceQs: ["Why sort intervals by end time for maximum non-overlapping?", "How do you build a max-heap with heapq?", "What is the cost of heappush?", "Give a case where greedy fails."],
  revision: ["Greedy: local best, check with counterexamples and exchange.", "heapq = min-heap; negatives for max.", "Top-k: heap of size k.", "Intervals: sort by start (merge) or end (max count)."],
  hinglish: "Greedy mein har step par abhi ka sabse achha chunav hota hai aur kabhi badla nahi jata; ye har sawal mein sahi nahi hota, isliye counterexample se jaancho (coins 4,3,1 aur amount 6). heapq min-heap hai, max-heap ke liye negative push karo. Intervals mein pehle sort karo.",
  quiz: [
    mcq("Which rule gives the maximum number of non-overlapping intervals?", ["Sort by start time", "Sort by end time and keep any interval starting after the last end", "Sort by length", "Pick randomly"], 1, "The earliest-finishing interval leaves the most room."),
    mcq("How do you get a max-heap from Python's heapq?", ["Use heapq.maxheap", "Push negated values", "Sort descending", "It is impossible"], 1, "heapq only provides a min-heap, so negate the keys."),
    mcq("A min-heap of size k over a stream keeps which element at the root?", ["The largest", "The kth largest seen so far", "The median", "The most recent"], 1, "It holds the k largest values; the smallest of them is the kth largest."),
    mcq("For coins 4, 3, 1 and amount 6, what does the greedy method return?", ["2 coins", "3 coins (4 + 1 + 1)", "1 coin", "It cannot"], 1, "The optimum is two 3-coins, so greedy is wrong here."),
    mcq("What is the cost of heappop on a heap with n items?", ["O(1)", "O(log n)", "O(n)", "O(n log n)"], 1, "The heap re-balances along one root-to-leaf path.")
  ],
  tasks: [
    p({ t: "Assign Cookies", d: "E", tags: ["greedy", "sorting", "two-pointers"], tc: "O(n log n)", sc: "O(1)", goal: "Match the smallest sufficient cookie to the least demanding child.", hint: "Sort both lists; advance the cookie pointer, and the child pointer only when the cookie satisfies the child.",
      s: "Read a line of child greed factors and a line of cookie sizes. A child is content if given a cookie at least as large as the greed factor; each cookie goes to at most one child. Print the largest number of content children.", inp: "Two lines.", out: "An integer.", edge: "no cookies large enough",
      sol: `greed = sorted(map(int, input().split()))
cookies = sorted(map(int, input().split()))
child = 0
for cookie in cookies:
    if child < len(greed) and cookie >= greed[child]:
        child += 1
print(child)`, c: [["1 2 3\n1 1", "1"], ["1 2\n1 2 3", "2"], ["5\n1", "0"], ["2 3\n3 3", "2"]] }),
    p({ t: "Best Time to Buy and Sell Stock", d: "E", tags: ["greedy", "array"], tc: "O(n)", sc: "O(1)", goal: "Track the lowest price so far and the best profit if selling today.", hint: "profit today = price - minimum price seen before today.",
      s: "Read a line of daily prices. Buy once and sell once later. Print the maximum profit, or 0 if no profit is possible.", inp: "One line.", out: "An integer.", edge: "falling prices",
      sol: `prices = list(map(int, input().split()))
low = float("inf")
best = 0
for price in prices:
    low = min(low, price)
    best = max(best, price - low)
print(best)`, c: [["7 1 5 3 6 4", "5"], ["7 6 4 3 1", "0"], ["1 2", "1"], ["3", "0"]] }),
    p({ t: "Stock Profit With Many Transactions", d: "E", tags: ["greedy", "array"], tc: "O(n)", sc: "O(1)", goal: "Add every rise: a long climb equals the sum of its daily gains.", hint: "Sum the positive differences between consecutive days.",
      s: "Read a line of daily prices. You may buy and sell any number of times but hold at most one share. Print the maximum total profit.", inp: "One line.", out: "An integer.", edge: "only falling prices",
      sol: `prices = list(map(int, input().split()))
print(sum(max(0, prices[i] - prices[i - 1]) for i in range(1, len(prices))))`, c: [["7 1 5 3 6 4", "7"], ["1 2 3 4 5", "4"], ["7 6 4 3 1", "0"], ["2 4 1", "2"]] }),
    p({ t: "Last Stone Weight", d: "E", tags: ["heap", "simulation"], tc: "O(n log n)", sc: "O(n)", goal: "Use a max-heap (negated min-heap) to repeatedly take the two heaviest stones.", hint: "Push negatives; pop two, push their difference if it is not zero.",
      s: "Read a line of stone weights. Repeatedly smash the two heaviest stones: equal stones both vanish, otherwise the heavier stone loses the lighter one's weight and stays. Print the weight of the last remaining stone, or 0 if none remains.", inp: "One line.", out: "An integer.", edge: "one stone",
      sol: `import heapq

heap = [-x for x in map(int, input().split())]
heapq.heapify(heap)
while len(heap) > 1:
    a = -heapq.heappop(heap)
    b = -heapq.heappop(heap)
    if a != b:
        heapq.heappush(heap, -(a - b))
print(-heap[0] if heap else 0)`, c: [["2 7 4 1 8 1", "1"], ["1", "1"], ["2 2", "0"], ["10 4 3", "3"]] }),
    p({ t: "Kth Largest Element", d: "E", tags: ["heap", "top-k"], tc: "O(n log k)", sc: "O(k)", goal: "Keep a min-heap of the k largest values so the root is the kth largest.", hint: "Push each number; when the heap exceeds k items pop the smallest.",
      s: "Read a line of integers and k. Print the kth largest element in sorted order (duplicates count separately).", inp: "Line 1: the array. Line 2: k.", out: "An integer.", edge: "duplicates",
      sol: `import heapq

nums = list(map(int, input().split()))
k = int(input())
heap = []
for x in nums:
    heapq.heappush(heap, x)
    if len(heap) > k:
        heapq.heappop(heap)
print(heap[0])`, c: [["3 2 1 5 6 4\n2", "5"], ["3 2 3 1 2 4 5 5 6\n4", "4"], ["1\n1", "1"], ["7 7 7\n2", "7"]] }),
    p({ t: "Can Attend All Meetings", d: "E", tags: ["intervals", "sorting"], tc: "O(n log n)", sc: "O(n)", goal: "After sorting by start, only neighbouring meetings can conflict.", hint: "Sort by start and check that each meeting starts at or after the previous one ends.",
      s: "Read n and then n meetings (start end). Print yes if one person can attend all of them (a meeting may start exactly when another ends), otherwise no.", inp: "Line 1: n. Then n lines.", out: "yes or no.", edge: "touching meetings",
      sol: `n = int(input())
meetings = sorted(tuple(map(int, input().split())) for _ in range(n))
ok = all(meetings[i][0] >= meetings[i - 1][1] for i in range(1, n))
print("yes" if ok else "no")`, c: [["3\n0 30\n5 10\n15 20", "no"], ["2\n7 10\n2 4", "yes"], ["2\n1 5\n5 8", "yes"], ["1\n3 4", "yes"]] }),
    p({ t: "Minimum Meeting Rooms", d: "M", tags: ["intervals", "heap"], tc: "O(n log n)", sc: "O(n)", goal: "Keep a min-heap of end times of rooms in use; reuse a room when the earliest one is free.", hint: "Sort by start; if the earliest end <= the new start, pop it; then push the new end. The heap size is the rooms needed.",
      s: "Read n and then n meetings (start end). Print the minimum number of rooms needed so that no two overlapping meetings share a room (a meeting may start when another ends).", inp: "Line 1: n. Then n lines.", out: "An integer.", edge: "identical meetings",
      sol: `import heapq

n = int(input())
meetings = sorted(tuple(map(int, input().split())) for _ in range(n))
ends = []
for start, end in meetings:
    if ends and ends[0] <= start:
        heapq.heappop(ends)
    heapq.heappush(ends, end)
print(len(ends))`, c: [["3\n0 30\n5 10\n15 20", "2"], ["2\n7 10\n2 4", "1"], ["3\n1 5\n1 5\n1 5", "3"], ["1\n1 2", "1"]] }),
    p({ t: "Non-overlapping Intervals", d: "M", tags: ["intervals", "greedy"], tc: "O(n log n)", sc: "O(n)", goal: "Keep the interval that ends earliest; every conflicting interval must be removed.", hint: "Sort by end; keep an interval if its start is at least the last kept end, otherwise count a removal.",
      s: "Read n and then n intervals (start end). Print the minimum number of intervals to remove so that the rest do not overlap (intervals that only touch at an end do not overlap).", inp: "Line 1: n. Then n lines.", out: "An integer.", edge: "all identical",
      sol: `n = int(input())
intervals = sorted((tuple(map(int, input().split())) for _ in range(n)), key=lambda iv: iv[1])
last_end = float("-inf")
removed = 0
for start, end in intervals:
    if start >= last_end:
        last_end = end
    else:
        removed += 1
print(removed)`, c: [["4\n1 2\n2 3\n3 4\n1 3", "1"], ["3\n1 2\n1 2\n1 2", "2"], ["2\n1 2\n2 3", "0"], ["1\n1 5", "0"]] }),
    p({ t: "Jump Game", d: "M", tags: ["greedy", "array"], tc: "O(n)", sc: "O(1)", goal: "Track the farthest reachable index instead of exploring every jump.", hint: "Walk the array; if an index is beyond the farthest reach, the end is unreachable.",
      s: "Read a line of non-negative integers where each number is the maximum jump length from that position. Starting at index 0, print yes if you can reach the last index, otherwise no.", inp: "One line.", out: "yes or no.", edge: "a single element",
      sol: `nums = list(map(int, input().split()))
reach = 0
ok = True
for i, x in enumerate(nums):
    if i > reach:
        ok = False
        break
    reach = max(reach, i + x)
print("yes" if ok else "no")`, c: [["2 3 1 1 4", "yes"], ["3 2 1 0 4", "no"], ["0", "yes"], ["2 0 0", "yes"]] }),
    p({ t: "Jump Game Minimum Jumps", d: "M", tags: ["greedy", "array", "bfs"], tc: "O(n)", sc: "O(1)", goal: "Count jumps as BFS layers: extend to the farthest reachable position before committing to the next jump.", hint: "Track the end of the current jump range and the farthest index seen; when you pass the range end, count a jump.",
      s: "Read a line of non-negative integers where each number is the maximum jump length from that position (the last index is reachable). Print the minimum number of jumps from index 0 to the last index.", inp: "One line.", out: "An integer.", edge: "a single element",
      sol: `nums = list(map(int, input().split()))
jumps = end = farthest = 0
for i in range(len(nums) - 1):
    farthest = max(farthest, i + nums[i])
    if i == end:
        jumps += 1
        end = farthest
print(jumps)`, c: [["2 3 1 1 4", "2"], ["2 3 0 1 4", "2"], ["1", "0"], ["1 1 1 1", "3"]] }),
    p({ t: "Gas Station", d: "M", tags: ["greedy", "array"], tc: "O(n)", sc: "O(1)", goal: "If the total gas covers the total cost a start exists, and it begins just after the point where the running tank last went negative.", hint: "Track total balance and the current tank; reset the start to the next station when the tank drops below zero.",
      s: "Read a line of gas amounts and a line of travel costs for stations arranged in a circle. Starting with an empty tank at some station and travelling clockwise, find the station index from which you can complete the full circle, or -1. The answer is unique if it exists.", inp: "Two lines.", out: "An index or -1.", edge: "single station",
      sol: `gas = list(map(int, input().split()))
cost = list(map(int, input().split()))
total = tank = start = 0
for i in range(len(gas)):
    diff = gas[i] - cost[i]
    total += diff
    tank += diff
    if tank < 0:
        start = i + 1
        tank = 0
print(start if total >= 0 else -1)`, c: [["1 2 3 4 5\n3 4 5 1 2", "3"], ["2 3 4\n3 4 3", "-1"], ["5\n4", "0"], ["3 1 1\n1 2 2", "0"]] }),
    p({ t: "Task Scheduler", d: "M", tags: ["greedy", "counting"], tc: "O(n)", sc: "O(1)", goal: "The most frequent task defines the frame; fill the idle slots with the other tasks.", hint: "Answer = max(number of tasks, (maxcount - 1) x (n + 1) + number of tasks with maxcount).",
      s: "Read a string where each letter is a task, and a cooldown n. The same task needs at least n other intervals (tasks or idle time) between two runs. Each interval runs one task or idles. Print the minimum number of intervals to finish all tasks.", inp: "Line 1: the tasks. Line 2: n.", out: "An integer.", edge: "n = 0",
      sol: `from collections import Counter

tasks = input()
n = int(input())
counts = Counter(tasks)
most = max(counts.values())
with_most = sum(1 for c in counts.values() if c == most)
print(max(len(tasks), (most - 1) * (n + 1) + with_most))`, c: [["AAABBB\n2", "8"], ["AAABBB\n0", "6"], ["AAAAAABCDEFG\n2", "16"], ["ABC\n5", "3"]] }),
    p({ t: "Partition Labels", d: "M", tags: ["greedy", "string"], tc: "O(n)", sc: "O(1)", goal: "Extend the current part to the last occurrence of every letter it contains.", hint: "Record each letter's last index; cut when the scan index reaches the farthest last index.",
      s: "Read a string. Partition it into as many parts as possible so that each letter appears in at most one part. Print the sizes of the parts, in order, on one line.", inp: "One line.", out: "The part sizes.", edge: "all distinct letters",
      sol: `s = input()
last = {ch: i for i, ch in enumerate(s)}
sizes = []
start = end = 0
for i, ch in enumerate(s):
    end = max(end, last[ch])
    if i == end:
        sizes.append(end - start + 1)
        start = i + 1
print(*sizes)`, c: [["ababcbacadefegdehijhklij", "9 7 8"], ["eccbbbbdec", "10"], ["a", "1"], ["abc", "1 1 1"]] }),
    p({ t: "Insert Interval", d: "M", tags: ["intervals", "sorting"], tc: "O(n)", sc: "O(n)", goal: "Copy the intervals before the new one, merge the overlapping ones, then copy the rest.", hint: "Add intervals that end before the new start, merge those that overlap, then add the remaining intervals.",
      s: "Read n, then n sorted non-overlapping intervals (start end), then one new interval. Insert the new interval, merging where it overlaps or touches, and print the resulting intervals one per line.", inp: "Line 1: n. Then n intervals. Then the new interval.", out: "The intervals.", edge: "n = 0",
      sol: `n = int(input())
intervals = [tuple(map(int, input().split())) for _ in range(n)]
new_start, new_end = map(int, input().split())
out = []
placed = False
for start, end in intervals:
    if end < new_start:
        out.append((start, end))
    elif start > new_end:
        if not placed:
            out.append((new_start, new_end))
            placed = True
        out.append((start, end))
    else:
        new_start = min(new_start, start)
        new_end = max(new_end, end)
if not placed:
    out.append((new_start, new_end))
for start, end in out:
    print(start, end)`, c: [["2\n1 3\n6 9\n2 5", "1 5\n6 9"], ["5\n1 2\n3 5\n6 7\n8 10\n12 16\n4 8", "1 2\n3 10\n12 16"], ["0\n5 7", "5 7"], ["1\n1 5\n6 8", "1 5\n6 8"]] }),
    p({ t: "Reorganize String", d: "M", tags: ["greedy", "heap", "string"], tc: "O(n log k)", sc: "O(k)", goal: "Always place the two most frequent remaining letters next to each other in turn.", hint: "Use a max-heap of (count, letter); each round pop two letters, append both, and push them back with one fewer.",
      s: "Read a string of lower-case letters. Rearrange it so that no two equal letters are adjacent, using this rule to make the answer unique: repeat taking the two letters with the highest remaining counts (ties by smaller letter), write the more frequent one first, and reduce both counts. Print the result, or impossible.", inp: "One line.", out: "The string or impossible.", edge: "one letter dominates",
      sol: `import heapq
from collections import Counter

heap = [(-count, ch) for ch, count in Counter(input()).items()]
heapq.heapify(heap)
out = []
ok = True
while len(heap) > 1:
    c1, a = heapq.heappop(heap)
    c2, b = heapq.heappop(heap)
    out.append(a)
    out.append(b)
    if c1 + 1 < 0:
        heapq.heappush(heap, (c1 + 1, a))
    if c2 + 1 < 0:
        heapq.heappush(heap, (c2 + 1, b))
if heap:
    count, ch = heap[0]
    if count < -1:
        ok = False
    else:
        out.append(ch)
print("".join(out) if ok else "impossible")`, c: [["aab", "aba"], ["aaab", "impossible"], ["aabb", "abab"], ["a", "a"]] }),
    p({ t: "Connect Ropes Minimum Cost", d: "M", tags: ["greedy", "heap"], tc: "O(n log n)", sc: "O(n)", goal: "Always join the two shortest ropes; this is Huffman-style merging.", hint: "Pop the two smallest, add their sum to the cost, and push the sum back.",
      s: "Read a line of rope lengths. Joining two ropes costs the sum of their lengths. Print the minimum total cost to join all ropes into one.", inp: "One line.", out: "An integer.", edge: "one rope",
      sol: `import heapq

ropes = list(map(int, input().split()))
heapq.heapify(ropes)
cost = 0
while len(ropes) > 1:
    a = heapq.heappop(ropes)
    b = heapq.heappop(ropes)
    cost += a + b
    heapq.heappush(ropes, a + b)
print(cost)`, c: [["4 3 2 6", "29"], ["1", "0"], ["1 2", "3"], ["5 5 5 5", "40"]] }),
    p({ t: "K Closest Points to Origin", d: "M", tags: ["heap", "sorting", "geometry"], tc: "O(n log k)", sc: "O(k)", goal: "Rank points by squared distance (no square roots needed) and break ties deterministically.", hint: "Sort by (x*x + y*y, x, y) and take the first k, or keep a heap of size k.",
      s: "Read n and k and then n points (x y). Print the k points closest to the origin (0, 0), one per line, ordered by distance, then by x, then by y.", inp: "Line 1: n k. Then n points.", out: "k lines.", edge: "equal distances",
      sol: `n, k = map(int, input().split())
points = [tuple(map(int, input().split())) for _ in range(n)]
points.sort(key=lambda p: (p[0] ** 2 + p[1] ** 2, p[0], p[1]))
for x, y in points[:k]:
    print(x, y)`, c: [["2 1\n1 3\n-2 2", "-2 2"], ["3 2\n3 3\n5 -1\n-2 4", "3 3\n-2 4"], ["1 1\n0 0", "0 0"], ["3 3\n1 1\n-1 -1\n0 2", "-1 -1\n1 1\n0 2"]] }),
    p({ t: "Median of a Data Stream", d: "M", tags: ["heap", "design", "streaming"], tc: "O(log n) per number", sc: "O(n)", goal: "Keep the lower half in a max-heap and the upper half in a min-heap, balanced in size.", hint: "Push to the max-heap, move its top to the min-heap, and rebalance so the lower half is never smaller.",
      s: "Read a line of numbers arriving one at a time. After each number print the median of all numbers seen so far with one decimal. All the medians go on one line separated by spaces.", inp: "One line.", out: "One line of medians.", edge: "even counts",
      sol: `import heapq

low, high = [], []
out = []
for x in map(int, input().split()):
    heapq.heappush(low, -x)
    heapq.heappush(high, -heapq.heappop(low))
    if len(high) > len(low):
        heapq.heappush(low, -heapq.heappop(high))
    median = -low[0] if len(low) > len(high) else (-low[0] + high[0]) / 2
    out.append(f"{median:.1f}")
print(*out)`, c: [["5 15 1 3", "5.0 10.0 5.0 4.0"], ["2", "2.0"], ["1 2", "1.0 1.5"], ["3 2 1", "3.0 2.5 2.0"]] }),
    p({ t: "Minimum Arrows to Burst Balloons", d: "M", tags: ["intervals", "greedy"], tc: "O(n log n)", sc: "O(n)", goal: "Sort by end and shoot at the end of the first balloon, which bursts every balloon overlapping that point.", hint: "Keep the end of the current arrow; a balloon starting after it needs a new arrow.",
      s: "Read n and then n balloons as intervals (start end) on a line. An arrow shot at position x bursts every balloon with start <= x <= end. Print the minimum number of arrows needed.", inp: "Line 1: n. Then n lines.", out: "An integer.", edge: "touching balloons",
      sol: `n = int(input())
balloons = sorted((tuple(map(int, input().split())) for _ in range(n)), key=lambda b: b[1])
arrows = 0
position = float("-inf")
for start, end in balloons:
    if start > position:
        arrows += 1
        position = end
print(arrows)`, c: [["4\n10 16\n2 8\n1 6\n7 12", "2"], ["4\n1 2\n3 4\n5 6\n7 8", "4"], ["3\n1 2\n2 3\n3 4", "2"], ["1\n5 9", "1"]] }),
    p({ t: "Maximize Capital", d: "H", tags: ["greedy", "heap"], tc: "O(n log n)", sc: "O(n)", goal: "Among the projects you can afford, always do the most profitable one, using a heap of affordable profits.", hint: "Sort projects by required capital, move the affordable ones into a max-heap of profits, and take the best k times.",
      s: "Read k and your starting capital w, then a line of project profits and a line of the capital each project requires. Each project can be done once and adds its profit to your capital. You may complete at most k projects. Print the maximum capital you can end with.", inp: "Line 1: k w. Line 2: profits. Line 3: required capital.", out: "An integer.", edge: "no affordable project",
      sol: `import heapq

k, w = map(int, input().split())
profits = list(map(int, input().split()))
capital = list(map(int, input().split()))
projects = sorted(zip(capital, profits))
heap = []
i = 0
for _ in range(k):
    while i < len(projects) and projects[i][0] <= w:
        heapq.heappush(heap, -projects[i][1])
        i += 1
    if not heap:
        break
    w -= heapq.heappop(heap)
print(w)`, c: [["2 0\n1 2 3\n0 1 1", "4"], ["3 0\n1 2 3\n0 1 2", "6"], ["1 0\n1 2 3\n1 1 2", "0"], ["2 1\n5 4\n2 1", "10"]] }),
    p({ t: "Candy Distribution", d: "H", tags: ["greedy", "array"], tc: "O(n)", sc: "O(n)", goal: "Satisfy the left neighbour rule and the right neighbour rule in two separate passes and take the maximum.", hint: "Pass left to right giving more than the left neighbour when the rating is higher, then right to left; keep the larger value.",
      s: "Read a line of children's ratings in a row. Every child gets at least one candy, and a child with a higher rating than a neighbour must get more candies than that neighbour. Print the minimum total number of candies.", inp: "One line.", out: "An integer.", edge: "equal ratings",
      sol: `ratings = list(map(int, input().split()))
n = len(ratings)
candy = [1] * n
for i in range(1, n):
    if ratings[i] > ratings[i - 1]:
        candy[i] = candy[i - 1] + 1
for i in range(n - 2, -1, -1):
    if ratings[i] > ratings[i + 1]:
        candy[i] = max(candy[i], candy[i + 1] + 1)
print(sum(candy))`, c: [["1 0 2", "5"], ["1 2 2", "4"], ["5", "1"], ["1 3 2 2 1", "7"]] }),
    p({ t: "Minimum Refuelling Stops", d: "H", tags: ["greedy", "heap"], tc: "O(n log n)", sc: "O(n)", goal: "Drive as far as possible and only when stuck refuel at the best station already passed.", hint: "Keep a max-heap of fuel amounts at stations you passed; when you cannot reach the next point, take the largest.",
      s: "Read the target distance and the starting fuel (one unit of fuel is one unit of distance), then n, then n stations as position and fuel (sorted by position). Each station can be used once and gives all its fuel. Print the minimum number of refuelling stops to reach the target, or -1 if impossible.", inp: "Line 1: target start_fuel. Line 2: n. Then n stations.", out: "An integer.", edge: "start fuel already enough",
      sol: `import heapq

target, fuel = map(int, input().split())
n = int(input())
stations = [tuple(map(int, input().split())) for _ in range(n)] + [(target, 0)]
heap = []
stops = 0
last = 0
answer = None
for position, gas in stations:
    fuel -= position - last
    while fuel < 0 and heap:
        fuel -= heapq.heappop(heap)
        stops += 1
    if fuel < 0:
        answer = -1
        break
    heapq.heappush(heap, -gas)
    last = position
print(answer if answer is not None else stops)`, c: [["1 1\n0", "0"], ["100 1\n1\n10 100", "-1"], ["100 10\n4\n10 60\n20 30\n30 30\n60 40", "2"], ["100 50\n2\n25 25\n50 50", "1"]] }),
  ],
});

module.exports = { lessons };
