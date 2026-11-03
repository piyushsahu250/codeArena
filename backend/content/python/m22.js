// Phase 7 / Module 22: Python Technical Interview Questions. Lessons live in m22a.js onward; this file adds the chapters and the module assessment.
"use strict";
const { task } = require("./lib");

const parts = [
  { title: "Core Language", description: "Output-prediction questions on types, functions, collections and iterators.", files: ["./m22a"] },
  { title: "Objects, Errors and Decorators", description: "Classes, exceptions, context managers, decorators and functional tools.", files: ["./m22b"] },
  { title: "Internals, Concurrency and the Standard Library", description: "Memory and identity, threads, processes and asyncio, standard-library idioms.", files: ["./m22c"] },
];
const chapters = parts.map((part) => ({ title: part.title, description: part.description, lessons: part.files.flatMap((f) => require(f).lessons) }));

module.exports = {
  module: {
    title: "Phase 7 - Module 22: Python Technical Interview Questions",
    description: "More than 150 technical interview questions, each a short program whose output you predict: with the explanation, the common misconceptions behind the wrong answers and a follow-up question. Every program is executed by the course's quality gate, so the answers are what Python really prints.",
    minQuestions: 150,
    chapters,
    assessment: {
      title: "Module 22 Assessment: Technical Interview Questions",
      description: "Four problems that model interview topics.",
      questions: [
        task("Truthiness Report", "Read a line of tokens. For each token print the token and then true or false according to Python truthiness of the value it names: the words None, 0, 0.0, empty (an empty string), [] and {} are falsy; every other token is truthy. One line per token.", "", `falsy = {"None", "0", "0.0", "empty", "[]", "{}"}
for token in input().split():
    print(token, "false" if token in falsy else "true")`, [["0 1 [] [0] None", "0 false\n1 true\n[] false\n[0] true\nNone false"], ["empty x", "empty false\nx true"], ["0.0 0.1", "0.0 false\n0.1 true"], ["{} {1}", "{} false\n{1} true"]]),
        task("Evaluate Chained Comparison", "Read a line with an odd number of tokens: numbers separated by the comparison operators < <= > >= == != (for example 1 < 2 <= 2). Print True if the whole chain holds, meaning every neighbouring comparison is true, otherwise False.", "", `import operator

ops = {"<": operator.lt, "<=": operator.le, ">": operator.gt, ">=": operator.ge, "==": operator.eq, "!=": operator.ne}
tokens = input().split()
numbers = [float(t) for t in tokens[0::2]]
symbols = tokens[1::2]
print(all(ops[s](numbers[i], numbers[i + 1]) for i, s in enumerate(symbols)))`, [["1 < 2 <= 2", "True"], ["3 > 2 > 2", "False"], ["5 == 5.0 != 6", "True"], ["1 < 3 > 2 > 4", "False"]]),
        task("Flatten and Count Types", "Read a nested list written as JSON, for example [1,[2,\"a\"],[[3.5]]]. Print the number of integers, floats and strings found anywhere inside it as ints=A floats=B strings=C (booleans count as none of these; JSON true and false are bools).", "", `import json


def walk(x):
    if isinstance(x, list):
        for item in x:
            yield from walk(item)
    else:
        yield x


counts = {"ints": 0, "floats": 0, "strings": 0}
for v in walk(json.loads(input())):
    if isinstance(v, bool):
        continue
    if isinstance(v, int):
        counts["ints"] += 1
    elif isinstance(v, float):
        counts["floats"] += 1
    elif isinstance(v, str):
        counts["strings"] += 1
print(f"ints={counts['ints']} floats={counts['floats']} strings={counts['strings']}")`, [['[1,[2,"a"],[[3.5]]]', "ints=2 floats=1 strings=1"], ["[]", "ints=0 floats=0 strings=0"], ['[true,[false,1],"x","y"]', "ints=1 floats=0 strings=2"], ["[[[1.5,2.5]],3]", "ints=1 floats=2 strings=0"]]),
        task("Decorator Call Log", "Read n and then n lines of integers to call a function double(x) = 2 * x through a logging decorator. For each call print call double(x) -> result in the format shown in the sample. After all calls print calls=N.", "", `def logged(f):
    def wrapper(x):
        result = f(x)
        print(f"call {f.__name__}({x}) -> {result}")
        wrapper.count += 1
        return result
    wrapper.count = 0
    return wrapper


@logged
def double(x):
    return 2 * x


n = int(input())
for _ in range(n):
    double(int(input()))
print(f"calls={double.count}")`, [["2\n3\n-4", "call double(3) -> 6\ncall double(-4) -> -8\ncalls=2"], ["1\n0", "call double(0) -> 0\ncalls=1"], ["0", "calls=0"], ["3\n1\n1\n1", "call double(1) -> 2\ncall double(1) -> 2\ncall double(1) -> 2\ncalls=3"]]),
      ],
    },
  },
};
