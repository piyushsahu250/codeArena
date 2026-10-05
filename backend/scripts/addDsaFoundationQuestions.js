// Adds Foundation-level (BTL 1-2) questions to the DSA ReadinessSubject: 20 MCQs across 9 topics
// and 4 STDIO coding questions. Coding questions are validated first: their Python AND Java
// reference solutions must be ACCEPTED by the real judge against every test case, or nothing is
// inserted. Idempotent by (title): re-running skips questions that already exist. Reuses the
// Subject/Unit taxonomy ids of the existing DSA question "Array Sum and Average Classifier".
const prisma = require("../src/prisma");
const { judgeSubmission } = require("../src/utils/judge");

const mcq = (btlLevel, topic, title, description, options, correct, explanation) => ({
  questionType: "MCQ", btlLevel, topic, title, description, options, correctAnswer: [correct], explanation,
  difficulty: "EASY", points: 5, estimatedTimeMin: 1, tags: [topic],
});

const MCQS = [
  // ---- BTL 1: Remember ----
  mcq(1, "Stacks and Queues", "Stack ordering principle", "Which principle does a stack data structure follow?", ["FIFO (First In, First Out)", "LIFO (Last In, First Out)", "Random access", "Priority order"], 1, "A stack removes the most recently added element first: Last In, First Out."),
  mcq(1, "Stacks and Queues", "Queue insertion operation", "Which operation adds an element to the back of a queue?", ["Push", "Pop", "Enqueue", "Dequeue"], 2, "Enqueue inserts at the rear; dequeue removes from the front. Push/pop belong to stacks."),
  mcq(1, "Arrays", "Array index access complexity", "What is the time complexity of reading an array element when you know its index?", ["O(1)", "O(n)", "O(log n)", "O(n^2)"], 0, "Arrays are contiguous, so the address is computed directly from the index: constant time."),
  mcq(1, "Linked Lists", "Singly linked list node contents", "In a singly linked list, each node stores:", ["Only its data", "Its data and a reference to the next node", "Its data and references to both neighbours", "Only the index of the next node"], 1, "A singly linked node holds a value and a pointer to the next node. Two pointers describe a doubly linked list."),
  mcq(1, "Searching and Sorting", "Search requiring sorted input", "Which search algorithm requires the data to be sorted?", ["Linear search", "Binary search", "Both linear and binary search", "Neither"], 1, "Binary search discards half the range each step, which only works if the data is ordered."),
  mcq(1, "Searching and Sorting", "Adjacent swap sorting algorithm", "Which sorting algorithm works by repeatedly swapping adjacent elements that are in the wrong order?", ["Merge sort", "Quick sort", "Bubble sort", "Heap sort"], 2, "Bubble sort repeatedly compares and swaps neighbouring elements until the array is sorted."),
  mcq(1, "Hashing", "Hash table placement", "What does a hash table use to decide where to store a key?", ["A hash function", "A sorting step", "A binary search", "A stack"], 0, "A hash function maps the key to a bucket/slot index."),
  mcq(1, "Trees", "Binary tree child limit", "In a binary tree, every node has at most how many children?", ["1", "2", "3", "Any number"], 1, "By definition a binary tree node has at most two children (left and right)."),
  mcq(1, "Complexity Analysis", "Meaning of Big-O", "What does Big-O notation describe?", ["The exact running time in seconds", "An upper bound on how an algorithm's cost grows with input size", "The memory address of a variable", "The number of lines in a program"], 1, "Big-O describes the upper bound on growth rate of time or space as input size grows."),
  mcq(1, "Recursion", "Required part of a recursive function", "Every correct recursive function must have a:", ["Loop", "Base case", "Global variable", "void return type"], 1, "Without a base case the recursion never stops."),
  // ---- BTL 2: Understand ----
  mcq(2, "Searching and Sorting", "Binary search step count", "Binary search is run on a sorted array of 1024 elements. Roughly how many comparisons are needed in the worst case?", ["About 5", "About 10", "About 512", "1024"], 1, "Each step halves the range: log2(1024) = 10, so about 10 comparisons."),
  mcq(2, "Stacks and Queues", "Stack trace after pushes and a pop", "Starting from an empty stack you run push(1), push(2), push(3), pop(). What is now on top of the stack?", ["1", "2", "3", "The stack is empty"], 1, "pop() removes 3 (the last pushed), leaving 2 on top."),
  mcq(2, "Stacks and Queues", "Queue trace after enqueues and a dequeue", "Starting from an empty queue you run enqueue(5), enqueue(8), enqueue(2), dequeue(). Which element is now at the front?", ["5", "8", "2", "The queue is empty"], 1, "dequeue() removes 5 (first in), so 8 is now at the front."),
  mcq(2, "Complexity Analysis", "Nested loop complexity", "A loop running i from 1 to n contains another loop running j from 1 to n, doing constant work inside. What is the overall time complexity?", ["O(n)", "O(n log n)", "O(n^2)", "O(2n)"], 2, "The inner loop runs n times for each of n iterations: n * n = O(n^2)."),
  mcq(2, "Linked Lists", "Insertion at the front: array vs linked list", "Why is inserting at the beginning of an array usually slower than inserting at the head of a linked list?", ["The array must shift every existing element, while the list only relinks the head", "Arrays cannot store new values after creation", "Linked lists store elements contiguously", "Arrays are always sorted"], 0, "Array insertion at index 0 shifts n elements (O(n)); a linked list just points a new head at the old one (O(1))."),
  mcq(2, "Hashing", "Hash collision", "What is it called when two different keys map to the same slot in a hash table?", ["Overflow", "Collision", "Underflow", "Rotation"], 1, "That event is a collision, handled by chaining or open addressing."),
  mcq(2, "Searching and Sorting", "Stable O(n log n) sort", "Which of these sorting algorithms is stable and guarantees O(n log n) time even in the worst case?", ["Quick sort", "Heap sort", "Merge sort", "Selection sort"], 2, "Merge sort is stable and O(n log n) always. Quick sort is O(n^2) worst case; heap sort is not stable; selection sort is O(n^2)."),
  mcq(2, "Recursion", "Missing base case behaviour", "What typically happens when a recursive function has no reachable base case?", ["It returns 0", "It keeps calling itself until a stack overflow occurs", "It runs exactly once", "The compiler always rejects it"], 1, "Each call adds a stack frame; without termination the call stack is exhausted."),
  mcq(2, "Trees", "Inorder traversal of a BST", "An inorder traversal of a binary search tree visits the keys in what order?", ["Random order", "Descending order", "Ascending sorted order", "Level by level"], 2, "Left subtree, node, right subtree: for a BST this yields keys in ascending order."),
  mcq(2, "Strings", "Two-pointer string reversal cost", "Reversing a string of length n in place with two pointers (one at each end, swapping inward) takes:", ["O(1) time", "O(n) time", "O(n^2) time", "O(log n) time"], 1, "About n/2 swaps are made, which is O(n)."),
];

const readArr = {
  java: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] arr = new int[n];\n        for (int i = 0; i < n; i++) arr[i] = sc.nextInt();\n\n        // TODO: %TODO%\n    }\n}\n",
  python: "n = int(input())\narr = list(map(int, input().split()))\n\n# TODO: %TODO%\n",
};

const CODING = [
  {
    title: "Reverse an Array", topic: "Arrays", tags: ["Arrays", "Basics"],
    description: "Write a complete program that reads an array of integers and prints its elements in reverse order.",
    inputFormat: "- The first line contains an integer N.\n- The second line contains N space-separated integers.",
    outputFormat: "- Print the N integers in reverse order on a single line, separated by single spaces.",
    constraints: "- 1 <= N <= 1000\n- -10^4 <= array elements <= 10^4",
    explanation: "Read the array, then print it from the last index down to index 0.",
    starter: { java: readArr.java.replace("%TODO%", "print the elements from last to first, separated by spaces"), python: readArr.python.replace("%TODO%", "print the elements from last to first, separated by spaces") },
    ref: {
      python: "n = int(input())\narr = input().split()\nprint(' '.join(reversed(arr)))\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); int[] r=new int[n]; for(int i=0;i<n;i++) r[i]=sc.nextInt(); StringBuilder sb=new StringBuilder(); for(int i=n-1;i>=0;i--){ sb.append(r[i]); if(i>0) sb.append(' ');} System.out.println(sb); } }",
    },
    cases: [["5\n1 2 3 4 5", "5 4 3 2 1", false], ["4\n-1 0 3 9", "9 3 0 -1", false], ["1\n7", "7", true], ["6\n10 20 30 40 50 60", "60 50 40 30 20 10", true], ["3\n5 5 5", "5 5 5", true], ["2\n-8 8", "8 -8", true]],
  },
  {
    title: "Maximum and Minimum of an Array", topic: "Arrays", tags: ["Arrays", "Basics"],
    description: "Write a complete program that reads an array of integers and prints the largest and the smallest value in it.",
    inputFormat: "- The first line contains an integer N.\n- The second line contains N space-separated integers.",
    outputFormat: "- Print the maximum and then the minimum, separated by a single space, on one line.",
    constraints: "- 1 <= N <= 1000\n- -10^4 <= array elements <= 10^4",
    explanation: "Scan the array once while tracking the largest and smallest value seen so far.",
    starter: { java: readArr.java.replace("%TODO%", "print the maximum and the minimum, separated by a space"), python: readArr.python.replace("%TODO%", "print the maximum and the minimum, separated by a space") },
    ref: {
      python: "n = int(input())\narr = list(map(int, input().split()))\nprint(max(arr), min(arr))\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); int mx=Integer.MIN_VALUE, mn=Integer.MAX_VALUE; for(int i=0;i<n;i++){int x=sc.nextInt(); mx=Math.max(mx,x); mn=Math.min(mn,x);} System.out.println(mx+\" \"+mn); } }",
    },
    cases: [["5\n3 1 4 1 5", "5 1", false], ["4\n-5 -2 -9 -1", "-1 -9", false], ["1\n42", "42 42", true], ["6\n100 -100 0 50 -50 25", "100 -100", true], ["3\n7 7 7", "7 7", true], ["2\n10000 -10000", "10000 -10000", true]],
  },
  {
    title: "Palindrome String Check", topic: "Strings", tags: ["Strings", "Two Pointers"],
    description: "Write a complete program that reads a word and prints YES if it reads the same forwards and backwards, otherwise NO.",
    inputFormat: "- A single line containing a string of lowercase English letters (no spaces).",
    outputFormat: "- Print YES if the string is a palindrome, otherwise print NO.",
    constraints: "- 1 <= length of the string <= 1000",
    explanation: "Compare the string with its reverse, or move two pointers inward from both ends.",
    starter: {
      java: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        String s = sc.next();\n\n        // TODO: print YES if s is a palindrome, otherwise NO\n    }\n}\n",
      python: "s = input().strip()\n\n# TODO: print YES if s is a palindrome, otherwise NO\n",
    },
    ref: {
      python: "s = input().strip()\nprint('YES' if s == s[::-1] else 'NO')\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); String s=sc.next(); System.out.println(new StringBuilder(s).reverse().toString().equals(s)?\"YES\":\"NO\"); } }",
    },
    cases: [["level", "YES", false], ["hello", "NO", false], ["a", "YES", true], ["abccba", "YES", true], ["abca", "NO", true], ["racecar", "YES", true]],
  },
  {
    title: "Linear Search Position", topic: "Searching and Sorting", tags: ["Searching", "Arrays"],
    description: "Write a complete program that performs a linear search: given an array and a target value, print the 0-based index of the first occurrence of the target, or -1 if it is not present.",
    inputFormat: "- The first line contains an integer N.\n- The second line contains N space-separated integers.\n- The third line contains the target integer.",
    outputFormat: "- Print the 0-based index of the first occurrence of the target, or -1 if it does not appear.",
    constraints: "- 1 <= N <= 1000\n- -10^4 <= array elements, target <= 10^4",
    explanation: "Scan the array from left to right and stop at the first element equal to the target.",
    starter: {
      java: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] arr = new int[n];\n        for (int i = 0; i < n; i++) arr[i] = sc.nextInt();\n        int target = sc.nextInt();\n\n        // TODO: print the first index of target, or -1\n    }\n}\n",
      python: "n = int(input())\narr = list(map(int, input().split()))\ntarget = int(input())\n\n# TODO: print the first index of target, or -1\n",
    },
    ref: {
      python: "n = int(input())\narr = list(map(int, input().split()))\nt = int(input())\nprint(arr.index(t) if t in arr else -1)\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); int[] r=new int[n]; for(int i=0;i<n;i++) r[i]=sc.nextInt(); int t=sc.nextInt(); int ans=-1; for(int i=0;i<n;i++){ if(r[i]==t){ans=i;break;} } System.out.println(ans); } }",
    },
    cases: [["5\n4 2 7 2 9\n2", "1", false], ["5\n4 2 7 2 9\n10", "-1", false], ["1\n5\n5", "0", true], ["4\n-1 -2 -3 -4\n-4", "3", true], ["6\n1 2 3 4 5 6\n6", "5", true], ["3\n9 9 9\n9", "0", true]],
  },
];

(async () => {
  // 1. Validate every coding question with real reference solutions BEFORE touching the DB.
  for (const c of CODING) {
    const cases = c.cases.map(([input, expected]) => ({ input, expected }));
    for (const lang of ["python", "java"]) {
      const r = await judgeSubmission({ language: lang, code: c.ref[lang], testCases: cases, evaluationType: "STDIO", timeLimitMs: 2000 });
      console.log(`${r.verdict === "ACCEPTED" ? "PASS" : "FAIL"}  validate "${c.title}" ${lang} -> ${r.verdict} ${r.passedCases}/${r.totalCases}`);
      if (r.verdict !== "ACCEPTED") throw new Error(`Reference ${lang} solution for "${c.title}" was not ACCEPTED; aborting without writes.`);
    }
  }

  const subject = await prisma.readinessSubject.findFirst({ where: { name: "DSA" } });
  const donor = await prisma.question.findFirst({ where: { title: "Array Sum and Average Classifier" } });
  if (!subject || !donor) throw new Error("DSA subject or donor question missing");
  const base = { subjectId: donor.subjectId, unitId: donor.unitId, createdById: donor.createdById, instituteId: null, questionStatus: "PUBLISHED", aiGenerated: false, subject: null };

  let created = 0, skipped = 0;
  const ids = [];
  const upsertByTitle = async (data, testCases) => {
    const exists = await prisma.question.findFirst({ where: { title: data.title, subjectId: base.subjectId } });
    if (exists) { skipped++; ids.push(exists.id); return; }
    const q = await prisma.question.create({ data: { ...base, ...data, ...(testCases ? { testCases: { create: testCases } } : {}) } });
    created++; ids.push(q.id);
  };
  for (const m of MCQS) await upsertByTitle(m);
  for (const c of CODING) {
    await upsertByTitle({
      questionType: "CODING", btlLevel: 2, difficulty: "EASY", points: 10, topic: c.topic, tags: c.tags, title: c.title,
      description: c.description, inputFormat: c.inputFormat, outputFormat: c.outputFormat, constraints: c.constraints, explanation: c.explanation,
      evaluationType: "STDIO", starterCodeByLanguage: c.starter, referenceSolution: c.ref, estimatedTimeMin: 8,
    }, c.cases.map(([input, expected, isHidden]) => ({ input, expected, isHidden })));
  }

  // 2. Pool + subject config.
  const admin = await prisma.user.findFirst({ where: { id: donor.createdById } });
  const poolRes = await prisma.readinessQuestionPool.createMany({
    data: ids.map((questionId) => ({ subjectId: subject.id, questionId, addedByUserId: admin?.id || donor.createdById, addedByName: admin?.name || "Platform seed" })),
    skipDuplicates: true,
  });
  const topics = ["Arrays", "Strings", "Stacks and Queues", "Linked Lists", "Searching and Sorting", "Hashing", "Trees", "Recursion", "Complexity Analysis"].map((name) => ({ name, subtopics: [] }));
  await prisma.readinessSubject.update({ where: { id: subject.id }, data: { topics } });

  const stats = await prisma.readinessQuestionPool.findMany({ where: { subjectId: subject.id }, include: { question: { select: { btlLevel: true, questionType: true, topic: true } } } });
  const by = {};
  for (const p of stats) { const k = `BTL${p.question.btlLevel}/${p.question.questionType}`; by[k] = (by[k] || 0) + 1; }
  console.log(`\nCreated ${created}, skipped ${skipped}; pool rows added ${poolRes.count}. Pool now:`, JSON.stringify(by));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
