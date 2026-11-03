// Phase 7 / Module 21, lessons 5-6: two pointers and sliding windows, and stacks and queues with tagged practice problems.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, prob: p } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Two Pointers and Sliding Windows: Pattern Problems",
  minutes: 90,
  learn: ["Use two pointers on sorted data and from both ends", "Maintain a variable-size window with a running summary", "Choose between fixed and variable windows", "Combine windows with counters and a monotonic deque"],
  why: "Two pointers and windows turn many O(n^2) scans into O(n). They appear in a large share of array and string interview questions and in real stream-processing code.",
  realWorld: "A monitoring tool computes the maximum traffic in every 5-minute window; a spell checker looks for a pair of words; a billing job finds the shortest period that reaches a target amount.",
  simple: "Instead of trying every pair or every subarray, keep <strong>two indices</strong> that only move forward (or towards each other). Each step you decide which pointer to move, and every element is visited a constant number of times.",
  detail: `<h3>Three shapes</h3>
${table(["Shape", "How", "Typical problems"], [["opposite ends", "<code>l = 0, r = n - 1</code>, move the pointer that can still improve the answer", "two sum in a sorted array, container with most water, 3Sum, palindromes"], ["same direction (read / write)", "a fast pointer reads, a slow pointer writes", "remove duplicates, remove element, partition"], ["sliding window", "window [left, right] grows on the right and shrinks on the left", "longest substring without repeats, minimum size subarray, permutation in string"]])}
<h3>Variable window recipe</h3>
<ol><li>Move <code>right</code> one step and add the new element to the window summary (sum, counter, set).</li><li>While the window breaks the rule, remove <code>a[left]</code> and move <code>left</code>.</li><li>Record the answer (length, count, best value) for the current valid window.</li></ol>
<p>It works when shrinking never makes a window invalid (for example positive numbers and a sum limit, or a character-count rule). With negative numbers a simple window is wrong; use prefix sums and hashing instead (previous lesson).</p>
<h3>Counting windows</h3>
<p>If every window ending at <code>right</code> and starting at or after <code>left</code> is valid, there are <code>right - left + 1</code> of them; add that to the total (subarray product less than k). &quot;Exactly k&quot; equals &quot;at most k&quot; minus &quot;at most k - 1&quot;.</p>
<h3>Monotonic deque for window maximum</h3>
<p>Keep a deque of indices whose values are decreasing. The front is always the maximum of the current window; pop smaller values from the back when a new value arrives and pop the front when it leaves the window. Every index enters and leaves once: O(n).</p>
<h3>Remember</h3>
<ul><li>Sorting first costs O(n log n) but often unlocks two pointers (3Sum, closest sum, counting pairs).</li><li>Skip duplicates explicitly when the answer must be unique.</li><li>A fixed-size window just adds the new element and drops the old one: <code>total += a[i] - a[i - k]</code>.</li></ul>`,
  syntax: { code: `l, r = 0, len(a) - 1\nwhile l < r:\n    s = a[l] + a[r]\n    if s == target: ...\n    elif s < target: l += 1\n    else: r -= 1\n\nleft = 0\nfor right, x in enumerate(a):\n    add(x)\n    while invalid(): remove(a[left]); left += 1`, note: "Both pointers only move forward: O(n)." },
  diagram: chain("Variable sliding window", "Left to right: extend the right edge and add the element, check the rule, shrink the left edge while the window is invalid, then record the best window.",
    [{ k: "proc", t: "extend right\nadd a[right]" }, { k: "dec", t: "window\nvalid?" }, { k: "proc", t: "no: shrink left\nremove a[left]" }, { k: "term", t: "yes: record\nbest answer" }], { w: 160, gap: 36, hgt: 62 }),
  example: { code: `def two_sum_sorted(a, target):
    l, r = 0, len(a) - 1
    while l < r:
        s = a[l] + a[r]
        if s == target:
            return l, r
        if s < target:
            l += 1
        else:
            r -= 1


def max_water(h):
    l, r, best = 0, len(h) - 1, 0
    while l < r:
        best = max(best, min(h[l], h[r]) * (r - l))
        if h[l] < h[r]:
            l += 1
        else:
            r -= 1
    return best


def longest_unique(s):
    last, left, best = {}, 0, 0
    for right, ch in enumerate(s):
        if ch in last and last[ch] >= left:
            left = last[ch] + 1
        last[ch] = right
        best = max(best, right - left + 1)
    return best


def max_window_sum(a, k):
    total = sum(a[:k])
    best = total
    for i in range(k, len(a)):
        total += a[i] - a[i - k]
        best = max(best, total)
    return best


print(two_sum_sorted([1, 2, 3, 4, 4, 9, 56, 90], 8))
print(max_water([1, 8, 6, 2, 5, 4, 8, 3, 7]))
print(longest_unique("abcabcbb"), longest_unique("pwwkew"))
print(max_window_sum([2, 1, 5, 1, 3, 2], 3))`, out: `(3, 4)
49
3 3
9` },
  lineByLine: [["two_sum_sorted", "A sum that is too small can only grow by moving l right; one that is too large only shrinks by moving r left. 4 + 4 = 8 at indices 3 and 4."], ["max_water", "The area is limited by the shorter wall. Moving the taller wall can only reduce the width without raising the limit, so move the shorter one."], ["longest_unique", "last remembers each character's latest position; when a repeat lies inside the window, left jumps just past it."], ["max_window_sum", "A fixed window: add the entering element and subtract the leaving one. The best of [2,1,5], [1,5,1], [5,1,3], [1,3,2] is 9."]],
  dryRun: { intro: "<code>longest_unique(\"pwwkew\")</code>:", headers: ["right", "char", "left", "window", "best"], rows: [["0", "p", "0", "p", "1"], ["1", "w", "0", "pw", "2"], ["2", "w", "2", "w (left jumped past the first w)", "2"], ["3", "k", "2", "wk", "2"], ["4", "e", "2", "wke", "3"], ["5", "w", "3", "kew", "3"]] },
  realExample: { intro: "Maximum of every window of size k with a monotonic deque: each index enters and leaves the deque once.", code: `from collections import deque


def window_maxima(a, k):
    dq, out = deque(), []
    for i, x in enumerate(a):
        while dq and a[dq[-1]] <= x:
            dq.pop()
        dq.append(i)
        if dq[0] <= i - k:
            dq.popleft()
        if i >= k - 1:
            out.append(a[dq[0]])
    return out


print(window_maxima([1, 3, -1, -3, 5, 3, 6, 7], 3))
print(window_maxima([4, 3, 2, 1], 2))`, out: `[3, 3, 5, 5, 6, 7]
[4, 3, 2]` },
  mistakes: ["Using a window on arrays with negative numbers when the rule is not monotone.", "Forgetting to shrink inside a while loop (an if removes only one element).", "Counting duplicates twice in 3Sum.", "Moving both pointers at once in opposite-ends problems.", "Recomputing the window sum from scratch each step."],
  practices: ["State the invariant: what is true for the window or the pointers.", "Draw the first three steps on a small example.", "Test an array of length 1 and 2.", "Say why each pointer moves at most n times."],
  interview: ["Why is two pointers correct for container with most water?", "When does a sliding window fail?", "How do you count subarrays with at most k distinct values?", "What is a monotonic deque used for?"],
  practiceQs: ["What is the complexity of 3Sum with sorting?", "How do you make a window of fixed size k efficient?", "What does left jumping to last[ch] + 1 achieve?", "Why must duplicates be skipped in 3Sum?"],
  revision: ["Opposite ends, read-write pointers, sliding window.", "Variable window: expand, shrink while invalid, record.", "Exactly k = at most k - at most k - 1.", "Monotonic deque gives window maxima in O(n)."],
  hinglish: "Two pointers mein do index aage badhte hain aur har element ek hi baar dekha jata hai, isliye O(n) milta hai. Sliding window mein right se badhao, rule toot jaye to left se ghatao, aur har valid window par answer update karo. Negative numbers mein simple window kaam nahi karti.",
  quiz: [
    mcq("In a sorted array, the pair sum is too small. Which pointer moves?", ["The right pointer moves left", "The left pointer moves right", "Both move", "Neither"], 1, "Only a larger left value can increase the sum."),
    mcq("Why is the sliding window for 'shortest subarray with sum at least target' valid for positive numbers?", ["Shrinking the window can only reduce the sum, so the rule is monotone", "Positive numbers are sorted", "Python guarantees it", "Because of recursion"], 0, "With positives, adding grows the sum and removing shrinks it, so two pointers never need to go back."),
    mcq("How do you count subarrays with exactly k distinct values using windows?", ["Count windows with at most k and subtract at most k - 1", "Sort the array", "Use two nested loops", "Use recursion"], 0, "The difference leaves exactly k."),
    mcq("What does a monotonic deque of indices store for window maximum?", ["Indices with decreasing values; the front is the maximum", "The sorted window", "All values", "Only the last element"], 0, "Smaller older values can never be the maximum again, so they are discarded."),
    mcq("What is the time complexity of the opposite-ends two sum on a sorted array?", ["O(n^2)", "O(n log n)", "O(n)", "O(1)"], 2, "Each step moves a pointer and the pointers meet after at most n steps.")
  ],
  tasks: [
    p({ t: "Squares of a Sorted Array", d: "E", tags: ["two-pointers", "array"], tc: "O(n)", sc: "O(n)", goal: "Merge from the largest absolute values at the two ends instead of sorting again.", hint: "The largest square is at one of the ends; fill the result from the back.",
      s: "Read a sorted (non-decreasing) line of integers, possibly negative. Print the squares of the numbers in ascending order.", inp: "One line.", out: "The sorted squares.", edge: "all negative, all positive",
      sol: `a = list(map(int, input().split()))
l, r = 0, len(a) - 1
out = [0] * len(a)
for i in range(len(a) - 1, -1, -1):
    if abs(a[l]) > abs(a[r]):
        out[i] = a[l] ** 2
        l += 1
    else:
        out[i] = a[r] ** 2
        r -= 1
print(*out)`, c: [["-4 -1 0 3 10", "0 1 9 16 100"], ["-7 -3 2 3 11", "4 9 9 49 121"], ["5", "25"], ["-2 -2", "4 4"]] }),
    p({ t: "Two Sum in a Sorted Array", d: "E", tags: ["two-pointers", "array"], tc: "O(n)", sc: "O(1)", goal: "Exploit the order: a sum that is too small needs a bigger left value, one that is too large needs a smaller right value.", hint: "Start with pointers at both ends and move the one that fixes the comparison.",
      s: "Read a sorted line of integers and a target. Exactly one pair of different positions sums to the target. Print their 1-based indices in ascending order, separated by a space.", inp: "Line 1: the sorted array. Line 2: the target.", out: "Two indices.", edge: "equal numbers",
      sol: `a = list(map(int, input().split()))
target = int(input())
l, r = 0, len(a) - 1
while l < r:
    s = a[l] + a[r]
    if s == target:
        print(l + 1, r + 1)
        break
    if s < target:
        l += 1
    else:
        r -= 1`, c: [["2 7 11 15\n9", "1 2"], ["2 3 4\n6", "1 3"], ["-1 0\n-1", "1 2"], ["1 2 3 4 4 9 56 90\n8", "4 5"]] }),
    p({ t: "Merge Two Sorted Arrays", d: "E", tags: ["two-pointers", "merge"], tc: "O(n + m)", sc: "O(n + m)", goal: "Implement the merge step of merge sort with one pointer per array.", hint: "Repeatedly take the smaller of the two current heads.",
      s: "Read two sorted lines of integers. Print the merged sorted sequence on one line.", inp: "Two lines.", out: "The merged line.", edge: "one array much longer",
      sol: `a = list(map(int, input().split()))
b = list(map(int, input().split()))
i = j = 0
out = []
while i < len(a) and j < len(b):
    if a[i] <= b[j]:
        out.append(a[i])
        i += 1
    else:
        out.append(b[j])
        j += 1
out.extend(a[i:])
out.extend(b[j:])
print(*out)`, c: [["1 3 5\n2 4 6", "1 2 3 4 5 6"], ["1 2 3\n10", "1 2 3 10"], ["5\n1 1 1", "1 1 1 5"], ["-3 0\n-3 0", "-3 -3 0 0"]] }),
    p({ t: "Remove Element In Place", d: "E", tags: ["two-pointers", "in-place"], tc: "O(n)", sc: "O(1)", goal: "Use a write pointer to compact the array without extra memory.", hint: "Copy every element that is not the value to the write position.",
      s: "Read a line of integers and a value. Remove all occurrences of the value, keeping the order of the rest. Print the new length on the first line and the remaining elements on the second line (print none if nothing remains).", inp: "Line 1: the array. Line 2: the value.", out: "Two lines.", edge: "every element removed",
      sol: `a = list(map(int, input().split()))
val = int(input())
write = 0
for x in a:
    if x != val:
        a[write] = x
        write += 1
print(write)
print(*a[:write] if write else ["none"])`, c: [["3 2 2 3\n3", "2\n2 2"], ["0 1 2 2 3 0 4 2\n2", "5\n0 1 3 0 4"], ["1\n1", "0\nnone"], ["4 5\n9", "2\n4 5"]] }),
    p({ t: "Maximum Average of Fixed Window", d: "E", tags: ["sliding-window", "array"], tc: "O(n)", sc: "O(1)", goal: "Slide a fixed-size window by adding the entering value and subtracting the leaving one.", hint: "Compute the first window sum, then update it in O(1) per step.",
      s: "Read a line of integers and a window size k. Print the maximum average of any k consecutive elements with 2 decimals.", inp: "Line 1: the array. Line 2: k.", out: "A number with 2 decimals.", edge: "negative numbers, k = 1",
      sol: `a = list(map(int, input().split()))
k = int(input())
total = sum(a[:k])
best = total
for i in range(k, len(a)):
    total += a[i] - a[i - k]
    best = max(best, total)
print(f"{best / k:.2f}")`, c: [["1 12 -5 -6 50 3\n4", "12.75"], ["5\n1", "5.00"], ["0 4 0 3 2\n1", "4.00"], ["-1 -2 -3\n2", "-1.50"]] }),
    p({ t: "Count Pairs Below Target", d: "E", tags: ["two-pointers", "sorting"], tc: "O(n log n)", sc: "O(1)", goal: "After sorting, one successful pair at the ends counts a whole block of pairs at once.", hint: "If a[l] + a[r] < target then every index between l and r also pairs with l, so add r - l.",
      s: "Read a line of integers and a target. Print how many pairs of positions i < j have a[i] + a[j] strictly less than the target.", inp: "Line 1: the array. Line 2: the target.", out: "An integer.", edge: "no pair, all pairs",
      sol: `a = sorted(map(int, input().split()))
target = int(input())
l, r, count = 0, len(a) - 1, 0
while l < r:
    if a[l] + a[r] < target:
        count += r - l
        l += 1
    else:
        r -= 1
print(count)`, c: [["-1 1 2 3 1\n2", "3"], ["-6 2 5 -2 -7 -1 3\n-2", "10"], ["1 1\n3", "1"], ["5 6\n3", "0"]] }),
    p({ t: "Reverse Vowels", d: "E", tags: ["two-pointers", "string"], tc: "O(n)", sc: "O(n)", goal: "Skip irrelevant characters from both ends and swap the relevant ones.", hint: "Move l to the next vowel and r to the previous vowel, then swap.",
      s: "Read a string. Reverse the order of its vowels (a e i o u, either case) and leave every other character where it is. Print the result.", inp: "One line.", out: "The new string.", edge: "no vowels, mixed case",
      sol: `s = list(input())
vowels = set("aeiouAEIOU")
l, r = 0, len(s) - 1
while l < r:
    if s[l] not in vowels:
        l += 1
    elif s[r] not in vowels:
        r -= 1
    else:
        s[l], s[r] = s[r], s[l]
        l += 1
        r -= 1
print("".join(s))`, c: [["hello", "holle"], ["leetcode", "leotcede"], ["xyz", "xyz"], ["aA", "Aa"]] }),
    p({ t: "Intersection of Sorted Arrays", d: "E", tags: ["two-pointers", "array"], tc: "O(n + m)", sc: "O(1) extra", goal: "Advance whichever pointer holds the smaller value and collect equal heads.", hint: "Equal heads go into the result and both pointers move; otherwise move the smaller one.",
      s: "Read two sorted lines of integers. Print their common elements, keeping duplicates as many times as both arrays contain them (a multiset intersection), in ascending order; print none if there are none.", inp: "Two lines.", out: "A line or none.", edge: "duplicates",
      sol: `a = list(map(int, input().split()))
b = list(map(int, input().split()))
i = j = 0
out = []
while i < len(a) and j < len(b):
    if a[i] == b[j]:
        out.append(a[i])
        i += 1
        j += 1
    elif a[i] < b[j]:
        i += 1
    else:
        j += 1
print(*out if out else ["none"])`, c: [["1 2 2 3\n2 2 3 4", "2 2 3"], ["1 1 1\n1 1", "1 1"], ["1 2\n3 4", "none"], ["4 5 6\n4 5 6", "4 5 6"]] }),
    p({ t: "Three Sum", d: "M", tags: ["two-pointers", "sorting"], tc: "O(n^2)", sc: "O(1) extra", goal: "Fix one number and solve two sum on the sorted remainder, skipping duplicates to keep triplets unique.", hint: "Sort; for each i run opposite-end pointers on the rest; after a hit skip equal neighbours.",
      s: "Read a line of integers. Print every unique triplet of values that sum to zero, one per line, each triplet in ascending order and the triplets in ascending order. Print none if there is no triplet.", inp: "One line.", out: "Triplets or none.", edge: "all zeros, duplicates",
      sol: `a = sorted(map(int, input().split()))
res = []
for i in range(len(a) - 2):
    if i and a[i] == a[i - 1]:
        continue
    l, r = i + 1, len(a) - 1
    while l < r:
        s = a[i] + a[l] + a[r]
        if s < 0:
            l += 1
        elif s > 0:
            r -= 1
        else:
            res.append((a[i], a[l], a[r]))
            l += 1
            while l < r and a[l] == a[l - 1]:
                l += 1
            r -= 1
            while l < r and a[r] == a[r + 1]:
                r -= 1
if res:
    for t in res:
        print(*t)
else:
    print("none")`, c: [["-1 0 1 2 -1 -4", "-1 -1 2\n-1 0 1"], ["0 1 1", "none"], ["0 0 0", "0 0 0"], ["-2 0 1 1 2", "-2 0 2\n-2 1 1"]] }),
    p({ t: "Container With Most Water", d: "M", tags: ["two-pointers", "greedy"], tc: "O(n)", sc: "O(1)", goal: "Prove the greedy move: always discard the shorter wall because it cannot do better with a smaller width.", hint: "Area is min(height) x width; move the pointer at the shorter line inward.",
      s: "Read a line of positive integers, the heights of vertical lines at positions 0, 1, 2 .... Print the largest amount of water two of the lines can hold together with the x-axis (width between them times the shorter height).", inp: "One line.", out: "An integer.", edge: "two lines only",
      sol: `h = list(map(int, input().split()))
l, r, best = 0, len(h) - 1, 0
while l < r:
    best = max(best, min(h[l], h[r]) * (r - l))
    if h[l] < h[r]:
        l += 1
    else:
        r -= 1
print(best)`, c: [["1 8 6 2 5 4 8 3 7", "49"], ["1 1", "1"], ["4 3 2 1 4", "16"], ["1 2 1", "2"]] }),
    p({ t: "Longest Substring Without Repeating Characters", d: "M", tags: ["sliding-window", "string", "hashing"], tc: "O(n)", sc: "O(k)", goal: "Keep a window with no repeats and jump the left edge past the previous occurrence.", hint: "Store each character's last index; when it is inside the window move left to last + 1.",
      s: "Read a non-empty string. Print the length of the longest substring in which no character appears twice.", inp: "One line.", out: "An integer.", edge: "all equal characters",
      sol: `s = input()
last, left, best = {}, 0, 0
for right, ch in enumerate(s):
    if ch in last and last[ch] >= left:
        left = last[ch] + 1
    last[ch] = right
    best = max(best, right - left + 1)
print(best)`, c: [["abcabcbb", "3"], ["bbbbb", "1"], ["pwwkew", "3"], ["dvdf", "3"]] }),
    p({ t: "Longest Repeating Character Replacement", d: "M", tags: ["sliding-window", "string"], tc: "O(n)", sc: "O(k)", goal: "A window is valid when its length minus its most frequent letter count is at most the allowed replacements.", hint: "Track the highest letter frequency in the window; shrink while length - maxfreq exceeds k.",
      s: "Read a string of upper-case letters and a number k. You may replace at most k characters by any letters. Print the length of the longest substring that can be made of one repeated letter.", inp: "Line 1: the string. Line 2: k.", out: "An integer.", edge: "k = 0",
      sol: `from collections import defaultdict

s = input()
k = int(input())
count = defaultdict(int)
left = best = maxf = 0
for right, ch in enumerate(s):
    count[ch] += 1
    maxf = max(maxf, count[ch])
    while right - left + 1 - maxf > k:
        count[s[left]] -= 1
        left += 1
    best = max(best, right - left + 1)
print(best)`, c: [["ABAB\n2", "4"], ["AABABBA\n1", "4"], ["A\n0", "1"], ["ABC\n1", "2"]] }),
    p({ t: "Minimum Size Subarray Sum", d: "M", tags: ["sliding-window", "array"], tc: "O(n)", sc: "O(1)", goal: "With positive numbers a window can shrink greedily whenever the sum is already large enough.", hint: "Grow right; while sum >= target record the length and move left.",
      s: "Read a line of positive integers and a target. Print the length of the shortest contiguous subarray whose sum is at least the target, or 0 if no subarray works.", inp: "Line 1: the array. Line 2: the target.", out: "An integer.", edge: "no valid subarray",
      sol: `a = list(map(int, input().split()))
target = int(input())
left = total = 0
best = len(a) + 1
for right, x in enumerate(a):
    total += x
    while total >= target:
        best = min(best, right - left + 1)
        total -= a[left]
        left += 1
print(best if best <= len(a) else 0)`, c: [["2 3 1 2 4 3\n7", "2"], ["1 4 4\n4", "1"], ["1 1 1 1\n11", "0"], ["5 1 3 5 10 7 4 9 2 8\n15", "2"]] }),
    p({ t: "Permutation in String", d: "M", tags: ["sliding-window", "hashing", "string"], tc: "O(n)", sc: "O(k)", goal: "Slide a fixed window and compare letter counts.", hint: "A window of length len(s1) is a permutation when its Counter equals Counter(s1).",
      s: "Read strings s1 and s2. Print yes if some substring of s2 is a permutation of s1, otherwise no.", inp: "Two lines.", out: "yes or no.", edge: "s1 longer than s2",
      sol: `from collections import Counter

s1 = input()
s2 = input()
need = Counter(s1)
window = Counter(s2[:len(s1) - 1])
found = False
for i in range(len(s1) - 1, len(s2)):
    window[s2[i]] += 1
    if window == need:
        found = True
        break
    left = s2[i - len(s1) + 1]
    window[left] -= 1
    if window[left] == 0:
        del window[left]
print("yes" if found else "no")`, c: [["ab\neidbaooo", "yes"], ["ab\neidboaoo", "no"], ["a\na", "yes"], ["abc\nab", "no"]] }),
    p({ t: "Max Consecutive Ones With K Flips", d: "M", tags: ["sliding-window", "array"], tc: "O(n)", sc: "O(1)", goal: "Keep a window containing at most k zeros.", hint: "Count zeros in the window; shrink from the left while the count exceeds k.",
      s: "Read a line of 0s and 1s and a number k. You may flip at most k zeros to ones. Print the length of the longest run of ones you can get.", inp: "Line 1: the array. Line 2: k.", out: "An integer.", edge: "k = 0",
      sol: `a = list(map(int, input().split()))
k = int(input())
left = zeros = best = 0
for right, x in enumerate(a):
    if x == 0:
        zeros += 1
    while zeros > k:
        if a[left] == 0:
            zeros -= 1
        left += 1
    best = max(best, right - left + 1)
print(best)`, c: [["1 1 1 0 0 0 1 1 1 1 0\n2", "6"], ["0 0 1 1 0 0 1 1 1 0 1 1 0 0 0 1 1 1 1\n3", "10"], ["0\n0", "0"], ["1 1\n0", "2"]] }),
    p({ t: "Fruit Into Baskets", d: "M", tags: ["sliding-window", "hashing"], tc: "O(n)", sc: "O(1)", goal: "Recognise the disguised 'longest subarray with at most two distinct values'.", hint: "Keep a count per type; while more than two types are in the window, shrink from the left.",
      s: "Read a line of integers (fruit types in a row of trees). You may collect from consecutive trees but your two baskets can each hold only one type. Print the largest number of fruits you can collect.", inp: "One line.", out: "An integer.", edge: "only one type",
      sol: `from collections import defaultdict

a = list(map(int, input().split()))
count = defaultdict(int)
left = best = 0
for right, x in enumerate(a):
    count[x] += 1
    while len(count) > 2:
        count[a[left]] -= 1
        if count[a[left]] == 0:
            del count[a[left]]
        left += 1
    best = max(best, right - left + 1)
print(best)`, c: [["1 2 1", "3"], ["0 1 2 2", "3"], ["1 2 3 2 2", "4"], ["3 3 3 1 2 1 1 2 3 3 4", "5"]] }),
    p({ t: "Subarray Product Less Than K", d: "M", tags: ["sliding-window", "counting"], tc: "O(n)", sc: "O(1)", goal: "Count all windows ending at each right end in one step.", hint: "For every right, once the product is below k there are right - left + 1 valid subarrays ending there.",
      s: "Read a line of positive integers and a number k. Print how many contiguous subarrays have a product strictly less than k.", inp: "Line 1: the array. Line 2: k.", out: "An integer.", edge: "k <= 1",
      sol: `a = list(map(int, input().split()))
k = int(input())
if k <= 1:
    print(0)
else:
    product, left, count = 1, 0, 0
    for right, x in enumerate(a):
        product *= x
        while product >= k:
            product //= a[left]
            left += 1
        count += right - left + 1
    print(count)`, c: [["10 5 2 6\n100", "8"], ["1 2 3\n0", "0"], ["1 1 1\n2", "6"], ["5\n6", "1"]] }),
    p({ t: "Longest Mountain", d: "M", tags: ["two-pointers", "array"], tc: "O(n)", sc: "O(1)", goal: "Find a peak and expand both ways, then jump past the mountain.", hint: "From a start index climb up, then climb down; the mountain counts only if both parts are non-empty.",
      s: "Read a line of integers. A mountain is a subarray of length at least 3 that strictly increases and then strictly decreases. Print the length of the longest mountain, or 0.", inp: "One line.", out: "An integer.", edge: "plateaus, no mountain",
      sol: `a = list(map(int, input().split()))
n = len(a)
best = 0
i = 0
while i + 1 < n:
    if a[i] < a[i + 1]:
        j = i
        while j + 1 < n and a[j] < a[j + 1]:
            j += 1
        if j + 1 < n and a[j] > a[j + 1]:
            while j + 1 < n and a[j] > a[j + 1]:
                j += 1
            best = max(best, j - i + 1)
        i = max(j, i + 1)
    else:
        i += 1
print(best)`, c: [["2 1 4 7 3 2 5", "5"], ["2 2 2", "0"], ["1 2 3 2 1", "5"], ["0 1 0", "3"]] }),
    p({ t: "Remove Duplicates Allowing Two", d: "M", tags: ["two-pointers", "in-place"], tc: "O(n)", sc: "O(1)", goal: "Generalise the write pointer: keep an element if it differs from the one two places behind the write position.", hint: "a[i] can be kept when write < 2 or a[i] != a[write - 2].",
      s: "Read a sorted line of integers. Keep each value at most twice. Print the new length on the first line and the kept elements on the second line.", inp: "One sorted line.", out: "Two lines.", edge: "all equal",
      sol: `a = list(map(int, input().split()))
write = 0
for x in a:
    if write < 2 or x != a[write - 2]:
        a[write] = x
        write += 1
print(write)
print(*a[:write])`, c: [["1 1 1 2 2 3", "5\n1 1 2 2 3"], ["0 0 1 1 1 1 2 3 3", "7\n0 0 1 1 2 3 3"], ["1", "1\n1"], ["2 2 2 2", "2\n2 2"]] }),
    p({ t: "Three Sum Closest", d: "M", tags: ["two-pointers", "sorting"], tc: "O(n^2)", sc: "O(1)", goal: "Adapt 3Sum: keep the sum closest to the target while moving pointers by comparing the current sum with the target.", hint: "For each i move l and r inward; update the best sum whenever it is closer to the target.",
      s: "Read a line of at least three integers and a target. Print the sum of three different elements that is closest to the target (the answer is unique).", inp: "Line 1: the array. Line 2: the target.", out: "An integer.", edge: "exact match",
      sol: `a = sorted(map(int, input().split()))
target = int(input())
best = a[0] + a[1] + a[2]
for i in range(len(a) - 2):
    l, r = i + 1, len(a) - 1
    while l < r:
        s = a[i] + a[l] + a[r]
        if abs(s - target) < abs(best - target):
            best = s
        if s < target:
            l += 1
        elif s > target:
            r -= 1
        else:
            break
print(best)`, c: [["-1 2 1 -4\n1", "2"], ["0 0 0\n1", "0"], ["1 1 1 1\n0", "3"], ["-5 -3 4 8\n6", "7"]] }),
    p({ t: "Longest Substring With At Most K Distinct", d: "M", tags: ["sliding-window", "hashing", "string"], tc: "O(n)", sc: "O(k)", goal: "Generalise the two-basket window to any number of distinct characters.", hint: "Keep a count per character and shrink the window while it has more than k distinct characters.",
      s: "Read a string and a number k. Print the length of the longest substring that contains at most k distinct characters.", inp: "Line 1: the string. Line 2: k.", out: "An integer.", edge: "k = 0",
      sol: `from collections import defaultdict

s = input()
k = int(input())
count = defaultdict(int)
left = best = 0
for right, ch in enumerate(s):
    count[ch] += 1
    while len(count) > k:
        count[s[left]] -= 1
        if count[s[left]] == 0:
            del count[s[left]]
        left += 1
    best = max(best, right - left + 1)
print(best)`, c: [["eceba\n2", "3"], ["aa\n1", "2"], ["abcabc\n3", "6"], ["a\n0", "0"]] }),
    p({ t: "Sliding Window Maximum", d: "H", tags: ["sliding-window", "deque", "monotonic"], tc: "O(n)", sc: "O(k)", goal: "Use a monotonic deque so each element is pushed and popped once.", hint: "Keep indices in a deque with decreasing values; drop the front when it leaves the window.",
      s: "Read a line of integers and a window size k. Print the maximum of every window of k consecutive elements, in order, on one line.", inp: "Line 1: the array. Line 2: k.", out: "One line of maxima.", edge: "k = 1, k equal to n",
      sol: `from collections import deque

a = list(map(int, input().split()))
k = int(input())
dq, out = deque(), []
for i, x in enumerate(a):
    while dq and a[dq[-1]] <= x:
        dq.pop()
    dq.append(i)
    if dq[0] <= i - k:
        dq.popleft()
    if i >= k - 1:
        out.append(a[dq[0]])
print(*out)`, c: [["1 3 -1 -3 5 3 6 7\n3", "3 3 5 5 6 7"], ["1\n1", "1"], ["9 11\n2", "11"], ["4 3 2 1\n2", "4 3 2"]] }),
    p({ t: "Two Non-Overlapping Subarrays", d: "H", tags: ["sliding-window", "prefix-sum", "dp"], tc: "O(n)", sc: "O(n)", goal: "Combine prefix sums with a running best of the earlier window so the later window can be added in O(1).", hint: "For each end index keep the best sum of a first-length window that ends early enough; try both orders of the two lengths.",
      s: "Read a line of non-negative integers and then two lengths L and M. Choose one subarray of length L and one of length M that do not overlap (in either order). Print the largest possible total of their sums.", inp: "Line 1: the array. Line 2: L and M.", out: "An integer.", edge: "both orders",
      sol: `a = list(map(int, input().split()))
L, M = map(int, input().split())
P = [0]
for x in a:
    P.append(P[-1] + x)


def solve(first, second):
    best_first = 0
    result = 0
    for i in range(first + second, len(P)):
        best_first = max(best_first, P[i - second] - P[i - second - first])
        result = max(result, best_first + P[i] - P[i - second])
    return result


print(max(solve(L, M), solve(M, L)))`, c: [["0 6 5 2 2 5 1 9 4\n1 2", "20"], ["3 8 1 3 2 1 8 9 0\n3 2", "29"], ["2 1 5 6 0 9 5 0 3 8\n4 3", "31"], ["1 1\n1 1", "2"]] }),
  ],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Stacks, Queues and Monotonic Structures: Pattern Problems",
  minutes: 90,
  learn: ["Use a stack for matching, nesting, undo and expression evaluation", "Use a queue or deque for first-in first-out processing and windows", "Apply the monotonic stack to next-greater and span problems", "Design small data structures: min stack, queue from stacks"],
  why: "Stacks and queues model how programs run (call stack), how editors undo, how compilers parse and how tasks are scheduled. Monotonic stacks turn many O(n^2) 'next greater' scans into O(n) and are a favourite in interviews.",
  realWorld: "A browser's back button is a stack, a print queue is a queue, a code editor highlights matching brackets with a stack, and a stock app computes the 'span' of rising prices with a monotonic stack.",
  simple: "A <strong>stack</strong> gives you the most recent item first (last in, first out): use <code>list.append</code> and <code>list.pop</code>. A <strong>queue</strong> gives you the oldest item first: use <code>collections.deque</code> with <code>append</code> and <code>popleft</code>.",
  detail: `<h3>Python tools</h3>
${table(["Structure", "Python", "Cost"], [["stack", "<code>stack = []</code>, <code>stack.append(x)</code>, <code>stack.pop()</code>, <code>stack[-1]</code>", "O(1)"], ["queue / deque", "<code>from collections import deque</code>; <code>q.append(x)</code>, <code>q.popleft()</code>", "O(1)"], ["priority queue", "<code>heapq</code> (later lesson)", "O(log n)"], ["avoid", "<code>list.pop(0)</code> and <code>list.insert(0, x)</code> are O(n)", "O(n)"]])}
<h3>Patterns</h3>
<ul><li><strong>Matching and nesting</strong>: push openers, pop on a closer and compare (valid parentheses, decode string, simplify path).</li><li><strong>Undo and evaluation</strong>: reverse Polish notation, baseball scores, calculators with precedence (push terms, multiply and divide immediately, sum at the end).</li><li><strong>Monotonic stack</strong>: keep the stack in increasing or decreasing order so each element is pushed and popped once. Use it for next greater element, daily temperatures, stock span, largest rectangle in a histogram, sum of subarray minimums, remove K digits.</li><li><strong>Two stacks</strong>: a queue from two stacks (amortised O(1)), a min stack that stores the minimum alongside each value.</li><li><strong>Simulation with a stack</strong>: asteroid collision, remove adjacent duplicates, validating push/pop sequences.</li></ul>
<h3>Monotonic stack in one sentence</h3>
<p>Walk the array once; while the new value beats the value on top of the stack, pop it and resolve its answer (the new value is the next greater element of every popped index), then push the new index. Remaining items have no answer (-1 or 0).</p>
<h3>Complexity</h3>
<p>Each element is pushed once and popped at most once, so the total work is O(n) even though there is a while loop inside the for loop. Say this explicitly in an interview.</p>`,
  syntax: { code: `stack = []\nfor i, x in enumerate(a):\n    while stack and a[stack[-1]] < x:\n        answer[stack.pop()] = x\n    stack.append(i)`, note: "Pop while the new value resolves older ones." },
  diagram: chain("Monotonic stack", "Left to right: read the next value, pop every smaller value from the stack and answer it with the new value, push the new index, continue.",
    [{ k: "proc", t: "next value x" }, { k: "dec", t: "x greater than\nstack top?" }, { k: "proc", t: "yes: pop and\nanswer it" }, { k: "term", t: "no: push x\nand continue" }], { w: 150, gap: 36, hgt: 62 }),
  example: { code: `from collections import deque


def valid(s):
    pairs = {")": "(", "]": "[", "}": "{"}
    stack = []
    for ch in s:
        if ch in pairs:
            if not stack or stack.pop() != pairs[ch]:
                return False
        else:
            stack.append(ch)
    return not stack


def next_greater(a):
    ans, stack = [-1] * len(a), []
    for i, x in enumerate(a):
        while stack and a[stack[-1]] < x:
            ans[stack.pop()] = x
        stack.append(i)
    return ans


def daily_temperatures(t):
    ans, stack = [0] * len(t), []
    for i, x in enumerate(t):
        while stack and t[stack[-1]] < x:
            j = stack.pop()
            ans[j] = i - j
        stack.append(i)
    return ans


print(valid("{[]}"), valid("([)]"), valid("(("))
print(next_greater([4, 5, 2, 25]))
print(daily_temperatures([73, 74, 75, 71, 69, 72, 76, 73]))
q = deque([1, 2, 3])
q.append(4)
print(q.popleft(), list(q))`, out: `True False False
[5, 25, 25, -1]
[1, 1, 4, 2, 1, 1, 0, 0]
1 [2, 3, 4]` },
  lineByLine: [["valid", "Every closer must match the most recent unmatched opener; at the end nothing may be left on the stack."], ["next_greater", "When 5 arrives it pops 4 and answers it; 25 pops 2 and 5. The remaining index (25) keeps -1."], ["daily_temperatures", "Same pattern, but the answer is the distance i - j in days."], ["deque", "popleft removes the oldest item in O(1); list.pop(0) would be O(n)."]],
  dryRun: { intro: "<code>next_greater([4, 5, 2, 25])</code>:", headers: ["i", "x", "stack before (values)", "pops", "stack after"], rows: [["0", "4", "[]", "-", "[4]"], ["1", "5", "[4]", "4 -> 5", "[5]"], ["2", "2", "[5]", "-", "[5, 2]"], ["3", "25", "[5, 2]", "2 -> 25, 5 -> 25", "[25]"]] },
  realExample: { intro: "Evaluating an expression in reverse Polish notation with one stack.", code: `OPS = {
    "+": lambda a, b: a + b,
    "-": lambda a, b: a - b,
    "*": lambda a, b: a * b,
    "/": lambda a, b: int(a / b),
}


def rpn(tokens):
    stack = []
    for tok in tokens.split():
        if tok in OPS:
            b, a = stack.pop(), stack.pop()
            stack.append(OPS[tok](a, b))
        else:
            stack.append(int(tok))
    return stack[0]


print(rpn("2 1 + 3 *"))
print(rpn("4 13 5 / +"))
print(rpn("10 6 9 3 + -11 * / * 17 + 5 +"))`, out: `9
6
22` },
  mistakes: ["Forgetting to check that the stack is non-empty before pop or [-1].", "Using list.pop(0) as a queue.", "Not handling items left on the stack after the loop.", "Choosing the wrong direction of comparison for ties (< versus <=).", "Computing division in RPN with // for negative numbers instead of truncating toward zero."],
  practices: ["Say what the stack holds: indices or values, increasing or decreasing.", "Argue the O(n) bound from push-once pop-once.", "Test empty, single and all-equal inputs.", "For brackets, test a closer first and leftover openers."],
  interview: ["Explain the monotonic stack.", "How do you implement a queue with two stacks?", "How do you design a stack that returns its minimum in O(1)?", "Why is list.pop(0) a bad queue?"],
  practiceQs: ["What is left on the stack at the end of next_greater?", "What does the stack store in daily temperatures?", "How is the stack used to evaluate a postfix expression?", "What is the amortised cost of the two-stack queue?"],
  revision: ["Stack: append/pop. Queue: deque append/popleft.", "Matching, evaluation, undo, monotonic stack.", "Push once, pop once: O(n).", "Min stack stores the running minimum."],
  hinglish: "Stack mein last in first out hota hai (append aur pop), queue mein first in first out (deque ka popleft). Brackets match karne, expression evaluate karne aur next greater element jaise sawalon mein stack kaam aata hai. Monotonic stack mein har element ek baar push aur ek baar pop hota hai, isliye O(n).",
  quiz: [
    mcq("Which structure is best for checking balanced brackets?", ["Queue", "Stack", "Set", "Heap"], 1, "The most recent opener must be closed first."),
    mcq("Why is a monotonic-stack solution O(n) even with a while loop inside the for loop?", ["Python is fast", "Each element is pushed once and popped at most once", "The loop never runs", "The stack has constant size"], 1, "The total number of pops is at most the number of pushes."),
    mcq("Which Python call is O(n) and should not be used as a queue pop?", ["deque.popleft()", "list.pop(0)", "list.pop()", "deque.append(x)"], 1, "Removing the first list element shifts every other element."),
    mcq("In an RPN evaluation, after reading an operator, which operands do you pop?", ["Two numbers: the second popped is the left operand", "One number", "Three numbers", "None"], 0, "b = pop(), a = pop(), then compute a op b."),
    mcq("A min stack stores extra information so that getMin is O(1). What is it?", ["The running minimum with each element", "The sorted stack", "The maximum", "A queue"], 0, "Each push records min(value, previous minimum).")
  ],
  tasks: [
    p({ t: "Valid Parentheses", d: "E", tags: ["stack", "string"], tc: "O(n)", sc: "O(n)", goal: "Match three kinds of brackets with one stack.", hint: "Push openers; on a closer the top of the stack must be its matching opener.",
      s: "Read a string made only of the characters ( ) [ ] { }. Print yes if every bracket is closed by the right kind in the right order, otherwise no.", inp: "One line.", out: "yes or no.", edge: "closer first, leftover openers",
      sol: `s = input()
pairs = {")": "(", "]": "[", "}": "{"}
stack = []
ok = True
for ch in s:
    if ch in pairs:
        if not stack or stack.pop() != pairs[ch]:
            ok = False
            break
    else:
        stack.append(ch)
print("yes" if ok and not stack else "no")`, c: [["()[]{}", "yes"], ["(]", "no"], ["([)]", "no"], ["{[]}", "yes"]] }),
    p({ t: "Min Stack Operations", d: "E", tags: ["stack", "design"], tc: "O(1) per operation", sc: "O(n)", goal: "Store the running minimum next to each value so the minimum survives pops.", hint: "Push min(x, current minimum) onto a second stack in step with the first.",
      s: "Process commands read until the end of input: push X, pop, and min. For every min command print the smallest value currently on the stack.", inp: "One command per line.", out: "One line per min command.", edge: "pop after pushes",
      sol: `import sys

stack, mins = [], []
for line in sys.stdin.read().split("\\n"):
    parts = line.split()
    if not parts:
        continue
    if parts[0] == "push":
        x = int(parts[1])
        stack.append(x)
        mins.append(min(x, mins[-1]) if mins else x)
    elif parts[0] == "pop":
        stack.pop()
        mins.pop()
    else:
        print(mins[-1])`, c: [["push 5\npush 3\nmin\npush 7\nmin\npop\npop\nmin", "3\n3\n5"], ["push 1\nmin", "1"], ["push 2\npush 2\npop\nmin", "2"], ["push -1\npush 0\nmin\npop\nmin", "-1\n-1"]] }),
    p({ t: "Queue Using Two Stacks", d: "E", tags: ["stack", "queue", "design"], tc: "O(1) amortised", sc: "O(n)", goal: "Reverse the order twice: move items from the inbox to the outbox only when the outbox is empty.", hint: "Push to an inbox stack; when dequeuing with an empty outbox pour the whole inbox into it.",
      s: "Process commands read until the end of input: enqueue X and dequeue. Using only two stacks to model the queue, print the value removed by every dequeue.", inp: "One command per line.", out: "One line per dequeue.", edge: "interleaved operations",
      sol: `import sys

inbox, outbox = [], []
for line in sys.stdin.read().split("\\n"):
    parts = line.split()
    if not parts:
        continue
    if parts[0] == "enqueue":
        inbox.append(int(parts[1]))
    else:
        if not outbox:
            while inbox:
                outbox.append(inbox.pop())
        print(outbox.pop())`, c: [["enqueue 1\nenqueue 2\ndequeue\nenqueue 3\ndequeue\ndequeue", "1\n2\n3"], ["enqueue 5\ndequeue", "5"], ["enqueue 1\nenqueue 2\nenqueue 3\ndequeue\ndequeue", "1\n2"], ["enqueue 9\ndequeue\nenqueue 8\ndequeue", "9\n8"]] }),
    p({ t: "Evaluate Reverse Polish Notation", d: "E", tags: ["stack", "expression"], tc: "O(n)", sc: "O(n)", goal: "Evaluate postfix expressions with one stack and integer division truncating toward zero.", hint: "Push numbers; on an operator pop two operands (the second popped is the left one).",
      s: "Read one line holding a postfix expression: integers and the operators + - * / separated by spaces. Division truncates toward zero. Print the value.", inp: "One line.", out: "An integer.", edge: "negative numbers, division",
      sol: `stack = []
for tok in input().split():
    if tok in ("+", "-", "*", "/"):
        b, a = stack.pop(), stack.pop()
        if tok == "+":
            stack.append(a + b)
        elif tok == "-":
            stack.append(a - b)
        elif tok == "*":
            stack.append(a * b)
        else:
            stack.append(int(a / b))
    else:
        stack.append(int(tok))
print(stack[0])`, c: [["2 1 + 3 *", "9"], ["4 13 5 / +", "6"], ["10 6 9 3 + -11 * / * 17 + 5 +", "22"], ["3 4 -", "-1"]] }),
    p({ t: "Baseball Game Score", d: "E", tags: ["stack", "simulation"], tc: "O(n)", sc: "O(n)", goal: "Model a record of scores where later operations refer to earlier ones.", hint: "Keep the valid scores on a stack: C removes the top, D doubles it, + adds the top two.",
      s: "Read one line of operations. An integer records that score; + records the sum of the previous two scores; D records double the previous score; C removes the previous score. Print the sum of all scores at the end.", inp: "One line.", out: "An integer.", edge: "negative scores",
      sol: `stack = []
for op in input().split():
    if op == "C":
        stack.pop()
    elif op == "D":
        stack.append(2 * stack[-1])
    elif op == "+":
        stack.append(stack[-1] + stack[-2])
    else:
        stack.append(int(op))
print(sum(stack))`, c: [["5 2 C D +", "30"], ["5 -2 4 C D 9 + +", "27"], ["1", "1"], ["3 D D", "21"]] }),
    p({ t: "Backspace String Compare", d: "E", tags: ["stack", "string"], tc: "O(n)", sc: "O(n)", goal: "Simulate typing with backspace using a stack for each string.", hint: "A # pops the last character if there is one; compare the final stacks.",
      s: "Read two strings typed into an editor where # means backspace (it does nothing on empty text). Print yes if the two end up with the same text, otherwise no.", inp: "Two lines.", out: "yes or no.", edge: "backspace on empty text",
      sol: `def typed(s):
    stack = []
    for ch in s:
        if ch == "#":
            if stack:
                stack.pop()
        else:
            stack.append(ch)
    return stack


print("yes" if typed(input()) == typed(input()) else "no")`, c: [["ab#c\nad#c", "yes"], ["ab##\nc#d#", "yes"], ["a#c\nb", "no"], ["a##c\n#a#c", "yes"]] }),
    p({ t: "Moving Average of a Stream", d: "E", tags: ["queue", "sliding-window"], tc: "O(1) per value", sc: "O(k)", goal: "Keep the last k values in a queue and a running sum.", hint: "Add the new value to the queue and sum; if the queue exceeds k remove the oldest and subtract it.",
      s: "Read a window size k and then a line of numbers arriving one by one. After each number print the average of the last k numbers received (fewer at the start) with 2 decimals.", inp: "Line 1: k. Line 2: the numbers.", out: "One line per number.", edge: "fewer than k values so far",
      sol: `from collections import deque

k = int(input())
window = deque()
total = 0
for x in map(int, input().split()):
    window.append(x)
    total += x
    if len(window) > k:
        total -= window.popleft()
    print(f"{total / len(window):.2f}")`, c: [["3\n1 10 3 5", "1.00\n5.50\n4.67\n6.00"], ["1\n4 8", "4.00\n8.00"], ["2\n3", "3.00"], ["5\n1 2 3 4", "1.00\n1.50\n2.00\n2.50"]] }),
    p({ t: "Next Greater Element", d: "M", tags: ["stack", "monotonic"], tc: "O(n)", sc: "O(n)", goal: "Resolve earlier positions as soon as a larger value arrives, using a decreasing stack.", hint: "Keep indices of values not yet resolved; pop while the new value is larger and record it.",
      s: "Read a line of integers. For each element print the first larger element to its right, or -1 if there is none.", inp: "One line.", out: "One line of answers.", edge: "equal values",
      sol: `a = list(map(int, input().split()))
ans, stack = [-1] * len(a), []
for i, x in enumerate(a):
    while stack and a[stack[-1]] < x:
        ans[stack.pop()] = x
    stack.append(i)
print(*ans)`, c: [["4 5 2 25", "5 25 25 -1"], ["3 2 1", "-1 -1 -1"], ["1 2 3", "2 3 -1"], ["2 2", "-1 -1"]] }),
    p({ t: "Daily Temperatures", d: "M", tags: ["stack", "monotonic"], tc: "O(n)", sc: "O(n)", goal: "Store indices on the stack so distances can be computed when a warmer day arrives.", hint: "Pop colder days while the current day is warmer and write the index difference.",
      s: "Read a line of daily temperatures. For each day print how many days you must wait for a warmer temperature, or 0 if there is none.", inp: "One line.", out: "One line of integers.", edge: "decreasing temperatures",
      sol: `t = list(map(int, input().split()))
ans, stack = [0] * len(t), []
for i, x in enumerate(t):
    while stack and t[stack[-1]] < x:
        j = stack.pop()
        ans[j] = i - j
    stack.append(i)
print(*ans)`, c: [["73 74 75 71 69 72 76 73", "1 1 4 2 1 1 0 0"], ["30 40 50 60", "1 1 1 0"], ["30 60 90", "1 1 0"], ["90 80 70", "0 0 0"]] }),
    p({ t: "Decode String", d: "M", tags: ["stack", "string", "parsing"], tc: "O(output size)", sc: "O(n)", goal: "Use a stack to save the text and repeat count when a bracket opens.", hint: "On [ push (current text, count); on ] pop and set current = previous + current * count.",
      s: "Read an encoded string such as 3[a2[c]] where k[text] means the text repeated k times (nesting allowed, k may have several digits). Print the decoded string.", inp: "One line.", out: "The decoded string.", edge: "nested brackets, no brackets",
      sol: `s = input()
stack = []
cur = ""
num = 0
for ch in s:
    if ch.isdigit():
        num = num * 10 + int(ch)
    elif ch == "[":
        stack.append((cur, num))
        cur, num = "", 0
    elif ch == "]":
        prev, k = stack.pop()
        cur = prev + cur * k
    else:
        cur += ch
print(cur)`, c: [["3[a]2[bc]", "aaabcbc"], ["3[a2[c]]", "accaccacc"], ["2[abc]3[cd]ef", "abcabccdcdcdef"], ["abc", "abc"]] }),
    p({ t: "Simplify Unix Path", d: "M", tags: ["stack", "string", "parsing"], tc: "O(n)", sc: "O(n)", goal: "Treat directory names as pushes and .. as a pop.", hint: "Split on / and ignore empty parts and .; a .. removes the previous directory if any.",
      s: "Read an absolute Unix-style path. Print its canonical form: it starts with one /, directories are separated by one /, there is no trailing /, and . and .. are resolved (.. at the root stays at the root).", inp: "One line.", out: "The canonical path.", edge: "root, repeated slashes",
      sol: `stack = []
for part in input().split("/"):
    if part == "" or part == ".":
        continue
    if part == "..":
        if stack:
            stack.pop()
    else:
        stack.append(part)
print("/" + "/".join(stack))`, c: [["/home/", "/home"], ["/../", "/"], ["/home//foo/", "/home/foo"], ["/a/./b/../../c/", "/c"]] }),
    p({ t: "Asteroid Collision", d: "M", tags: ["stack", "simulation"], tc: "O(n)", sc: "O(n)", goal: "Resolve collisions only between a right-moving asteroid on the stack and a new left-moving one.", hint: "While the new asteroid moves left and the top moves right, compare sizes: equal destroys both, smaller is destroyed.",
      s: "Read a line of non-zero integers: each asteroid's size, with the sign as direction (positive moves right, negative moves left, all at the same speed). When two meet, the smaller explodes; equal sizes both explode. Print the asteroids that remain, left to right, or none.", inp: "One line.", out: "The survivors or none.", edge: "equal sizes",
      sol: `stack = []
for x in map(int, input().split()):
    alive = True
    while alive and x < 0 and stack and stack[-1] > 0:
        if stack[-1] < -x:
            stack.pop()
        elif stack[-1] == -x:
            stack.pop()
            alive = False
        else:
            alive = False
    if alive:
        stack.append(x)
print(*stack if stack else ["none"])`, c: [["5 10 -5", "5 10"], ["8 -8", "none"], ["10 2 -5", "10"], ["-2 -1 1 2", "-2 -1 1 2"]] }),
    p({ t: "Remove K Digits", d: "M", tags: ["stack", "greedy", "monotonic"], tc: "O(n)", sc: "O(n)", goal: "Build the smallest number greedily with an increasing stack, removing larger digits that precede smaller ones.", hint: "While the new digit is smaller than the stack top and removals remain, pop; finally trim leftover removals from the end.",
      s: "Read a number as a string and k. Remove exactly k digits so that the remaining number is as small as possible. Print it without leading zeros (print 0 if nothing remains).", inp: "Line 1: the digits. Line 2: k.", out: "The smallest number.", edge: "leading zeros, k equal to the length",
      sol: `num = input()
k = int(input())
stack = []
for d in num:
    while k and stack and stack[-1] > d:
        stack.pop()
        k -= 1
    stack.append(d)
if k:
    stack = stack[:-k]
print("".join(stack).lstrip("0") or "0")`, c: [["1432219\n3", "1219"], ["10200\n1", "200"], ["10\n2", "0"], ["112\n1", "11"]] }),
    p({ t: "Next Greater Element in a Circle", d: "M", tags: ["stack", "monotonic", "circular"], tc: "O(n)", sc: "O(n)", goal: "Handle circular arrays by scanning the array twice with the same stack.", hint: "Iterate 2n positions using i % n, but only push indices in the first pass.",
      s: "Read a line of integers describing a circular array (after the last element comes the first). For each element print the first larger element found going forward around the circle, or -1.", inp: "One line.", out: "One line of answers.", edge: "single element",
      sol: `a = list(map(int, input().split()))
n = len(a)
ans, stack = [-1] * n, []
for i in range(2 * n):
    x = a[i % n]
    while stack and a[stack[-1]] < x:
        ans[stack.pop()] = x
    if i < n:
        stack.append(i)
print(*ans)`, c: [["1 2 1", "2 -1 2"], ["1 2 3 4 3", "2 3 4 -1 4"], ["5", "-1"], ["2 2", "-1 -1"]] }),
    p({ t: "Online Stock Span", d: "M", tags: ["stack", "monotonic"], tc: "O(n)", sc: "O(n)", goal: "Merge spans of smaller earlier days so each day is handled in amortised constant time.", hint: "Keep (price, span) pairs; pop while the top price is at most today's and add its span.",
      s: "Read a line of daily prices. For each day print its span: the number of consecutive days up to and including today whose price is less than or equal to today's price.", inp: "One line.", out: "One line of spans.", edge: "falling prices",
      sol: `stack = []
out = []
for price in map(int, input().split()):
    span = 1
    while stack and stack[-1][0] <= price:
        span += stack.pop()[1]
    stack.append((price, span))
    out.append(span)
print(*out)`, c: [["100 80 60 70 60 75 85", "1 1 1 2 1 4 6"], ["10 20 30", "1 2 3"], ["30 20 10", "1 1 1"], ["5", "1"]] }),
    p({ t: "Basic Calculator II", d: "M", tags: ["stack", "expression", "parsing"], tc: "O(n)", sc: "O(n)", goal: "Handle operator precedence by resolving * and / immediately and summing the terms at the end.", hint: "Remember the previous operator; for + and - push the signed number, for * and / combine with the top.",
      s: "Read an expression with non-negative integers and the operators + - * / (no spaces, no brackets). Division of integers truncates toward zero. Print the value.", inp: "One line.", out: "An integer.", edge: "single number, division",
      sol: `s = input()
stack = []
num = 0
op = "+"
for i, ch in enumerate(s):
    if ch.isdigit():
        num = num * 10 + int(ch)
    if not ch.isdigit() or i == len(s) - 1:
        if op == "+":
            stack.append(num)
        elif op == "-":
            stack.append(-num)
        elif op == "*":
            stack.append(stack.pop() * num)
        else:
            stack.append(int(stack.pop() / num))
        op = ch
        num = 0
print(sum(stack))`, c: [["3+2*2", "7"], ["3/2", "1"], ["3+5/2", "5"], ["14-3/2", "13"]] }),
    p({ t: "Minimum Brackets to Add", d: "M", tags: ["stack", "greedy", "counting"], tc: "O(n)", sc: "O(1)", goal: "Count unmatched closers and unmatched openers with one balance counter.", hint: "A closer with no open bracket needs an added opener; leftover openers need closers.",
      s: "Read a string of ( and ) characters. Print the minimum number of brackets you must insert anywhere so that the string becomes balanced.", inp: "One line.", out: "An integer.", edge: "only closers",
      sol: `s = input()
balance = need = 0
for ch in s:
    if ch == "(":
        balance += 1
    elif balance:
        balance -= 1
    else:
        need += 1
print(need + balance)`, c: [["())", "1"], ["(((", "3"], ["()", "0"], ["()))((", "4"]] }),
    p({ t: "Remove Adjacent Duplicates K", d: "M", tags: ["stack", "string"], tc: "O(n)", sc: "O(n)", goal: "Store (character, run length) pairs so groups of k disappear immediately.", hint: "Push (char, 1) or increment the top's count; pop the pair when its count reaches k.",
      s: "Read a string and k. Repeatedly delete k equal adjacent characters until no more deletions are possible. Print the final string, or none if it is empty.", inp: "Line 1: the string. Line 2: k.", out: "The remaining string or none.", edge: "everything removed",
      sol: `s = input()
k = int(input())
stack = []
for ch in s:
    if stack and stack[-1][0] == ch:
        stack[-1][1] += 1
        if stack[-1][1] == k:
            stack.pop()
    else:
        stack.append([ch, 1])
result = "".join(c * n for c, n in stack)
print(result or "none")`, c: [["deeedbbcccbdaa\n3", "aa"], ["abcd\n2", "abcd"], ["pbbcggttciiippooaais\n2", "ps"], ["aaaa\n2", "none"]] }),
    p({ t: "Validate Stack Sequences", d: "M", tags: ["stack", "simulation"], tc: "O(n)", sc: "O(n)", goal: "Simulate the pushes and pop greedily whenever the top matches the next expected pop.", hint: "Push each value, then pop while the top equals the next value in the pop order.",
      s: "Read two lines of distinct integers: the order in which values are pushed onto an initially empty stack, and a proposed order in which they are popped. Print yes if that pop order is possible, otherwise no.", inp: "Two lines.", out: "yes or no.", edge: "single element",
      sol: `pushed = list(map(int, input().split()))
popped = list(map(int, input().split()))
stack, j = [], 0
for x in pushed:
    stack.append(x)
    while stack and j < len(popped) and stack[-1] == popped[j]:
        stack.pop()
        j += 1
print("yes" if j == len(popped) else "no")`, c: [["1 2 3 4 5\n4 5 3 2 1", "yes"], ["1 2 3 4 5\n4 3 5 1 2", "no"], ["1\n1", "yes"], ["1 2\n2 1", "yes"]] }),
    p({ t: "Largest Rectangle in Histogram", d: "H", tags: ["stack", "monotonic"], tc: "O(n)", sc: "O(n)", goal: "Use an increasing stack so that when a bar is popped its rectangle's full width is known.", hint: "Append a bar of height 0; when a lower bar arrives pop taller bars and compute height x (current index - new stack top - 1).",
      s: "Read a line of bar heights (each bar has width 1). Print the area of the largest rectangle that fits inside the histogram.", inp: "One line.", out: "An integer.", edge: "one bar, increasing bars",
      sol: `heights = list(map(int, input().split())) + [0]
stack = []
best = 0
for i, h in enumerate(heights):
    while stack and heights[stack[-1]] >= h:
        height = heights[stack.pop()]
        width = i if not stack else i - stack[-1] - 1
        best = max(best, height * width)
    stack.append(i)
print(best)`, c: [["2 1 5 6 2 3", "10"], ["2 4", "4"], ["1", "1"], ["6 2 5 4 5 1 6", "12"]] }),
    p({ t: "Sum of Subarray Minimums", d: "H", tags: ["stack", "monotonic", "counting"], tc: "O(n)", sc: "O(n)", goal: "Count, for every element, in how many subarrays it is the minimum using nearest smaller elements on both sides.", hint: "For each i find the distance to the previous smaller (strict) and next smaller-or-equal element; contribution = a[i] x left x right.",
      s: "Read a line of integers. Print the sum of the minimum of every contiguous subarray.", inp: "One line.", out: "An integer.", edge: "equal values",
      sol: `a = list(map(int, input().split()))
n = len(a)
left, right = [0] * n, [0] * n
stack = []
for i in range(n):
    while stack and a[stack[-1]] > a[i]:
        stack.pop()
    left[i] = i - (stack[-1] if stack else -1)
    stack.append(i)
stack = []
for i in range(n - 1, -1, -1):
    while stack and a[stack[-1]] >= a[i]:
        stack.pop()
    right[i] = (stack[-1] if stack else n) - i
    stack.append(i)
print(sum(a[i] * left[i] * right[i] for i in range(n)))`, c: [["3 1 2 4", "17"], ["11 81 94 43 3", "444"], ["1", "1"], ["2 2", "6"]] }),
    p({ t: "Basic Calculator With Brackets", d: "H", tags: ["stack", "expression", "parsing"], tc: "O(n)", sc: "O(n)", goal: "Save the running result and the sign on a stack when a bracket opens, and restore them when it closes.", hint: "On ( push (result, sign) and reset; on ) finish the group and combine it with the saved values.",
      s: "Read an expression with non-negative integers, + and -, brackets ( ) and possibly a leading minus before a bracket (no spaces). Print its value.", inp: "One line.", out: "An integer.", edge: "nested brackets, unary minus",
      sol: `s = input()
stack = []
result, sign, num = 0, 1, 0
for ch in s:
    if ch.isdigit():
        num = num * 10 + int(ch)
    elif ch in "+-":
        result += sign * num
        num = 0
        sign = 1 if ch == "+" else -1
    elif ch == "(":
        stack.append((result, sign))
        result, sign = 0, 1
    elif ch == ")":
        result += sign * num
        num = 0
        prev_result, prev_sign = stack.pop()
        result = prev_result + prev_sign * result
        sign = 1
result += sign * num
print(result)`, c: [["(1+(4+5+2)-3)+(6+8)", "23"], ["1-(2+3)", "-4"], ["2147483647", "2147483647"], ["-(2+3)", "-5"]] }),
  ],
});

module.exports = { lessons };
