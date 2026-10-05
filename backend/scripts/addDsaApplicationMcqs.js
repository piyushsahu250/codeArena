// Adds BTL 3 (Apply) multiple-choice questions to the DSA ReadinessSubject -- the level the
// "Application Readiness" mode draws from exclusively (btlMin = btlMax = 3). Each question asks the
// student to APPLY a concept: trace code, run an algorithm on given data, or choose the right
// structure for a scenario. Trace-style answers are recomputed in JS below and must match the
// marked option before anything is written. Idempotent by title.
const prisma = require("../src/prisma");

const q = (topic, title, description, options, correct, explanation) => ({
  questionType: "MCQ", btlLevel: 3, topic, title, description, options, correctAnswer: [correct], explanation,
  difficulty: "MEDIUM", points: 5, estimatedTimeMin: 2, tags: [topic, "Apply"],
});

const MCQS = [
  q("Arrays", "Negative-offset index lookup", "What does this program print?\n\narr = [4, 8, 15, 16, 23, 42]\nprint(arr[len(arr) - 2])", ["16", "23", "42", "15"], 1, "len(arr) is 6, so the index is 4, which holds 23."),
  q("Arrays", "Running prefix sums trace", "What is printed after this code runs?\n\narr = [1, 2, 3, 4, 5]\nfor i in range(1, 5):\n    arr[i] = arr[i] + arr[i - 1]\nprint(arr)", ["[1, 3, 6, 10, 15]", "[1, 2, 3, 4, 5]", "[3, 5, 7, 9, 5]", "[15, 14, 12, 9, 5]"], 0, "Each element becomes itself plus the already-updated previous element, giving the prefix sums 1, 3, 6, 10, 15."),
  q("Strings", "Slice of a word", "What does this program print?\n\ns = 'algorithm'\nprint(s[2:6])", ["gori", "gorit", "lgor", "orit"], 0, "Indices 2 to 5 of a-l-g-o-r-i-t-h-m are g, o, r, i."),
  q("Stacks and Queues", "Postfix evaluation", "Using a stack, evaluate the postfix expression:\n\n5 3 2 * + 4 -", ["3", "7", "9", "13"], 1, "3 2 * gives 6; 5 6 + gives 11; 11 4 - gives 7."),
  q("Stacks and Queues", "Balanced brackets selection", "Using a stack to match brackets, which of these strings is balanced?", ["([)]", "{[()]}", "((())", "]["], 1, "Only {[()]} closes every bracket in the exact reverse order it was opened."),
  q("Stacks and Queues", "Circular queue insert position", "A circular queue has capacity 5 (indices 0 to 4). Its front is at index 3 and it currently holds 4 elements. At which index will the next enqueue store its element?", ["0", "1", "2", "4"], 2, "Next free slot = (front + count) mod capacity = (3 + 4) mod 5 = 2."),
  q("Stacks and Queues", "Browser back button structure", "A browser's Back button returns to the most recently visited page first. Which data structure naturally models this history?", ["Queue", "Stack", "Hash table", "Binary tree"], 1, "Most recent first is last-in-first-out, which is a stack."),
  q("Stacks and Queues", "Print spooler structure", "Which data structure should a printer spooler use so documents print in the order they were submitted?", ["Stack", "Queue", "Binary tree", "Hash set"], 1, "First submitted, first printed is first-in-first-out, which is a queue."),
  q("Linked Lists", "Delete the next node", "In a singly linked list, which statement correctly removes the node that comes immediately after node P?", ["P.next = P.next.next", "P = P.next.next", "P.next = P", "P.next.next = P"], 0, "Re-linking P to the node after the one being removed bypasses it."),
  q("Linked Lists", "Iterative reversal progress", "A singly linked list 1 -> 2 -> 3 -> 4 is reversed iteratively using prev, curr and next pointers. After exactly two nodes have been processed, the list that begins at prev is:", ["2 -> 1 -> null", "1 -> 2 -> null", "2 -> 3 -> 4", "1 -> null"], 0, "Each step points the current node back at prev. After nodes 1 and 2 are processed, prev starts the reversed part 2 -> 1."),
  q("Searching and Sorting", "Second binary search probe", "Binary search for 23 in this sorted array, using mid = (lo + hi) // 2 with lo = 0 and hi = 9 initially:\n\n[2, 5, 8, 12, 16, 23, 38, 56, 72, 91]\n\nWhich index is examined second?", ["5", "6", "7", "8"], 2, "First mid = 4 (value 16 < 23) so lo = 5; second mid = (5 + 9) // 2 = 7."),
  q("Searching and Sorting", "Bubble sort first pass", "One full pass of bubble sort (swapping adjacent out-of-order pairs from left to right) is applied to [5, 1, 4, 2, 8]. What does the array look like afterwards?", ["[1, 4, 2, 5, 8]", "[1, 2, 4, 5, 8]", "[1, 5, 4, 2, 8]", "[5, 1, 4, 2, 8]"], 0, "5 bubbles right past 1, 4 and 2 and stops before 8: [1, 4, 2, 5, 8]."),
  q("Searching and Sorting", "Selection sort second pass", "Selection sort is run on [64, 25, 12, 22, 11]. What does the array look like after the second pass?", ["[11, 12, 25, 22, 64]", "[11, 12, 22, 25, 64]", "[11, 25, 12, 22, 64]", "[12, 25, 64, 22, 11]"], 0, "Pass 1 puts 11 first: [11, 25, 12, 22, 64]. Pass 2 swaps the minimum of the rest (12) into position 1: [11, 12, 25, 22, 64]."),
  q("Searching and Sorting", "Two-sum on a sorted array", "You must decide whether any two numbers in a sorted array add up to a target, in O(n) time and O(1) extra space. Which technique fits?", ["Two pointers moving inward from both ends", "Nested loops over every pair", "Sorting the array again for every element", "Recursion without memoization"], 0, "With sorted data, move the left pointer up when the sum is too small and the right pointer down when too large."),
  q("Hashing", "Chaining bucket load", "A hash table with chaining uses h(k) = k mod 7. The keys 15, 22, 8 and 29 are inserted. How many keys end up in bucket 1?", ["1", "2", "3", "4"], 3, "15, 22, 8 and 29 all leave remainder 1 when divided by 7, so all four collide in bucket 1."),
  q("Hashing", "Word frequency structure", "Which structure counts how many times each word appears in a large text with average O(1) work per word?", ["A sorted array searched linearly", "A hash map from word to count", "A stack of words", "A singly linked list of words"], 1, "A hash map gives average constant-time lookup and update for each word."),
  q("Strings", "Anagram check approach", "Which approach decides whether two words are anagrams in O(n) time?", ["Compare the character frequency counts of both words", "Bubble sort both words and compare them", "Check whether one word is a substring of the other", "Compare only the two lengths"], 0, "Equal character counts for every letter is exactly the anagram condition and takes one pass over each word."),
  q("Recursion", "Recursive sum trace", "What does f(4) return?\n\ndef f(n):\n    if n == 0:\n        return 0\n    return n + f(n - 1)", ["4", "10", "24", "0"], 1, "f(4) = 4 + 3 + 2 + 1 + 0 = 10."),
  q("Recursion", "Two-branch recursion trace", "What does g(5) return?\n\ndef g(n):\n    if n <= 1:\n        return 1\n    return g(n - 1) + g(n - 2)", ["5", "8", "13", "3"], 1, "g(1)=1, g(2)=2, g(3)=3, g(4)=5, so g(5)=8."),
  q("Complexity Analysis", "Halving loop iterations", "How many times does the loop body run for n = 64?\n\nwhile n > 1:\n    n = n // 2", ["5", "6", "7", "64"], 1, "64 -> 32 -> 16 -> 8 -> 4 -> 2 -> 1 takes 6 halvings."),
  q("Complexity Analysis", "Binary search inside a loop", "A loop runs n times and, on each iteration, binary-searches a sorted array of n elements. What is the total time complexity?", ["O(n)", "O(n log n)", "O(n^2)", "O(log n)"], 1, "n iterations, each costing O(log n), gives O(n log n)."),
  q("Trees", "Preorder traversal", "A binary tree has root 1. Node 1's left child is 2 and its right child is 3. Node 2 has children 4 (left) and 5 (right). What is the preorder traversal (root, left, right)?", ["1 2 4 5 3", "4 2 5 1 3", "4 5 2 3 1", "1 2 3 4 5"], 0, "Visit 1, then the whole left subtree (2, 4, 5), then the right subtree (3)."),
  q("Trees", "Building a binary search tree", "The keys 50, 30, 70, 20, 40 are inserted into an empty binary search tree in that order. Which key becomes the left child of 30?", ["20", "40", "50", "70"], 0, "20 is smaller than 50 and smaller than 30, so it becomes the left child of 30; 40 goes to its right."),
  q("Graphs", "Breadth-first visit order", "A graph has edges A -> B, A -> C, B -> D, C -> D (neighbours listed in alphabetical order). In what order does a breadth-first search starting at A visit the nodes?", ["A B C D", "A B D C", "A D B C", "D C B A"], 0, "BFS visits A, then all of A's neighbours (B, C), then the next level (D)."),
];

// Independent recomputation of the trace-style answers (guards against an authoring slip).
function selfCheck() {
  const get = (t) => MCQS.find((m) => m.title === t);
  const ans = (t) => get(t).options[get(t).correctAnswer[0]];
  const checks = [];
  const a1 = [4, 8, 15, 16, 23, 42]; checks.push(["Negative-offset index lookup", String(a1[a1.length - 2])]);
  const a2 = [1, 2, 3, 4, 5]; for (let i = 1; i < 5; i++) a2[i] += a2[i - 1]; checks.push(["Running prefix sums trace", `[${a2.join(", ")}]`]);
  checks.push(["Slice of a word", "algorithm".slice(2, 6)]);
  const st = []; for (const t of "5 3 2 * + 4 -".split(" ")) { if (/\d/.test(t)) st.push(+t); else { const b = st.pop(), a = st.pop(); st.push(t === "*" ? a * b : t === "+" ? a + b : a - b); } } checks.push(["Postfix evaluation", String(st[0])]);
  checks.push(["Circular queue insert position", String((3 + 4) % 5)]);
  const arr = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91]; let lo = 0, hi = 9; const probes = []; while (lo <= hi) { const mid = Math.floor((lo + hi) / 2); probes.push(mid); if (arr[mid] === 23) break; if (arr[mid] < 23) lo = mid + 1; else hi = mid - 1; } checks.push(["Second binary search probe", String(probes[1])]);
  const b = [5, 1, 4, 2, 8]; for (let i = 0; i < b.length - 1; i++) if (b[i] > b[i + 1]) [b[i], b[i + 1]] = [b[i + 1], b[i]]; checks.push(["Bubble sort first pass", `[${b.join(", ")}]`]);
  const s = [64, 25, 12, 22, 11]; for (let p = 0; p < 2; p++) { let m = p; for (let i = p + 1; i < s.length; i++) if (s[i] < s[m]) m = i; [s[p], s[m]] = [s[m], s[p]]; } checks.push(["Selection sort second pass", `[${s.join(", ")}]`]);
  checks.push(["Chaining bucket load", String([15, 22, 8, 29].filter((k) => k % 7 === 1).length)]);
  const f = (n) => (n === 0 ? 0 : n + f(n - 1)); checks.push(["Recursive sum trace", String(f(4))]);
  const g = (n) => (n <= 1 ? 1 : g(n - 1) + g(n - 2)); checks.push(["Two-branch recursion trace", String(g(5))]);
  let n = 64, iters = 0; while (n > 1) { n = Math.floor(n / 2); iters++; } checks.push(["Halving loop iterations", String(iters)]);
  for (const [title, expected] of checks) {
    const ok = ans(title) === expected;
    console.log(`${ok ? "PASS" : "FAIL"}  self-check "${title}" -> marked "${ans(title)}", computed "${expected}"`);
    if (!ok) throw new Error(`Marked answer for "${title}" disagrees with recomputation; aborting without writes.`);
  }
}

(async () => {
  selfCheck();
  const titles = new Set(MCQS.map((m) => m.title));
  if (titles.size !== MCQS.length) throw new Error("Duplicate titles in batch");
  for (const m of MCQS) if (new Set(m.options).size !== m.options.length) throw new Error(`Duplicate options in "${m.title}"`);

  const subject = await prisma.readinessSubject.findFirst({ where: { name: "DSA" } });
  const donor = await prisma.question.findFirst({ where: { title: "Array Sum and Average Classifier" } });
  const base = { subjectId: donor.subjectId, unitId: donor.unitId, createdById: donor.createdById, instituteId: null, questionStatus: "PUBLISHED", aiGenerated: false, subject: null };
  const admin = await prisma.user.findFirst({ where: { id: donor.createdById } });
  let created = 0, skipped = 0;
  const ids = [];
  for (const m of MCQS) {
    const exists = await prisma.question.findFirst({ where: { title: m.title, subjectId: base.subjectId } });
    if (exists) { skipped++; ids.push(exists.id); continue; }
    const row = await prisma.question.create({ data: { ...base, ...m } });
    created++; ids.push(row.id);
  }
  const pool = await prisma.readinessQuestionPool.createMany({
    data: ids.map((questionId) => ({ subjectId: subject.id, questionId, addedByUserId: admin?.id || donor.createdById, addedByName: admin?.name || "Platform seed" })),
    skipDuplicates: true,
  });
  // Topic list: add Graphs (new here) without dropping the existing ones.
  const topics = Array.isArray(subject.topics) ? subject.topics : [];
  if (!topics.some((t) => t.name === "Graphs")) await prisma.readinessSubject.update({ where: { id: subject.id }, data: { topics: [...topics, { name: "Graphs", subtopics: [] }] } });

  const stats = await prisma.readinessQuestionPool.findMany({ where: { subjectId: subject.id }, include: { question: { select: { btlLevel: true, questionType: true } } } });
  const by = {};
  for (const p of stats) { const k = `BTL${p.question.btlLevel}/${p.question.questionType}`; by[k] = (by[k] || 0) + 1; }
  console.log(`\nCreated ${created}, skipped ${skipped}; pool rows added ${pool.count}. Pool now:`, JSON.stringify(by));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
