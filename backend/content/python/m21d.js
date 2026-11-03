// Phase 7 / Module 21, lessons 7-8: binary search and sorting, and recursion, backtracking, bits and math, with tagged practice problems.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, prob: p } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 7
lessons.push({
  title: "Binary Search and Sorting: Pattern Problems",
  minutes: 90,
  learn: ["Write a correct binary search and use bisect for bounds", "Binary search on the answer when the answer space is monotone", "Handle rotated and mountain arrays", "Use sorting keys, merging and merge-sort ideas such as counting inversions"],
  why: "Binary search turns O(n) scans into O(log n) and, when applied to the answer itself, solves many optimisation problems. Sorting with the right key is the quickest way to simplify messy interview questions.",
  realWorld: "Databases use binary search in indexes, Git bisect finds the commit that broke a build, autoscalers search for the smallest capacity that meets a deadline, and every report that lists the top items sorts by a key.",
  simple: "If the data is sorted (or a yes/no test changes only once, from no to yes), you can halve the search range each step. The art is keeping the loop invariant exactly right so you never loop forever or skip the answer.",
  detail: `<h3>The reliable template: first index where a condition is true</h3>
<pre style="background:#16181c;color:#d8dee9;padding:12px 14px;border-radius:8px;overflow:auto"><code>lo, hi = 0, n          # answer is in [lo, hi]; hi means "none"
while lo &lt; hi:
    mid = (lo + hi) // 2
    if condition(mid):
        hi = mid         # mid may be the answer
    else:
        lo = mid + 1     # answer is to the right
# lo is the first index where condition is true (or n)</code></pre>
<p>With a <em>monotone</em> condition (false, false, ..., true, true) this always terminates. <code>bisect_left(a, x)</code> is exactly this with <code>a[mid] &gt;= x</code>; <code>bisect_right</code> uses <code>a[mid] &gt; x</code>. Counting occurrences is <code>bisect_right - bisect_left</code>.</p>
<h3>Binary search on the answer</h3>
<p>When a problem asks for the minimum value that makes something feasible (eating speed, ship capacity, largest sum) write a function <code>feasible(x)</code>, check that it flips only once as x grows, then binary search x between a lower and an upper bound. Total cost: O(log(range) x cost of feasible).</p>
${table(["Problem family", "Search space", "feasible(x)"], [["Koko eating bananas", "speed 1..max pile", "hours needed at speed x &lt;= h"], ["ship packages in D days", "capacity max..sum", "days needed with capacity x &lt;= D"], ["split array largest sum", "max..sum", "pieces needed with limit x &lt;= m"], ["smallest divisor", "1..max", "sum of ceil(a/x) &lt;= threshold"], ["integer square root", "0..n", "x*x &lt;= n (find the last true)"]])}
<h3>Rotated and mountain arrays</h3>
<p>In a rotated sorted array one half around mid is always sorted: decide which half, check whether the target lies in it, and discard the other half. The minimum is where the order breaks; compare <code>a[mid]</code> with <code>a[hi]</code>. In a mountain array compare <code>a[mid]</code> with <code>a[mid + 1]</code> to know whether you are on the rising or falling side.</p>
<h3>Sorting essentials</h3>
<ul><li><code>sorted(items, key=..., reverse=...)</code> is stable and O(n log n); tuples compare element by element, so <code>key=lambda p: (-p[1], p[0])</code> sorts by count descending then name.</li><li><strong>Merge sort</strong> splits, sorts halves and merges; counting how many elements jump ahead during the merge counts <em>inversions</em>.</li><li><strong>Counting sort</strong> for small integer ranges is O(n + range).</li><li><strong>Merge intervals</strong>: sort by start, then extend the last interval while the next one overlaps.</li><li>Median of two sorted arrays: binary search the partition point of the smaller array (O(log min(n, m))).</li></ul>`,
  syntax: { code: `from bisect import bisect_left, bisect_right\ni = bisect_left(a, x)\ncount = bisect_right(a, x) - bisect_left(a, x)\nlo, hi = 1, max(piles)\nwhile lo < hi:\n    mid = (lo + hi) // 2\n    if ok(mid): hi = mid\n    else: lo = mid + 1`, note: "Keep the invariant: the answer stays in [lo, hi]." },
  diagram: chain("Binary search on the answer", "Left to right: pick the middle candidate, test whether it is feasible, keep the left half if yes or the right half if no, and repeat until one candidate is left.",
    [{ k: "proc", t: "mid = (lo + hi) // 2" }, { k: "dec", t: "feasible\n(mid)?" }, { k: "proc", t: "yes: hi = mid\nno: lo = mid + 1" }, { k: "term", t: "lo == hi:\nthe answer" }], { w: 160, gap: 36, hgt: 62 }),
  example: { code: `from bisect import bisect_left, bisect_right


def binary_search(a, x):
    lo, hi = 0, len(a) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if a[mid] == x:
            return mid
        if a[mid] < x:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1


def first_true(lo, hi, ok):
    while lo < hi:
        mid = (lo + hi) // 2
        if ok(mid):
            hi = mid
        else:
            lo = mid + 1
    return lo


def min_speed(piles, hours):
    return first_true(1, max(piles), lambda s: sum((p + s - 1) // s for p in piles) <= hours)


a = [1, 2, 2, 2, 3, 5]
print(bisect_left(a, 2), bisect_right(a, 2), bisect_left(a, 4))
print(binary_search(a, 5), binary_search(a, 4))
print(min_speed([3, 6, 7, 11], 8))
print(sorted(["banana", "Apple", "cherry"], key=str.lower), sorted([(2, "b"), (1, "z"), (2, "a")]))`, out: `1 4 5
5 -1
4
['Apple', 'banana', 'cherry'] [(1, 'z'), (2, 'a'), (2, 'b')]` },
  lineByLine: [["binary_search", "The classic version with an inclusive range: stop when the range is empty; return -1 if the target is absent."], ["first_true", "The template for 'smallest value where ok is true'. The answer is always inside [lo, hi]."], ["min_speed", "At speed s a pile of p bananas takes ceil(p / s) hours, written (p + s - 1) // s. Speed 4 needs 1 + 2 + 2 + 3 = 8 hours, which is the smallest speed that works."], ["bisect_left / bisect_right", "Insertion points before and after the run of 2s, so the count of 2s is 4 - 1 = 3. 4 would go at index 5."], ["sorted(..., key=str.lower)", "Case-insensitive ordering; tuples sort by first then second element."]],
  dryRun: { intro: "<code>min_speed([3, 6, 7, 11], 8)</code> narrowing the speed range:", headers: ["lo", "hi", "mid", "hours at mid", "ok?"], rows: [["1", "11", "6", "1+1+2+2 = 6", "yes, hi = 6"], ["1", "6", "3", "1+2+3+4 = 10", "no, lo = 4"], ["4", "6", "5", "1+2+2+3 = 8", "yes, hi = 5"], ["4", "5", "4", "1+2+2+3 = 8", "yes, hi = 4"], ["4", "4", "-", "-", "answer 4"]] },
  realExample: { intro: "Merge sort that also counts inversions (pairs that are out of order): the count falls out of the merge step.", code: `def merge_count(a):
    if len(a) <= 1:
        return a, 0
    mid = len(a) // 2
    left, x = merge_count(a[:mid])
    right, y = merge_count(a[mid:])
    merged, i, j, cross = [], 0, 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i])
            i += 1
        else:
            merged.append(right[j])
            j += 1
            cross += len(left) - i
    merged += left[i:] + right[j:]
    return merged, x + y + cross


print(merge_count([2, 4, 1, 3, 5]))
print(merge_count([5, 4, 3, 2, 1])[1])`, out: `([1, 2, 3, 4, 5], 3)
10` },
  mistakes: ["Infinite loops from lo = mid with a floor midpoint.", "Mixing inclusive and exclusive bounds in one template.", "Applying binary search to data or a condition that is not monotone.", "Forgetting that the answer may be 'none' (index n).", "Sorting inside a loop and making the solution O(n^2 log n)."],
  practices: ["Pick one template and stick to it.", "State the invariant before coding.", "Test arrays of length 0, 1 and 2 and targets below, above and inside the range.", "For answer-search, test feasible() by hand at the bounds."],
  interview: ["Write binary search and explain the loop invariant.", "How do you search a rotated sorted array?", "What does 'binary search on the answer' mean?", "How do you count inversions?"],
  practiceQs: ["What does bisect_left return when the value is absent?", "Why use (lo + hi) // 2 and not floating division?", "What must be true of feasible(x) for binary search on the answer?", "What is the cost of sorting n items?"],
  revision: ["first_true template with a monotone condition.", "bisect_left / bisect_right for bounds and counts.", "Binary search on the answer: feasible(x) flips once.", "sorted with key; merge sort counts inversions."],
  hinglish: "Binary search tab chalti hai jab data sorted ho ya haan/na wali condition sirf ek baar badalti ho. Har step mein range aadhi karo aur invariant sahi rakho. Agar sawal 'minimum speed ya capacity' puchta hai to answer par hi binary search lagao, feasible(x) ek baar hi badalna chahiye.",
  quiz: [
    mcq("What is the time complexity of binary search on a sorted array of n items?", ["O(n)", "O(log n)", "O(n log n)", "O(1)"], 1, "The range halves every step."),
    mcq("What does bisect_right(a, x) - bisect_left(a, x) give for a sorted list a?", ["The index of x", "The number of times x occurs", "The largest element", "Always 0"], 1, "The two bounds surround the run of equal values."),
    mcq("Binary search on the answer requires that feasible(x)...", ["is random", "changes from false to true only once as x grows", "is always true", "uses recursion"], 1, "Monotonicity lets you discard half of the candidates."),
    mcq("In a rotated sorted array, how do you decide which half to search?", ["Pick the sorted half and check whether the target lies in it", "Always the left half", "Sort the array first", "Use random choice"], 0, "One half around mid is always in order."),
    mcq("What does counting inversions measure?", ["Pairs (i < j) with a[i] > a[j]", "The number of duplicates", "The array length", "The median"], 0, "It tells how far from sorted the array is.")
  ],
  tasks: [
    p({ t: "Classic Binary Search", d: "E", tags: ["binary-search", "array"], tc: "O(log n)", sc: "O(1)", goal: "Write the textbook loop with correct bounds and return -1 for a missing target.", hint: "Keep an inclusive range [lo, hi] and compare a[mid] with the target.",
      s: "Read a sorted line of distinct integers and a target. Print the index of the target, or -1 if it is absent.", inp: "Line 1: sorted array. Line 2: target.", out: "An index or -1.", edge: "single element, missing value",
      sol: `a = list(map(int, input().split()))
x = int(input())
lo, hi = 0, len(a) - 1
answer = -1
while lo <= hi:
    mid = (lo + hi) // 2
    if a[mid] == x:
        answer = mid
        break
    if a[mid] < x:
        lo = mid + 1
    else:
        hi = mid - 1
print(answer)`, c: [["-1 0 3 5 9 12\n9", "4"], ["-1 0 3 5 9 12\n2", "-1"], ["5\n5", "0"], ["1 2 3 4\n1", "0"]] }),
    p({ t: "Search Insert Position", d: "E", tags: ["binary-search", "array"], tc: "O(log n)", sc: "O(1)", goal: "Find the first index whose value is at least the target (a lower bound).", hint: "Use the first-true template with the condition a[mid] >= target.",
      s: "Read a sorted line of distinct integers and a target. Print the index where the target is found, or the index where it would be inserted to keep the array sorted.", inp: "Line 1: sorted array. Line 2: target.", out: "An index.", edge: "smaller than all, larger than all",
      sol: `a = list(map(int, input().split()))
x = int(input())
lo, hi = 0, len(a)
while lo < hi:
    mid = (lo + hi) // 2
    if a[mid] >= x:
        hi = mid
    else:
        lo = mid + 1
print(lo)`, c: [["1 3 5 6\n5", "2"], ["1 3 5 6\n2", "1"], ["1 3 5 6\n7", "4"], ["1 3 5 6\n0", "0"]] }),
    p({ t: "Integer Square Root", d: "E", tags: ["binary-search", "math"], tc: "O(log n)", sc: "O(1)", goal: "Search the answer space 0..n for the last value whose square is at most n.", hint: "Binary search x; if x * x <= n remember x and look right, else look left.",
      s: "Read a non-negative integer n. Print the largest integer x such that x * x <= n, without using sqrt.", inp: "One integer.", out: "An integer.", edge: "0 and 1, large n",
      sol: `n = int(input())
lo, hi, ans = 0, n, 0
while lo <= hi:
    mid = (lo + hi) // 2
    if mid * mid <= n:
        ans = mid
        lo = mid + 1
    else:
        hi = mid - 1
print(ans)`, c: [["4", "2"], ["8", "2"], ["0", "0"], ["2147395599", "46339"]] }),
    p({ t: "Perfect Square Check", d: "E", tags: ["binary-search", "math"], tc: "O(log n)", sc: "O(1)", goal: "Use the same search to test an exact square.", hint: "Search for x with x * x == n.",
      s: "Read a positive integer n. Print yes if it is a perfect square, otherwise no, without using sqrt.", inp: "One integer.", out: "yes or no.", edge: "1",
      sol: `n = int(input())
lo, hi = 1, n
found = False
while lo <= hi:
    mid = (lo + hi) // 2
    if mid * mid == n:
        found = True
        break
    if mid * mid < n:
        lo = mid + 1
    else:
        hi = mid - 1
print("yes" if found else "no")`, c: [["16", "yes"], ["14", "no"], ["1", "yes"], ["808201", "yes"]] }),
    p({ t: "Count Occurrences in Sorted Array", d: "E", tags: ["binary-search", "bisect"], tc: "O(log n)", sc: "O(1)", goal: "Count a value as the difference of two insertion points.", hint: "bisect_right(a, x) - bisect_left(a, x).",
      s: "Read a sorted line of integers and a value x. Print how many times x occurs.", inp: "Line 1: sorted array. Line 2: x.", out: "An integer.", edge: "absent value",
      sol: `from bisect import bisect_left, bisect_right

a = list(map(int, input().split()))
x = int(input())
print(bisect_right(a, x) - bisect_left(a, x))`, c: [["1 2 2 2 3\n2", "3"], ["1 2 3\n4", "0"], ["5 5 5\n5", "3"], ["1 1 2\n1", "2"]] }),
    p({ t: "Sort Array by Parity", d: "E", tags: ["sorting", "array"], tc: "O(n)", sc: "O(n)", goal: "Partition by a predicate while keeping the original order inside each group.", hint: "Collect the even numbers and the odd numbers in separate lists and join them.",
      s: "Read a line of integers. Print the even numbers first and then the odd numbers, each group in its original order.", inp: "One line.", out: "One line.", edge: "all even, all odd",
      sol: `a = list(map(int, input().split()))
print(*([x for x in a if x % 2 == 0] + [x for x in a if x % 2 != 0]))`, c: [["3 1 2 4", "2 4 3 1"], ["0", "0"], ["1 3 5", "1 3 5"], ["2 4", "2 4"]] }),
    p({ t: "Relative Sort", d: "E", tags: ["sorting", "counting"], tc: "O(n log n)", sc: "O(n)", goal: "Combine a custom order with the default order for the remaining items.", hint: "Count the values, output them in the order of the second array, then the leftovers sorted.",
      s: "Read two lines of integers, arr1 and arr2 (arr2 has distinct values that all occur in arr1). Print the elements of arr1 ordered so that the values follow the order of arr2, and the values not in arr2 come last in ascending order.", inp: "Two lines.", out: "One line.", edge: "no leftovers",
      sol: `from collections import Counter

a = list(map(int, input().split()))
order = list(map(int, input().split()))
counts = Counter(a)
out = []
for x in order:
    out += [x] * counts.pop(x, 0)
for x in sorted(counts):
    out += [x] * counts[x]
print(*out)`, c: [["2 3 1 3 2 4 6 7 9 2 19\n2 1 4 3 9 6", "2 2 2 1 4 3 3 9 6 7 19"], ["5 3 1\n3", "3 1 5"], ["4 4 1\n4", "4 4 1"], ["1 2\n2 1", "2 1"]] }),
    p({ t: "Lower and Upper Bound", d: "E", tags: ["binary-search", "bisect"], tc: "O(log n)", sc: "O(1)", goal: "Understand the two insertion points: before and after equal values.", hint: "The lower bound is the first index with a[i] >= x; the upper bound is the first index with a[i] > x.",
      s: "Read a sorted line of integers and a value x. Print two indices: the first position where x could be inserted without breaking the order (lower bound) and the last such position (upper bound).", inp: "Line 1: sorted array. Line 2: x.", out: "Two indices.", edge: "value absent",
      sol: `from bisect import bisect_left, bisect_right

a = list(map(int, input().split()))
x = int(input())
print(bisect_left(a, x), bisect_right(a, x))`, c: [["1 2 2 3\n2", "1 3"], ["1 3\n2", "1 1"], ["1 2\n5", "2 2"], ["4 4\n4", "0 2"]] }),
    p({ t: "Search in Rotated Sorted Array", d: "M", tags: ["binary-search", "array"], tc: "O(log n)", sc: "O(1)", goal: "Decide which half is sorted and whether the target is inside it.", hint: "If a[lo] <= a[mid] the left half is sorted; test whether the target lies in it, otherwise search the other half.",
      s: "Read a line of distinct integers that is a sorted array rotated at an unknown point, and a target. Print the index of the target or -1, in O(log n).", inp: "Line 1: the array. Line 2: the target.", out: "An index or -1.", edge: "no rotation, two elements",
      sol: `a = list(map(int, input().split()))
x = int(input())
lo, hi = 0, len(a) - 1
answer = -1
while lo <= hi:
    mid = (lo + hi) // 2
    if a[mid] == x:
        answer = mid
        break
    if a[lo] <= a[mid]:
        if a[lo] <= x < a[mid]:
            hi = mid - 1
        else:
            lo = mid + 1
    else:
        if a[mid] < x <= a[hi]:
            lo = mid + 1
        else:
            hi = mid - 1
print(answer)`, c: [["4 5 6 7 0 1 2\n0", "4"], ["4 5 6 7 0 1 2\n3", "-1"], ["1\n0", "-1"], ["3 1\n1", "1"]] }),
    p({ t: "Minimum in Rotated Sorted Array", d: "M", tags: ["binary-search", "array"], tc: "O(log n)", sc: "O(1)", goal: "Compare the middle with the right end to find the break in the order.", hint: "If a[mid] > a[hi] the minimum is to the right of mid; otherwise it is at mid or to its left.",
      s: "Read a line of distinct integers that is a sorted array rotated at an unknown point. Print the smallest element in O(log n).", inp: "One line.", out: "An integer.", edge: "not rotated",
      sol: `a = list(map(int, input().split()))
lo, hi = 0, len(a) - 1
while lo < hi:
    mid = (lo + hi) // 2
    if a[mid] > a[hi]:
        lo = mid + 1
    else:
        hi = mid
print(a[lo])`, c: [["3 4 5 1 2", "1"], ["4 5 6 7 0 1 2", "0"], ["11 13 15 17", "11"], ["2 1", "1"]] }),
    p({ t: "Peak of a Mountain Array", d: "M", tags: ["binary-search", "array"], tc: "O(log n)", sc: "O(1)", goal: "Use the slope at mid to discard half of the array.", hint: "If a[mid] < a[mid + 1] the peak is to the right, otherwise at mid or to the left.",
      s: "Read a line of integers that strictly increase up to one peak and then strictly decrease. Print the index of the peak in O(log n).", inp: "One line.", out: "An index.", edge: "peak next to an end",
      sol: `a = list(map(int, input().split()))
lo, hi = 0, len(a) - 1
while lo < hi:
    mid = (lo + hi) // 2
    if a[mid] < a[mid + 1]:
        lo = mid + 1
    else:
        hi = mid
print(lo)`, c: [["0 1 0", "1"], ["0 2 1 0", "1"], ["0 10 5 2", "1"], ["3 5 3 2 0", "1"]] }),
    p({ t: "First and Last Position", d: "M", tags: ["binary-search", "bisect"], tc: "O(log n)", sc: "O(1)", goal: "Find both ends of a run of equal values with two binary searches.", hint: "The first position is the lower bound; the last is the upper bound minus one, if the value exists.",
      s: "Read a sorted line of integers and a target. Print the first and last index of the target, or -1 -1 if it is absent.", inp: "Line 1: sorted array. Line 2: target.", out: "Two indices.", edge: "absent target",
      sol: `from bisect import bisect_left, bisect_right

a = list(map(int, input().split()))
x = int(input())
lo, hi = bisect_left(a, x), bisect_right(a, x)
print(lo, hi - 1) if lo < hi else print(-1, -1)`, c: [["5 7 7 8 8 10\n8", "3 4"], ["5 7 7 8 8 10\n6", "-1 -1"], ["1\n1", "0 0"], ["2 2\n2", "0 1"]] }),
    p({ t: "Eating Bananas", d: "M", tags: ["binary-search", "answer-search"], tc: "O(n log m)", sc: "O(1)", goal: "Recognise 'minimum speed that meets a deadline' as binary search on the answer.", hint: "Search the speed between 1 and the largest pile; hours at speed s is the sum of ceil(pile / s).",
      s: "Read a line of pile sizes and the number of hours h. Each hour you choose one pile and eat up to s bananas from it (a pile finished early wastes the rest of that hour). Print the smallest integer eating speed s that finishes all piles within h hours.", inp: "Line 1: the piles. Line 2: h.", out: "An integer.", edge: "h equal to the number of piles",
      sol: `piles = list(map(int, input().split()))
h = int(input())
lo, hi = 1, max(piles)
while lo < hi:
    mid = (lo + hi) // 2
    if sum((p + mid - 1) // mid for p in piles) <= h:
        hi = mid
    else:
        lo = mid + 1
print(lo)`, c: [["3 6 7 11\n8", "4"], ["30 11 23 4 20\n5", "30"], ["30 11 23 4 20\n6", "23"], ["1 1\n2", "1"]] }),
    p({ t: "Ship Packages Within D Days", d: "M", tags: ["binary-search", "answer-search"], tc: "O(n log S)", sc: "O(1)", goal: "Binary search the capacity and greedily simulate the loading order.", hint: "The capacity is at least the heaviest package and at most the total; count days greedily for a candidate.",
      s: "Read a line of package weights (to be shipped in the given order) and the number of days D. Print the smallest ship capacity that ships everything within D days.", inp: "Line 1: weights. Line 2: D.", out: "An integer.", edge: "one day",
      sol: `w = list(map(int, input().split()))
days = int(input())
lo, hi = max(w), sum(w)
while lo < hi:
    mid = (lo + hi) // 2
    need, load = 1, 0
    for x in w:
        if load + x > mid:
            need += 1
            load = 0
        load += x
    if need <= days:
        hi = mid
    else:
        lo = mid + 1
print(lo)`, c: [["1 2 3 4 5 6 7 8 9 10\n5", "15"], ["3 2 2 4 1 4\n3", "6"], ["1 2 3 1 1\n4", "3"], ["5\n1", "5"]] }),
    p({ t: "Kth Smallest in a Sorted Matrix", d: "M", tags: ["binary-search", "matrix"], tc: "O(n log(max - min))", sc: "O(1)", goal: "Binary search on the value and count how many matrix entries are at most that value.", hint: "Search between the smallest and largest entry; count with bisect_right on every row.",
      s: "Read n, then an n by n matrix whose rows and columns are sorted ascending, then k. Print the kth smallest element of the whole matrix (counting duplicates).", inp: "Line 1: n. Then n rows. Then k.", out: "An integer.", edge: "n = 1, duplicates",
      sol: `from bisect import bisect_right

n = int(input())
m = [list(map(int, input().split())) for _ in range(n)]
k = int(input())
lo, hi = m[0][0], m[-1][-1]
while lo < hi:
    mid = (lo + hi) // 2
    if sum(bisect_right(row, mid) for row in m) >= k:
        hi = mid
    else:
        lo = mid + 1
print(lo)`, c: [["3\n1 5 9\n10 11 13\n12 13 15\n8", "13"], ["1\n-5\n1", "-5"], ["2\n1 2\n1 3\n3", "2"], ["2\n1 2\n3 4\n4", "4"]] }),
    p({ t: "Search a 2D Matrix", d: "M", tags: ["binary-search", "matrix"], tc: "O(log(r x c))", sc: "O(1)", goal: "Treat a fully ordered matrix as one sorted array and map the index back to a row and column.", hint: "Binary search over 0..r*c-1 with row = mid // c and column = mid % c.",
      s: "Read r and c, then an r by c matrix in which each row is sorted and the first number of a row is greater than the last number of the previous row, then a target. Print yes if the target is in the matrix, otherwise no.", inp: "Line 1: r and c. Then r rows. Then the target.", out: "yes or no.", edge: "single cell",
      sol: `r, c = map(int, input().split())
m = [list(map(int, input().split())) for _ in range(r)]
x = int(input())
lo, hi = 0, r * c - 1
found = False
while lo <= hi:
    mid = (lo + hi) // 2
    v = m[mid // c][mid % c]
    if v == x:
        found = True
        break
    if v < x:
        lo = mid + 1
    else:
        hi = mid - 1
print("yes" if found else "no")`, c: [["3 4\n1 3 5 7\n10 11 16 20\n23 30 34 60\n3", "yes"], ["3 4\n1 3 5 7\n10 11 16 20\n23 30 34 60\n13", "no"], ["1 1\n1\n1", "yes"], ["1 1\n1\n2", "no"]] }),
    p({ t: "Sort Characters by Frequency", d: "M", tags: ["sorting", "hashing"], tc: "O(n log k)", sc: "O(n)", goal: "Sort with a two-part key: frequency descending, then character ascending.", hint: "Sort Counter items by (-count, character) and repeat each character count times.",
      s: "Read a string. Print it rearranged so that characters appear in decreasing order of frequency, with the same character grouped together; characters with equal frequency are ordered by character code (A before a).", inp: "One line.", out: "The rearranged string.", edge: "ties",
      sol: `from collections import Counter

counts = Counter(input())
ordered = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))
print("".join(ch * n for ch, n in ordered))`, c: [["tree", "eert"], ["cccaaa", "aaaccc"], ["Aabb", "bbAa"], ["z", "z"]] }),
    p({ t: "Merge Intervals", d: "M", tags: ["sorting", "intervals"], tc: "O(n log n)", sc: "O(n)", goal: "Sort by start and merge each interval into the last one when they overlap or touch.", hint: "After sorting, extend the last merged interval's end if the next start is <= that end.",
      s: "Read n and then n intervals (start end). Merge all intervals that overlap or touch and print the merged intervals in ascending order, one per line.", inp: "Line 1: n. Then n lines.", out: "The merged intervals.", edge: "touching intervals, nested intervals",
      sol: `n = int(input())
intervals = sorted(tuple(map(int, input().split())) for _ in range(n))
merged = []
for s, e in intervals:
    if merged and s <= merged[-1][1]:
        merged[-1][1] = max(merged[-1][1], e)
    else:
        merged.append([s, e])
for s, e in merged:
    print(s, e)`, c: [["4\n1 3\n2 6\n8 10\n15 18", "1 6\n8 10\n15 18"], ["2\n1 4\n4 5", "1 5"], ["1\n5 7", "5 7"], ["3\n1 10\n2 3\n4 5", "1 10"]] }),
    p({ t: "Smallest Divisor Within Threshold", d: "M", tags: ["binary-search", "answer-search"], tc: "O(n log m)", sc: "O(1)", goal: "Search the divisor: larger divisors never increase the sum of ceilings.", hint: "Binary search d between 1 and the maximum; check sum(ceil(x / d)) <= threshold.",
      s: "Read a line of positive integers and a threshold. Find the smallest positive integer divisor d such that the sum of ceil(x / d) over all numbers is at most the threshold, and print d.", inp: "Line 1: the numbers. Line 2: the threshold.", out: "An integer.", edge: "threshold equal to the count",
      sol: `a = list(map(int, input().split()))
limit = int(input())
lo, hi = 1, max(a)
while lo < hi:
    mid = (lo + hi) // 2
    if sum((x + mid - 1) // mid for x in a) <= limit:
        hi = mid
    else:
        lo = mid + 1
print(lo)`, c: [["1 2 5 9\n6", "5"], ["44 22 33 11 1\n5", "44"], ["2 3 5 7 11\n11", "3"], ["1\n1", "1"]] }),
    p({ t: "Count Smaller Elements", d: "M", tags: ["sorting", "bisect"], tc: "O(n log n)", sc: "O(n)", goal: "Use a sorted copy and binary search to count smaller values for every element.", hint: "For each x, bisect_left in the sorted copy gives the number of strictly smaller values.",
      s: "Read a line of integers. For each element print how many elements of the whole array are strictly smaller than it.", inp: "One line.", out: "One line of counts.", edge: "all equal",
      sol: `from bisect import bisect_left

a = list(map(int, input().split()))
ordered = sorted(a)
print(*(bisect_left(ordered, x) for x in a))`, c: [["8 1 2 2 3", "4 0 1 1 3"], ["6 5 4 8", "2 1 0 3"], ["7 7 7", "0 0 0"], ["1", "0"]] }),
    p({ t: "Median of Two Sorted Arrays", d: "H", tags: ["binary-search", "partition"], tc: "O(log min(n, m))", sc: "O(1)", goal: "Binary search a partition of the smaller array so that the left halves of both arrays hold the smaller half of all elements.", hint: "Choose i elements from the shorter array and half - i from the longer; the partition is right when each left maximum is at most the other side's right minimum.",
      s: "Read two non-empty sorted lines of integers. Print the median of all the numbers combined with one decimal (the average of the two middle numbers when the total count is even), aiming for O(log(min(n, m))).", inp: "Two lines.", out: "A number with 1 decimal.", edge: "even and odd totals",
      sol: `a = list(map(int, input().split()))
b = list(map(int, input().split()))
if len(a) > len(b):
    a, b = b, a
m, n = len(a), len(b)
half = (m + n + 1) // 2
lo, hi = 0, m
median = 0.0
while lo <= hi:
    i = (lo + hi) // 2
    j = half - i
    a_left = a[i - 1] if i > 0 else float("-inf")
    a_right = a[i] if i < m else float("inf")
    b_left = b[j - 1] if j > 0 else float("-inf")
    b_right = b[j] if j < n else float("inf")
    if a_left <= b_right and b_left <= a_right:
        if (m + n) % 2:
            median = max(a_left, b_left)
        else:
            median = (max(a_left, b_left) + min(a_right, b_right)) / 2
        break
    if a_left > b_right:
        hi = i - 1
    else:
        lo = i + 1
print(f"{median:.1f}")`, c: [["1 3\n2", "2.0"], ["1 2\n3 4", "2.5"], ["0 0\n0 0", "0.0"], ["1\n2 3 4", "2.5"]] }),
    p({ t: "Split Array Largest Sum", d: "H", tags: ["binary-search", "answer-search", "greedy"], tc: "O(n log S)", sc: "O(1)", goal: "Binary search the largest allowed piece sum and greedily count pieces.", hint: "For a limit L cut a new piece whenever adding the next number would exceed L; feasible when pieces <= m.",
      s: "Read a line of non-negative integers and a number m. Split the array into m non-empty contiguous pieces so that the largest piece sum is as small as possible. Print that smallest possible largest sum.", inp: "Line 1: the array. Line 2: m.", out: "An integer.", edge: "m = 1, m = n",
      sol: `a = list(map(int, input().split()))
m = int(input())
lo, hi = max(a), sum(a)
while lo < hi:
    mid = (lo + hi) // 2
    pieces, total = 1, 0
    for x in a:
        if total + x > mid:
            pieces += 1
            total = 0
        total += x
    if pieces <= m:
        hi = mid
    else:
        lo = mid + 1
print(lo)`, c: [["7 2 5 10 8\n2", "18"], ["1 2 3 4 5\n2", "9"], ["1 4 4\n3", "4"], ["10\n1", "10"]] }),
    p({ t: "Count Inversions", d: "H", tags: ["sorting", "merge-sort", "divide-and-conquer"], tc: "O(n log n)", sc: "O(n)", goal: "Count cross-half inversions during the merge step of merge sort.", hint: "When a right-half element is placed before remaining left-half elements, add the number of those left elements.",
      s: "Read a line of integers. Print the number of inversions: pairs of positions i < j with a[i] > a[j].", inp: "One line.", out: "An integer.", edge: "sorted input, equal values",
      sol: `def sort_count(a):
    if len(a) <= 1:
        return a, 0
    mid = len(a) // 2
    left, x = sort_count(a[:mid])
    right, y = sort_count(a[mid:])
    merged, i, j, cross = [], 0, 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i])
            i += 1
        else:
            merged.append(right[j])
            j += 1
            cross += len(left) - i
    merged += left[i:] + right[j:]
    return merged, x + y + cross


print(sort_count(list(map(int, input().split())))[1])`, c: [["2 4 1 3 5", "3"], ["5 4 3 2 1", "10"], ["1 2 3", "0"], ["1 1 1", "0"]] }),
  ],
});

// ---------------------------------------------------------------- 8
lessons.push({
  title: "Recursion, Backtracking, Bits and Math: Pattern Problems",
  minutes: 90,
  learn: ["Write recursive functions with a clear base case and smaller subproblem", "Use backtracking: choose, explore, undo, with pruning", "Generate subsets, permutations, combinations and partitions", "Use bit tricks and number theory (gcd, fast power)"],
  why: "Recursion and backtracking are the natural tools for 'generate all' and 'is there a way' problems, and they are the base for trees, graphs and dynamic programming. Bit tricks and gcd appear in short, high-signal interview questions.",
  realWorld: "Sudoku and puzzle solvers, route planners with constraints, test-case generators, permission systems stored in bit flags and cryptography (modular exponentiation) all use the techniques here.",
  simple: "A recursive function solves a problem by solving smaller copies of itself until a <strong>base case</strong> answers directly. <strong>Backtracking</strong> builds a solution step by step; whenever a partial choice cannot work, it undoes the last step and tries another.",
  detail: `<h3>The recursion checklist</h3>
<ol><li>What is the smallest case I can answer directly (base case)?</li><li>How does a bigger case use a smaller one (the recursive step), making progress towards the base case?</li><li>What is the cost: how many calls and how deep is the recursion? Python's default limit is about 1000 nested calls (<code>sys.setrecursionlimit</code> can raise it, but prefer loops or memoisation for deep recursion).</li></ol>
<p>Overlapping subproblems (Fibonacci) are cached with <code>functools.lru_cache</code>, which is the start of dynamic programming.</p>
<h3>The backtracking template</h3>
<pre style="background:#16181c;color:#d8dee9;padding:12px 14px;border-radius:8px;overflow:auto"><code>def dfs(state):
    if is_complete(state):
        record(state); return
    for choice in choices(state):
        if not valid(state, choice): continue   # prune early
        apply(state, choice)
        dfs(state)
        undo(state, choice)                      # backtrack</code></pre>
${table(["Problem", "Choices at each step", "Avoid duplicates by"], [["subsets", "include elements from index <code>start</code> onwards", "always moving the start index forward"], ["permutations", "any unused element", "a <code>used</code> array; skip equal values when the previous equal one is unused"], ["combinations", "numbers greater than the last chosen", "increasing order"], ["combination sum", "candidates from index <code>start</code> (reuse allowed)", "start index, sorted candidates"], ["parentheses", "add ( if open &lt; n, add ) if close &lt; open", "the validity rules"], ["N-queens", "a column for the next row", "sets for columns and both diagonals"]])}
<h3>Bits</h3>
<ul><li><code>x &amp; 1</code> odd test, <code>x &gt;&gt; k</code> and <code>x &lt;&lt; k</code> shift, <code>x &amp; (x - 1)</code> clears the lowest set bit, <code>x &amp; -x</code> isolates it.</li><li>Power of two: <code>x &gt; 0 and x &amp; (x - 1) == 0</code>.</li><li><code>a ^ a == 0</code> and <code>a ^ 0 == a</code>: xor cancels pairs.</li><li>Bitmasks represent subsets of up to ~20 items: loop <code>mask</code> from 0 to <code>(1 &lt;&lt; n) - 1</code>.</li></ul>
<h3>Math tools</h3>
<p><code>math.gcd</code>, <code>lcm = a // gcd * b</code>, fast exponentiation (square and halve the exponent: O(log n)), <code>pow(x, n, mod)</code> for modular powers, <code>divmod</code>, and the factorial number system for the k-th permutation.</p>`,
  syntax: { code: `def dfs(start, path):\n    out.append(path[:])\n    for i in range(start, len(a)):\n        path.append(a[i])\n        dfs(i + 1, path)\n        path.pop()`, note: "Choose, explore, undo." },
  diagram: chain("Backtracking", "Left to right: pick a choice, check it is valid, explore deeper, record the answer if the state is complete, then undo the choice and try the next one.",
    [{ k: "proc", t: "choose" }, { k: "dec", t: "valid?\n(prune)" }, { k: "proc", t: "explore\n(recurse)" }, { k: "proc", t: "record if\ncomplete" }, { k: "term", t: "undo and\ntry next" }], { w: 125, gap: 28, hgt: 62 }),
  example: { code: `def power(x, n):
    if n == 0:
        return 1
    half = power(x, n // 2)
    return half * half if n % 2 == 0 else half * half * x


def subsets(a):
    out = []

    def dfs(start, path):
        out.append(tuple(path))
        for i in range(start, len(a)):
            path.append(a[i])
            dfs(i + 1, path)
            path.pop()

    dfs(0, [])
    return out


print(power(2, 10), power(3, 5))
print(subsets([1, 2, 3]))
print(bin(37), 37 & 1, 37 >> 2, 37 & (37 - 1), 1 << 5, 5 ^ 3)`, out: `1024 243
[(), (1,), (1, 2), (1, 2, 3), (1, 3), (2,), (2, 3), (3,)]
0b100101 1 9 36 32 6` },
  lineByLine: [["power", "Halve the exponent each call: O(log n) multiplications instead of n."], ["subsets / dfs", "Every call records the current path as a subset, then tries to extend it with each later element. After the recursive call, pop undoes the choice."], ["output order", "The empty set first, then 1, 1 2, 1 2 3, 1 3, 2, 2 3, 3: depth-first order."], ["bin(37)", "37 is 100101 in binary."], ["37 & (37 - 1)", "Clears the lowest set bit: 100101 becomes 100100 = 36."], ["5 ^ 3", "101 xor 011 = 110 = 6."]],
  dryRun: { intro: "How <code>subsets([1, 2, 3])</code> unfolds (path, then what happens):", headers: ["call", "path recorded", "next"], rows: [["dfs(0, [])", "()", "choose 1"], ["dfs(1, [1])", "(1,)", "choose 2"], ["dfs(2, [1, 2])", "(1, 2)", "choose 3"], ["dfs(3, [1, 2, 3])", "(1, 2, 3)", "nothing left: return and undo 3"], ["back in dfs(2, [1, 2])", "-", "loop ends; return and undo 2; try 3 -> (1, 3)"]] },
  realExample: { intro: "N-Queens by backtracking with sets for columns and diagonals: the number of solutions for boards 1 to 7.", code: `def queens(n):
    cols, d1, d2 = set(), set(), set()

    def place(r):
        if r == n:
            return 1
        total = 0
        for c in range(n):
            if c in cols or r - c in d1 or r + c in d2:
                continue
            cols.add(c)
            d1.add(r - c)
            d2.add(r + c)
            total += place(r + 1)
            cols.remove(c)
            d1.remove(r - c)
            d2.remove(r + c)
        return total

    return place(0)


print([queens(n) for n in range(1, 8)])`, out: `[1, 0, 0, 2, 10, 4, 40]` },
  mistakes: ["Missing or unreachable base case (infinite recursion).", "Forgetting to undo a choice (shared mutable state leaks between branches).", "Appending the same list object instead of a copy (<code>path[:]</code>).", "Not pruning, so a 2^n search becomes impossibly slow.", "Recursing 10^5 levels deep and hitting the recursion limit."],
  practices: ["Write the base case first.", "Draw the recursion tree for n = 3.", "State what is passed down (state) and what is returned.", "Add memoisation when the same arguments repeat."],
  interview: ["How do you generate all permutations?", "How do you avoid duplicate subsets?", "What is the complexity of subsets and permutations?", "How do you check whether a number is a power of two?"],
  practiceQs: ["How many subsets does a set of n items have?", "Why copy the path before saving it?", "What does x & (x - 1) do?", "What is the recursion depth of power(x, 1000)?"],
  revision: ["Base case + smaller subproblem.", "Backtracking: choose, explore, undo, prune.", "Subsets 2^n, permutations n!.", "Bits: &, |, ^, <<, >>, x & (x-1)."],
  hinglish: "Recursion mein pehle base case likho aur phir chhote subproblem par aao. Backtracking mein choice karo, aage explore karo aur phir choice wapas undo karo. Duplicates se bachne ke liye sorted input aur 'pichhla barabar element use hua ya nahi' check karo. Bits mein x & (x-1) sabse niche ka set bit hata deta hai.",
  quiz: [
    mcq("How many subsets does a set with n distinct elements have?", ["n", "n squared", "2^n", "n!"], 2, "Each element is either in or out."),
    mcq("Why do you save path[:] instead of path in a backtracking solution?", ["To save memory", "The list is mutated later, so a copy is needed", "Python requires it", "It is faster"], 1, "Otherwise every saved answer would show the final state of the same list."),
    mcq("What does x & (x - 1) do?", ["Doubles x", "Clears the lowest set bit of x", "Reverses the bits", "Negates x"], 1, "It is the basis of the power-of-two test and bit counting."),
    mcq("What is the recursion limit problem in Python?", ["There is none", "Very deep recursion raises RecursionError (default about 1000)", "Recursion is always slow", "Recursion is not allowed"], 1, "Convert to a loop or increase the limit carefully."),
    mcq("How many permutations does a list of n distinct items have?", ["2^n", "n!", "n squared", "n log n"], 1, "n choices for the first position, n - 1 for the next, and so on.")
  ],
  tasks: [
    p({ t: "Fast Power", d: "E", tags: ["recursion", "math"], tc: "O(log n)", sc: "O(log n)", goal: "Reduce the exponent by half in each call.", hint: "x^n = (x^(n/2))^2, with an extra factor x when n is odd.",
      s: "Read a base x and a non-negative exponent n. Print x raised to the power n using recursion that halves the exponent.", inp: "One line: x n.", out: "An integer.", edge: "n = 0",
      sol: `def power(x, n):
    if n == 0:
        return 1
    half = power(x, n // 2)
    return half * half if n % 2 == 0 else half * half * x


x, n = map(int, input().split())
print(power(x, n))`, c: [["2 10", "1024"], ["5 3", "125"], ["7 0", "1"], ["10 18", "1000000000000000000"]] }),
    p({ t: "Fibonacci With Memoisation", d: "E", tags: ["recursion", "memoisation"], tc: "O(n)", sc: "O(n)", goal: "Turn an exponential recursion into a linear one by caching results.", hint: "Decorate the recursive function with functools.lru_cache.",
      s: "Read n and print the nth Fibonacci number with F(0) = 0 and F(1) = 1.", inp: "One integer.", out: "An integer.", edge: "0 and 1",
      sol: `from functools import lru_cache


@lru_cache(None)
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)


print(fib(int(input())))`, c: [["10", "55"], ["0", "0"], ["1", "1"], ["50", "12586269025"]] }),
    p({ t: "Tower of Hanoi Moves", d: "E", tags: ["recursion", "divide-and-conquer"], tc: "O(2^n)", sc: "O(n)", goal: "Express a hard-looking puzzle as: move n-1 aside, move one disk, move n-1 back.", hint: "hanoi(n, src, dst, aux) = hanoi(n-1, src, aux, dst), move src to dst, hanoi(n-1, aux, dst, src).",
      s: "Read n, the number of disks on peg A. Print the moves that transfer them to peg C using peg B as spare, one per line as two letters (from to), moving one disk at a time and never placing a larger disk on a smaller one.", inp: "One integer.", out: "2^n - 1 lines.", edge: "n = 1",
      sol: `def hanoi(n, src, dst, aux):
    if n == 0:
        return
    hanoi(n - 1, src, aux, dst)
    print(src, dst)
    hanoi(n - 1, aux, dst, src)


hanoi(int(input()), "A", "C", "B")`, c: [["1", "A C"], ["2", "A B\nA C\nB C"], ["3", "A C\nA B\nC B\nA C\nB A\nB C\nA C"], ["4", "A B\nA C\nB C\nA B\nC A\nC B\nA B\nA C\nB C\nB A\nC A\nB C\nA B\nA C\nB C"]] }),
    p({ t: "Binary Strings of Length n", d: "E", tags: ["recursion", "generation"], tc: "O(n x 2^n)", sc: "O(n)", goal: "Generate all combinations by deciding one position at a time.", hint: "Recursively append 0 and then 1 to a growing prefix.",
      s: "Read n. Print all binary strings of length n in ascending (lexicographic) order on one line, separated by spaces.", inp: "One integer.", out: "One line.", edge: "n = 1",
      sol: `n = int(input())
out = []


def build(prefix):
    if len(prefix) == n:
        out.append(prefix)
        return
    build(prefix + "0")
    build(prefix + "1")


build("")
print(*out)`, c: [["1", "0 1"], ["2", "00 01 10 11"], ["3", "000 001 010 011 100 101 110 111"], ["4", "0000 0001 0010 0011 0100 0101 0110 0111 1000 1001 1010 1011 1100 1101 1110 1111"]] }),
    p({ t: "Greatest Common Divisor and Least Common Multiple", d: "E", tags: ["math", "recursion"], tc: "O(log min(a, b))", sc: "O(1)", goal: "Use Euclid's algorithm and derive the least common multiple from the gcd.", hint: "gcd(a, b) = gcd(b, a % b); lcm = a // gcd * b.",
      s: "Read two positive integers. Print their greatest common divisor and their least common multiple, separated by a space.", inp: "One line: a b.", out: "gcd lcm.", edge: "equal numbers, coprime numbers",
      sol: `a, b = map(int, input().split())
x, y = a, b
while y:
    x, y = y, x % y
print(x, a // x * b)`, c: [["12 18", "6 36"], ["7 13", "1 91"], ["100 25", "25 100"], ["1 1", "1 1"]] }),
    p({ t: "Count Set Bits", d: "E", tags: ["bit-manipulation", "math"], tc: "O(set bits)", sc: "O(1)", goal: "Clear the lowest set bit repeatedly so the loop runs once per 1 bit.", hint: "n &= n - 1 removes the lowest set bit.",
      s: "Read a non-negative integer and print how many 1 bits it has in binary.", inp: "One integer.", out: "An integer.", edge: "0, powers of two",
      sol: `n = int(input())
count = 0
while n:
    n &= n - 1
    count += 1
print(count)`, c: [["11", "3"], ["0", "0"], ["255", "8"], ["1024", "1"]] }),
    p({ t: "Power of Two Check", d: "E", tags: ["bit-manipulation", "math"], tc: "O(1)", sc: "O(1)", goal: "A power of two has exactly one set bit.", hint: "n > 0 and n & (n - 1) == 0.",
      s: "Read a non-negative integer. Print yes if it is a power of two (1, 2, 4, 8, ...), otherwise no.", inp: "One integer.", out: "yes or no.", edge: "0",
      sol: `n = int(input())
print("yes" if n > 0 and n & (n - 1) == 0 else "no")`, c: [["1", "yes"], ["16", "yes"], ["218", "no"], ["0", "no"]] }),
    p({ t: "Reverse 32-bit Integer Bits", d: "E", tags: ["bit-manipulation", "simulation"], tc: "O(32)", sc: "O(1)", goal: "Build the reversed number bit by bit with shifts.", hint: "Shift the result left and add the lowest bit of n, 32 times.",
      s: "Read an unsigned 32-bit integer. Print the unsigned integer obtained by reversing its 32 bits.", inp: "One integer.", out: "An integer.", edge: "0, 1",
      sol: `n = int(input())
result = 0
for _ in range(32):
    result = (result << 1) | (n & 1)
    n >>= 1
print(result)`, c: [["43261596", "964176192"], ["4294967293", "3221225471"], ["0", "0"], ["1", "2147483648"]] }),
    p({ t: "Flatten a Nested List", d: "M", tags: ["recursion", "parsing"], tc: "O(n)", sc: "O(depth)", goal: "Recurse into elements that are lists and collect the others.", hint: "Parse with json.loads; for each item, if it is a list recurse, else append it.",
      s: "Read a nested list written as JSON, for example [1,[2,[3,4]],5]. Print all the integers in the order they appear, separated by spaces, or none if there are no integers.", inp: "One line of JSON.", out: "One line.", edge: "empty lists",
      sol: `import json


def flatten(items):
    for item in items:
        if isinstance(item, list):
            yield from flatten(item)
        else:
            yield item


values = list(flatten(json.loads(input())))
print(*values if values else ["none"])`, c: [["[1,[2,[3,4]],5]", "1 2 3 4 5"], ["[]", "none"], ["[[],[1]]", "1"], ["[[[7]]]", "7"]] }),
    p({ t: "All Subsets", d: "M", tags: ["backtracking", "subsets"], tc: "O(n x 2^n)", sc: "O(n)", goal: "Generate the power set with the 'extend from index start' pattern.", hint: "Record the current path, then extend it with each later element and undo.",
      s: "Read a line of distinct integers. Print every subset, one per line, in the depth-first order obtained by choosing elements from left to right (the empty subset first, printed as the word empty).", inp: "One line.", out: "2^n lines.", edge: "single element",
      sol: `a = list(map(int, input().split()))
out = []


def dfs(start, path):
    out.append(path[:])
    for i in range(start, len(a)):
        path.append(a[i])
        dfs(i + 1, path)
        path.pop()


dfs(0, [])
for subset in out:
    print(*subset if subset else ["empty"])`, c: [["1 2 3", "empty\n1\n1 2\n1 2 3\n1 3\n2\n2 3\n3"], ["5", "empty\n5"], ["1 2", "empty\n1\n1 2\n2"], ["3 1", "empty\n3\n3 1\n1"]] }),
    p({ t: "All Permutations", d: "M", tags: ["backtracking", "permutations"], tc: "O(n x n!)", sc: "O(n)", goal: "Track used elements and pick the next unused element at every position.", hint: "Keep a used array; at each position loop over the unused elements from left to right.",
      s: "Read a line of distinct integers. Print every permutation, one per line, in the order produced by choosing the next unused element from left to right.", inp: "One line.", out: "n! lines.", edge: "single element",
      sol: `a = list(map(int, input().split()))
used = [False] * len(a)
path = []


def dfs():
    if len(path) == len(a):
        print(*path)
        return
    for i in range(len(a)):
        if not used[i]:
            used[i] = True
            path.append(a[i])
            dfs()
            path.pop()
            used[i] = False


dfs()`, c: [["1 2 3", "1 2 3\n1 3 2\n2 1 3\n2 3 1\n3 1 2\n3 2 1"], ["5", "5"], ["2 1", "2 1\n1 2"], ["3 1 2", "3 1 2\n3 2 1\n1 3 2\n1 2 3\n2 3 1\n2 1 3"]] }),
    p({ t: "Combinations", d: "M", tags: ["backtracking", "combinations"], tc: "O(k x C(n, k))", sc: "O(k)", goal: "Choose k numbers in increasing order so every combination appears once.", hint: "Recurse with a start value; only pick numbers larger than the previous pick.",
      s: "Read n and k. Print all combinations of k numbers chosen from 1..n, one per line, numbers ascending and the lines in ascending order.", inp: "One line: n k.", out: "C(n, k) lines.", edge: "k = n",
      sol: `n, k = map(int, input().split())
path = []


def dfs(start):
    if len(path) == k:
        print(*path)
        return
    for x in range(start, n + 1):
        path.append(x)
        dfs(x + 1)
        path.pop()


dfs(1)`, c: [["4 2", "1 2\n1 3\n1 4\n2 3\n2 4\n3 4"], ["1 1", "1"], ["3 3", "1 2 3"], ["3 1", "1\n2\n3"]] }),
    p({ t: "Combination Sum", d: "M", tags: ["backtracking", "combinations"], tc: "O(2^t)", sc: "O(t)", goal: "Allow reuse of a candidate by recursing with the same start index, and prune when the remainder goes negative.", hint: "Sort the candidates; recurse with the remaining target and break the loop when a candidate is too large.",
      s: "Read a line of distinct positive integers (candidates) and a target. Print every combination of candidates that sums to the target (a candidate may be used several times), one per line with numbers in non-decreasing order, in the order found by trying candidates from smallest to largest. Print none if there is no combination.", inp: "Line 1: candidates. Line 2: target.", out: "Combinations or none.", edge: "no solution",
      sol: `cands = sorted(map(int, input().split()))
target = int(input())
out = []
path = []


def dfs(start, remaining):
    if remaining == 0:
        out.append(path[:])
        return
    for i in range(start, len(cands)):
        if cands[i] > remaining:
            break
        path.append(cands[i])
        dfs(i, remaining - cands[i])
        path.pop()


dfs(0, target)
if out:
    for combo in out:
        print(*combo)
else:
    print("none")`, c: [["2 3 6 7\n7", "2 2 3\n7"], ["2 3 5\n8", "2 2 2 2\n2 3 3\n3 5"], ["2\n1", "none"], ["3 4\n3", "3"]] }),
    p({ t: "Generate Parentheses", d: "M", tags: ["backtracking", "string"], tc: "O(4^n / sqrt(n))", sc: "O(n)", goal: "Prune with two counters so only valid strings are ever built.", hint: "Add ( while fewer than n opened; add ) while closed < opened.",
      s: "Read n. Print every balanced string of n pairs of round brackets, one per line, in the order found by preferring ( before ).", inp: "One integer.", out: "All valid strings.", edge: "n = 1",
      sol: `n = int(input())


def build(s, opened, closed):
    if len(s) == 2 * n:
        print(s)
        return
    if opened < n:
        build(s + "(", opened + 1, closed)
    if closed < opened:
        build(s + ")", opened, closed + 1)


build("", 0, 0)`, c: [["1", "()"], ["2", "(())\n()()"], ["3", "((()))\n(()())\n(())()\n()(())\n()()()"], ["4", "(((())))\n((()()))\n((())())\n((()))()\n(()(()))\n(()()())\n(()())()\n(())(())\n(())()()\n()((()))\n()(()())\n()(())()\n()()(())\n()()()()"]] }),
    p({ t: "Phone Letter Combinations", d: "M", tags: ["backtracking", "string"], tc: "O(4^n)", sc: "O(n)", goal: "Take one choice per digit and combine them, as nested loops of unknown depth.", hint: "Use a digit-to-letters map and recurse over the digit positions, or itertools.product.",
      s: "Read a string of digits 2-9. Using the old phone keypad letters (2 abc, 3 def, 4 ghi, 5 jkl, 6 mno, 7 pqrs, 8 tuv, 9 wxyz), print all letter combinations on one line, separated by spaces, in order.", inp: "One line of digits.", out: "One line.", edge: "a single digit",
      sol: `from itertools import product

keys = {"2": "abc", "3": "def", "4": "ghi", "5": "jkl", "6": "mno", "7": "pqrs", "8": "tuv", "9": "wxyz"}
digits = input()
print(*("".join(p) for p in product(*(keys[d] for d in digits))))`, c: [["23", "ad ae af bd be bf cd ce cf"], ["2", "a b c"], ["9", "w x y z"], ["45", "gj gk gl hj hk hl ij ik il"]] }),
    p({ t: "Subsets With Duplicates", d: "M", tags: ["backtracking", "subsets"], tc: "O(n x 2^n)", sc: "O(n)", goal: "Sort and skip equal values at the same recursion level to avoid duplicate subsets.", hint: "In the loop skip i when i > start and a[i] == a[i - 1].",
      s: "Read a line of integers that may contain duplicates. Print every distinct subset (as sorted lists) one per line in depth-first order over the sorted array, with the empty subset first as the word empty.", inp: "One line.", out: "Distinct subsets.", edge: "all equal",
      sol: `a = sorted(map(int, input().split()))
out = []


def dfs(start, path):
    out.append(path[:])
    for i in range(start, len(a)):
        if i > start and a[i] == a[i - 1]:
            continue
        path.append(a[i])
        dfs(i + 1, path)
        path.pop()


dfs(0, [])
for subset in out:
    print(*subset if subset else ["empty"])`, c: [["1 2 2", "empty\n1\n1 2\n1 2 2\n2\n2 2"], ["0", "empty\n0"], ["1 1", "empty\n1\n1 1"], ["4 4 4 1 4", "empty\n1\n1 4\n1 4 4\n1 4 4 4\n1 4 4 4 4\n4\n4 4\n4 4 4\n4 4 4 4"]] }),
    p({ t: "Unique Permutations", d: "M", tags: ["backtracking", "permutations"], tc: "O(n x n!)", sc: "O(n)", goal: "Skip an equal value if its identical predecessor is still unused, to avoid repeating a permutation.", hint: "Sort first; skip a[i] when a[i] == a[i - 1] and used[i - 1] is False.",
      s: "Read a line of integers that may contain duplicates. Print every distinct permutation, one per line, in ascending order.", inp: "One line.", out: "Distinct permutations.", edge: "all equal",
      sol: `a = sorted(map(int, input().split()))
used = [False] * len(a)
path = []


def dfs():
    if len(path) == len(a):
        print(*path)
        return
    for i in range(len(a)):
        if used[i] or (i > 0 and a[i] == a[i - 1] and not used[i - 1]):
            continue
        used[i] = True
        path.append(a[i])
        dfs()
        path.pop()
        used[i] = False


dfs()`, c: [["1 1 2", "1 1 2\n1 2 1\n2 1 1"], ["1 2", "1 2\n2 1"], ["2 2", "2 2"], ["1 2 2", "1 2 2\n2 1 2\n2 2 1"]] }),
    p({ t: "Palindrome Partitioning", d: "M", tags: ["backtracking", "string"], tc: "O(n x 2^n)", sc: "O(n)", goal: "Choose each next piece as a palindromic prefix of the rest.", hint: "At each position try every prefix; recurse only when the prefix is a palindrome.",
      s: "Read a string. Print every way to split it into pieces that are all palindromes, one split per line with the pieces separated by spaces, trying shorter first pieces first.", inp: "One line.", out: "All partitions.", edge: "single character",
      sol: `s = input()
path = []


def dfs(start):
    if start == len(s):
        print(*path)
        return
    for end in range(start + 1, len(s) + 1):
        piece = s[start:end]
        if piece == piece[::-1]:
            path.append(piece)
            dfs(end)
            path.pop()


dfs(0)`, c: [["aab", "a a b\naa b"], ["a", "a"], ["aba", "a b a\naba"], ["abba", "a b b a\na bb a\nabba"]] }),
    p({ t: "Word Search in a Grid", d: "M", tags: ["backtracking", "matrix"], tc: "O(r x c x 3^L)", sc: "O(L)", goal: "Search neighbouring cells without reusing a cell, marking and unmarking visited cells.", hint: "From each cell start a DFS matching the next letter; mark the cell as used and restore it when returning.",
      s: "Read r, then r rows of letters (the grid), then a word. Print yes if the word can be built from letters of adjacent cells (up, down, left, right) without using the same cell twice, otherwise no.", inp: "Line 1: r. Then r rows. Then the word.", out: "yes or no.", edge: "word longer than the grid",
      sol: `r = int(input())
grid = [list(input()) for _ in range(r)]
word = input()
c = len(grid[0])


def dfs(i, j, k):
    if k == len(word):
        return True
    if i < 0 or j < 0 or i >= r or j >= c or grid[i][j] != word[k]:
        return False
    saved = grid[i][j]
    grid[i][j] = "#"
    found = dfs(i + 1, j, k + 1) or dfs(i - 1, j, k + 1) or dfs(i, j + 1, k + 1) or dfs(i, j - 1, k + 1)
    grid[i][j] = saved
    return found


print("yes" if any(dfs(i, j, 0) for i in range(r) for j in range(c)) else "no")`, c: [["3\nABCE\nSFCS\nADEE\nABCCED", "yes"], ["3\nABCE\nSFCS\nADEE\nSEE", "yes"], ["3\nABCE\nSFCS\nADEE\nABCB", "no"], ["1\nA\nAA", "no"]] }),
    p({ t: "Letter Case Permutations", d: "M", tags: ["backtracking", "string"], tc: "O(n x 2^L)", sc: "O(n)", goal: "Branch only at letters; digits have a single choice.", hint: "At a letter try the lower-case form and then the upper-case form; at a digit just continue.",
      s: "Read a string of lower-case letters and digits. Print every string obtained by changing the case of any of its letters, on one line separated by spaces, trying lower case before upper case at each letter from left to right.", inp: "One line.", out: "One line.", edge: "digits only",
      sol: `s = input()
out = []


def dfs(i, current):
    if i == len(s):
        out.append(current)
        return
    ch = s[i]
    if ch.isalpha():
        dfs(i + 1, current + ch.lower())
        dfs(i + 1, current + ch.upper())
    else:
        dfs(i + 1, current + ch)


dfs(0, "")
print(*out)`, c: [["a1b2", "a1b2 a1B2 A1b2 A1B2"], ["3z4", "3z4 3Z4"], ["12", "12"], ["ab", "ab aB Ab AB"]] }),
    p({ t: "N-Queens Count", d: "H", tags: ["backtracking", "pruning"], tc: "O(n!)", sc: "O(n)", goal: "Prune with sets of attacked columns and diagonals so invalid placements are never explored.", hint: "A cell (r, c) is attacked if column c, diagonal r - c or anti-diagonal r + c is taken.",
      s: "Read n. Print the number of ways to place n chess queens on an n by n board so that no two queens attack each other.", inp: "One integer.", out: "An integer.", edge: "n = 1",
      sol: `n = int(input())
cols, d1, d2 = set(), set(), set()


def place(r):
    if r == n:
        return 1
    total = 0
    for c in range(n):
        if c in cols or r - c in d1 or r + c in d2:
            continue
        cols.add(c)
        d1.add(r - c)
        d2.add(r + c)
        total += place(r + 1)
        cols.remove(c)
        d1.remove(r - c)
        d2.remove(r + c)
    return total


print(place(0))`, c: [["4", "2"], ["1", "1"], ["6", "4"], ["8", "92"]] }),
    p({ t: "Partition Into K Equal Sum Subsets", d: "H", tags: ["backtracking", "pruning"], tc: "O(k x 2^n)", sc: "O(n)", goal: "Fill buckets one number at a time with strong pruning (largest first, skip equal states).", hint: "Sort descending, give each number to a bucket that still has room, and stop trying more empty buckets once one empty bucket failed.",
      s: "Read a line of positive integers and a number k. Print yes if the numbers can be divided into k non-empty groups with equal sums (each number used exactly once), otherwise no.", inp: "Line 1: the numbers. Line 2: k.", out: "yes or no.", edge: "sum not divisible by k",
      sol: `nums = sorted(map(int, input().split()), reverse=True)
k = int(input())
total = sum(nums)
if total % k or nums[0] > total // k:
    print("no")
else:
    target = total // k
    buckets = [0] * k

    def dfs(i):
        if i == len(nums):
            return True
        seen = set()
        for b in range(k):
            if buckets[b] + nums[i] <= target and buckets[b] not in seen:
                seen.add(buckets[b])
                buckets[b] += nums[i]
                if dfs(i + 1):
                    return True
                buckets[b] -= nums[i]
        return False

    print("yes" if dfs(0) else "no")`, c: [["4 3 2 3 5 2 1\n4", "yes"], ["1 2 3 4\n3", "no"], ["2 2 2 2 3 4 5\n4", "no"], ["1\n1", "yes"]] }),
    p({ t: "Kth Permutation Sequence", d: "H", tags: ["math", "factorial-number-system"], tc: "O(n^2)", sc: "O(n)", goal: "Skip whole blocks of (n-1)! permutations at a time instead of generating them all.", hint: "The first digit is determined by (k - 1) // (n - 1)!; remove it and continue with the remainder.",
      s: "Read n and k. Consider all permutations of the digits 1..n in ascending order. Print the kth one (k starts at 1).", inp: "One line: n k.", out: "A digit string.", edge: "k = 1, k = n!",
      sol: `from math import factorial

n, k = map(int, input().split())
digits = list(range(1, n + 1))
k -= 1
out = []
for i in range(n, 0, -1):
    block = factorial(i - 1)
    index, k = divmod(k, block)
    out.append(str(digits.pop(index)))
print("".join(out))`, c: [["3 3", "213"], ["4 9", "2314"], ["3 1", "123"], ["1 1", "1"]] }),
  ],
});

module.exports = { lessons };
