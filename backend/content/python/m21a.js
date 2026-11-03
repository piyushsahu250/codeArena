// Phase 7 / Module 21, lessons 1-2: the interview method, and arrays with prefix sums.
// Every problem is a tagged PracticeQuestion: difficulty, topic tags, a style tag, intended time and space complexity and a learning objective.
// The style tag names the kind of assessment practised; no problem is claimed to come from any company.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, prob: p } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 1
lessons.push({
  title: "How to Solve a Coding Problem: Method, Complexity and Testing",
  minutes: 50,
  learn: ["Follow a repeatable method: understand, examples, brute force, improve, code, test", "Estimate time and space complexity and relate them to input limits", "Choose test cases that expose edge cases", "Communicate your thinking in an interview or online assessment"],
  why: "Interviewers and online assessments judge how you think as much as the final code. A fixed method keeps you calm, avoids silly mistakes and lets you recover when you are stuck.",
  realWorld: "In a 45-minute interview you are given an unfamiliar problem. Candidates who clarify the input, state a simple solution first, improve it, and test it with edge cases usually do better than those who start typing at once.",
  simple: "Do not code first. <strong>Understand</strong> the problem, try <strong>small examples</strong>, state a <strong>brute-force</strong> answer and its cost, find what is wasteful, <strong>improve</strong>, then code and <strong>test</strong> with ordinary and edge cases.",
  detail: `<h3>A seven-step method</h3>
<ol><li><strong>Restate</strong> the problem in your own words. Ask about input size, value ranges, duplicates, empty input and what to return when there is no answer.</li><li><strong>Examples</strong>: work one small example by hand and one tricky one.</li><li><strong>Brute force</strong>: say the obvious solution and its time and space. A correct slow solution beats no solution.</li><li><strong>Look for the waste</strong>: repeated work (use a dictionary or prefix sums), unused order (sort, binary search, two pointers), overlapping subproblems (dynamic programming).</li><li><strong>Plan</strong> in plain steps, including the data structure you will use and why.</li><li><strong>Code</strong> with clear names; keep the main idea visible.</li><li><strong>Test</strong> with your examples, an empty or single element, duplicates, negatives, the largest input, then trace one example line by line.</li></ol>
<h3>Complexity and input limits</h3>
<p>Count how the work grows with the input size n (time) and how much extra memory you use (space). A Python program does roughly 10 to 50 million simple operations per second, so the limits guide the approach:</p>
${table(["n up to", "Aim for", "Typical techniques"], [["10 to 20", "O(2^n) or O(n!)", "backtracking, bitmask search"], ["500", "O(n^3)", "triple loops, Floyd-Warshall"], ["5,000", "O(n^2)", "nested loops, simple dynamic programming"], ["100,000", "O(n log n)", "sorting, heaps, binary search, segment trees"], ["1,000,000 or more", "O(n)", "one pass, hashing, two pointers, prefix sums"]])}
<p><code>sorted()</code> is O(n log n). Dictionary and set lookups are O(1) on average. Slicing and <code>list.insert(0, x)</code> cost O(n). Building a string with <code>+=</code> in a loop can be O(n^2); use <code>"".join(parts)</code>.</p>
<h3>Reading input fast</h3>
<p>In online judges use <code>input()</code> for small inputs and <code>sys.stdin.read().split()</code> or <code>sys.stdin.readline</code> for large ones. Print once with <code>print(*items)</code> or <code>"\\n".join(...)</code> instead of thousands of separate prints.</p>
<h3>Edge cases to try every time</h3>
<ul><li>Empty or one element; two equal elements; all elements equal.</li><li>Negative numbers, zero, very large values (Python integers do not overflow).</li><li>Already sorted, reverse sorted, duplicates.</li><li>The smallest and the largest allowed input.</li><li>No answer: print what the statement says (such as -1 or none).</li></ul>
<h3>In the interview</h3>
<p>Think aloud, state trade-offs, name the pattern if you see one, ask for hints when stuck (it is normal), and never stay silent for minutes. After coding, walk through your own test case before saying you are done. Honest statements such as &quot;I have seen a similar problem, so I will use that idea&quot; are fine.</p>
<h3>About the problem bank in this module</h3>
<p>Every problem is tagged with its difficulty, topic, a <em>style</em> label (campus online assessment, product-company interview, or advanced), the intended time and space complexity and a learning objective. The style labels describe the kind of assessment a problem practises; the problems are original teaching exercises and none is claimed to come from any particular company.</p>`,
  syntax: { code: `import sys\ndata = sys.stdin.read().split()\nnums = list(map(int, data))\nprint(*result)           # one output call`, note: "Read fast, print once." },
  diagram: chain("The problem-solving method", "Left to right: restate and ask questions, work examples, state a brute-force solution, improve it, code it, then test edge cases.",
    [{ k: "proc", t: "restate +\nask" }, { k: "proc", t: "small\nexamples" }, { k: "proc", t: "brute\nforce" }, { k: "proc", t: "improve" }, { k: "proc", t: "code" }, { k: "term", t: "test\nedge cases" }], { w: 112, gap: 26, hgt: 56 }),
  example: { code: `def pair_sum_slow(nums, target):
    steps = 0
    for i in range(len(nums)):
        for j in range(i + 1, len(nums)):
            steps += 1
            if nums[i] + nums[j] == target:
                return (i, j), steps
    return None, steps


def pair_sum_fast(nums, target):
    seen, steps = {}, 0
    for i, x in enumerate(nums):
        steps += 1
        if target - x in seen:
            return (seen[target - x], i), steps
        seen[x] = i
    return None, steps


print(pair_sum_slow([2, 7, 11, 15], 9), pair_sum_fast([2, 7, 11, 15], 9))
for n in (10, 100, 1000):
    nums = list(range(n))
    print(n, pair_sum_slow(nums, -1)[1], pair_sum_fast(nums, -1)[1])`, out: `((0, 1), 1) ((0, 1), 2)
10 45 10
100 4950 100
1000 499500 1000` },
  lineByLine: [["pair_sum_slow", "Brute force: try every pair. It counts how many pairs it looked at."], ["pair_sum_fast", "Remember every number seen; for each new number ask whether its partner target - x was seen. One pass."], ["first line", "Both find the pair (0, 1) for [2, 7, 11, 15] and target 9, in 1 and 2 steps."], ["target -1 on 0..n-1", "No pair sums to -1, so each function does all of its work (the worst case)."], ["steps 45, 4950, 499500", "n(n-1)/2 pairs: it grows with n squared. When n is 10 times larger the work is 100 times larger."], ["steps 10, 100, 1000", "n steps: it grows in step with n. This is the difference between O(n^2) and O(n)."]],
  dryRun: { intro: "Two sum with the dictionary on <code>[2, 7, 11, 15]</code>, target 9:", headers: ["i", "x", "target - x", "seen before", "action"], rows: [["0", "2", "7", "{}", "store 2 -> 0"], ["1", "7", "2", "{2: 0}", "found: indices 0 and 1"]] },
  realExample: { intro: "Testing the way an interviewer expects: the same function on ordinary and edge inputs, compared with an obviously correct slow version.", code: `def max_subarray_fast(nums):
    best = current = nums[0]
    for x in nums[1:]:
        current = max(x, current + x)
        best = max(best, current)
    return best


def max_subarray_slow(nums):
    return max(sum(nums[i:j]) for i in range(len(nums)) for j in range(i + 1, len(nums) + 1))


tests = [[5], [-3], [1, 2, 3], [-2, 1, -3, 4, -1, 2, 1, -5, 4], [-1, -2, -3], [0, 0], [3, -10, 3]]
print(all(max_subarray_fast(t) == max_subarray_slow(t) for t in tests))
print([max_subarray_fast(t) for t in tests])`, out: `True
[5, -3, 6, 6, -1, 0, 3]` },
  mistakes: ["Starting to code before understanding the problem.", "Skipping the brute-force answer, then freezing.", "Testing only the sample input.", "Ignoring input limits and writing O(n^2) for n = 10^6.", "Staying silent while thinking."],
  practices: ["Ask clarifying questions and repeat the answers.", "State the complexity of your solution unprompted.", "Write a slow, obviously correct version to compare against.", "Practise on a timer."],
  interview: ["How do you approach a problem you have not seen?", "What is the complexity of your solution and can you do better?", "Which edge cases would you test?", "What do you do when you are stuck?"],
  practiceQs: ["What would you try for n = 10^5?", "Why is s += c in a loop risky?", "What is the worst case of the dictionary approach for two sum?", "Name five edge cases for an array problem."],
  revision: ["Restate, examples, brute force, improve, code, test.", "Limits guide complexity: 10^5 means about O(n log n).", "Edge cases: empty, one, equal, negative, largest, none.", "Think aloud."],
  hinglish: "Problem milte hi code mat likho: pehle samjho, chhote examples try karo, brute force batao, phir usse behtar banao, code likho aur edge cases se test karo. Input limit dekh kar tay karo ki O(n^2) chalega ya O(n log n) chahiye. Interview mein sochte hue bolte raho.",
  quiz: [
    mcq("n can be 100,000. Which time complexity is the safest target in Python?", ["O(n^2)", "O(n log n)", "O(2^n)", "O(n!)"], 1, "About 10^5 x 17 operations is fast; 10^10 for n^2 is far too slow."),
    mcq("What is the best first solution to state in an interview when you do not see the trick yet?", ["Nothing; wait for inspiration", "A correct brute-force solution and its cost", "A guess without testing", "The final optimised code"], 1, "A correct slow solution shows progress and often reveals the waste to remove."),
    mcq("Which operation is O(n) and a common hidden cost in loops?", ["Dictionary lookup", "list.insert(0, x)", "Appending to a list", "Reading a list element by index"], 1, "Inserting at the front shifts every element."),
    mcq("Which input is the most useful edge case for a function that returns the maximum of a list?", ["A list of 1000 random numbers", "An empty list or a one-element list", "A list sorted ascending", "A list of strings"], 1, "Empty and single-element inputs break many first attempts."),
    mcq("Why print once with print(*items) or join instead of many print calls in a loop for big output?", ["It looks nicer", "Fewer output calls are much faster", "print is unsafe", "It changes the answer"], 1, "Each print call has overhead; one call writes everything.")
  ],
  tasks: [
    p({ t: "Reverse Integer", d: "E", tags: ["math", "warm-up"], tc: "O(d)", sc: "O(d)", goal: "Handle sign and trailing zeros when reversing the digits of an integer.", hint: "Reverse the digits of the absolute value as text, then put the sign back.",
      s: "Read one integer (possibly negative). Print the integer obtained by reversing its digits, keeping the sign. Trailing zeros of the input disappear (120 becomes 21).", inp: "One integer.", out: "The reversed integer.", edge: "negative numbers, trailing zeros, zero",
      sol: `n = int(input())
sign = -1 if n < 0 else 1
print(sign * int(str(abs(n))[::-1]))`, c: [["123", "321"], ["-120", "-21"], ["0", "0"], ["1000", "1"]] }),
    p({ t: "Palindrome Number", d: "E", tags: ["math", "warm-up"], tc: "O(d)", sc: "O(1)", goal: "Decide palindromes without special-casing, remembering that negative numbers are not palindromes.", hint: "Compare the digits with their reverse; a minus sign breaks the match.",
      s: "Read an integer. Print yes if it reads the same forwards and backwards (negative numbers never do), otherwise print no.", inp: "One integer.", out: "yes or no.", edge: "negative numbers, single digit, numbers ending in 0",
      sol: `n = int(input())
text = str(n)
print("yes" if text == text[::-1] else "no")`, c: [["121", "yes"], ["-121", "no"], ["10", "no"], ["7", "yes"]] }),
    p({ t: "Custom FizzBuzz", d: "E", tags: ["math", "warm-up"], tc: "O(n x r)", sc: "O(1)", goal: "Combine several rules for one output using string building instead of nested ifs.", hint: "Build the word by appending each matching rule's word; if the word is empty print the number.",
      s: "Read n and then a line of rules written as number word pairs (for example 3 Fizz 5 Buzz). For every i from 1 to n print the concatenation of the words of all rules whose number divides i, in the order given. If no rule applies print i itself. One value per line.", inp: "Line 1: n. Line 2: the rules as alternating numbers and words.", out: "n lines.", edge: "numbers divisible by several rules, no rule applies",
      sol: `n = int(input())
parts = input().split()
rules = [(int(parts[i]), parts[i + 1]) for i in range(0, len(parts), 2)]
for i in range(1, n + 1):
    word = "".join(w for k, w in rules if i % k == 0)
    print(word or i)`, c: [["15\n3 Fizz 5 Buzz", "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz"], ["6\n2 Even 3 Three", "1\nEven\nThree\nEven\n5\nEvenThree"], ["3\n7 Seven", "1\n2\n3"], ["4\n1 A", "A\nA\nA\nA"]] }),
  ],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "Arrays and Prefix Sums: Pattern Problems",
  minutes: 90,
  learn: ["Use one-pass scans, running values and Kadane's idea", "Use prefix and suffix arrays to avoid repeated work", "Handle matrices: rotation and spiral traversal", "Apply in-place techniques and recognise when a problem is really about counting"],
  why: "Arrays are the most common interview topic. The patterns here (running maximum, prefix sums, in-place rearrangement, two-way scans) are the building blocks of almost every other topic.",
  realWorld: "Prefix sums power dashboard range totals (sales between two dates), running balances, and cumulative statistics. Kadane's algorithm finds the best consecutive period of profit or loss.",
  simple: "Most array problems become easy once you ask: <em>what do I need to remember while scanning?</em> A running sum, the best so far, the sum before this position (prefix) or after it (suffix).",
  detail: `<h3>Core patterns</h3>
${table(["Pattern", "Idea", "Example problems"], [["running value", "carry one number through a single pass", "maximum consecutive ones, second largest"], ["Kadane", "best sum ending here = max(x, previous + x)", "maximum subarray, circular subarray, maximum product"], ["prefix sums", "<code>P[i]</code> = sum of the first i items; sum of a range = <code>P[r+1] - P[l]</code>", "range sum queries, equilibrium index, subarray sum equals k"], ["prefix and suffix products", "answer = everything left x everything right", "product except self, trapping rain water"], ["in-place swapping", "overwrite with a write pointer, or swap from the ends", "move zeroes, remove duplicates, sort colors, next permutation"], ["index as hash", "use the array's own positions or signs as markers", "first missing positive, find duplicates"], ["matrix layers", "process row by row or ring by ring", "rotate image, spiral order"]])}
<h3>Prefix sums in one picture</h3>
<p>For <code>a = [3, 1, 4, 1, 5]</code>, <code>P = [0, 3, 4, 8, 9, 14]</code>. The sum of <code>a[1..3]</code> is <code>P[4] - P[1] = 9 - 3 = 6</code>. Building P costs O(n) once; every query is O(1).</p>
<h3>Kadane's algorithm</h3>
<p>Let <code>cur</code> be the best sum of a subarray ending at the current element: either the element alone or the element added to the previous best. Keep the largest <code>cur</code> seen. All-negative arrays work because <code>cur</code> starts from the first element, not 0.</p>
<h3>Matrix tips</h3>
<p>Rotating clockwise equals reversing the row order and then transposing: <code>[list(r) for r in zip(*m[::-1])]</code>. For spiral order keep four bounds (top, bottom, left, right) and shrink them.</p>
<h3>Choosing the approach</h3>
<ul><li>&quot;Contiguous&quot; and &quot;sum&quot; suggests prefix sums or Kadane.</li><li>&quot;Except self&quot; or &quot;left and right&quot; suggests prefix and suffix arrays.</li><li>&quot;In place&quot; and O(1) memory suggests pointers and swaps.</li><li>Values bounded by the array length suggest using indices as markers.</li></ul>`,
  syntax: { code: `P = [0]\nfor x in a:\n    P.append(P[-1] + x)\nrange_sum = P[r + 1] - P[l]\n\nbest = cur = a[0]\nfor x in a[1:]:\n    cur = max(x, cur + x)\n    best = max(best, cur)`, note: "Prefix sums for ranges, Kadane for the best consecutive sum." },
  diagram: chain("Prefix sums", "Left to right: the array, its prefix sums built once, and a range sum answered by subtracting two prefix values.",
    [{ k: "io", t: "array\na[0..n-1]" }, { k: "proc", t: "build P\nP[i+1] = P[i] + a[i]" }, { k: "proc", t: "range sum =\nP[r+1] - P[l]" }, { k: "term", t: "answer\nin O(1)" }], { w: 160, gap: 36, hgt: 62 }),
  example: { code: `def prefix_sums(a):
    p = [0]
    for x in a:
        p.append(p[-1] + x)
    return p


def kadane(a):
    best = cur = a[0]
    for x in a[1:]:
        cur = max(x, cur + x)
        best = max(best, cur)
    return best


a = [3, 1, 4, 1, 5]
p = prefix_sums(a)
print(p)
print(p[4] - p[1], sum(a[1:4]))
print(kadane([-2, 1, -3, 4, -1, 2, 1, -5, 4]), kadane([-3, -1, -2]))

left = [1]
for x in a[:-1]:
    left.append(left[-1] * x)
right = [1]
for x in reversed(a[1:]):
    right.append(right[-1] * x)
right.reverse()
print([l * r for l, r in zip(left, right)])`, out: `[0, 3, 4, 8, 9, 14]
6 6
6 -1
[20, 60, 15, 60, 12]` },
  lineByLine: [["prefix_sums", "p[i] holds the sum of the first i elements; p[0] is 0, the sum of nothing."], ["p[4] - p[1]", "The sum of a[1], a[2], a[3] (3 elements): 6, equal to the direct sum."], ["kadane", "cur is the best sum ending at the current element; best is the largest cur seen. The first array's best is 4 -1 2 1 = 6."], ["kadane([-3, -1, -2])", "Starting from the first element makes all-negative arrays return the largest element, -1, not 0."], ["left and right", "left[i] is the product of everything before i, right[i] everything after."], ["last line", "The product of all other elements for each position of [3, 1, 4, 1, 5]: for example 1 x 4 x 1 x 5 = 20."]],
  dryRun: { intro: "Kadane on <code>[-2, 1, -3, 4, -1, 2, 1, -5, 4]</code> (first six steps):", headers: ["x", "cur = max(x, cur + x)", "best"], rows: [["-2", "-2", "-2"], ["1", "1", "1"], ["-3", "-2", "1"], ["4", "4", "4"], ["-1", "3", "4"], ["2", "5", "5"]] },
  realExample: { intro: "Counting subarrays with a given sum by remembering how often each prefix sum occurred (prefix sums plus a dictionary).", code: `from collections import defaultdict


def count_subarrays_with_sum(a, k):
    seen = defaultdict(int)
    seen[0] = 1
    total = count = 0
    for x in a:
        total += x
        count += seen[total - k]
        seen[total] += 1
    return count


print(count_subarrays_with_sum([1, 1, 1], 2))
print(count_subarrays_with_sum([1, -1, 0], 0))
print(count_subarrays_with_sum([3, 4, 7, 2, -3, 1, 4, 2], 7))`, out: `2
3
4` },
  mistakes: ["Initialising Kadane with 0, which breaks all-negative arrays.", "Off-by-one errors in prefix ranges (use P of length n + 1).", "Using division for product except self (fails with zeros).", "Modifying a list while looping over it.", "Slicing inside a loop and turning an O(n) idea into O(n^2)."],
  practices: ["Say what you remember during the scan.", "Test an all-negative, an all-zero and a single-element array.", "Prefer one pass when it keeps the code clear.", "Draw a six-element example and trace it."],
  interview: ["Explain Kadane's algorithm.", "How do prefix sums answer range queries?", "How do you compute product except self without division?", "How would you rotate a matrix in place?"],
  practiceQs: ["What is P for [2, 2, 2]?", "Why start the dictionary with {0: 1}?", "What is the complexity of building prefix sums?", "How do you spot a circular-array problem?"],
  revision: ["Running value, prefix sums, Kadane, prefix x suffix.", "Range sum is P[r+1] - P[l].", "Index markers for values 1..n.", "Matrix rotation = reverse rows then transpose."],
  hinglish: "Array ke zyadatar sawal ye puchte hain: scan karte waqt kya yaad rakhna hai? Running sum, ab tak ka best, ya is position ke pehle/baad ka hissa. Prefix sum se range sum O(1) mein milta hai aur Kadane se sabse achha continuous subarray.",
  quiz: [
    mcq("For a = [3, 1, 4, 1, 5], what is the sum of a[1..3] using prefix sums P = [0, 3, 4, 8, 9, 14]?", ["P[3] - P[1]", "P[4] - P[1]", "P[4] - P[0]", "P[3] - P[0]"], 1, "The sum of indices l..r is P[r+1] - P[l] = 9 - 3 = 6."),
    mcq("Why should Kadane start with the first element rather than 0?", ["It is faster", "An all-negative array must return its largest element, not 0", "It avoids overflow", "Python requires it"], 1, "Starting at 0 would claim an empty subarray with sum 0."),
    mcq("Which technique gives product of array except self in O(n) without division?", ["Sorting", "Prefix and suffix products", "Binary search", "Recursion"], 1, "Multiply what is left of i by what is right of i."),
    mcq("Which operation rotates a square matrix 90 degrees clockwise?", ["Transpose only", "Reverse the row order, then transpose", "Reverse each row only", "Sort the rows"], 1, "m[::-1] then zip(*...) does exactly that."),
    mcq("An array holds each value from 1..n once or twice. Which trick finds duplicates in O(1) extra space?", ["Use signs or positions as markers", "Sort with a heap", "Recursion with memo", "Binary search on the answer"], 0, "Marking index value-1 as visited uses the array itself.")
  ],
  tasks: [
    p({ t: "Second Largest Distinct", d: "E", tags: ["array", "running-value"], tc: "O(n)", sc: "O(1)", goal: "Track two values in one pass and handle duplicates and tiny inputs.", hint: "Keep the largest and the second largest distinct value; ignore a value equal to the largest.",
      s: "Read a line of integers. Print the second largest distinct value, or none if there are fewer than two distinct values.", inp: "One line of integers.", out: "An integer or the word none.", edge: "all equal, two elements, negatives",
      sol: `first = second = None
for x in map(int, input().split()):
    if first is None or x > first:
        first, second = x, first
    elif x != first and (second is None or x > second):
        second = x
print(second if second is not None else "none")`, c: [["4 9 2 9 7", "7"], ["5 5 5", "none"], ["-3 -1 -2", "-2"], ["10 20", "10"]] }),
    p({ t: "Move Zeroes to the End", d: "E", tags: ["array", "in-place"], tc: "O(n)", sc: "O(1)", goal: "Rearrange with a write pointer while keeping the order of the other elements.", hint: "Copy non-zero values forward with a write index, then fill the rest with zeros.",
      s: "Read a line of integers. Print the same numbers with all zeros moved to the end and the order of the other numbers unchanged.", inp: "One line of integers.", out: "The rearranged line.", edge: "all zeros, no zeros, single element",
      sol: `a = list(map(int, input().split()))
write = 0
for x in a:
    if x != 0:
        a[write] = x
        write += 1
for i in range(write, len(a)):
    a[i] = 0
print(*a)`, c: [["0 1 0 3 12", "1 3 12 0 0"], ["1 2 3", "1 2 3"], ["0", "0"], ["4 0 5 0 6 0", "4 5 6 0 0 0"]] }),
    p({ t: "Rotate Array Right by K", d: "E", tags: ["array", "rotation"], tc: "O(n)", sc: "O(n)", goal: "Use modulo to normalise the rotation amount and slice correctly.", hint: "Reduce k with k % n, then the answer is the last k items followed by the rest.",
      s: "Read a line of integers and then k. Rotate the array to the right by k places (k may be larger than the length) and print it.", inp: "Line 1: the array. Line 2: k.", out: "The rotated array.", edge: "k = 0, k larger than n, single element",
      sol: `a = list(map(int, input().split()))
k = int(input()) % len(a)
print(*(a[len(a) - k:] + a[:len(a) - k]))`, c: [["1 2 3 4 5 6 7\n3", "5 6 7 1 2 3 4"], ["1 2\n3", "2 1"], ["1 2 3\n0", "1 2 3"], ["9\n100", "9"]] }),
    p({ t: "Maximum Consecutive Ones", d: "E", tags: ["array", "running-value"], tc: "O(n)", sc: "O(1)", goal: "Maintain a current streak and a best streak in a single pass.", hint: "Increase a counter on 1, reset it on 0 and track the maximum.",
      s: "Read a line of 0s and 1s. Print the length of the longest run of consecutive 1s.", inp: "One line of 0/1 values.", out: "An integer.", edge: "no ones, all ones",
      sol: `best = cur = 0
for x in map(int, input().split()):
    cur = cur + 1 if x == 1 else 0
    best = max(best, cur)
print(best)`, c: [["1 1 0 1 1 1", "3"], ["0 0", "0"], ["1", "1"], ["1 0 1 1 0 1 1 1 1", "4"]] }),
    p({ t: "Missing Number in a Range", d: "E", tags: ["array", "math"], tc: "O(n)", sc: "O(1)", goal: "Replace a search with an arithmetic identity (sum of 0..n).", hint: "The numbers 0..n add up to n(n+1)/2; subtract what you have.",
      s: "Read a line with n distinct integers taken from the range 0..n. Print the one number of that range that is missing.", inp: "One line with n distinct integers from 0..n.", out: "The missing number.", edge: "missing 0, missing n",
      sol: `a = list(map(int, input().split()))
n = len(a)
print(n * (n + 1) // 2 - sum(a))`, c: [["3 0 1", "2"], ["0 1", "2"], ["9 6 4 2 3 5 7 0 1", "8"], ["1", "0"]] }),
    p({ t: "Check Sorted Order", d: "E", tags: ["array", "scan"], tc: "O(n)", sc: "O(1)", goal: "Compare neighbouring elements in a single scan and stop on the first violation.", hint: "The array is sorted if no element is smaller than its predecessor.",
      s: "Read a line of integers. Print yes if the numbers are in non-decreasing order, otherwise print no.", inp: "One line of integers.", out: "yes or no.", edge: "single element, equal neighbours",
      sol: `a = list(map(int, input().split()))
print("yes" if all(a[i] <= a[i + 1] for i in range(len(a) - 1)) else "no")`, c: [["1 2 2 5", "yes"], ["3 1", "no"], ["7", "yes"], ["1 3 2", "no"]] }),
    p({ t: "Unique Values of a Sorted Array", d: "E", tags: ["array", "two-pointers"], tc: "O(n)", sc: "O(1)", goal: "Compare each element with the last kept one instead of using a set.", hint: "In a sorted array duplicates are neighbours; keep an element only if it differs from the last kept.",
      s: "Read a line with a sorted (non-decreasing) array. Print the number of distinct values on the first line and the distinct values in order on the second.", inp: "One line, sorted.", out: "Line 1: count. Line 2: the distinct values.", edge: "all equal, single element",
      sol: `a = list(map(int, input().split()))
kept = [a[0]]
for x in a[1:]:
    if x != kept[-1]:
        kept.append(x)
print(len(kept))
print(*kept)`, c: [["1 1 2", "2\n1 2"], ["0 0 1 1 1 2 2 3 3 4", "5\n0 1 2 3 4"], ["5", "1\n5"], ["2 2 2", "1\n2"]] }),
    p({ t: "Sort Colors", d: "E", tags: ["array", "counting"], tc: "O(n)", sc: "O(1)", goal: "Sort a tiny set of values by counting instead of comparing.", hint: "Count the 0s, 1s and 2s, then write them back in order.",
      s: "Read a line containing only 0, 1 and 2. Print it sorted in ascending order.", inp: "One line of 0/1/2 values.", out: "The sorted line.", edge: "one colour only",
      sol: `a = list(map(int, input().split()))
counts = [a.count(0), a.count(1), a.count(2)]
print(*([0] * counts[0] + [1] * counts[1] + [2] * counts[2]))`, c: [["2 0 2 1 1 0", "0 0 1 1 2 2"], ["2 0 1", "0 1 2"], ["1", "1"], ["0 0", "0 0"]] }),
    p({ t: "Maximum Subarray Sum", d: "M", tags: ["array", "kadane", "dp"], tc: "O(n)", sc: "O(1)", goal: "Apply Kadane's algorithm and handle all-negative input correctly.", hint: "best ending here = max(x, previous best ending here + x).",
      s: "Read a line of integers (at least one). Print the largest sum of a non-empty contiguous subarray.", inp: "One line of integers.", out: "An integer.", edge: "all negative, single element",
      sol: `a = list(map(int, input().split()))
best = cur = a[0]
for x in a[1:]:
    cur = max(x, cur + x)
    best = max(best, cur)
print(best)`, c: [["-2 1 -3 4 -1 2 1 -5 4", "6"], ["1", "1"], ["-3 -1 -2", "-1"], ["5 4 -1 7 8", "23"]] }),
    p({ t: "Product of Array Except Self", d: "M", tags: ["array", "prefix-product"], tc: "O(n)", sc: "O(1) extra", goal: "Use prefix and suffix products so no division is needed and zeros are handled.", hint: "Fill the answer with products of everything to the left, then multiply by everything to the right in a second pass.",
      s: "Read a line of integers. Print, for each position, the product of all the other numbers. Do not use division.", inp: "One line of integers (at least one).", out: "A line of products.", edge: "zeros, single element",
      sol: `a = list(map(int, input().split()))
n = len(a)
out = [1] * n
left = 1
for i in range(n):
    out[i] = left
    left *= a[i]
right = 1
for i in range(n - 1, -1, -1):
    out[i] *= right
    right *= a[i]
print(*out)`, c: [["1 2 3 4", "24 12 8 6"], ["-1 1 0 -3 3", "0 0 9 0 0"], ["5", "1"], ["2 3", "3 2"]] }),
    p({ t: "Count Subarrays With Sum K", d: "M", tags: ["array", "prefix-sum", "hashing"], tc: "O(n)", sc: "O(n)", goal: "Combine prefix sums with a dictionary to count ranges, including negative numbers.", hint: "For each prefix sum s, add how many earlier prefixes equal s - k.",
      s: "Read a line of integers and then k. Print how many contiguous subarrays have a sum equal to k.", inp: "Line 1: the array. Line 2: k.", out: "An integer.", edge: "negative numbers, zeros, k = 0",
      sol: `from collections import defaultdict

a = list(map(int, input().split()))
k = int(input())
seen = defaultdict(int)
seen[0] = 1
total = count = 0
for x in a:
    total += x
    count += seen[total - k]
    seen[total] += 1
print(count)`, c: [["1 1 1\n2", "2"], ["1 2 3\n3", "2"], ["1 -1 0\n0", "3"], ["5\n5", "1"]] }),
    p({ t: "Range Sum Queries", d: "M", tags: ["array", "prefix-sum"], tc: "O(n + q)", sc: "O(n)", goal: "Preprocess once so every range query is answered in constant time.", hint: "Build P with P[0] = 0; the sum of l..r is P[r + 1] - P[l].",
      s: "Read a line with n integers, then q, then q lines l r (0-based, inclusive). Print the sum of a[l..r] for every query, one per line.", inp: "Line 1: the array. Line 2: q. Then q query lines.", out: "q lines.", edge: "single-element ranges, negative values",
      sol: `a = list(map(int, input().split()))
q = int(input())
p = [0]
for x in a:
    p.append(p[-1] + x)
for _ in range(q):
    l, r = map(int, input().split())
    print(p[r + 1] - p[l])`, c: [["1 2 3 4 5\n3\n0 4\n1 3\n2 2", "15\n9\n3"], ["10 -2 5\n2\n0 0\n1 2", "10\n3"], ["7\n1\n0 0", "7"], ["1 1 1 1\n2\n0 3\n1 2", "4\n2"]] }),
    p({ t: "Equilibrium Index", d: "M", tags: ["array", "prefix-sum"], tc: "O(n)", sc: "O(1)", goal: "Compare the sum on the left with the total minus the left minus the element.", hint: "Keep the left sum; the right sum is total - left - a[i].",
      s: "Read a line of integers. Print the first index whose left-side sum equals its right-side sum (an empty side counts as 0), or -1 if there is none.", inp: "One line of integers.", out: "An index or -1.", edge: "index 0, last index, single element",
      sol: `a = list(map(int, input().split()))
total = sum(a)
left = 0
answer = -1
for i, x in enumerate(a):
    if left == total - left - x:
        answer = i
        break
    left += x
print(answer)`, c: [["1 7 3 6 5 6", "3"], ["1 2 3", "-1"], ["2 1 -1", "0"], ["0", "0"]] }),
    p({ t: "Next Permutation", d: "M", tags: ["array", "permutation"], tc: "O(n)", sc: "O(1)", goal: "Find the pivot from the right, swap, then reverse the suffix.", hint: "Find the rightmost i with a[i] < a[i+1], swap a[i] with the smallest larger element on its right, reverse everything after i.",
      s: "Read a line of integers. Print the next lexicographically greater permutation of the numbers; if the array is the greatest permutation, print the smallest (sorted ascending).", inp: "One line of integers.", out: "The next permutation.", edge: "descending input, duplicates",
      sol: `a = list(map(int, input().split()))
i = len(a) - 2
while i >= 0 and a[i] >= a[i + 1]:
    i -= 1
if i >= 0:
    j = len(a) - 1
    while a[j] <= a[i]:
        j -= 1
    a[i], a[j] = a[j], a[i]
a[i + 1:] = reversed(a[i + 1:])
print(*a)`, c: [["1 2 3", "1 3 2"], ["3 2 1", "1 2 3"], ["1 1 5", "1 5 1"], ["1 3 2", "2 1 3"]] }),
    p({ t: "Find All Duplicates", d: "M", tags: ["array", "counting"], tc: "O(n)", sc: "O(n)", goal: "Detect repeated values with a counter (and know the O(1)-space marking alternative).", hint: "Count occurrences; every value seen twice is a duplicate.",
      s: "Read a line of integers where each value appears once or twice. Print the values that appear twice in ascending order, or none.", inp: "One line of integers.", out: "Sorted duplicates or none.", edge: "no duplicates, all duplicates",
      sol: `from collections import Counter

counts = Counter(map(int, input().split()))
dups = sorted(v for v, c in counts.items() if c == 2)
print(*dups if dups else ["none"])`, c: [["4 3 2 7 8 2 3 1", "2 3"], ["1 1 2", "1"], ["1 2 3", "none"], ["2 2", "2"]] }),
    p({ t: "Rotate Matrix Clockwise", d: "M", tags: ["matrix", "array"], tc: "O(n^2)", sc: "O(n^2)", goal: "Express a rotation as reverse-then-transpose.", hint: "Reverse the order of the rows, then transpose with zip(*rows).",
      s: "Read n and then an n by n matrix. Print the matrix rotated 90 degrees clockwise, one row per line.", inp: "Line 1: n. Then n rows of n integers.", out: "n rows.", edge: "n = 1",
      sol: `n = int(input())
m = [list(map(int, input().split())) for _ in range(n)]
for row in zip(*m[::-1]):
    print(*row)`, c: [["3\n1 2 3\n4 5 6\n7 8 9", "7 4 1\n8 5 2\n9 6 3"], ["2\n1 2\n3 4", "3 1\n4 2"], ["1\n5", "5"], ["2\n0 0\n1 1", "1 0\n1 0"]] }),
    p({ t: "Spiral Order", d: "M", tags: ["matrix", "simulation"], tc: "O(r x c)", sc: "O(r x c)", goal: "Walk a matrix ring by ring with four shrinking boundaries.", hint: "Keep top, bottom, left, right; walk the top row, right column, bottom row, left column, then shrink.",
      s: "Read r and c, then an r by c matrix. Print its elements in clockwise spiral order starting at the top-left corner, on one line.", inp: "Line 1: r and c. Then r rows.", out: "One line of integers.", edge: "single row, single column",
      sol: `r, c = map(int, input().split())
m = [list(map(int, input().split())) for _ in range(r)]
top, bottom, left, right = 0, r - 1, 0, c - 1
out = []
while top <= bottom and left <= right:
    for j in range(left, right + 1):
        out.append(m[top][j])
    for i in range(top + 1, bottom + 1):
        out.append(m[i][right])
    if top < bottom and left < right:
        for j in range(right - 1, left - 1, -1):
            out.append(m[bottom][j])
        for i in range(bottom - 1, top, -1):
            out.append(m[i][left])
    top += 1
    bottom -= 1
    left += 1
    right -= 1
print(*out)`, c: [["3 3\n1 2 3\n4 5 6\n7 8 9", "1 2 3 6 9 8 7 4 5"], ["1 4\n1 2 3 4", "1 2 3 4"], ["3 1\n1\n2\n3", "1 2 3"], ["2 3\n1 2 3\n4 5 6", "1 2 3 6 5 4"]] }),
    p({ t: "Maximum Product Subarray", d: "M", tags: ["array", "dp"], tc: "O(n)", sc: "O(1)", goal: "Track both the maximum and minimum product ending here because a negative can flip them.", hint: "Keep the largest and smallest product ending at each position; swap them when x is negative.",
      s: "Read a line of integers. Print the largest product of a non-empty contiguous subarray.", inp: "One line of integers.", out: "An integer.", edge: "zeros, negatives, single element",
      sol: `a = list(map(int, input().split()))
best = hi = lo = a[0]
for x in a[1:]:
    if x < 0:
        hi, lo = lo, hi
    hi = max(x, hi * x)
    lo = min(x, lo * x)
    best = max(best, hi)
print(best)`, c: [["2 3 -2 4", "6"], ["-2 0 -1", "0"], ["-2 3 -4", "24"], ["-3", "-3"]] }),
    p({ t: "Trapping Rain Water", d: "H", tags: ["array", "two-pointers", "prefix-max"], tc: "O(n)", sc: "O(1)", goal: "Water above a bar is limited by the lower of the tallest bars on both sides; use two pointers to avoid extra arrays.", hint: "Move the pointer on the lower side inward, tracking the maximum height seen on each side.",
      s: "Read a line of non-negative integers describing bar heights of width 1. Print how many units of rain water are trapped between the bars.", inp: "One line of heights.", out: "An integer.", edge: "fewer than three bars, monotone heights",
      sol: `h = list(map(int, input().split()))
l, r = 0, len(h) - 1
lmax = rmax = water = 0
while l < r:
    if h[l] < h[r]:
        lmax = max(lmax, h[l])
        water += lmax - h[l]
        l += 1
    else:
        rmax = max(rmax, h[r])
        water += rmax - h[r]
        r -= 1
print(water)`, c: [["0 1 0 2 1 0 1 3 2 1 2 1", "6"], ["4 2 0 3 2 5", "9"], ["1 2 3", "0"], ["3 0 3", "3"]] }),
    p({ t: "First Missing Positive", d: "H", tags: ["array", "index-as-hash"], tc: "O(n)", sc: "O(n)", goal: "The answer lies in 1..n+1, so only the values inside that range matter.", hint: "Put the numbers in a set and test 1, 2, 3 ... until one is missing. (In place it can be done in O(1) space by swapping each value to its own index.)",
      s: "Read a line of integers (positive, zero or negative). Print the smallest positive integer that does not appear.", inp: "One line of integers.", out: "An integer.", edge: "all negative, consecutive from 1",
      sol: `values = set(map(int, input().split()))
i = 1
while i in values:
    i += 1
print(i)`, c: [["1 2 0", "3"], ["3 4 -1 1", "2"], ["7 8 9 11 12", "1"], ["1", "2"]] }),
    p({ t: "Maximum Circular Subarray Sum", d: "H", tags: ["array", "kadane", "circular"], tc: "O(n)", sc: "O(1)", goal: "A circular best is either an ordinary best or the total minus the worst subarray; handle all-negative input.", hint: "Answer = max(kadane max, total - kadane min), unless every number is negative.",
      s: "Read a line of integers describing a circular array (the end connects to the start). Print the largest sum of a non-empty subarray that may wrap around.", inp: "One line of integers.", out: "An integer.", edge: "all negative, wrap-around is best",
      sol: `a = list(map(int, input().split()))
best = cur_max = worst = cur_min = a[0]
for x in a[1:]:
    cur_max = max(x, cur_max + x)
    best = max(best, cur_max)
    cur_min = min(x, cur_min + x)
    worst = min(worst, cur_min)
total = sum(a)
print(best if best < 0 else max(best, total - worst))`, c: [["1 -2 3 -2", "3"], ["5 -3 5", "10"], ["-3 -2 -3", "-2"], ["8 -1 3 -2 6", "16"]] }),
  ],
});

module.exports = { lessons };
