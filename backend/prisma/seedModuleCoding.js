// Seeds a real, judge-verified proctored coding assessment for the two fully-authored modules
// (Module 1 "Introduction to Java", Module 2 "Java Basics") — the other 14 stub modules are left
// ungated by this feature (no ModuleCodingTest row = the lock-map gate is skipped entirely for
// them), exactly the same "seed a genuine smaller set, grow the rest via the admin CMS" approach
// used for the Learning Module's lesson content and the Interview Prep question bank.
// Idempotent and non-destructive to admin edits: the ModuleCodingTest config upserts with
// `update: {}`, and its question pool is only ever created once (skipped if any question already
// exists for that test), so admin edits/additions survive a redeploy untouched.
//
// Every question here is authored LeetCode-style (FUNCTION mode) — the student writes only a
// method body matching functionSignature (from functionSignatures.js, the single source of truth
// also used by migrateCodingToFunctionMode.js to update an already-seeded production database).
// resolveCodingFields() generates the real starterCodeByLanguage from that signature, exactly the
// same call every admin CRUD route makes — never hand-authored here.

const { resolveCodingFields } = require("../src/utils/functionHarness");
const { MODULE_CODING_SIGNATURES } = require("./functionSignatures");

const MODULE_TESTS = {
  "Introduction to Java": {
    title: "Module 1 Coding Assessment",
    instructions: "Solve every question by implementing the given method — no need to read input or print output yourself.",
    questionCount: 3,
    timeLimitMin: 30,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Sum of Two Integers",
        description: "Return the sum of two integers.",
        difficulty: "EASY",
        // 2 visible + 10 hidden, matching the platform-wide minimum enforced on every other
        // question-creation surface — this module's original 1-visible/2-hidden data predated that
        // standard and let a student pass with only 2 hidden cases actually checked.
        visibleCount: 2,
        testCases: [
          { input: "3\n5", expected: "8" },
          { input: "-2\n7", expected: "5" },
          { input: "0\n0", expected: "0" },
          { input: "10\n20", expected: "30" },
          { input: "-10\n-20", expected: "-30" },
          { input: "100\n-100", expected: "0" },
          { input: "1\n-1", expected: "0" },
          { input: "999999\n1", expected: "1000000" },
          { input: "-999999\n-1", expected: "-1000000" },
          { input: "7\n7", expected: "14" },
          { input: "0\n-5", expected: "-5" },
          { input: "123456\n654321", expected: "777777" },
        ],
      },
      {
        title: "Even or Odd",
        description: 'Return "Even" if the given integer is even, or "Odd" if it is odd.',
        difficulty: "EASY",
        visibleCount: 2,
        testCases: [
          { input: "4", expected: "Even" },
          { input: "7", expected: "Odd" },
          { input: "0", expected: "Even" },
          { input: "-3", expected: "Odd" },
          { input: "-8", expected: "Even" },
          { input: "1", expected: "Odd" },
          { input: "100", expected: "Even" },
          { input: "101", expected: "Odd" },
          { input: "-1", expected: "Odd" },
          { input: "2", expected: "Even" },
          { input: "999999", expected: "Odd" },
          { input: "1000000", expected: "Even" },
        ],
      },
      {
        title: "String Length",
        description: "Return the number of characters in the given string.",
        difficulty: "EASY",
        visibleCount: 2,
        testCases: [
          { input: "hello", expected: "5" },
          { input: "Java", expected: "4" },
          { input: "a", expected: "1" },
          { input: "OpenAI", expected: "6" },
          { input: "Sanjivani", expected: "9" },
          { input: "test", expected: "4" },
          { input: "CodeArena", expected: "9" },
          { input: "x", expected: "1" },
          { input: "HelloWorld", expected: "10" },
          { input: "abcdefghij", expected: "10" },
          { input: "Programming", expected: "11" },
          { input: "Q", expected: "1" },
        ],
      },
      {
        title: "Largest of Three",
        description: "Return the largest of three given integers.",
        difficulty: "EASY",
        visibleCount: 2,
        testCases: [
          { input: "3\n9\n5", expected: "9" },
          { input: "1\n1\n1", expected: "1" },
          { input: "-4\n-1\n-9", expected: "-1" },
          { input: "10\n20\n30", expected: "30" },
          { input: "30\n20\n10", expected: "30" },
          { input: "0\n0\n0", expected: "0" },
          { input: "-5\n-10\n-1", expected: "-1" },
          { input: "100\n99\n98", expected: "100" },
          { input: "-100\n-99\n-98", expected: "-98" },
          { input: "5\n5\n10", expected: "10" },
          { input: "7\n3\n7", expected: "7" },
          { input: "-1\n0\n1", expected: "1" },
        ],
      },
    ],
  },
  "Java Basics": {
    title: "Module 2 Coding Assessment",
    instructions: "Solve every question by implementing the given method, applying the variables/operators/type-casting concepts from this module.",
    questionCount: 3,
    timeLimitMin: 35,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Truncating Cast",
        description: "Return the given decimal number cast to an int (truncated toward zero, no rounding).",
        difficulty: "EASY",
        testCases: [
          { input: "9.7", expected: "9" },
          { input: "3.2", expected: "3" },
          { input: "-2.8", expected: "-2" },
        ],
      },
      {
        title: "Sum 1 to N",
        description: "Return the sum of all integers from 1 to N (inclusive).",
        difficulty: "EASY",
        testCases: [
          { input: "5", expected: "15" },
          { input: "1", expected: "1" },
          { input: "10", expected: "55" },
        ],
      },
      {
        title: "Integer Division",
        description: "Return the result of integer division a / b (truncated).",
        difficulty: "EASY",
        testCases: [
          { input: "7\n2", expected: "3" },
          { input: "10\n3", expected: "3" },
          { input: "9\n3", expected: "3" },
        ],
      },
      {
        title: "Character to ASCII",
        description: "Return the ASCII (integer) value of the given single-character string.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "A", expected: "65" },
          { input: "a", expected: "97" },
          { input: "0", expected: "48" },
        ],
      },
    ],
  },
  "Control Statements": {
    title: "Module 3 Coding Assessment",
    instructions: "Solve every question by implementing the given method, applying the if/else, switch, and loop concepts from this module.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Leap Year Checker",
        description: "Return true if the given year is a leap year (divisible by 4, but not by 100 unless also divisible by 400).",
        difficulty: "EASY",
        testCases: [
          { input: "2000", expected: "true" },
          { input: "1900", expected: "false" },
          { input: "2024", expected: "true" },
        ],
      },
      {
        title: "Day Number to Name",
        description: "Given a day number from 1 (Monday) to 7 (Sunday), return the day's name using a switch statement.",
        difficulty: "EASY",
        testCases: [
          { input: "1", expected: "Monday" },
          { input: "7", expected: "Sunday" },
          { input: "4", expected: "Thursday" },
        ],
      },
      {
        title: "FizzBuzz",
        description: "Return the numbers from 1 to N, space-separated, replacing multiples of 3 with \"Fizz\", multiples of 5 with \"Buzz\", and multiples of both with \"FizzBuzz\".",
        difficulty: "MEDIUM",
        testCases: [
          { input: "5", expected: "1 2 Fizz 4 Buzz" },
          { input: "15", expected: "1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz" },
          { input: "3", expected: "1 2 Fizz" },
        ],
      },
      {
        title: "Prime Check",
        description: "Return true if the given integer is a prime number, false otherwise.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "2", expected: "true" },
          { input: "4", expected: "false" },
          { input: "17", expected: "true" },
        ],
      },
    ],
  },
  "Methods": {
    title: "Module 4 Coding Assessment",
    instructions: "Solve every question by implementing the given method, applying the parameters/return-types/recursion concepts from this module.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Sum of Digits (Recursive)",
        description: "Return the sum of the digits of the given non-negative integer, computed using recursion.",
        difficulty: "EASY",
        testCases: [
          { input: "123", expected: "6" },
          { input: "9", expected: "9" },
          { input: "1000", expected: "1" },
        ],
      },
      {
        title: "Power of a Number",
        description: "Return base raised to the power exp (exp is a non-negative integer).",
        difficulty: "EASY",
        testCases: [
          { input: "2\n10", expected: "1024" },
          { input: "3\n0", expected: "1" },
          { input: "5\n3", expected: "125" },
        ],
      },
      {
        title: "Palindrome Number Check",
        description: "Return true if the given integer reads the same forwards and backwards. Negative numbers are never palindromes.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "121", expected: "true" },
          { input: "123", expected: "false" },
          { input: "-121", expected: "false" },
        ],
      },
      {
        title: "Sum of Array (Recursive)",
        description: "Return the sum of all elements in the given array, computed using recursion.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "1 2 3 4 5", expected: "15" },
          { input: "0", expected: "0" },
          { input: "10", expected: "10" },
        ],
      },
    ],
  },
  "Arrays": {
    title: "Module 5 Coding Assessment",
    instructions: "Solve every question by implementing the given method, applying the array traversal, searching, and aggregation concepts from this module.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Sum of Array Elements",
        description: "Return the sum of all elements in the given array.",
        difficulty: "EASY",
        testCases: [
          { input: "1 2 3 4 5", expected: "15" },
          { input: "0", expected: "0" },
          { input: "-1 -2 -3", expected: "-6" },
        ],
      },
      {
        title: "Find Maximum in Array",
        description: "Return the largest value in the given array.",
        difficulty: "EASY",
        testCases: [
          { input: "3 9 5 1", expected: "9" },
          { input: "-5 -1 -9", expected: "-1" },
          { input: "7", expected: "7" },
        ],
      },
      {
        title: "Binary Search",
        description: "Given a SORTED array and a target value, return the 0-based index of the target using binary search, or -1 if it isn't present.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "2 5 8 12 16 23 38\n23", expected: "5" },
          { input: "1 3 5 7 9\n4", expected: "-1" },
          { input: "10 20 30\n10", expected: "0" },
        ],
      },
      {
        title: "Count Even Numbers",
        description: "Return the count of even numbers in the given array.",
        difficulty: "EASY",
        testCases: [
          { input: "1 2 3 4 5 6", expected: "3" },
          { input: "1 3 5", expected: "0" },
          { input: "2 4 6 8", expected: "4" },
        ],
      },
    ],
  },
  "Strings": {
    title: "Module 6 Coding Assessment",
    instructions: "Solve every question by implementing the given method, applying the String/StringBuilder concepts from this module.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Reverse a String",
        description: "Return the given string reversed.",
        difficulty: "EASY",
        testCases: [
          { input: "hello", expected: "olleh" },
          { input: "Java", expected: "avaJ" },
          { input: "a", expected: "a" },
        ],
      },
      {
        title: "Count Character Occurrences",
        description: "Return how many times the single-character string c appears in the string s.",
        difficulty: "EASY",
        testCases: [
          { input: "banana\na", expected: "3" },
          { input: "mississippi\ns", expected: "4" },
          { input: "hello\nz", expected: "0" },
        ],
      },
      {
        title: "Check Anagram",
        description: "Return true if strings a and b are anagrams of each other (same characters, same counts, order doesn't matter), false otherwise.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "listen\nsilent", expected: "true" },
          { input: "hello\nworld", expected: "false" },
          { input: "abc\ncab", expected: "true" },
        ],
      },
      {
        title: "Title Case a Sentence",
        description: "Return the given sentence with the first letter of each word capitalized and every other letter lowercased.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "hello world", expected: "Hello World" },
          { input: "JAVA programming", expected: "Java Programming" },
          { input: "a", expected: "A" },
        ],
      },
    ],
  },
  "Object-Oriented Programming (OOP)": {
    title: "Module 7 Coding Assessment",
    instructions: "Solve every question by implementing the given method — these are real-world word problems in the spirit of this module's class-design examples.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Simple Interest Calculator",
        description: "Given a principal amount, an annual interest rate (as a whole-number percent), and a duration in years, return the simple interest earned (principal * rate * years / 100).",
        difficulty: "EASY",
        testCases: [
          { input: "1000\n5\n2", expected: "100" },
          { input: "5000\n10\n3", expected: "1500" },
          { input: "200\n2\n1", expected: "4" },
        ],
      },
      {
        title: "Employee Bonus Eligibility",
        description: "An employee is eligible for a bonus if they have at least 2 years of service AND a performance rating of at least 3. Return whether the given employee is eligible.",
        difficulty: "EASY",
        testCases: [
          { input: "3\n4", expected: "true" },
          { input: "1\n5", expected: "false" },
          { input: "5\n2", expected: "false" },
        ],
      },
      {
        title: "Compare Circle Areas",
        description: "Given the radii of two circles, return true if the first circle's area is strictly greater than the second's, false otherwise.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "5\n3", expected: "true" },
          { input: "2\n2", expected: "false" },
          { input: "1\n10", expected: "false" },
        ],
      },
      {
        title: "Price After Discount",
        description: "Given a price and a discount percentage, return the price after applying the discount, floored to the nearest whole number.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "100\n20", expected: "80" },
          { input: "250\n10", expected: "225" },
          { input: "99.99\n50", expected: "49" },
        ],
      },
    ],
  },
  "Exception Handling": {
    title: "Module 8 Coding Assessment",
    instructions: "Solve every question by implementing the given method, handling invalid input gracefully (internally, with try/catch) instead of letting the program crash.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Validate Age",
        description: "Return \"Valid\" if the given age is between 0 and 150 inclusive, or \"Invalid\" otherwise.",
        difficulty: "EASY",
        testCases: [
          { input: "25", expected: "Valid" },
          { input: "-5", expected: "Invalid" },
          { input: "200", expected: "Invalid" },
        ],
      },
      {
        title: "Safe Parse Integer",
        description: "Return the string parsed as an integer, or -1 if it cannot be parsed as a valid integer.",
        difficulty: "EASY",
        testCases: [
          { input: "123", expected: "123" },
          { input: "abc", expected: "-1" },
          { input: "-45", expected: "-45" },
        ],
      },
      {
        title: "Safe Square Root",
        description: "Return the floor of the square root of the given integer, or -1 if the integer is negative (instead of producing NaN).",
        difficulty: "MEDIUM",
        testCases: [
          { input: "16", expected: "4" },
          { input: "-9", expected: "-1" },
          { input: "2", expected: "1" },
        ],
      },
      {
        title: "Bank Withdrawal Validator",
        description: "Given an account balance and a withdrawal amount, return \"Approved\" if the amount is positive and does not exceed the balance, or \"Denied\" otherwise.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "500\n200", expected: "Approved" },
          { input: "100\n150", expected: "Denied" },
          { input: "300\n-50", expected: "Denied" },
        ],
      },
    ],
  },
  "Collections Framework": {
    title: "Module 9 Coding Assessment",
    instructions: "Solve every question by implementing the given method, applying the List/Map/Set/Queue/Stack thinking from this module (arrays and strings stand in for the collection types, since the judge tests one static method at a time).",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "First Unique Element",
        description: "Return the first element in the array that appears exactly once (in a map/frequency-count sense), or -1 if every element repeats.",
        difficulty: "EASY",
        testCases: [
          { input: "2 3 2 4 3", expected: "4" },
          { input: "1 1 2 2 3 3", expected: "-1" },
          { input: "5", expected: "5" },
        ],
      },
      {
        title: "Balanced Parentheses",
        description: "Return true if the given string of only '(' and ')' characters is balanced (every opening bracket has a matching closing bracket in the correct order), false otherwise. An empty string is balanced.",
        difficulty: "EASY",
        testCases: [
          { input: "(())", expected: "true" },
          { input: "(()", expected: "false" },
          { input: "", expected: "true" },
        ],
      },
      {
        title: "Front After K Dequeues",
        description: "Given an array representing a queue (front to back) and a number of dequeue operations K, return the element that would be at the front after K dequeues, or -1 if K is greater than or equal to the array's length.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "10 20 30 40\n2", expected: "30" },
          { input: "5 6\n0", expected: "5" },
          { input: "1 2 3\n5", expected: "-1" },
        ],
      },
      {
        title: "Merge Two Sorted Arrays",
        description: "Given two arrays that are each already sorted in ascending order, return a single merged array in ascending order.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "1 3 5\n2 4 6", expected: "1 2 3 4 5 6" },
          { input: "1 5 9\n2 3", expected: "1 2 3 5 9" },
          { input: "4 5\n1 2 3", expected: "1 2 3 4 5" },
        ],
      },
    ],
  },
  "File Handling": {
    title: "Module 10 Coding Assessment",
    instructions: "Solve every question by implementing the given method — these model the kind of word/line processing you'd do on text read from a file, since the judge tests a single static method rather than real file I/O.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Count Long Words",
        description: "Given an array of words, return the count of words with more than 3 characters.",
        difficulty: "EASY",
        testCases: [
          { input: "cat elephant dog giraffe", expected: "2" },
          { input: "a bb ccc", expected: "0" },
          { input: "hello", expected: "1" },
        ],
      },
      {
        title: "Find Longest Word",
        description: "Given an array of words, return the longest one (there is a unique longest word).",
        difficulty: "EASY",
        testCases: [
          { input: "cat elephant dog", expected: "elephant" },
          { input: "a bb ccc", expected: "ccc" },
          { input: "single", expected: "single" },
        ],
      },
      {
        title: "Total Word Length",
        description: "Given an array of words, return the sum of the lengths of all the words.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "cat dog bird", expected: "10" },
          { input: "a bb ccc", expected: "6" },
          { input: "hello", expected: "5" },
        ],
      },
      {
        title: "Count Capitalized Words",
        description: "Given a string of space-separated words, return the count of words that start with an uppercase letter.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "Hello world Java Programming", expected: "3" },
          { input: "hello world", expected: "0" },
          { input: "A B C", expected: "3" },
        ],
      },
    ],
  },
  "Multithreading": {
    title: "Module 11 Coding Assessment",
    instructions: "Solve every question by implementing the given method — since the judge grades one deterministic method call rather than real concurrent execution, these model thread-scheduling and synchronization outcomes as plain computations.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Last Thread to Finish",
        description: "Given each thread's completion time (index = thread ID, unique maximum), return the ID (index) of the thread that finishes last.",
        difficulty: "EASY",
        testCases: [
          { input: "300 150 450 200", expected: "2" },
          { input: "100 500 300", expected: "1" },
          { input: "50", expected: "0" },
        ],
      },
      {
        title: "Total Sequential Execution Time",
        description: "Given the durations of several tasks, return the total time to run them one after another (sequentially, not in parallel).",
        difficulty: "EASY",
        testCases: [
          { input: "100 200 300", expected: "600" },
          { input: "50", expected: "50" },
          { input: "10 20", expected: "30" },
        ],
      },
      {
        title: "Lost Update Count",
        description: "Given the total number of increments performed by all threads and the actual final counter value observed (due to missing synchronization), return how many updates were lost.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "100\n95", expected: "5" },
          { input: "50\n50", expected: "0" },
          { input: "10\n3", expected: "7" },
        ],
      },
      {
        title: "Last Worker Task Count",
        description: "Given a total number of tasks distributed round-robin (task i assigned to worker i % workers) across a fixed number of worker threads, return how many tasks the last worker (highest index) processes.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "10\n3", expected: "3" },
          { input: "7\n2", expected: "3" },
          { input: "5\n5", expected: "1" },
        ],
      },
    ],
  },
  "Java 8 Features": {
    title: "Module 12 Coding Assessment",
    instructions: "Solve every question by implementing the given method — these mirror the kind of filter/map/reduce/Optional pipelines you'd write with the Stream API, expressed as plain methods since the judge grades a single static method's return value.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "First Match or Default",
        description: "Given an array and a target, return the first value strictly greater than the target, or -1 if none exists.",
        difficulty: "EASY",
        testCases: [
          { input: "3 7 2 9\n5", expected: "7" },
          { input: "1 2 3\n10", expected: "-1" },
          { input: "10 20\n5", expected: "10" },
        ],
      },
      {
        title: "Uppercase All Words",
        description: "Given an array of words, return them uppercased and joined by a single space.",
        difficulty: "EASY",
        testCases: [
          { input: "cat dog", expected: "CAT DOG" },
          { input: "hello", expected: "HELLO" },
          { input: "a b c", expected: "A B C" },
        ],
      },
      {
        title: "Count Positive Numbers",
        description: "Return the count of strictly positive numbers in the given array.",
        difficulty: "EASY",
        testCases: [
          { input: "1 -2 3 -4 5", expected: "3" },
          { input: "-1 -2", expected: "0" },
          { input: "5", expected: "1" },
        ],
      },
      {
        title: "Product of All Elements",
        description: "Return the product of every element in the given array.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "1 2 3 4", expected: "24" },
          { input: "5", expected: "5" },
          { input: "2 2 2", expected: "8" },
        ],
      },
    ],
  },
  "JDBC": {
    title: "Module 13 Coding Assessment",
    instructions: "Solve every question by implementing the given method — these model the outcome of SQL/JDBC operations (WHERE filters, aggregates, constraint checks, parameterized clauses) as plain computations, since the judge has no real database to connect to.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Simulate Row Count After WHERE Filter",
        description: "Given an array of scores and a passing score, return the count of scores greater than or equal to the passing score (as if counting rows matching a WHERE score >= ? clause).",
        difficulty: "EASY",
        testCases: [
          { input: "60 75 40 90\n50", expected: "3" },
          { input: "30 20\n50", expected: "0" },
          { input: "100\n50", expected: "1" },
        ],
      },
      {
        title: "Simulate SUM Aggregate Query",
        description: "Given an array of transaction amounts, return their total (as if computing SELECT SUM(amount) FROM transactions).",
        difficulty: "EASY",
        testCases: [
          { input: "100 200 300", expected: "600" },
          { input: "50", expected: "50" },
          { input: "10 20 30", expected: "60" },
        ],
      },
      {
        title: "Simulate Duplicate Primary Key Detection",
        description: "Given an array of IDs about to be inserted, return true if any ID is duplicated (which would violate a PRIMARY KEY/UNIQUE constraint), or false if all are unique.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "1 2 3 2", expected: "true" },
          { input: "1 2 3", expected: "false" },
          { input: "5", expected: "false" },
        ],
      },
      {
        title: "Simulate SET Clause Builder",
        description: "Given an array of column names, return a parameterized SQL SET clause joining them as \"col1 = ?, col2 = ?, ...\" in order.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "name age", expected: "name = ?, age = ?" },
          { input: "id", expected: "id = ?" },
          { input: "x y z", expected: "x = ?, y = ?, z = ?" },
        ],
      },
    ],
  },
  "Advanced Java": {
    title: "Module 14 Coding Assessment",
    instructions: "Solve every question by implementing the given method — these model outcomes from generics, reflection, serialization, and annotations as plain computations, since the judge can't exercise those APIs directly.",
    questionCount: 4,
    timeLimitMin: 40,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Count Type Mismatches",
        description: "Given an array of type tags stored in a raw (non-generic) container and the expected type tag, return how many entries do NOT match the expected type (what a generic container would have prevented at compile time).",
        difficulty: "EASY",
        testCases: [
          { input: "1 1 2 1\n1", expected: "1" },
          { input: "2 2 2\n2", expected: "0" },
          { input: "1\n2", expected: "1" },
        ],
      },
      {
        title: "Total Serialized Size",
        description: "Given an array of object sizes and a fixed per-object serialization overhead, return the total serialized size (sum of sizes plus overhead times the object count).",
        difficulty: "EASY",
        testCases: [
          { input: "10 20 30\n5", expected: "75" },
          { input: "100\n10", expected: "110" },
          { input: "1 1 1 1\n2", expected: "12" },
        ],
      },
      {
        title: "Count Reflective Method Matches",
        description: "Given an array of method name lengths (as if discovered via reflection) and a target length, return how many methods have that exact name length.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "5 3 5 7\n5", expected: "2" },
          { input: "3 3 3\n3", expected: "3" },
          { input: "10\n5", expected: "0" },
        ],
      },
      {
        title: "Simulate Deprecated API Usage Count",
        description: "Given an array of booleans, one per method call, indicating whether the called method is annotated @Deprecated, return the count of deprecated calls.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "true false true false true", expected: "3" },
          { input: "false false", expected: "0" },
          { input: "true", expected: "1" },
        ],
      },
    ],
  },
  "Data Structures & Algorithms in Java": {
    title: "Module 15 Coding Assessment",
    instructions: "Solve every question by implementing the given method — classic data-structure and algorithm problems, using arrays to represent linked lists, trees, and graphs since the judge tests a single static method.",
    questionCount: 4,
    timeLimitMin: 45,
    passingPercent: 70,
    maxAttempts: 3,
    cooldownMinutes: 10,
    questions: [
      {
        title: "Reverse a Linked List (Array Simulation)",
        description: "Given an array representing a linked list's values in order, return them reversed.",
        difficulty: "EASY",
        testCases: [
          { input: "1 2 3 4", expected: "4 3 2 1" },
          { input: "5", expected: "5" },
          { input: "1 2", expected: "2 1" },
        ],
      },
      {
        title: "Valid Degree Sum (Graph)",
        description: "Given the degree of each node in an undirected graph, return true if the sum of all degrees is even (a necessary property of any valid simple graph, per the handshake lemma), false otherwise.",
        difficulty: "EASY",
        testCases: [
          { input: "2 2 2", expected: "true" },
          { input: "1 1 1", expected: "false" },
          { input: "3 3", expected: "true" },
        ],
      },
      {
        title: "Valid BST In-order Sequence",
        description: "Given an array of values as if produced by an in-order traversal of a binary tree, return true if the sequence is strictly ascending (confirming it's a valid Binary Search Tree in-order sequence), false otherwise.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "1 3 5 8", expected: "true" },
          { input: "5 3 8", expected: "false" },
          { input: "7", expected: "true" },
        ],
      },
      {
        title: "Count Inversions",
        description: "Given an array, return the number of inversions — pairs of indices (i, j) where i < j but the value at i is greater than the value at j.",
        difficulty: "MEDIUM",
        testCases: [
          { input: "2 4 1 3 5", expected: "3" },
          { input: "1 2 3", expected: "0" },
          { input: "3 2 1", expected: "3" },
        ],
      },
    ],
  },
};

async function seedModuleCoding(prisma) {
  const course = await prisma.course.findUnique({ where: { slug: "java" } });
  if (!course) return;

  let seededCount = 0;
  for (const [moduleTitle, spec] of Object.entries(MODULE_TESTS)) {
    const mod = await prisma.courseModule.findUnique({
      where: { courseId_title: { courseId: course.id, title: moduleTitle } },
    });
    if (!mod) continue;

    const test = await prisma.moduleCodingTest.upsert({
      where: { moduleId: mod.id },
      update: {},
      create: {
        moduleId: mod.id,
        title: spec.title,
        instructions: spec.instructions,
        questionCount: spec.questionCount,
        timeLimitMin: spec.timeLimitMin,
        passingPercent: spec.passingPercent,
        maxAttempts: spec.maxAttempts,
        cooldownMinutes: spec.cooldownMinutes,
      },
    });

    const existingCount = await prisma.question.count({ where: { moduleCodingTestId: test.id } });
    if (existingCount === 0) {
      for (const q of spec.questions) {
        const resolved = resolveCodingFields({ evaluationType: "FUNCTION", functionSignature: MODULE_CODING_SIGNATURES[q.title] });
        await prisma.question.create({
          data: {
            moduleCodingTestId: test.id,
            title: q.title,
            description: q.description,
            difficulty: q.difficulty || "EASY",
            questionType: "CODING",
            timeLimitMs: 3000,
            evaluationType: resolved.evaluationType,
            functionSignature: resolved.functionSignature,
            starterCodeByLanguage: resolved.starterCodeByLanguage,
            // Defaults to 1 visible case (the original convention for every question that hasn't
            // been backfilled to the 2-visible/10-hidden platform standard yet — see visibleCount
            // on Module 1's questions above for the backfilled shape).
            testCases: {
              create: q.testCases.map((tc, i) => ({ input: tc.input, expected: tc.expected, isHidden: i >= (q.visibleCount ?? 1) })),
            },
          },
        });
      }
      seededCount += spec.questions.length;
    }
  }

  console.log("Seeded module coding tests:", seededCount, "new questions across", Object.keys(MODULE_TESTS).length, "modules.");
}

module.exports = { seedModuleCoding, MODULE_TESTS };
