// Phase 3 / Module 15: Core Data Structures. Assembled from chapter files, one chapter per theme.
"use strict";
const chapters = [require("./m15a"), require("./m15b"), require("./m15c")];
module.exports = {
  module: {
    title: "Phase 3 - Module 15: Core Data Structures",
    description: "Arrays and strings, two pointers, sliding window, hashing, stacks, queues, linked lists, trees, heaps, graphs, recursion and backtracking, dynamic programming and greedy algorithms, with coding patterns and interview problems for every topic.",
    chapters: chapters.map((c) => ({ title: c.title, description: c.description, lessons: c.lessons })),
    assessment: {
      title: "Module 15 Assessment: Core Data Structures",
      description: "Mixed data-structure problems.",
      questions: [],
    },
  },
};
