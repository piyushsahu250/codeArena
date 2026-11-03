// Phase 6: Real-World Projects. 15 mini projects and 6 major projects, each with the 19-part guide, complete tested source code
// (except the build-from-scratch projects, which publish milestones and acceptance tests only) and project tasks.
"use strict";

const miniFiles = ["./pa", "./pb", "./pc"];
const majorFiles = ["./pd", "./pe"];
const mini = miniFiles.flatMap((f) => require(f).lessons);
const major = majorFiles.flatMap((f) => require(f).lessons);
for (const L of [...mini, ...major]) L.project.title = L.project.title || L.title.replace(/^(Mini|Major) Project \d+:\s*/, "");
const chapters = [
  { title: "Mini Projects", description: "Fifteen small, complete programs that combine what you learned in Phases 1 to 4.", lessons: mini },
  { title: "Major Projects", description: "Six larger projects with databases, security, an API and data analysis. Two of the 21 projects are build-from-scratch challenges.", lessons: major },
];

module.exports = {
  module: {
    title: "Phase 6 - Real-World Projects",
    description: "Fifteen mini projects and six major projects. Each project has a problem statement, scenario, objectives, prerequisites, requirements, architecture and flowchart diagrams, a database schema where it applies, step-by-step implementation, complete tested source code, an explanation of every component, sample input and output, testing instructions, common bugs, extension challenges, GitHub and README preparation, interview questions and an evaluation rubric. Two projects are build-from-scratch challenges with no published solution.",
    minMini: 15,
    minMajor: 6,
    minScratch: 2,
    chapters,
    assessment: null,
  },
};
