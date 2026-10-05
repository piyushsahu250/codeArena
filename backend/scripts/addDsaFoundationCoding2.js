// Second batch: 10 more Foundation (BTL 2) STDIO coding questions for the DSA ReadinessSubject.
// Same safety model as addDsaFoundationQuestions.js: every question's Python AND Java reference
// solution must be ACCEPTED by the real judge on all test cases or nothing is written; idempotent
// by title; added to the DSA ReadinessQuestionPool.
const prisma = require("../src/prisma");
const { judgeSubmission } = require("../src/utils/judge");

const J = (body, decl) => `import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n${decl}\n        // TODO: ${body}\n    }\n}\n`;
const ARR_J = "        int n = sc.nextInt();\n        int[] arr = new int[n];\n        for (int i = 0; i < n; i++) arr[i] = sc.nextInt();\n";
const ARR_P = "n = int(input())\narr = list(map(int, input().split()))\n";
const arrStarter = (todo) => ({ java: J(todo, ARR_J), python: `${ARR_P}\n# TODO: ${todo}\n` });
const ARR_IN = "- The first line contains an integer N.\n- The second line contains N space-separated integers.";

const CODING = [
  {
    title: "Count Even and Odd Numbers", topic: "Arrays", tags: ["Arrays", "Basics"],
    description: "Write a complete program that reads an array of integers and counts how many of them are even and how many are odd (zero counts as even).",
    inputFormat: ARR_IN, outputFormat: "- Print the count of even numbers and the count of odd numbers, separated by a single space.",
    constraints: "- 1 <= N <= 1000\n- -10^4 <= array elements <= 10^4",
    explanation: "An integer x is even when x % 2 == 0. Scan the array once and keep two counters.",
    starter: arrStarter("print the even count and the odd count separated by a space"),
    ref: {
      python: "n = int(input())\narr = list(map(int, input().split()))\ne = sum(1 for x in arr if x % 2 == 0)\nprint(e, n - e)\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); int e=0; for(int i=0;i<n;i++){ if(sc.nextInt()%2==0) e++; } System.out.println(e+\" \"+(n-e)); } }",
    },
    cases: [["5\n1 2 3 4 5", "2 3", false], ["4\n2 4 6 8", "4 0", false], ["1\n7", "0 1", true], ["6\n-2 -3 0 10 11 13", "3 3", true], ["3\n0 0 0", "3 0", true], ["2\n-1 -1", "0 2", true]],
  },
  {
    title: "Count Vowels in a String", topic: "Strings", tags: ["Strings", "Basics"],
    description: "Write a complete program that reads a line of text and prints how many vowels (a, e, i, o, u) it contains.",
    inputFormat: "- A single line of lowercase English letters and spaces.", outputFormat: "- Print a single integer: the number of vowels in the line.",
    constraints: "- 1 <= length of the line <= 1000",
    explanation: "Walk through each character and increase a counter whenever it is one of a, e, i, o, u.",
    starter: {
      java: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        String s = sc.nextLine();\n\n        // TODO: print the number of vowels in s\n    }\n}\n",
      python: "s = input()\n\n# TODO: print the number of vowels in s\n",
    },
    ref: {
      python: "s = input()\nprint(sum(1 for c in s if c in 'aeiou'))\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); String s=sc.nextLine(); int c=0; for(char ch: s.toCharArray()){ if(\"aeiou\".indexOf(ch)>=0) c++; } System.out.println(c); } }",
    },
    cases: [["hello", "2", false], ["education", "5", false], ["rhythm", "0", true], ["aeiou", "5", true], ["programming is fun", "5", true], ["a", "1", true]],
  },
  {
    title: "Stack Operations Simulator", topic: "Stacks and Queues", tags: ["Stack", "Simulation"],
    description: "Simulate a stack. You are given a list of commands: `push x` puts x on top of the stack, `pop` removes the top element, and `top` prints the top element without removing it. If `pop` or `top` is used on an empty stack, print EMPTY.",
    inputFormat: "- The first line contains an integer Q, the number of commands.\n- Each of the next Q lines is one command: `push x`, `pop`, or `top`.",
    outputFormat: "- For every `top` command print the top element, and for every `pop`/`top` on an empty stack print EMPTY, each on its own line. A successful `push` or `pop` prints nothing.",
    constraints: "- 1 <= Q <= 1000\n- -10^4 <= x <= 10^4",
    explanation: "Use a stack (list/ArrayDeque). push appends, pop removes the last element, top reads it. Check for emptiness before pop and top.",
    starter: {
      java: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int q = sc.nextInt();\n        Deque<Integer> stack = new ArrayDeque<>();\n        for (int i = 0; i < q; i++) {\n            String cmd = sc.next();\n            // TODO: handle push (read a number), pop and top\n        }\n    }\n}\n",
      python: "q = int(input())\nstack = []\nfor _ in range(q):\n    parts = input().split()\n    # TODO: handle push (parts[1]), pop and top\n",
    },
    ref: {
      python: "q = int(input())\nst = []\nfor _ in range(q):\n    p = input().split()\n    if p[0] == 'push':\n        st.append(int(p[1]))\n    elif p[0] == 'pop':\n        if st: st.pop()\n        else: print('EMPTY')\n    else:\n        print(st[-1] if st else 'EMPTY')\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int q=sc.nextInt(); Deque<Integer> st=new ArrayDeque<>(); for(int i=0;i<q;i++){ String c=sc.next(); if(c.equals(\"push\")) st.push(sc.nextInt()); else if(c.equals(\"pop\")){ if(st.isEmpty()) System.out.println(\"EMPTY\"); else st.pop(); } else { System.out.println(st.isEmpty()?\"EMPTY\":String.valueOf(st.peek())); } } } }",
    },
    cases: [["6\npush 5\npush 8\ntop\npop\ntop\npop", "8\n5", false], ["3\npop\ntop\npush 1", "EMPTY\nEMPTY", false], ["4\npush 1\npush 2\npop\ntop", "1", true], ["5\npush -3\ntop\npop\npop\ntop", "-3\nEMPTY\nEMPTY", true], ["2\npush 9\ntop", "9", true], ["7\npush 1\npush 2\npush 3\npop\npop\ntop\npop", "1", true]],
  },
  {
    title: "Queue Operations Simulator", topic: "Stacks and Queues", tags: ["Queue", "Simulation"],
    description: "Simulate a queue. You are given a list of commands: `enqueue x` adds x to the back of the queue, `dequeue` removes the front element, and `front` prints the front element without removing it. If `dequeue` or `front` is used on an empty queue, print EMPTY.",
    inputFormat: "- The first line contains an integer Q, the number of commands.\n- Each of the next Q lines is one command: `enqueue x`, `dequeue`, or `front`.",
    outputFormat: "- For every `front` command print the front element, and for every `dequeue`/`front` on an empty queue print EMPTY, each on its own line. A successful `enqueue` or `dequeue` prints nothing.",
    constraints: "- 1 <= Q <= 1000\n- -10^4 <= x <= 10^4",
    explanation: "Use a queue (deque). enqueue appends at the back, dequeue removes from the front, front reads the first element. Check for emptiness first.",
    starter: {
      java: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int q = sc.nextInt();\n        Deque<Integer> queue = new ArrayDeque<>();\n        for (int i = 0; i < q; i++) {\n            String cmd = sc.next();\n            // TODO: handle enqueue (read a number), dequeue and front\n        }\n    }\n}\n",
      python: "from collections import deque\n\nq = int(input())\nqueue = deque()\nfor _ in range(q):\n    parts = input().split()\n    # TODO: handle enqueue (parts[1]), dequeue and front\n",
    },
    ref: {
      python: "from collections import deque\nq = int(input())\nd = deque()\nfor _ in range(q):\n    p = input().split()\n    if p[0] == 'enqueue':\n        d.append(int(p[1]))\n    elif p[0] == 'dequeue':\n        if d: d.popleft()\n        else: print('EMPTY')\n    else:\n        print(d[0] if d else 'EMPTY')\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int q=sc.nextInt(); Deque<Integer> d=new ArrayDeque<>(); for(int i=0;i<q;i++){ String c=sc.next(); if(c.equals(\"enqueue\")) d.addLast(sc.nextInt()); else if(c.equals(\"dequeue\")){ if(d.isEmpty()) System.out.println(\"EMPTY\"); else d.pollFirst(); } else { System.out.println(d.isEmpty()?\"EMPTY\":String.valueOf(d.peekFirst())); } } } }",
    },
    cases: [["6\nenqueue 5\nenqueue 8\nfront\ndequeue\nfront\ndequeue", "5\n8", false], ["3\ndequeue\nfront\nenqueue 1", "EMPTY\nEMPTY", false], ["4\nenqueue 1\nenqueue 2\ndequeue\nfront", "2", true], ["5\nenqueue -3\nfront\ndequeue\ndequeue\nfront", "-3\nEMPTY\nEMPTY", true], ["2\nenqueue 9\nfront", "9", true], ["7\nenqueue 1\nenqueue 2\nenqueue 3\ndequeue\ndequeue\nfront\ndequeue", "3", true]],
  },
  {
    title: "Check if an Array is Sorted", topic: "Searching and Sorting", tags: ["Arrays", "Sorting"],
    description: "Write a complete program that checks whether an array is sorted in non-decreasing (ascending) order.",
    inputFormat: ARR_IN, outputFormat: "- Print YES if every element is less than or equal to the next one, otherwise print NO.",
    constraints: "- 1 <= N <= 1000\n- -10^4 <= array elements <= 10^4",
    explanation: "Compare each element with the next one; if any element is greater than its successor the array is not sorted.",
    starter: arrStarter("print YES if the array is sorted in non-decreasing order, otherwise NO"),
    ref: {
      python: "n = int(input())\narr = list(map(int, input().split()))\nprint('YES' if all(arr[i] <= arr[i+1] for i in range(n-1)) else 'NO')\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); int[] r=new int[n]; for(int i=0;i<n;i++) r[i]=sc.nextInt(); boolean ok=true; for(int i=0;i+1<n;i++){ if(r[i]>r[i+1]) ok=false; } System.out.println(ok?\"YES\":\"NO\"); } }",
    },
    cases: [["5\n1 2 2 3 9", "YES", false], ["4\n3 1 2 4", "NO", false], ["1\n5", "YES", true], ["3\n5 4 3", "NO", true], ["4\n-5 -5 0 7", "YES", true], ["2\n2 1", "NO", true]],
  },
  {
    title: "Binary Search Index", topic: "Searching and Sorting", tags: ["Searching", "Binary Search"],
    description: "Write a complete program that performs a binary search on a sorted array of distinct integers and prints the 0-based index of the target, or -1 if it is not present.",
    inputFormat: "- The first line contains an integer N.\n- The second line contains N distinct integers in ascending order.\n- The third line contains the target integer.",
    outputFormat: "- Print the 0-based index of the target, or -1 if it does not appear.",
    constraints: "- 1 <= N <= 1000\n- -10^4 <= array elements, target <= 10^4\n- All array elements are distinct and sorted ascending.",
    explanation: "Keep low and high indices; compare the target with the middle element and discard the half that cannot contain it, until the range is empty.",
    starter: {
      java: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        int[] arr = new int[n];\n        for (int i = 0; i < n; i++) arr[i] = sc.nextInt();\n        int target = sc.nextInt();\n\n        // TODO: binary search; print the index of target or -1\n    }\n}\n",
      python: "n = int(input())\narr = list(map(int, input().split()))\ntarget = int(input())\n\n# TODO: binary search; print the index of target or -1\n",
    },
    ref: {
      python: "n = int(input())\narr = list(map(int, input().split()))\nt = int(input())\nlo, hi, ans = 0, n - 1, -1\nwhile lo <= hi:\n    mid = (lo + hi) // 2\n    if arr[mid] == t:\n        ans = mid; break\n    if arr[mid] < t: lo = mid + 1\n    else: hi = mid - 1\nprint(ans)\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); int[] r=new int[n]; for(int i=0;i<n;i++) r[i]=sc.nextInt(); int t=sc.nextInt(); int lo=0, hi=n-1, ans=-1; while(lo<=hi){ int mid=(lo+hi)/2; if(r[mid]==t){ans=mid;break;} if(r[mid]<t) lo=mid+1; else hi=mid-1; } System.out.println(ans); } }",
    },
    cases: [["5\n1 3 5 7 9\n7", "3", false], ["5\n1 3 5 7 9\n4", "-1", false], ["1\n5\n5", "0", true], ["6\n-10 -5 0 5 10 15\n-10", "0", true], ["6\n-10 -5 0 5 10 15\n15", "5", true], ["4\n2 4 6 8\n9", "-1", true]],
  },
  {
    title: "Factorial of N", topic: "Recursion", tags: ["Recursion", "Math"],
    description: "Write a complete program that reads N and prints N! (N factorial), where 0! = 1. Try solving it with recursion.",
    inputFormat: "- A single line containing an integer N.", outputFormat: "- Print N!.",
    constraints: "- 0 <= N <= 12",
    explanation: "factorial(0) = 1 is the base case; otherwise factorial(n) = n * factorial(n - 1).",
    starter: {
      java: "import java.util.*;\n\npublic class Main {\n    // TODO: write a recursive factorial(int n)\n\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n        // print n!\n    }\n}\n",
      python: "n = int(input())\n\n# TODO: print n! (try a recursive function)\n",
    },
    ref: {
      python: "def f(n):\n    return 1 if n <= 1 else n * f(n - 1)\nprint(f(int(input())))\n",
      java: "import java.util.*;\npublic class Main { static long f(int n){ return n<=1?1:n*f(n-1);} public static void main(String[] a){ Scanner sc=new Scanner(System.in); System.out.println(f(sc.nextInt())); } }",
    },
    cases: [["5", "120", false], ["0", "1", false], ["1", "1", true], ["10", "3628800", true], ["12", "479001600", true], ["7", "5040", true]],
  },
  {
    title: "Nth Fibonacci Number", topic: "Recursion", tags: ["Recursion", "Math"],
    description: "Write a complete program that reads N and prints the Nth Fibonacci number, where F(0) = 0, F(1) = 1 and F(n) = F(n-1) + F(n-2).",
    inputFormat: "- A single line containing an integer N.", outputFormat: "- Print F(N).",
    constraints: "- 0 <= N <= 30",
    explanation: "The base cases are F(0) = 0 and F(1) = 1. Every other value is the sum of the previous two; a loop or recursion both work for N <= 30.",
    starter: {
      java: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n\n        // TODO: print the Nth Fibonacci number (F(0)=0, F(1)=1)\n    }\n}\n",
      python: "n = int(input())\n\n# TODO: print the Nth Fibonacci number (F(0)=0, F(1)=1)\n",
    },
    ref: {
      python: "n = int(input())\na, b = 0, 1\nfor _ in range(n):\n    a, b = b, a + b\nprint(a)\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] x){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); long a=0,b=1; for(int i=0;i<n;i++){ long t=a+b; a=b; b=t; } System.out.println(a); } }",
    },
    cases: [["10", "55", false], ["0", "0", false], ["1", "1", true], ["20", "6765", true], ["30", "832040", true], ["7", "13", true]],
  },
  {
    title: "Count Distinct Elements", topic: "Hashing", tags: ["Hashing", "Sets"],
    description: "Write a complete program that reads an array of integers and prints how many distinct values it contains. A hash set is a natural fit.",
    inputFormat: ARR_IN, outputFormat: "- Print the number of distinct values in the array.",
    constraints: "- 1 <= N <= 1000\n- -10^4 <= array elements <= 10^4",
    explanation: "Insert every element into a set; the set's size is the number of distinct values.",
    starter: arrStarter("print the number of distinct values (hint: use a set)"),
    ref: {
      python: "n = int(input())\narr = list(map(int, input().split()))\nprint(len(set(arr)))\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); Set<Integer> s=new HashSet<>(); for(int i=0;i<n;i++) s.add(sc.nextInt()); System.out.println(s.size()); } }",
    },
    cases: [["6\n1 2 2 3 3 3", "3", false], ["5\n5 5 5 5 5", "1", false], ["1\n9", "1", true], ["5\n1 2 3 4 5", "5", true], ["7\n-1 -1 0 0 1 1 2", "4", true], ["8\n10 20 10 30 20 40 50 40", "5", true]],
  },
  {
    title: "Sort an Array in Ascending Order", topic: "Searching and Sorting", tags: ["Sorting", "Arrays"],
    description: "Write a complete program that reads an array of integers and prints it sorted in ascending order. You may implement bubble sort or selection sort yourself to practise the idea.",
    inputFormat: ARR_IN, outputFormat: "- Print the N integers in ascending order on one line, separated by single spaces.",
    constraints: "- 1 <= N <= 1000\n- -10^4 <= array elements <= 10^4",
    explanation: "Bubble sort repeatedly swaps adjacent out-of-order elements; after each pass the largest remaining element settles at the end.",
    starter: arrStarter("sort arr in ascending order and print it, separated by spaces"),
    ref: {
      python: "n = int(input())\narr = list(map(int, input().split()))\nprint(' '.join(map(str, sorted(arr))))\n",
      java: "import java.util.*;\npublic class Main { public static void main(String[] a){ Scanner sc=new Scanner(System.in); int n=sc.nextInt(); int[] r=new int[n]; for(int i=0;i<n;i++) r[i]=sc.nextInt(); Arrays.sort(r); StringBuilder sb=new StringBuilder(); for(int i=0;i<n;i++){ if(i>0) sb.append(' '); sb.append(r[i]); } System.out.println(sb); } }",
    },
    cases: [["5\n5 2 9 1 5", "1 2 5 5 9", false], ["4\n-3 7 -3 0", "-3 -3 0 7", false], ["1\n8", "8", true], ["6\n6 5 4 3 2 1", "1 2 3 4 5 6", true], ["3\n1 2 3", "1 2 3", true], ["5\n100 -100 50 -50 0", "-100 -50 0 50 100", true]],
  },
];

(async () => {
  for (const c of CODING) {
    const cases = c.cases.map(([input, expected]) => ({ input, expected }));
    for (const lang of ["python", "java"]) {
      const r = await judgeSubmission({ language: lang, code: c.ref[lang], testCases: cases, evaluationType: "STDIO", timeLimitMs: 2000 });
      console.log(`${r.verdict === "ACCEPTED" ? "PASS" : "FAIL"}  validate "${c.title}" ${lang} -> ${r.verdict} ${r.passedCases}/${r.totalCases}`);
      if (r.verdict !== "ACCEPTED") throw new Error(`Reference ${lang} for "${c.title}" not ACCEPTED; aborting without writes.`);
    }
    // The starter itself must compile (an unfinished starter is expected to fail the tests, never to fail to compile).
    for (const lang of ["python", "java"]) {
      const r = await judgeSubmission({ language: lang, code: c.starter[lang], testCases: cases.slice(0, 1), evaluationType: "STDIO", timeLimitMs: 2000 });
      if (r.verdict === "COMPILE_ERROR") throw new Error(`Starter ${lang} for "${c.title}" does not compile: ${JSON.stringify(r.errorSummary)}`);
    }
  }

  const subject = await prisma.readinessSubject.findFirst({ where: { name: "DSA" } });
  const donor = await prisma.question.findFirst({ where: { title: "Array Sum and Average Classifier" } });
  const base = { subjectId: donor.subjectId, unitId: donor.unitId, createdById: donor.createdById, instituteId: null, questionStatus: "PUBLISHED", aiGenerated: false, subject: null };
  const admin = await prisma.user.findFirst({ where: { id: donor.createdById } });
  let created = 0, skipped = 0;
  const ids = [];
  for (const c of CODING) {
    const exists = await prisma.question.findFirst({ where: { title: c.title, subjectId: base.subjectId } });
    if (exists) { skipped++; ids.push(exists.id); continue; }
    const q = await prisma.question.create({ data: {
      ...base, questionType: "CODING", btlLevel: 2, difficulty: "EASY", points: 10, topic: c.topic, tags: c.tags, title: c.title,
      description: c.description, inputFormat: c.inputFormat, outputFormat: c.outputFormat, constraints: c.constraints, explanation: c.explanation,
      evaluationType: "STDIO", starterCodeByLanguage: c.starter, referenceSolution: c.ref, estimatedTimeMin: 8,
      testCases: { create: c.cases.map(([input, expected, isHidden]) => ({ input, expected, isHidden })) },
    } });
    created++; ids.push(q.id);
  }
  const pool = await prisma.readinessQuestionPool.createMany({
    data: ids.map((questionId) => ({ subjectId: subject.id, questionId, addedByUserId: admin?.id || donor.createdById, addedByName: admin?.name || "Platform seed" })),
    skipDuplicates: true,
  });
  const stats = await prisma.readinessQuestionPool.findMany({ where: { subjectId: subject.id }, include: { question: { select: { btlLevel: true, questionType: true } } } });
  const by = {};
  for (const p of stats) { const k = `BTL${p.question.btlLevel}/${p.question.questionType}`; by[k] = (by[k] || 0) + 1; }
  console.log(`\nCreated ${created}, skipped ${skipped}; pool rows added ${pool.count}. Pool now:`, JSON.stringify(by));
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
