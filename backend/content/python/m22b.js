// Phase 7 / Module 22, lessons 5-7: Python technical interview questions on object-oriented programming, exceptions and context managers, and decorators and functional tools.
"use strict";
const { mcq, task, iq, qaQuiz } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 5
{
  const items = [
    iq("E", `What does this print?`, `class A:\n    count = 0\n\na, b = A(), A()\na.count = 5\nprint(a.count, b.count, A.count)`, `5 0 0`, [`5 5 5`, `5 5 0`, `0 0 0`],
      `Assigning through an instance creates an instance attribute that shadows the class attribute for that object only.`,
      `Setting an attribute on an instance changes the class attribute for all instances.`,
      [`How do you change the class attribute for everyone?`, `Assign through the class: A.count = 5.`]),
    iq("E", `What does this print?`, `class P:\n    def __repr__(self):\n        return "P()"\n\n    def __str__(self):\n        return "a P"\n\np = P()\nprint(p, [p], f"{p}", repr(p))`, `a P [P()] a P P()`, [`P() [P()] P() P()`, `a P [a P] a P P()`, `a P [P()] P() a P`],
      `print and f-strings use __str__; the list display and repr() use __repr__ for the elements.`,
      `__str__ and __repr__ are interchangeable.`,
      [`Which one should always be defined?`, `__repr__, because __str__ falls back to it and debugging output uses it.`]),
    iq("E", `What does this print?`, `class A:\n    def hi(self):\n        return "A"\n\nclass B(A):\n    pass\n\nprint(B().hi(), isinstance(B(), A), issubclass(B, A))`, `A True True`, [`B True True`, `A False True`, `Raises AttributeError`],
      `B inherits hi from A, and a B instance is also an instance of A.`,
      `A subclass instance is not an instance of its parent.`,
      [`What does isinstance(x, (A, B)) do?`, `It tests against several classes at once.`]),
    iq("M", `What does this print?`, `class A:\n    def who(self):\n        return "A"\n\nclass B(A):\n    def who(self):\n        return "B" + super().who()\n\nclass C(A):\n    def who(self):\n        return "C" + super().who()\n\nclass D(B, C):\n    def who(self):\n        return "D" + super().who()\n\nprint(D().who(), [k.__name__ for k in D.__mro__])`, `DBCA ['D', 'B', 'C', 'A', 'object']`, [`DBA ['D', 'B', 'A', 'object']`, `DBAC ['D', 'B', 'A', 'C', 'object']`, `D ['D', 'B', 'C', 'A', 'object']`],
      `super() follows the method resolution order (C3 linearisation), not simply the parent. B's super() is C, because C comes before A in D's MRO.`,
      `super() always calls the single direct parent.`,
      [`What does C3 guarantee?`, `A class always appears before its parents and the order of base classes is preserved.`]),
    iq("M", `What does this print?`, `class A:\n    def f(self):\n        return "A.f"\n\nclass B(A):\n    def f(self):\n        return "B.f"\n\nprint(A.f(B()), B().f())`, `A.f B.f`, [`B.f B.f`, `A.f A.f`, `B.f A.f`],
      `Calling the function through the class A explicitly uses A's version, whatever the object; a normal call uses the object's class first.`,
      `Python always dispatches on the type of the object, even for A.f(...).`,
      [`What is A.f when accessed on the class?`, `A plain function; the instance form creates a bound method.`]),
    iq("M", `What does this print?`, `class C:\n    def __init__(self):\n        self._v = 1\n\n    @property\n    def v(self):\n        return self._v * 10\n\nc = C()\nresult = "writable"\ntry:\n    c.v = 5\nexcept AttributeError:\n    result = "read-only"\nprint(c.v, result)`, `10 read-only`, [`5 writable`, `10 writable`, `5 read-only`],
      `A property without a setter is read-only: assigning raises AttributeError.`,
      `A property can be assigned like any attribute.`,
      [`How do you add a setter?`, `Decorate a second method with @v.setter.`]),
    iq("M", `What does this print?`, `class T:\n    @classmethod\n    def make(cls):\n        return cls.__name__\n\n    @staticmethod\n    def add(a, b):\n        return a + b\n\nclass U(T):\n    pass\n\nprint(U.make(), T.add(1, 2))`, `U 3`, [`T 3`, `U None`, `Raises TypeError`],
      `A classmethod receives the class it was called on (U), so it works well for alternative constructors; a staticmethod gets no implicit argument.`,
      `A classmethod always receives the class that defined it.`,
      [`When use a staticmethod?`, `For a utility function that belongs to the class namespace but needs neither the class nor an instance.`]),
    iq("M", `What does this print?`, `class P:\n    def __init__(self, x):\n        self.x = x\n\n    def __eq__(self, other):\n        return self.x == other.x\n\ntry:\n    hash(P(1))\n    r = "hashable"\nexcept TypeError:\n    r = "unhashable"\nprint(r)`, `unhashable`, [`hashable`, `Raises TypeError`, `Raises AttributeError`],
      `Defining __eq__ without __hash__ sets __hash__ to None, so instances cannot be used in sets or as dict keys.`,
      `Objects are always hashable by identity.`,
      [`How do you make it hashable again?`, `Define __hash__ consistently with __eq__, for example hash(self.x).`]),
    iq("M", `What does this print?`, `class A:\n    def __init__(self):\n        self.items = []\n\nclass B:\n    items = []\n\na, b = B(), B()\na.items.append(1)\nprint(b.items, A().items)`, `[1] []`, [`[] []`, `[1] [1]`, `[] [1]`],
      `A list defined on the class is shared by all instances (append mutates it); a list created in __init__ belongs to one instance.`,
      `Each instance gets its own copy of every class attribute.`,
      [`What is the right place for per-instance state?`, `__init__ (or dataclass fields with default_factory).`]),
    iq("M", `What does this print?`, `from dataclasses import dataclass\n\n@dataclass\nclass Pt:\n    x: int\n    y: int = 0\n\nprint(Pt(1), Pt(1) == Pt(1, 0))`, `Pt(x=1, y=0) True`, [`<Pt object> False`, `Pt(1) True`, `Pt(x=1, y=0) False`],
      `@dataclass generates __init__, __repr__ and __eq__ from the annotated fields, comparing them as tuples.`,
      `A dataclass compares objects by identity.`,
      [`How do you make instances immutable?`, `@dataclass(frozen=True).`]),
    iq("M", `What does this print?`, `class A:\n    __slots__ = ("x",)\n\na = A()\ntry:\n    a.y = 1\nexcept AttributeError:\n    print("no y")`, `no y`, [`Raises SyntaxError`, `Nothing is printed`, `1`],
      `__slots__ replaces the per-instance dictionary with fixed storage, so undeclared attributes cannot be added.`,
      `__slots__ only speeds things up and changes nothing else.`,
      [`Why use __slots__?`, `Lower memory for many small objects and protection against typos in attribute names.`]),
    iq("M", `What does this print?`, `class Box:\n    def __len__(self):\n        return 0\n\nprint(bool(Box()), len(Box()))`, `False 0`, [`True 0`, `False 1`, `Raises TypeError`],
      `Truth testing uses __bool__ and, if that is missing, __len__; a length of 0 means falsy.`,
      `Every object is truthy unless it is None.`,
      [`Which method takes priority?`, `__bool__ is tried before __len__.`]),
    iq("M", `What does this print?`, `class A:\n    def __init__(self):\n        self.__s = 1\n\nprint(hasattr(A(), "__s"), hasattr(A(), "_A__s"))`, `False True`, [`True False`, `True True`, `False False`],
      `Names starting with two underscores are mangled to _ClassName__name to avoid accidental clashes in subclasses; it is not real privacy.`,
      `Double underscores make attributes truly private.`,
      [`What does a single underscore mean?`, `A convention: internal use, not enforced.`]),
    iq("M", `What does this print?`, `class Adder:\n    def __init__(self, n):\n        self.n = n\n\n    def __call__(self, x):\n        return x + self.n\n\nprint(Adder(3)(4), callable(Adder(1)))`, `7 True`, [`4 False`, `3 True`, `Raises TypeError`],
      `__call__ makes instances callable like functions, so they can hold state.`,
      `Only functions and lambdas are callable.`,
      [`How does a class itself become callable?`, `Calling a class runs its metaclass __call__, which creates an instance.`]),
    iq("H", `What does this print?`, `class A:\n    def __init_subclass__(cls, **kw):\n        print("registered", cls.__name__, end=" ")\n\nclass B(A):\n    pass\n\nclass C(A):\n    pass\n\nprint("end")`, `registered B registered C end`, [`end`, `registered B end`, `registered A registered B registered C end`],
      `__init_subclass__ runs on the parent each time a subclass is defined, which makes plugin registries easy without a metaclass.`,
      `Class bodies run only when the class is first used.`,
      [`When does a class body execute?`, `At definition time, when the interpreter reaches the class statement.`]),
    iq("H", `What does this print?`, `class D:\n    def __getattr__(self, name):\n        return name.upper()\n\nd = D()\nd.real = 1\nprint(d.real, d.other)`, `1 OTHER`, [`REAL OTHER`, `1 other`, `Raises AttributeError`],
      `__getattr__ is called only when normal lookup fails; real exists on the instance, other does not.`,
      `__getattr__ intercepts every attribute access.`,
      [`Which method intercepts every access?`, `__getattribute__, which is rarely needed and easy to get wrong.`]),
  ];
  lessons.push({
    title: "Interview Questions: Classes, Inheritance and Special Methods",
    minutes: 60,
    learn: ["Predict class versus instance attribute behaviour", "Explain inheritance, super() and the method resolution order", "Use properties, class and static methods, dataclasses and __slots__", "Know the special methods that drive Python behaviour"],
    why: "Object-oriented design questions are standard for backend roles. The traps here (shared class attributes, MRO, __eq__ and __hash__) are the ones that cause real production bugs.",
    items,
    revision: ["Class attributes are shared; assigning on an instance shadows them.", "super() follows the MRO (C3), not just the direct parent.", "__eq__ without __hash__ makes objects unhashable.", "@property, @classmethod, @staticmethod, @dataclass.", "__getattr__ is a fallback; __getattribute__ is always called."],
    quiz: qaQuiz(items),
    tasks: [task("Method Resolution Order", "Read n and then n class definitions, one per line as Name: Base1 Base2 (the bases may be empty, and every base is defined on an earlier line). The last class is the one to analyse. Print its method resolution order (C3 linearisation), ending with object, on one line.", "n = int(input())\nbases = {}\nlast = None\nfor _ in range(n):\n    name, _, rest = input().partition(\":\")\n    # remember the bases\n", `n = int(input())
bases = {}
last = None
for _ in range(n):
    name, _, rest = input().partition(":")
    last = name.strip()
    bases[last] = rest.split()


def merge(seqs):
    result = []
    seqs = [s[:] for s in seqs if s]
    while seqs:
        for seq in seqs:
            head = seq[0]
            if not any(head in s[1:] for s in seqs):
                break
        result.append(head)
        seqs = [[x for x in s if x != head] for s in seqs]
        seqs = [s for s in seqs if s]
    return result


def mro(cls):
    if not bases[cls]:
        return [cls]
    return [cls] + merge([mro(b) for b in bases[cls]] + [bases[cls][:]])


print(*mro(last), "object")`, [["4\nA:\nB: A\nC: A\nD: B C", "D B C A object"], ["3\nA:\nB:\nC: A B", "C A B object"], ["1\nA:", "A object"], ["5\nO:\nA: O\nB: O\nC: O\nD: A B C", "D A B C O object"]])],
  });
}

// ---------------------------------------------------------------- 6
{
  const items = [
    iq("E", `What does this print?`, `try:\n    1 / 0\nexcept ZeroDivisionError as e:\n    print(type(e).__name__)`, `ZeroDivisionError`, [`ArithmeticError`, `division by zero`, `Raises ZeroDivisionError`],
      `The except clause catches the exception and e is the exception object; type(e).__name__ is its class name.`,
      `The message text is the name of the exception.`,
      [`How can you catch several exception types?`, `Use a tuple: except (ValueError, TypeError).`]),
    iq("E", `What does this print?`, `def f():\n    try:\n        return "try"\n    finally:\n        print("finally", end=" ")\n\nprint(f())`, `finally try`, [`try finally`, `try`, `finally`],
      `The finally block runs before the function actually returns; its print happens before print(f()) prints the returned value.`,
      `A return statement skips the finally block.`,
      [`When does finally not run?`, `If the process is killed or os._exit() is called, or the interpreter crashes.`]),
    iq("E", `What does this print?`, `try:\n    int("x")\nexcept (ValueError, TypeError):\n    print("bad", end=" ")\nelse:\n    print("ok", end=" ")\nfinally:\n    print("done")`, `bad done`, [`ok done`, `bad ok done`, `bad`],
      `The except block runs because int("x") raised ValueError; else is skipped, and finally always runs.`,
      `else and finally are the same thing.`,
      [`When does else run?`, `Only if the try block finished without an exception.`]),
    iq("M", `What does this print?`, `try:\n    x = 1\nexcept Exception:\n    print("e", end=" ")\nelse:\n    print("else", end=" ")\nfinally:\n    print("fin")`, `else fin`, [`e fin`, `else`, `e else fin`],
      `With no exception, else runs and then finally.`,
      `The else block runs when an exception happened.`,
      [`Why use else at all?`, `To keep the code that may raise small, so only the intended statements are protected by the try.`]),
    iq("M", `What does this print?`, `def f():\n    try:\n        return 1\n    finally:\n        return 2\n\nprint(f())`, `2`, [`1`, `3`, `Raises RuntimeError`],
      `A return inside finally overrides the earlier return (and would even swallow an exception). Avoid it.`,
      `The first return wins.`,
      [`What else should never be put in finally?`, `break, continue or return, which can silently swallow exceptions.`]),
    iq("M", `What does this print?`, `try:\n    try:\n        1 / 0\n    except ZeroDivisionError as e:\n        raise ValueError("bad") from e\nexcept ValueError as v:\n    print(type(v.__cause__).__name__)`, `ZeroDivisionError`, [`ValueError`, `None`, `Raises TypeError`],
      `raise ... from e records the original exception as __cause__ so the chain is kept in the traceback.`,
      `A new exception automatically deletes the old one.`,
      [`What does raise with no argument do?`, `It re-raises the exception currently being handled, with its traceback.`]),
    iq("M", `What does this print?`, `class AppError(Exception):\n    pass\n\nclass DbError(AppError):\n    pass\n\ntry:\n    raise DbError("x")\nexcept AppError as e:\n    print(type(e).__name__, str(e))`, `DbError x`, [`AppError x`, `DbError`, `Raises DbError`],
      `An except clause for a parent class catches its subclasses; the object keeps its real type and message.`,
      `Catching a parent class changes the exception to the parent type.`,
      [`Why create your own exception hierarchy?`, `Callers can catch one base class for the whole library and still distinguish the cases.`]),
    iq("M", `What does this print?`, `try:\n    {}["k"]\nexcept LookupError:\n    print("lookup")\nexcept KeyError:\n    print("key")`, `lookup`, [`key`, `lookup key`, `Raises KeyError`],
      `Except clauses are checked in order and the first match wins. KeyError is a subclass of LookupError, so the second clause is unreachable.`,
      `The most specific clause is chosen automatically.`,
      [`How should the clauses be ordered?`, `Most specific first, general ones last.`]),
    iq("M", `What does this print?`, `class CM:\n    def __enter__(self):\n        print("enter", end=" ")\n        return self\n\n    def __exit__(self, *args):\n        print("exit", end=" ")\n        return True\n\nwith CM():\n    raise ValueError\nprint("after")`, `enter exit after`, [`enter exit`, `enter after`, `Raises ValueError`],
      `If __exit__ returns a true value the exception raised in the with block is suppressed and execution continues after the block.`,
      `An exception inside a with block always propagates.`,
      [`When is returning True from __exit__ a bad idea?`, `When it hides unexpected errors; suppress only specific exceptions.`]),
    iq("M", `What does this print?`, `from contextlib import contextmanager\n\n@contextmanager\ndef tag():\n    print("<", end="")\n    yield\n    print(">", end="")\n\nwith tag():\n    print("x", end="")\nprint()`, `<x>`, [`<>x`, `x<>`, `><x`],
      `Code before yield is the setup, the with block runs at the yield, and code after yield is the cleanup.`,
      `The generator runs completely before the with body starts.`,
      [`What happens to an exception raised in the body?`, `It is thrown into the generator at the yield; use try/finally there for cleanup.`]),
    iq("M", `What does this print?`, `import os\nimport tempfile\n\nwith tempfile.TemporaryDirectory() as d:\n    p = os.path.join(d, "a.txt")\n    with open(p, "w") as f:\n        f.write("hi\\nthere\\n")\n    with open(p) as f:\n        lines = f.read().splitlines()\nprint(lines, f.closed)`, `['hi', 'there'] True`, [`['hi\\n', 'there\\n'] True`, `['hi', 'there'] False`, `['hi', 'there'] Raises ValueError`],
      `splitlines drops the newlines; the with statement closes the file on exit, though the variable f still exists.`,
      `with deletes the variable, or leaves the file open.`,
      [`Why prefer with open(...)?`, `The file is closed even if an exception occurs.`]),
    iq("M", `What does this print?`, `try:\n    raise KeyError("a")\nexcept Exception as e:\n    print(repr(e), str(e))`, `KeyError('a') 'a'`, [`KeyError('a') a`, `'a' KeyError('a')`, `KeyError a`],
      `str(KeyError('a')) shows the key with quotes, a quirk of KeyError; repr shows the class and argument.`,
      `str(e) is always the plain message.`,
      [`Why does that matter in logs?`, `A bare KeyError message looks like 'name', so log the type as well: f"{type(e).__name__}: {e}".`]),
    iq("M", `What does this print?`, `try:\n    assert 1 == 2, "nope"\nexcept AssertionError as e:\n    print(e)`, `nope`, [`AssertionError`, `1 == 2`, `Raises SyntaxError`],
      `A failed assert raises AssertionError with the message; asserts are removed when Python runs with -O, so never use them for input validation.`,
      `assert is a safe way to validate user input.`,
      [`What should you raise for invalid input?`, `ValueError or TypeError with a clear message.`]),
    iq("M", `What does this print?`, `from contextlib import suppress\n\nwith suppress(KeyError):\n    {}["x"]\nprint("continued")`, `continued`, [`Raises KeyError`, `Nothing is printed`, `KeyError`],
      `suppress ignores the listed exception types inside the with block and continues after it.`,
      `suppress skips the rest of the program.`,
      [`How is it different from try/except pass?`, `It is shorter and more explicit; both skip the remaining statements inside the block.`]),
    iq("H", `What does this print?`, `try:\n    raise ExceptionGroup("g", [ValueError(1), TypeError(2)])\nexcept* ValueError as eg:\n    print(len(eg.exceptions), end=" ")\nexcept* TypeError:\n    print("t")`, `1 t`, [`2`, `1`, `Raises ExceptionGroup`],
      `except* handles each matching part of an exception group separately; both handlers run, one for each exception type.`,
      `Only the first matching except clause runs, as with plain except.`,
      [`Where do exception groups come from?`, `asyncio.TaskGroup and concurrent failures; the feature appeared in Python 3.11.`]),
    iq("H", `What does this print?`, `class R:\n    def __enter__(self):\n        return self\n\n    def __exit__(self, t, v, tb):\n        print(t.__name__, end=" ")\n        return False\n\ntry:\n    with R():\n        1 / 0\nexcept ZeroDivisionError:\n    print("caught")`, `ZeroDivisionError caught`, [`caught`, `caught ZeroDivisionError`, `ZeroDivisionError`],
      `__exit__ receives the exception info and runs first; returning False lets the exception continue to the outer except.`,
      `__exit__ is skipped when an exception occurs.`,
      [`What are the three arguments of __exit__?`, `The exception type, value and traceback (all None when there was no exception).`]),
  ];
  lessons.push({
    title: "Interview Questions: Exceptions, Context Managers and Files",
    minutes: 60,
    learn: ["Trace the order of try, except, else and finally", "Use raise from, custom exception hierarchies and exception groups", "Write and explain context managers", "Handle files safely"],
    why: "Error handling shows how you build reliable software. Interviewers check that you know what really runs and in what order, and that you avoid habits such as bare except or returning from finally.",
    items,
    revision: ["try / except / else / finally order; finally always runs.", "First matching except wins: specific before general.", "raise ... from e keeps the cause; bare raise re-raises.", "__exit__ returning True suppresses the exception.", "assert is not for validating input."],
    quiz: qaQuiz(items),
    tasks: [task("First Matching Handler", "Read n and then n lines Child Parent describing an exception class hierarchy (Parent is - for a root). Then read the raised class on one line and the except clauses in order on the next line. Print the first clause whose class is the raised class or one of its ancestors, or uncaught if none matches.", "n = int(input())\nparent = {}\nfor _ in range(n):\n    child, p = input().split()\n    parent[child] = p\nraised = input()\nhandlers = input().split()\n# walk up the hierarchy\n", `n = int(input())
parent = {}
for _ in range(n):
    child, p = input().split()
    parent[child] = p
raised = input()
handlers = input().split()
ancestors = []
cls = raised
while cls != "-" and cls is not None:
    ancestors.append(cls)
    cls = parent.get(cls, "-")
for h in handlers:
    if h in ancestors:
        print(h)
        break
else:
    print("uncaught")`, [["4\nKeyError LookupError\nIndexError LookupError\nLookupError Exception\nException -\nKeyError\nIndexError LookupError Exception", "LookupError"], ["4\nKeyError LookupError\nIndexError LookupError\nLookupError Exception\nException -\nKeyError\nKeyError Exception", "KeyError"], ["2\nA -\nB -\nA\nB", "uncaught"], ["3\nC B\nB A\nA -\nC\nA B", "A"]])],
  });
}

// ---------------------------------------------------------------- 7
{
  const items = [
    iq("E", `What does this print?`, `def shout(f):\n    def wrapper(*args):\n        return f(*args).upper()\n    return wrapper\n\n@shout\ndef hi(name):\n    return "hi " + name\n\nprint(hi("sam"))`, `HI SAM`, [`hi sam`, `Hi Sam`, `Raises TypeError`],
      `@shout replaces hi with wrapper, which calls the original and upper-cases the result.`,
      `A decorator changes the function's source code.`,
      [`What is @shout equivalent to?`, `hi = shout(hi).`]),
    iq("E", `What does this print?`, `def deco(f):\n    def wrapper(*args):\n        return f(*args)\n    return wrapper\n\n@deco\ndef hi():\n    pass\n\nprint(hi.__name__)`, `wrapper`, [`hi`, `deco`, `<lambda>`],
      `The decorated name now refers to the wrapper function, so introspection shows the wrapper's name.`,
      `A decorator keeps the original function's metadata automatically.`,
      [`How do you preserve the name and docstring?`, `Decorate the wrapper with functools.wraps(f).`]),
    iq("E", `What does this print?`, `import functools\n\ndef deco(f):\n    @functools.wraps(f)\n    def wrapper(*args):\n        return f(*args)\n    return wrapper\n\n@deco\ndef hi():\n    pass\n\nprint(hi.__name__)`, `hi`, [`wrapper`, `deco`, `Raises AttributeError`],
      `functools.wraps copies __name__, __doc__ and other metadata from f to the wrapper (and sets __wrapped__).`,
      `wraps changes what the decorator does.`,
      [`What else does wraps set?`, `__wrapped__, a reference to the original function.`]),
    iq("M", `What does this print?`, `def repeat(n):\n    def deco(f):\n        def wrapper(*args):\n            return [f(*args) for _ in range(n)]\n        return wrapper\n    return deco\n\n@repeat(3)\ndef one():\n    return 1\n\nprint(one())`, `[1, 1, 1]`, [`3`, `1`, `[3]`],
      `repeat(3) is called first and returns the real decorator, which then wraps one: three layers of functions.`,
      `@repeat(3) passes 3 straight to the decorated function.`,
      [`Why are there three nested functions?`, `The outer takes the decorator arguments, the middle takes the function, the inner is the wrapper.`]),
    iq("M", `What does this print?`, `def a(f):\n    return lambda: "a(" + f() + ")"\n\ndef b(f):\n    return lambda: "b(" + f() + ")"\n\n@a\n@b\ndef x():\n    return "x"\n\nprint(x())`, `a(b(x))`, [`b(a(x))`, `a(x)`, `x`],
      `Decorators apply bottom-up: x = a(b(x)), so a is the outermost wrapper.`,
      `Stacked decorators apply top to bottom.`,
      [`In what order do they run at call time?`, `The outermost wrapper runs first, then calls the next one inwards.`]),
    iq("M", `What does this print?`, `from functools import lru_cache\n\ncalls = []\n\n@lru_cache(None)\ndef sq(n):\n    calls.append(n)\n    return n * n\n\nprint(sq(3), sq(3), sq(4), len(calls))`, `9 9 16 2`, [`9 9 16 3`, `9 9 16 1`, `9 9 16 0`],
      `lru_cache stores results by arguments, so the second sq(3) does not run the body again; only 3 and 4 were computed.`,
      `The cache stores results between program runs.`,
      [`What must arguments be for lru_cache?`, `Hashable.`]),
    iq("M", `What does this print?`, `from functools import partial\n\nint2 = partial(int, base=2)\nprint(int2("101"), partial(pow, 2)(5))`, `5 32`, [`101 10`, `5 25`, `Raises TypeError`],
      `partial freezes some arguments: int2 is int with base=2, and partial(pow, 2)(5) is pow(2, 5).`,
      `partial runs the function immediately.`,
      [`How is partial different from a lambda?`, `It is picklable, introspectable and slightly faster, but less flexible.`]),
    iq("M", `What does this print?`, `from functools import reduce\n\nprint(reduce(lambda a, b: a * b, [1, 2, 3, 4]), reduce(lambda a, b: a + b, [], 10))`, `24 10`, [`10 10`, `24 0`, `Raises TypeError`],
      `reduce folds left to right; an initial value (third argument) is returned for an empty sequence.`,
      `reduce with an empty list always raises an error.`,
      [`When does reduce raise on an empty sequence?`, `When no initial value is given: TypeError.`]),
    iq("M", `What does this print?`, `print(list(map(lambda x: x * 2, filter(lambda x: x % 2, range(6)))))`, `[2, 6, 10]`, [`[0, 4, 8]`, `[1, 3, 5]`, `[2, 4, 6, 8, 10]`],
      `filter keeps the odd numbers 1, 3, 5 and map doubles them. A comprehension [x * 2 for x in range(6) if x % 2] is usually clearer.`,
      `filter removes the items for which the function returns True.`,
      [`Which is more Pythonic: map/filter or a comprehension?`, `Comprehensions, unless you already have a named function.`]),
    iq("M", `What does this print?`, `from operator import itemgetter\n\nrows = [("b", 2), ("a", 2), ("c", 1)]\nprint(sorted(rows, key=itemgetter(1, 0)))`, `[('c', 1), ('a', 2), ('b', 2)]`, [`[('a', 2), ('b', 2), ('c', 1)]`, `[('b', 2), ('a', 2), ('c', 1)]`, `[('c', 1), ('b', 2), ('a', 2)]`],
      `itemgetter(1, 0) builds the key (second field, first field), so rows sort by number and then by letter.`,
      `A key function can return only one value.`,
      [`How do you sort descending by one field and ascending by another?`, `Negate the numeric field in the key, or sort twice using stability.`]),
    iq("M", `What does this print?`, `def counted(f):\n    def wrapper(*args):\n        wrapper.calls += 1\n        return f(*args)\n    wrapper.calls = 0\n    return wrapper\n\n@counted\ndef f():\n    pass\n\nf()\nf()\nprint(f.calls)`, `2`, [`0`, `1`, `Raises AttributeError`],
      `Functions are objects, so the wrapper can carry state in an attribute that survives between calls.`,
      `Functions cannot have attributes.`,
      [`What is another way to keep state?`, `A closure variable with nonlocal, or a class with __call__.`]),
    iq("M", `What does this print?`, `class Twice:\n    def __init__(self, f):\n        self.f = f\n\n    def __call__(self, *args):\n        return self.f(self.f(*args))\n\n@Twice\ndef inc(x):\n    return x + 1\n\nprint(inc(5))`, `7`, [`6`, `5`, `Raises TypeError`],
      `A class can be a decorator: Twice(inc) is created and calling it runs __call__, which applies inc twice.`,
      `Only functions can be decorators.`,
      [`What is the advantage of a class decorator?`, `State is stored naturally on the instance.`]),
    iq("M", `What does this print?`, `adders = [lambda x, n=n: x + n for n in range(3)]\nprint([a(10) for a in adders])`, `[10, 11, 12]`, [`[12, 12, 12]`, `[10, 10, 10]`, `[11, 12, 13]`],
      `The default argument n=n freezes each loop value when the lambda is created, avoiding late binding.`,
      `The lambdas all see the last value of n.`,
      [`What alternative avoids the trick?`, `functools.partial(operator.add, n) or a factory function.`]),
    iq("M", `What does this print?`, `print(callable(len), callable(3), callable(lambda: 0), callable(type))`, `True False True True`, [`True False False True`, `True True True True`, `False False True True`],
      `Anything with __call__ is callable: functions, lambdas and classes (type); an int is not.`,
      `Classes are not callable.`,
      [`What happens when you call a class?`, `It creates an instance by running __new__ and __init__.`]),
    iq("H", `What does this print?`, `from functools import singledispatch\n\n@singledispatch\ndef show(x):\n    return "other"\n\n@show.register(int)\ndef _(x):\n    return "int"\n\n@show.register(list)\ndef _(x):\n    return "list"\n\nprint(show(1), show([1]), show("s"))`, `int list other`, [`other other other`, `int int other`, `int list list`],
      `singledispatch picks the implementation by the type of the first argument and falls back to the base function.`,
      `Python supports method overloading by argument types natively.`,
      [`Does it dispatch on later arguments?`, `No, only the first; use multimethods libraries or isinstance checks for more.`]),
    iq("H", `What does this print?`, `import functools\n\ndef deco(f):\n    @functools.wraps(f)\n    def w(*a, **k):\n        """wrapper doc"""\n        return f(*a, **k)\n    return w\n\n@deco\ndef add(a, b):\n    """adds"""\n    return a + b\n\nprint(add.__doc__, add.__wrapped__(1, 2))`, `adds 3`, [`wrapper doc 3`, `adds Raises AttributeError`, `wrapper doc None`],
      `wraps copies the original docstring over the wrapper's own and stores the original function as __wrapped__, which can be called to bypass the decorator.`,
      `The wrapper's own docstring always wins.`,
      [`Why is __wrapped__ useful?`, `Tools and tests can reach the undecorated function (inspect.unwrap follows the chain).`]),
  ];
  lessons.push({
    title: "Interview Questions: Decorators, Closures and Functional Tools",
    minutes: 60,
    learn: ["Explain how decorators work and write them with and without arguments", "Preserve metadata with functools.wraps", "Use lru_cache, partial, reduce, singledispatch and operator helpers", "Reason about stacking order and closure state"],
    why: "Decorators power frameworks such as Flask, FastAPI, pytest and Django. A candidate who can explain them from first principles shows real understanding of functions as objects.",
    items,
    revision: ["@d above def f means f = d(f); stacked decorators apply bottom-up.", "Decorator with arguments needs three levels of functions.", "functools.wraps keeps __name__, __doc__ and sets __wrapped__.", "lru_cache needs hashable arguments; partial freezes arguments.", "Functions are objects: they can carry attributes."],
    quiz: qaQuiz(items),
    tasks: [task("Count Calls", "Read n (at most 25). Consider the recursive Fibonacci function with fib(0) = 0 and fib(1) = 1. Print naive=A memo=B where A is the number of function calls the plain recursion makes to compute fib(n) (the first call counts) and B is the number of calls when a cache is used (calls answered from the cache still count as calls).", "n = int(input())\n# count the calls with and without memoisation\n", `n = int(input())
naive = 0


def fib(k):
    global naive
    naive += 1
    return k if k < 2 else fib(k - 1) + fib(k - 2)


fib(n)
memo = {}
memo_calls = 0


def fib_memo(k):
    global memo_calls
    memo_calls += 1
    if k in memo:
        return memo[k]
    memo[k] = k if k < 2 else fib_memo(k - 1) + fib_memo(k - 2)
    return memo[k]


fib_memo(n)
print(f"naive={naive} memo={memo_calls}")`, [["1", "naive=1 memo=1"], ["2", "naive=3 memo=3"], ["5", "naive=15 memo=9"], ["10", "naive=177 memo=19"]])],
  });
}

module.exports = { lessons };
