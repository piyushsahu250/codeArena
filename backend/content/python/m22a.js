// Phase 7 / Module 22, lessons 1-4: Python technical interview questions on data types, functions and scope, collections, and iterators and generators.
// Every question is a short program whose output (or exception) is executed by the validator; the wrong answers match common misconceptions.
"use strict";
const { mcq, task, iq, qaQuiz } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 1
{
  const items = [
    iq("E", `What does this print?`, `print(0.1 + 0.2 == 0.3)`, `False`, [`True`, `0.3`, `Raises ValueError`],
      `Floats are stored in binary, and 0.1, 0.2 and 0.3 have no exact binary form, so 0.1 + 0.2 is 0.30000000000000004, not 0.3.`,
      `Python adds decimals exactly like paper arithmetic; the error is a Python bug.`,
      [`How should you compare floats?`, `Use math.isclose(a, b) or a tolerance, and use decimal.Decimal for money.`]),
    iq("E", `What does this print?`, `print(7 // 2, -7 // 2, 7 % 3, -7 % 3)`, `3 -4 1 2`, [`3 -3 1 -1`, `3 -4 1 -1`, `3 -3 1 2`],
      `// is floor division, so -7 // 2 rounds down to -4, and % always takes the sign of the divisor, so -7 % 3 is 2. They satisfy a == (a // b) * b + a % b.`,
      `Floor division truncates toward zero, and the remainder is negative when the dividend is negative.`,
      [`Which function truncates toward zero?`, `int(a / b) truncates toward zero; math.trunc does too.`]),
    iq("E", `What does this print?`, `print(type(5 / 2), 5 / 2)`, `<class 'float'> 2.5`, [`<class 'int'> 2`, `<class 'int'> 2.5`, `<class 'float'> 2`],
      `True division with / always returns a float in Python 3, even when both operands are integers.`,
      `Dividing two integers gives an integer, as in C or Java.`,
      [`How do you get an integer quotient?`, `Use // (floor division) or divmod.`]),
    iq("E", `What does this print?`, `print(bool([]), bool([0]), bool(""), bool(" "))`, `False True False True`, [`False False False False`, `True True False True`, `False True False False`],
      `Empty containers and empty strings are falsy; any non-empty container is truthy, whatever it holds, and a string with a space is not empty.`,
      `A list containing 0 is falsy, or a string of spaces is empty.`,
      [`What is the idiomatic test for an empty list?`, `if not items: (not len(items) == 0).`]),
    iq("E", `What does this print?`, `print("5" + "5", "5" * 3)`, `55 555`, [`10 15`, `55 15`, `10 555`],
      `+ concatenates strings and * repeats them; neither converts the text to numbers.`,
      `Digits inside quotes are added numerically.`,
      [`How do you add the numbers in two numeric strings?`, `Convert first: int("5") + int("5") gives 10.`]),
    iq("E", `What happens when this runs?`, `print("5" + 5)`, `!TypeError`, [`10`, `55`, `Raises ValueError`],
      `Python does not silently convert between str and int, so mixing them in + raises TypeError.`,
      `Python converts the number to text like JavaScript does.`,
      [`Which exception does int("x") raise?`, `ValueError, because the type is right but the value is not.`]),
    iq("M", `What does this print?`, `a = [1, 2]\nb = a\nb.append(3)\nprint(a)`, `[1, 2, 3]`, [`[1, 2]`, `[3]`, `[1, 2, 3, 3]`],
      `Assignment binds another name to the same list; append changes that one shared object.`,
      `b = a copies the list.`,
      [`How do you make a shallow copy?`, `a.copy(), a[:] or list(a). Use copy.deepcopy for nested objects.`]),
    iq("M", `What does this print?`, `x = 10\ny = x\ny += 1\nprint(x, y)`, `10 11`, [`11 11`, `10 10`, `11 10`],
      `Integers are immutable: y += 1 rebinds y to a new integer and leaves x alone.`,
      `y and x are linked, so changing one changes the other.`,
      [`Which built-in types are immutable?`, `int, float, str, tuple, frozenset, bytes, bool and None.`]),
    iq("M", `What does this print?`, `print(1 < 2 < 3, 1 < 3 < 2)`, `True False`, [`True True`, `False False`, `False True`],
      `A chained comparison a < b < c means (a < b) and (b < c), with b evaluated once.`,
      `1 < 2 < 3 is computed as (1 < 2) < 3, comparing True with 3.`,
      [`What does 1 < 3 > 2 mean?`, `(1 < 3) and (3 > 2), which is True.`]),
    iq("M", `What does this print?`, `print(2 ** 3 ** 2)`, `512`, [`64`, `36`, `256`],
      `The power operator is right-associative: 2 ** (3 ** 2) = 2 ** 9 = 512.`,
      `Operators of the same precedence always evaluate left to right.`,
      [`Which other common operator is right-associative?`, `Assignment, and the conditional expression a if c else b nests to the right.`]),
    iq("M", `What does this print?`, `print(not 1 == 2, not (1 == 2) and 3 or 4)`, `True 3`, [`False 3`, `True 4`, `True True`],
      `not has lower precedence than ==, so not 1 == 2 is not (1 == 2). In the second expression True and 3 gives 3, and 3 or 4 keeps 3 because and/or return an operand, not a bool.`,
      `and/or always return True or False.`,
      [`What does 0 or "x" return?`, `"x": or returns the first truthy operand, and returns the first falsy one.`]),
    iq("M", `What does this print?`, `print(round(2.5), round(3.5), round(-2.5))`, `2 4 -2`, [`3 4 -3`, `2 3 -2`, `3 4 -2`],
      `round() uses banker's rounding: exact halves go to the nearest even number.`,
      `Halves always round up, as in school.`,
      [`How do you round half up?`, `Use decimal.Decimal with ROUND_HALF_UP, or floor(x + 0.5) for positive numbers.`]),
    iq("M", `What does this print?`, `print(int("42"), int(3.99), int(-3.99), float("1e3"))`, `42 3 -3 1000.0`, [`42 4 -4 1000.0`, `42 3 -3 1000`, `42 3 -4 1000.0`],
      `int() truncates toward zero and float("1e3") parses scientific notation into the float 1000.0.`,
      `int() rounds to the nearest integer, or floors negatives.`,
      [`What does int("3.5") do?`, `It raises ValueError; convert with int(float("3.5")).`]),
    iq("M", `What does this print?`, `print(1 == True, 0 == False, "1" == 1)`, `True True False`, [`False False False`, `True False False`, `True True True`],
      `bool is a subclass of int, so True equals 1 and False equals 0; a string never equals an integer.`,
      `True and False are a separate type that cannot equal numbers.`,
      [`What is isinstance(True, int)?`, `True, which is why sum([True, True]) is 2.`]),
    iq("H", `What does this print?`, `total = 0.0\nfor _ in range(10):\n    total += 0.1\nprint(total == 1.0, round(total, 10) == 1.0)`, `False True`, [`True True`, `False False`, `True False`],
      `Ten additions of 0.1 accumulate a tiny error (0.9999999999999999). Rounding to 10 places removes it.`,
      `The same value added ten times is exact.`,
      [`How could you sum floats more accurately?`, `math.fsum(values) tracks the lost low-order bits and returns the correctly rounded sum. Since Python 3.12 the built-in sum() also compensates for float error, so the exact result of sum([0.1] * 10) depends on the version; do not rely on it.`]),
    iq("H", `What does this print?`, `from decimal import Decimal\nprint(Decimal("0.1") + Decimal("0.2") == Decimal("0.3"), Decimal(0.1) == Decimal("0.1"))`, `True False`, [`True True`, `False False`, `False True`],
      `Decimal built from the string "0.1" is exactly one tenth; Decimal(0.1) captures the binary float's long expansion, which differs.`,
      `Decimal(0.1) and Decimal("0.1") are the same value.`,
      [`How should you construct Decimals?`, `From strings (or integers), never from floats, when exactness matters.`]),
  ];
  lessons.push({
    title: "Interview Questions: Data Types, Numbers and Operators",
    minutes: 60,
    learn: ["Predict the output of short programs about numbers, strings, truthiness and operators", "Explain floating-point behaviour, floor division, rounding and chained comparisons", "Tell mutable from immutable objects and names from values", "Answer the usual follow-up questions"],
    why: "Almost every Python interview starts with output-prediction questions on basics. They check whether you really know how the language works, not just how to write code that happens to run.",
    items,
    revision: ["Floats are binary: compare with isclose; money uses Decimal from strings.", "// floors, % follows the divisor's sign, / always gives a float.", "Empty containers are falsy; and/or return an operand.", "Assignment binds names; mutable objects are shared, immutable ones are rebound.", "Chained comparisons: a < b < c means a < b and b < c."],
    quiz: qaQuiz(items),
    tasks: [task("Exact Decimal Sum", "Read a line of decimal numbers written as text. Print their exact sum using decimal arithmetic (no floating-point error), written in plain notation with the same number of decimal places as the most precise input.", "from decimal import Decimal\nvalues = input().split()\n# add them exactly and print\n", `from decimal import Decimal

values = input().split()
print(format(sum(Decimal(v) for v in values), "f"))`, [["0.1 0.2", "0.3"], ["1.10 2.20 3.30", "6.60"], ["100 0.01", "100.01"], ["-1.5 1.5", "0.0"]])],
  });
}

// ---------------------------------------------------------------- 2
{
  const items = [
    iq("E", `What does this print?`, `def f(a, b=2):\n    return a + b\n\nprint(f(1), f(1, 5), f(b=1, a=1))`, `3 6 2`, [`3 6 3`, `1 5 1`, `Raises TypeError`],
      `Defaults fill missing arguments; keyword arguments can be given in any order.`,
      `A default value cannot be overridden or arguments must be given in order.`,
      [`Can a non-default parameter follow a default one?`, `No: def f(a=1, b) is a SyntaxError.`]),
    iq("E", `What does this print?`, `def f(*args, **kwargs):\n    return len(args), sorted(kwargs)\n\nprint(f(1, 2, x=3, y=4))`, `(2, ['x', 'y'])`, [`(4, [])`, `(2, [3, 4])`, `(2, {'x': 3, 'y': 4})`],
      `*args collects extra positional arguments into a tuple and **kwargs collects keyword arguments into a dict; sorted() of a dict gives its sorted keys.`,
      `**kwargs gives a list of values.`,
      [`What do * and ** do in a call?`, `They unpack a sequence or mapping into arguments: f(*[1, 2], **{"x": 3}).`]),
    iq("E", `What does this print?`, `def g():\n    pass\n\nprint(g())`, `None`, [`0`, `Raises TypeError`, `pass`],
      `A function without a return statement returns None.`,
      `A function with no return gives an empty string or 0.`,
      [`What does return with no value do?`, `It also returns None.`]),
    iq("E", `What does this print?`, `x = 5\n\ndef f():\n    x = 10\n\nf()\nprint(x)`, `5`, [`10`, `None`, `Raises UnboundLocalError`],
      `Assigning to x inside the function creates a new local variable; the global x is untouched.`,
      `Assigning a name inside a function updates the global of that name.`,
      [`How do you change the global x?`, `Declare global x inside the function (better: return the value).`]),
    iq("M", `What does this print?`, `def add(x, bucket=[]):\n    bucket.append(x)\n    return bucket\n\nprint(add(1), add(2))`, `[1, 2] [1, 2]`, [`[1] [2]`, `[1] [1, 2]`, `[1, 2] [2]`],
      `Default values are evaluated once, when the function is defined, so every call without the argument shares the same list. Both returned references show the final contents.`,
      `A new empty list is created on each call.`,
      [`What is the safe pattern?`, `Use bucket=None and create the list inside: if bucket is None: bucket = [].`]),
    iq("M", `What happens when this runs?`, `def f():\n    print(x)\n    x = 1\n\nx = 0\nf()`, `!UnboundLocalError`, [`0`, `1`, `Raises NameError`],
      `Because x is assigned somewhere in f, Python treats it as local for the whole function, so reading it before the assignment fails.`,
      `The function reads the global x until the assignment happens.`,
      [`Which class does UnboundLocalError inherit from?`, `NameError.`]),
    iq("M", `What does this print?`, `count = 0\n\ndef inc():\n    global count\n    count += 1\n\ninc()\ninc()\nprint(count)`, `2`, [`0`, `1`, `Raises UnboundLocalError`],
      `global tells Python that count refers to the module-level name, so += updates it.`,
      `Augmented assignment on a global always works without a declaration.`,
      [`Why avoid global state?`, `It makes functions hard to test and reason about; pass values in and return them.`]),
    iq("M", `What does this print?`, `def make():\n    n = 0\n    def step():\n        nonlocal n\n        n += 1\n        return n\n    return step\n\na, b = make(), make()\nprint(a(), a(), b())`, `1 2 1`, [`1 2 3`, `1 1 1`, `2 2 2`],
      `Each call to make creates its own variable n. The closure keeps its own copy, so a and b count independently.`,
      `All closures made by one function share a single counter.`,
      [`What does nonlocal do?`, `It lets an inner function rebind a variable of the nearest enclosing function scope.`]),
    iq("M", `What does this print?`, `fs = [lambda: i for i in range(3)]\nprint([f() for f in fs])`, `[2, 2, 2]`, [`[0, 1, 2]`, `[3, 3, 3]`, `[0, 0, 0]`],
      `Closures capture the variable i, not its value at creation time. After the loop i is 2, so every lambda returns 2 (late binding).`,
      `Each lambda remembers the value i had when it was created.`,
      [`How do you fix it?`, `Bind the value as a default argument: lambda i=i: i.`]),
    iq("M", `What does this print?`, `fs = [lambda i=i: i for i in range(3)]\nprint([f() for f in fs])`, `[0, 1, 2]`, [`[2, 2, 2]`, `[0, 0, 0]`, `Raises TypeError`],
      `A default argument is evaluated when each lambda is created, so each one stores its own value.`,
      `Default arguments are looked up at call time.`,
      [`When are defaults evaluated?`, `Once, at function definition time.`]),
    iq("M", `What does this print?`, `def f(x):\n    x.append(1)\n    x = [9]\n    return x\n\nlst = []\nprint(f(lst), lst)`, `[9] [1]`, [`[9] []`, `[1] [1]`, `[9] [9]`],
      `Arguments are passed by object reference: append mutates the caller's list, but rebinding x makes it point to a new list and does not affect lst.`,
      `Python passes by value (copies) or by reference (always changes the caller's variable).`,
      [`How would you stop the function changing the caller's list?`, `Work on a copy: x = list(x) at the start, or avoid mutating arguments.`]),
    iq("M", `What does this print?`, `print((lambda x, y=2: x * y)(4), (lambda *a: sum(a))(1, 2, 3))`, `8 6`, [`6 8`, `4 6`, `Raises TypeError`],
      `Lambdas accept the same parameter forms as functions: defaults and *args.`,
      `Lambdas cannot take default arguments or varargs.`,
      [`What can a lambda body contain?`, `Only one expression, no statements.`]),
    iq("M", `What does this print?`, `def f():\n    return f()\n\ntry:\n    f()\nexcept RecursionError:\n    print("caught")`, `caught`, [`Raises RecursionError`, `It hangs forever`, `Raises MemoryError`],
      `Python limits recursion depth (about 1000 frames by default) and raises RecursionError, which can be caught.`,
      `Infinite recursion crashes the interpreter or runs forever.`,
      [`How do you avoid deep recursion?`, `Use iteration or an explicit stack; raising sys.setrecursionlimit is a last resort.`]),
    iq("M", `What does this print?`, `def f(a, /, b, *, c):\n    return a, b, c\n\nprint(f(1, 2, c=3))`, `(1, 2, 3)`, [`Raises TypeError`, `(1, 2, 3, None)`, `(3, 2, 1)`],
      `Parameters before / are positional-only, parameters after * are keyword-only, and b may be passed either way.`,
      `The / and * in a signature are typos or mean multiply and divide.`,
      [`What happens with f(a=1, b=2, c=3)?`, `TypeError: a is positional-only.`]),
    iq("H", `What does this print?`, `def outer():\n    x = 1\n    def inner():\n        return x\n    x = 2\n    return inner()\n\nprint(outer())`, `2`, [`1`, `None`, `Raises NameError`],
      `The inner function reads the variable x when it runs, and by then x has been rebound to 2.`,
      `The closure freezes x at the moment inner is defined.`,
      [`What is a closure?`, `A function together with the variables it captured from its enclosing scope.`]),
    iq("H", `What does this print?`, `def f(n, memo={}):\n    if n in memo:\n        return memo[n]\n    memo[n] = n if n < 2 else f(n - 1) + f(n - 2)\n    return memo[n]\n\nprint(f(30), len(f.__defaults__[0]))`, `832040 31`, [`832040 1`, `832040 0`, `832040 30`],
      `Here the shared mutable default is used on purpose as a cache: it keeps the results for 0 to 30 between calls (31 entries).`,
      `Mutable defaults are always a bug.`,
      [`What is a cleaner way to cache?`, `functools.lru_cache, which also bounds memory if you set maxsize.`]),
  ];
  lessons.push({
    title: "Interview Questions: Functions, Scope and Closures",
    minutes: 60,
    learn: ["Explain arguments, defaults, *args and **kwargs, and positional-only and keyword-only parameters", "Apply the LEGB scope rules including global and nonlocal", "Predict closure behaviour and the late-binding trap", "Avoid mutable default arguments"],
    why: "Scope, defaults and closures are the source of many real bugs, so interviewers use them to separate people who memorised syntax from people who understand the execution model.",
    items,
    revision: ["Defaults are evaluated once at definition.", "A name assigned in a function is local for the whole function.", "Closures capture variables, not values; fix late binding with a default argument.", "Arguments are passed by object reference: mutation is shared, rebinding is not.", "global and nonlocal rebind outer names."],
    quiz: qaQuiz(items),
    tasks: [task("Per-Name Counters", "Process commands read until the end of input: inc NAME increases the counter called NAME by one (counters start at 0) and get NAME prints its current value. Build the counters with a closure factory, as in the lesson.", "import sys\n# one independent counter per name\n", `import sys


def make_counter():
    n = 0

    def step(delta=0):
        nonlocal n
        n += delta
        return n

    return step


counters = {}
for line in sys.stdin.read().splitlines():
    parts = line.split()
    if not parts:
        continue
    action, name = parts
    counter = counters.setdefault(name, make_counter())
    if action == "inc":
        counter(1)
    else:
        print(counter())`, [["inc a\ninc a\ninc b\nget a\nget b\nget c", "2\n1\n0"], ["get x", "0"], ["inc k\nget k\ninc k\nget k", "1\n2"], ["inc a\ninc b\ninc b\nget a\nget b", "1\n2"]])],
  });
}

// ---------------------------------------------------------------- 3
{
  const items = [
    iq("E", `What does this print?`, `a = [3, 1, 2]\nprint(sorted(a), a)`, `[1, 2, 3] [3, 1, 2]`, [`[1, 2, 3] [1, 2, 3]`, `[3, 1, 2] [1, 2, 3]`, `None [1, 2, 3]`],
      `sorted() returns a new sorted list and leaves the original untouched.`,
      `sorted() sorts the list in place.`,
      [`Which one sorts in place?`, `list.sort(), which returns None.`]),
    iq("E", `What does this print?`, `a = [3, 1, 2]\nprint(a.sort(), a)`, `None [1, 2, 3]`, [`[1, 2, 3] [1, 2, 3]`, `None [3, 1, 2]`, `[1, 2, 3] [3, 1, 2]`],
      `list.sort() changes the list and returns None; the print arguments are evaluated left to right, so None is printed with the sorted list.`,
      `sort() returns the sorted list.`,
      [`What is the common bug this causes?`, `a = a.sort() sets a to None.`]),
    iq("E", `What does this print?`, `print({1, 2, 2, 3} == {3, 2, 1}, [1, 2] == [2, 1])`, `True False`, [`True True`, `False False`, `False True`],
      `Sets ignore duplicates and order; lists compare element by element in order.`,
      `Sets keep insertion order or duplicates.`,
      [`Is a set ordered?`, `No guaranteed order, so sort before printing or comparing sequences.`]),
    iq("E", `What does this print?`, `print((1,), (1), type((1)).__name__, type((1,)).__name__)`, `(1,) 1 int tuple`, [`(1,) (1) tuple tuple`, `1 1 int int`, `(1,) 1 tuple int`],
      `A one-element tuple needs a trailing comma; (1) is just the integer 1 in brackets.`,
      `Brackets create a tuple.`,
      [`What creates a tuple?`, `The comma (a, b), not the brackets; () is the empty tuple.`]),
    iq("E", `What does this print?`, `d = {"a": 1}\nprint(d.get("b"), d.get("b", 0), "a" in d)`, `None 0 True`, [`Raises KeyError`, `0 0 True`, `None None False`],
      `get returns the default (None unless given) for a missing key instead of raising KeyError; in tests keys.`,
      `d.get raises KeyError like d["b"].`,
      [`When is d["b"] better than d.get("b")?`, `When a missing key is a bug and should fail loudly.`]),
    iq("M", `What does this print?`, `a = [1, 2, 3]\nb = a[:]\nb[0] = 99\nprint(a, b)`, `[1, 2, 3] [99, 2, 3]`, [`[99, 2, 3] [99, 2, 3]`, `[1, 2, 3] [1, 2, 3]`, `[99, 2, 3] [1, 2, 3]`],
      `A full slice makes a shallow copy, an independent list.`,
      `Slicing returns a view of the same list as in NumPy.`,
      [`Does a slice of a NumPy array copy?`, `No, NumPy slices are views; Python list slices are copies.`]),
    iq("M", `What does this print?`, `a = [[1], [2]]\nb = a.copy()\nb[0].append(9)\nprint(a)`, `[[1, 9], [2]]`, [`[[1], [2]]`, `[[1, 9], [2, 9]]`, `[[9], [2]]`],
      `copy() is shallow: the new outer list holds the same inner lists, so changing an inner list changes both.`,
      `copy() duplicates everything inside the list as well.`,
      [`What copies nested structures?`, `copy.deepcopy.`]),
    iq("M", `What does this print?`, `import copy\n\na = [[1], [2]]\nb = copy.deepcopy(a)\nb[0].append(9)\nprint(a, b)`, `[[1], [2]] [[1, 9], [2]]`, [`[[1, 9], [2]] [[1, 9], [2]]`, `[[1], [2]] [[1], [2]]`, `[[1, 9], [2]] [[1], [2]]`],
      `deepcopy recursively copies the inner lists, so the two structures are fully independent.`,
      `deepcopy is only for dictionaries.`,
      [`What is the cost of deepcopy?`, `Time and memory proportional to the size of the structure; it also handles reference cycles.`]),
    iq("M", `What does this print?`, `g = [[0] * 2] * 2\ng[0][0] = 1\nprint(g)`, `[[1, 0], [1, 0]]`, [`[[1, 0], [0, 0]]`, `[[1, 1], [0, 0]]`, `[[0, 0], [0, 0]]`],
      `[row] * 2 repeats a reference to the same row object, so both rows change together.`,
      `Multiplying a list copies each element.`,
      [`How do you build a 2 x 2 grid correctly?`, `[[0] * 2 for _ in range(2)].`]),
    iq("M", `What does this print?`, `words = ["b", "B", "a"]\nprint(sorted(words), sorted(words, key=str.lower))`, `['B', 'a', 'b'] ['a', 'b', 'B']`, [`['a', 'b', 'B'] ['B', 'a', 'b']`, `['B', 'a', 'b'] ['B', 'a', 'b']`, `['a', 'B', 'b'] ['a', 'b', 'B']`],
      `Default string order uses character codes (upper case before lower case). With key=str.lower, b and B tie and the stable sort keeps their original order, b before B.`,
      `Sorting is case-insensitive by default, or unstable.`,
      [`Is Python's sort stable?`, `Yes, equal keys keep their input order, which allows multi-key sorting in passes.`]),
    iq("M", `What does this print?`, `d = {"x": 1}\nfor k in list(d):\n    d[k + "y"] = 2\nprint(d)`, `{'x': 1, 'xy': 2}`, [`Raises RuntimeError`, `{'x': 1}`, `{'x': 1, 'xy': 2, 'xyy': 2}`],
      `Iterating over a copy of the keys is safe while the dict changes; iterating over d itself would raise RuntimeError (dictionary changed size during iteration).`,
      `You can add keys to a dict while looping over it.`,
      [`What do you do to delete while iterating?`, `Loop over list(d) or build a new dict with a comprehension.`]),
    iq("M", `What does this print?`, `print([x for x in range(5) if x % 2], {x % 3 for x in range(6)}, {x: x * x for x in range(3)})`, `[1, 3] {0, 1, 2} {0: 0, 1: 1, 2: 4}`, [`[0, 2, 4] {0, 1, 2, 0, 1, 2} {0: 0, 1: 1, 2: 4}`, `[1, 3] [0, 1, 2] {0: 0, 1: 1, 2: 4}`, `[1, 3] {0, 1, 2} [0, 1, 4]`],
      `The if in a list comprehension keeps odd numbers; a set comprehension removes duplicates; a dict comprehension builds key-value pairs.`,
      `Braces always make a dict, or a set keeps duplicates.`,
      [`What does {} create?`, `An empty dict; use set() for an empty set.`]),
    iq("M", `What does this print?`, `a = [1, 2, 3, 4, 5]\nprint(a[1:4], a[::-2], a[-2:], a[10:])`, `[2, 3, 4] [5, 3, 1] [4, 5] []`, [`[2, 3, 4, 5] [5, 3, 1] [4, 5] []`, `[2, 3, 4] [5, 3, 1] [4, 5] Raises IndexError`, `[1, 2, 3] [5, 3, 1] [4, 5] []`],
      `Slices exclude the stop index, a negative step walks backwards, and slicing past the end gives an empty list instead of an error.`,
      `Out-of-range slices raise IndexError like out-of-range indexes.`,
      [`How do you reverse a list in place?`, `a.reverse(); a[::-1] makes a reversed copy.`]),
    iq("M", `What does this print?`, `t = ([1], 2)\nt[0].append(9)\nprint(t)`, `([1, 9], 2)`, [`Raises TypeError`, `([1], 2)`, `([1, 9], 2, 9)`],
      `A tuple is immutable, but it holds a reference to a mutable list, and the list itself can change.`,
      `Everything inside a tuple is frozen.`,
      [`Can a tuple with a list be a dict key?`, `No: hashing it fails because the list is unhashable.`]),
    iq("H", `What does this print?`, `t = ([1], 2)\ntry:\n    t[0] += [9]\nexcept TypeError:\n    print("error", t)`, `error ([1, 9], 2)`, [`error ([1], 2)`, `([1, 9], 2)`, `error ([1, 9], 3)`],
      `t[0] += [9] first extends the list in place (a mutation that succeeds) and then tries to assign the result back to t[0], which fails because tuples do not support item assignment.`,
      `A failing statement leaves everything unchanged.`,
      [`Why does the list change even though an error is raised?`, `__iadd__ mutated the list before the failing item assignment; Python statements are not transactional.`]),
    iq("H", `What does this print?`, `d = dict.fromkeys(["a", "b"], [])\nd["a"].append(1)\nprint(d)`, `{'a': [1], 'b': [1]}`, [`{'a': [1], 'b': []}`, `{'a': [], 'b': []}`, `{'a': 1, 'b': None}`],
      `fromkeys uses the same value object for every key, so both keys share one list.`,
      `Each key gets its own fresh list.`,
      [`What should you use instead?`, `A dict comprehension {k: [] for k in keys} or collections.defaultdict(list).`]),
  ];
  lessons.push({
    title: "Interview Questions: Lists, Tuples, Sets and Dictionaries",
    minutes: 60,
    learn: ["Predict sorting, slicing, copying and mutation behaviour of the built-in collections", "Explain shallow versus deep copies and aliasing", "Recognise the shared-reference traps (list multiplication, fromkeys, mutable defaults)", "Choose the right collection and answer typical follow-ups"],
    why: "Data-structure behaviour is the most common source of subtle bugs. Interviewers love aliasing, copying and mutation questions because they show whether you understand references.",
    items,
    revision: ["sorted() copies; list.sort() mutates and returns None.", "Slices copy lists; copy() is shallow; deepcopy copies nested objects.", "[x] * n repeats one reference; build grids with a comprehension.", "Tuples are immutable but can hold mutable objects.", "Never change the size of a dict while iterating over it."],
    quiz: qaQuiz(items),
    tasks: [task("Stable Sort by Score", "Read n and then n lines of name and integer score. Print the names ordered by score from high to low; people with equal scores must keep the order in which they appeared in the input (a stable sort).", "n = int(input())\nrows = [input().split() for _ in range(n)]\n# sort by score descending, keeping ties in input order\n", `n = int(input())
rows = [input().split() for _ in range(n)]
rows.sort(key=lambda r: int(r[1]), reverse=True)
print(*(name for name, _ in rows), sep="\\n")`, [["4\nA 90\nB 85\nC 90\nD 85", "A\nC\nB\nD"], ["1\nZed 5", "Zed"], ["3\nx 1\ny 2\nz 3", "z\ny\nx"], ["3\nq 7\nr 7\ns 7", "q\nr\ns"]])],
  });
}

// ---------------------------------------------------------------- 4
{
  const items = [
    iq("E", `What does this print?`, `print(list(range(2, 10, 3)), list(zip("ab", [1, 2, 3])))`, `[2, 5, 8] [('a', 1), ('b', 2)]`, [`[2, 5, 8, 11] [('a', 1), ('b', 2)]`, `[2, 5, 8] [('a', 1), ('b', 2), (None, 3)]`, `[2, 3, 4] [('a', 1), ('b', 2)]`],
      `range stops before 10 and steps by 3; zip stops at the shortest input.`,
      `zip pads shorter inputs with None.`,
      [`Which function pads?`, `itertools.zip_longest.`]),
    iq("E", `What does this print?`, `print(list(enumerate("ab", start=1)))`, `[(1, 'a'), (2, 'b')]`, [`[(0, 'a'), (1, 'b')]`, `[('a', 1), ('b', 2)]`, `[(1, 'a'), (1, 'b')]`],
      `enumerate pairs a counter (starting where you say) with each item, counter first.`,
      `enumerate always starts at 0, or puts the item first.`,
      [`Why prefer enumerate to range(len(x))?`, `It is clearer and works for any iterable.`]),
    iq("E", `What does this print?`, `print(any([]), all([]), any([0, 1]), all([1, 0]))`, `False True True False`, [`False False True False`, `True True True False`, `False True False False`],
      `any of nothing is False and all of nothing is True (vacuous truth).`,
      `Both return False for an empty list.`,
      [`Do any and all short-circuit?`, `Yes, they stop at the first deciding item.`]),
    iq("E", `What does this print?`, `def gen():\n    yield 1\n    yield 2\n\ng = gen()\nprint(next(g), next(g), list(g))`, `1 2 []`, [`1 2 [1, 2]`, `1 1 [2]`, `1 2 [2]`],
      `A generator remembers its position; after two next() calls it is exhausted, so list(g) is empty.`,
      `list(g) restarts the generator.`,
      [`What does next() raise when a generator is finished?`, `StopIteration (or its default if one is given).`]),
    iq("M", `What does this print?`, `g = (x * 2 for x in range(3))\nprint(list(g), list(g))`, `[0, 2, 4] []`, [`[0, 2, 4] [0, 2, 4]`, `[] []`, `[0, 2, 4] [0, 4, 8]`],
      `A generator expression can be consumed only once.`,
      `Iterating a generator twice gives the same results, like a list.`,
      [`How do you reuse the values?`, `Store them in a list, or create a new generator each time.`]),
    iq("M", `What does this print?`, `print(type(map(str, [1])).__name__, list(map(str, [1, 2])))`, `map ['1', '2']`, [`list ['1', '2']`, `map [1, 2]`, `generator ['1', '2']`],
      `In Python 3 map returns a lazy iterator object; you need list() to see the results.`,
      `map returns a list like in Python 2.`,
      [`What is the benefit of laziness?`, `Constant memory and the ability to work with infinite or very large streams.`]),
    iq("M", `What does this print?`, `import itertools\n\ndef count():\n    n = 0\n    while True:\n        yield n\n        n += 1\n\nprint(list(itertools.islice(count(), 3)))`, `[0, 1, 2]`, [`[0, 1, 2, 3]`, `It never finishes`, `[1, 2, 3]`],
      `A generator can describe an infinite stream; islice takes just the first three values.`,
      `An infinite generator will hang or run out of memory.`,
      [`What would list(count()) do?`, `It would never finish and eventually exhaust memory.`]),
    iq("M", `What does this print?`, `print(sum(x for x in range(5)), max((len(w), w) for w in ["aa", "b", "cc"]))`, `10 (2, 'cc')`, [`10 (2, 'aa')`, `10 (1, 'b')`, `4 (2, 'cc')`],
      `A generator expression feeds sum without building a list. Tuples compare element by element, so (2, 'cc') beats (2, 'aa').`,
      `max picks the first of equal-length items.`,
      [`How do you get the first of the longest words?`, `max(words, key=len): max returns the first maximal item.`]),
    iq("M", `What does this print?`, `x = "outer"\n[x for x in range(2)]\nprint(x)`, `outer`, [`1`, `0`, `Raises NameError`],
      `In Python 3 a comprehension has its own scope, so its loop variable does not leak.`,
      `The loop variable of a comprehension stays defined afterwards, as in Python 2.`,
      [`Does a plain for loop leak its variable?`, `Yes, the name stays bound after the loop.`]),
    iq("M", `What does this print?`, `it = iter([1, 2, 3])\nnext(it)\nprint(list(it))`, `[2, 3]`, [`[1, 2, 3]`, `[3]`, `[1]`],
      `An iterator is consumed as you go; list(it) gets what is left.`,
      `iter() creates a fresh copy each time you use it.`,
      [`What is the iterator protocol?`, `__iter__ returns an iterator and __next__ returns the next item or raises StopIteration.`]),
    iq("M", `What does this print?`, `def f():\n    yield from [1, 2]\n    yield 3\n\nprint(list(f()))`, `[1, 2, 3]`, [`[[1, 2], 3]`, `[3]`, `[1, 2]`],
      `yield from hands control to a sub-iterable and yields each of its items.`,
      `yield from yields the list as one item.`,
      [`Why is yield from useful?`, `It delegates to sub-generators and forwards send and exceptions.`]),
    iq("M", `What does this print?`, `def acc():\n    total = 0\n    while True:\n        x = yield total\n        total += x\n\ng = acc()\nnext(g)\nprint(g.send(5), g.send(10))`, `5 15`, [`0 5`, `5 10`, `15 15`],
      `send resumes the generator and makes the paused yield expression evaluate to the sent value; the next yield returns the new total.`,
      `Generators can only produce values, never receive them.`,
      [`Why is the first next(g) needed?`, `To advance the generator to its first yield before anything can be sent.`]),
    iq("M", `What does this print?`, `print(list(zip(*[(1, 'a'), (2, 'b')])))`, `[(1, 2), ('a', 'b')]`, [`[(1, 'a'), (2, 'b')]`, `[(1, 'a', 2, 'b')]`, `[[1, 2], ['a', 'b']]`],
      `* unpacks the list into separate arguments, so zip transposes the pairs into columns.`,
      `zip(*x) is the same as zip(x).`,
      [`How do you transpose a matrix this way?`, `list(zip(*matrix)).`]),
    iq("M", `What does this print?`, `import itertools\n\nprint(list(itertools.chain([1], [2, 3])), list(itertools.accumulate([1, 2, 3])), list(itertools.product("ab", repeat=2)))`, `[1, 2, 3] [1, 3, 6] [('a', 'a'), ('a', 'b'), ('b', 'a'), ('b', 'b')]`, [`[[1], [2, 3]] [1, 3, 6] [('a', 'a'), ('a', 'b'), ('b', 'a'), ('b', 'b')]`, `[1, 2, 3] [1, 2, 3] [('a', 'b'), ('b', 'a')]`, `[1, 2, 3] [1, 3, 6] [('a', 'b'), ('b', 'a')]`],
      `chain joins iterables, accumulate gives running totals, and product with repeat=2 gives all ordered pairs.`,
      `product returns permutations without repetition.`,
      [`Which function gives combinations without repetition?`, `itertools.combinations (and permutations for ordered selections).`]),
    iq("H", `What does this print?`, `def f():\n    try:\n        yield 1\n    finally:\n        print("cleanup", end=" ")\n\ng = f()\nnext(g)\ng.close()\nprint("done")`, `cleanup done`, [`done`, `done cleanup`, `Raises GeneratorExit`],
      `close() raises GeneratorExit inside the generator at the paused yield, which runs the finally block before close returns.`,
      `An unfinished generator is simply dropped and its finally block never runs.`,
      [`How does with-statement style cleanup relate?`, `contextlib.closing or a generator-based context manager relies on this behaviour.`]),
    iq("H", `What does this print?`, `nums = [1, 2, 3]\nsquares = (n * n for n in nums)\nnums.append(4)\nprint(list(squares))`, `[1, 4, 9, 16]`, [`[1, 4, 9]`, `[1, 4, 9, 16, 25]`, `[]`],
      `The generator iterates over the same list object lazily, so it sees the value appended before the iteration finishes.`,
      `A generator takes a snapshot of the list when it is created.`,
      [`When is the outermost iterable evaluated?`, `Immediately, when the generator expression is created; the iteration itself is lazy.`]),
  ];
  lessons.push({
    title: "Interview Questions: Iterators, Generators and Comprehensions",
    minutes: 60,
    learn: ["Explain iterables, iterators, generators and the iterator protocol", "Predict lazy evaluation and single-use behaviour", "Use comprehension scoping rules, zip, enumerate and itertools", "Describe send, yield from and generator cleanup"],
    why: "Generators and iterators are central to idiomatic, memory-efficient Python. Questions about laziness and exhaustion check whether you can reason about when code actually runs.",
    items,
    revision: ["Iterators are consumed once; iterables can create new iterators.", "map, filter, zip, enumerate and generator expressions are lazy.", "yield from delegates; send passes values in; close runs finally blocks.", "Comprehensions have their own scope.", "itertools: chain, islice, accumulate, product, groupby."],
    quiz: qaQuiz(items),
    tasks: [task("Chunk a Stream", "Read a chunk size k and then a line of integers. Print the numbers in consecutive chunks of k (the last chunk may be shorter), one chunk per line with the numbers separated by spaces. Write a generator that yields the chunks.", "k = int(input())\nnumbers = input().split()\n# yield chunks of size k\n", `def chunks(items, k):
    for i in range(0, len(items), k):
        yield items[i:i + k]


k = int(input())
for chunk in chunks(input().split(), k):
    print(*chunk)`, [["3\n1 2 3 4 5 6 7", "1 2 3\n4 5 6\n7"], ["2\n1", "1"], ["1\n5 6", "5\n6"], ["4\n1 2 3 4", "1 2 3 4"]])],
  });
}

module.exports = { lessons };
