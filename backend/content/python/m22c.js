// Phase 7 / Module 22, lessons 8-10: Python technical interview questions on memory and internals, concurrency and async, and the standard library and idioms.
"use strict";
const { mcq, task, iq, qaQuiz } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 8
{
  const items = [
    iq("E", `What does this print?`, `a = [1]\nb = a\nc = a[:]\nprint(a is b, a is c, a == c)`, `True False True`, [`True True True`, `False False True`, `True False False`],
      `is tests identity (the same object); == tests equality of value. b is another name for a, while the slice c is a new list with equal contents.`,
      `is and == mean the same thing.`,
      [`When should you use is?`, `For singletons such as None, True and False: x is None.`]),
    iq("E", `What does this print?`, `x = None\nprint(x == None, x is None, not x)`, `True True True`, [`True False True`, `False True False`, `True True False`],
      `None is a singleton, so == and is agree, and None is falsy.`,
      `None is the same as 0 or an empty string.`,
      [`Why prefer is None to == None?`, `A class can override __eq__ and make == None give surprising results; is cannot be overridden.`]),
    iq("M", `What does this print?`, `import sys\n\na = []\nbefore = sys.getrefcount(a)\nb = a\nprint(sys.getrefcount(a) - before)`, `1`, [`0`, `2`, `Raises TypeError`],
      `CPython counts references to each object; binding a second name adds one reference. (getrefcount itself adds a temporary one, which cancels in the difference.)`,
      `Names copy objects, so the count does not change.`,
      [`What frees an object in CPython?`, `Its reference count reaching zero; a cycle collector handles reference cycles.`]),
    iq("M", `What does this print?`, `import weakref\n\nclass A:\n    pass\n\na = A()\nr = weakref.ref(a)\nalive = r() is a\ndel a\nprint(alive, r())`, `True None`, [`True <A object>`, `False None`, `True True`],
      `A weak reference does not keep the object alive; once the last strong reference is deleted the object is freed and the weak reference returns None.`,
      `del a deletes the object whatever else refers to it.`,
      [`What does del actually do?`, `It removes the name binding; the object is freed only if nothing else refers to it.`]),
    iq("M", `What does this print?`, `import sys\n\nprint(sys.getsizeof([]) < sys.getsizeof([1, 2, 3]))`, `True`, [`False`, `They are equal`, `Raises TypeError`],
      `A list stores an array of pointers, so a longer list takes more memory. getsizeof counts only the container, not the objects it points to.`,
      `getsizeof gives the total size including the elements.`,
      [`How do you measure the total memory of a structure?`, `Sum the sizes recursively, or use tracemalloc for allocation tracking.`]),
    iq("M", `What does this print?`, `s = "abc"\ntry:\n    s[0] = "x"\nexcept TypeError:\n    print("immutable")`, `immutable`, [`xbc`, `abc`, `Raises IndexError`],
      `Strings are immutable, so item assignment raises TypeError; build a new string instead.`,
      `Strings can be edited in place by index.`,
      [`How do you build a string from many pieces efficiently?`, `Collect the pieces in a list and call "".join(pieces).`]),
    iq("M", `What does this print?`, `from collections import deque\n\nd = deque([1, 2, 3])\nd.appendleft(0)\nd.rotate(1)\nprint(list(d))`, `[3, 0, 1, 2]`, [`[0, 1, 2, 3]`, `[1, 2, 3, 0]`, `[0, 3, 1, 2]`],
      `appendleft gives [0, 1, 2, 3]; rotate(1) moves every element one step to the right, so the last element comes to the front.`,
      `rotate(1) moves items to the left.`,
      [`Why use deque instead of a list for a queue?`, `popleft and appendleft are O(1), while list.pop(0) is O(n).`]),
    iq("M", `What does this print?`, `x = [0] * 3\ny = [0 for _ in range(3)]\nprint(x == y, x is y)`, `True False`, [`True True`, `False False`, `False True`],
      `The lists hold equal values but are two separate objects.`,
      `Equal lists are always the same object.`,
      [`Does this difference matter for lists of lists?`, `Yes: [[0]] * 3 shares one inner list, a comprehension creates separate ones.`]),
    iq("M", `What does this print?`, `a = (1, 2, [3])\nb = (1, 2, [3])\nprint(a == b, a is b)`, `True False`, [`True True`, `False False`, `False True`],
      `Equality compares the elements; the two tuples are different objects (they contain different list objects).`,
      `Tuples with equal contents are always the same object.`,
      [`Is hash(a) allowed here?`, `No, the tuple contains a list, so hashing raises TypeError.`]),
    iq("M", `What does this print?`, `print(sorted(set("hello")))`, `['e', 'h', 'l', 'o']`, [`['h', 'e', 'l', 'l', 'o']`, `{'e', 'h', 'l', 'o'}`, `['h', 'e', 'l', 'o']`],
      `A set removes duplicate letters and has no reliable order, so sorted() turns it into an ordered list.`,
      `A set keeps the insertion order and duplicates.`,
      [`What is the average cost of a set lookup?`, `O(1), thanks to hashing.`]),
    iq("M", `What does this print?`, `import copy\n\nclass N:\n    def __init__(self):\n        self.xs = [1]\n\na = N()\nb = copy.copy(a)\nb.xs.append(2)\nprint(a.xs)`, `[1, 2]`, [`[1]`, `[2]`, `Raises TypeError`],
      `copy.copy makes a shallow copy: the new object shares the same list, so the append is visible through both.`,
      `copy.copy duplicates everything the object holds.`,
      [`How do you give each copy its own list?`, `copy.deepcopy, or define __copy__ yourself.`]),
    iq("M", `What does this print?`, `big = 2 ** 100\nprint(big, type(big).__name__, big.bit_length())`, `1267650600228229401496703205376 int 101`, [`1.2676506002282294e+30 float 101`, `Raises OverflowError`, `1267650600228229401496703205376 long 100`],
      `Python integers have unlimited precision; 2 ** 100 needs 101 bits.`,
      `Integers overflow at 2 ** 31 or 2 ** 63 as in C.`,
      [`Do floats have the same precision?`, `No, floats are 64-bit with about 15-17 significant digits.`]),
    iq("M", `What does this print?`, `print(hash("a") == hash("a"), hash((1, 2)) == hash((1, 2)), hash(1) == hash(1.0))`, `True True True`, [`True True False`, `False True True`, `True False True`],
      `Equal hashable values must have equal hashes, and 1 == 1.0, so their hashes match. (String hashes differ between runs, but are stable within one run.)`,
      `Equal numbers of different types hash differently.`,
      [`What is the hash contract?`, `If a == b then hash(a) == hash(b).`]),
    iq("M", `What does this print?`, `lst = list(range(5))\nit = iter(lst)\nlst.append(5)\nprint(sum(it))`, `15`, [`10`, `5`, `Raises RuntimeError`],
      `A list iterator reads the list as it goes, so it also sees the element appended before iteration finishes: 0 + 1 + 2 + 3 + 4 + 5 = 15.`,
      `iter() takes a snapshot of the list.`,
      [`Is mutating a list while looping over it safe?`, `It does not raise an error but behaves confusingly; loop over a copy.`]),
    iq("H", `What does this print?`, `import threading\n\nn = 0\nlock = threading.Lock()\n\ndef work():\n    global n\n    for _ in range(1000):\n        with lock:\n            n += 1\n\nthreads = [threading.Thread(target=work) for _ in range(4)]\nfor t in threads:\n    t.start()\nfor t in threads:\n    t.join()\nprint(n)`, `4000`, [`1000`, `Less than 4000, unpredictable`, `Raises RuntimeError`],
      `n += 1 is not atomic (read, add, write), so threads need a lock for a guaranteed total. The GIL does not make such compound operations safe.`,
      `The GIL makes every Python statement atomic.`,
      [`What does the GIL actually protect?`, `The interpreter's internal data structures, not your program's logic.`]),
    iq("H", `What does this print?`, `class A:\n    pass\n\nclass B:\n    __slots__ = ()\n\nprint(hasattr(A(), "__dict__"), hasattr(B(), "__dict__"))`, `True False`, [`True True`, `False False`, `False True`],
      `Normal instances keep their attributes in a per-instance __dict__; with empty __slots__ there is no dictionary at all.`,
      `All Python objects have a __dict__.`,
      [`Which memory trade-off does __slots__ make?`, `Saves memory per instance but removes dynamic attributes and weakref support unless you add them to __slots__.`]),
  ];
  lessons.push({
    title: "Interview Questions: Memory, Identity and Python Internals",
    minutes: 60,
    learn: ["Distinguish identity from equality and names from objects", "Explain reference counting, weak references and copying", "Reason about mutability, hashing and memory use", "Explain what the GIL does and does not protect"],
    why: "Senior interviews probe how Python works under the hood: references, copying, hashing and threads. Strong answers prevent whole classes of bugs and performance problems.",
    items,
    revision: ["is is identity, == is equality; use is only for None and booleans.", "Names are references; objects are freed when the reference count hits zero.", "Shallow copies share inner objects; deepcopy does not.", "Equal objects must have equal hashes; mutable containers are unhashable.", "The GIL does not make compound operations such as += atomic."],
    quiz: qaQuiz(items),
    tasks: [task("Reference Counting", "Process commands read until the end of input: new X creates an object called X with one reference, ref X adds a reference, and del X removes one. When an object's count reaches zero print freed X. At the end print live: followed by the names of the objects still alive in alphabetical order separated by spaces (or none).", "import sys\ncounts = {}\n# simulate reference counts\n", `import sys

counts = {}
for line in sys.stdin.read().splitlines():
    parts = line.split()
    if not parts:
        continue
    action, name = parts
    if action == "new":
        counts[name] = 1
    elif action == "ref":
        counts[name] += 1
    else:
        counts[name] -= 1
        if counts[name] == 0:
            print("freed", name)
            del counts[name]
alive = sorted(counts)
print("live:", *(alive if alive else ["none"]))`, [["new a\nref a\ndel a\ndel a", "freed a\nlive: none"], ["new a\nnew b\ndel a\nref b\ndel b", "freed a\nlive: b"], ["new x\nnew y", "live: x y"], ["new q\ndel q\nnew q\nref q", "freed q\nlive: q"]])],
  });
}

// ---------------------------------------------------------------- 9
{
  const items = [
    iq("E", `What does this print?`, `import threading\n\nout = []\nt = threading.Thread(target=lambda: out.append("child"))\nt.start()\nt.join()\nout.append("main")\nprint(out)`, `['child', 'main']`, [`['main', 'child']`, `['child']`, `['main']`],
      `join() waits until the thread finishes, so the child's append happens before the main thread continues.`,
      `start() waits for the thread to finish.`,
      [`What does daemon=True mean?`, `The thread will not keep the program alive when the main thread ends.`]),
    iq("E", `What does this print?`, `from concurrent.futures import ThreadPoolExecutor\n\nwith ThreadPoolExecutor(2) as ex:\n    print(list(ex.map(lambda x: x * x, [1, 2, 3])))`, `[1, 4, 9]`, [`[1, 2, 3]`, `[9, 4, 1]`, `Raises RuntimeError`],
      `executor.map returns results in the order of the inputs, even if the work finished in a different order.`,
      `Results come back in completion order.`,
      [`Which function gives completion order?`, `concurrent.futures.as_completed.`]),
    iq("E", `What does this print?`, `import asyncio\n\nasync def f():\n    return 5\n\nprint(asyncio.run(f()))`, `5`, [`<coroutine object f>`, `None`, `Raises RuntimeError`],
      `Calling f() creates a coroutine; asyncio.run runs it in an event loop and returns its result.`,
      `Calling an async function runs it immediately.`,
      [`What happens if you call f() and never await it?`, `Nothing runs and Python warns that the coroutine was never awaited.`]),
    iq("M", `What does this print?`, `import asyncio\n\nasync def work(n, delay):\n    await asyncio.sleep(delay)\n    return n\n\nasync def main():\n    return await asyncio.gather(work(1, 0.03), work(2, 0.01), work(3, 0.02))\n\nprint(asyncio.run(main()))`, `[1, 2, 3]`, [`[2, 3, 1]`, `[3, 2, 1]`, `[1, 3, 2]`],
      `gather returns the results in the order the awaitables were passed, no matter which finished first.`,
      `gather returns results in completion order.`,
      [`How would you get completion order?`, `asyncio.as_completed or asyncio.wait with FIRST_COMPLETED.`]),
    iq("M", `What does this print?`, `import asyncio\n\nasync def work(n, delay):\n    await asyncio.sleep(delay)\n    return n\n\nasync def main():\n    done = []\n    for fut in asyncio.as_completed([work(1, 0.06), work(2, 0.01), work(3, 0.03)]):\n        done.append(await fut)\n    return done\n\nprint(asyncio.run(main()))`, `[2, 3, 1]`, [`[1, 2, 3]`, `[3, 2, 1]`, `[2, 1, 3]`],
      `as_completed yields results as the tasks finish, so the shortest delay comes first.`,
      `The loop waits for the first task before moving to the second.`,
      [`Why does concurrency help here?`, `All three sleeps overlap, so the total time is about the longest delay, not the sum.`]),
    iq("M", `What does this print?`, `import asyncio\n\norder = []\n\nasync def a():\n    order.append("a1")\n    await asyncio.sleep(0)\n    order.append("a2")\n\nasync def b():\n    order.append("b1")\n    await asyncio.sleep(0)\n    order.append("b2")\n\nasync def main():\n    await asyncio.gather(a(), b())\n\nasyncio.run(main())\nprint(order)`, `['a1', 'b1', 'a2', 'b2']`, [`['a1', 'a2', 'b1', 'b2']`, `['b1', 'a1', 'b2', 'a2']`, `['a1', 'b1', 'b2', 'a2']`],
      `Each await asyncio.sleep(0) hands control back to the event loop, which lets the other task run: cooperative multitasking.`,
      `Coroutines run in parallel on separate threads.`,
      [`What blocks the event loop?`, `Any long synchronous call, such as time.sleep or heavy computation, because no await gives control back.`]),
    iq("M", `What does this print?`, `from multiprocessing import Pool\n\ndef square(x):\n    return x * x\n\nif __name__ == "__main__":\n    with Pool(2) as p:\n        print(p.map(square, [1, 2, 3]))`, `[1, 4, 9]`, [`[1, 2, 3]`, `[3, 2, 1]`, `Raises RuntimeError`],
      `Pool.map splits the work across processes and returns the results in input order. The __main__ guard prevents child processes from re-running the pool code on platforms that start them by importing the module.`,
      `Processes share memory with the parent like threads do.`,
      [`When use processes instead of threads?`, `For CPU-bound work, because each process has its own interpreter and GIL.`]),
    iq("M", `What does this print?`, `import queue\n\nq = queue.Queue()\nfor i in range(3):\n    q.put(i)\nprint(q.get(), q.get(), q.qsize())`, `0 1 1`, [`2 1 1`, `0 1 3`, `0 1 2`],
      `queue.Queue is first in first out and thread-safe; after two gets one item is left.`,
      `A Queue returns the newest item first.`,
      [`Which class is last in first out?`, `queue.LifoQueue.`]),
    iq("M", `What does this print?`, `import threading\n\nresult = {}\n\ndef w(k, v):\n    result[k] = v\n\nthreads = [threading.Thread(target=w, args=(i, i * i)) for i in range(3)]\nfor t in threads:\n    t.start()\nfor t in threads:\n    t.join()\nprint(sorted(result.items()))`, `[(0, 0), (1, 1), (2, 4)]`, [`[(0, 0), (1, 1), (2, 2)]`, `[]`, `[(2, 4), (1, 1), (0, 0)]`],
      `Each thread stores its own key; dictionary item assignment is safe in CPython, and we sort the output because the finishing order is not guaranteed.`,
      `Threads finish in the order they started, so no sorting is needed.`,
      [`Why sort before printing?`, `Thread scheduling order is not deterministic.`]),
    iq("M", `What does this print?`, `from concurrent.futures import ThreadPoolExecutor\n\ndef boom():\n    raise ValueError("x")\n\nwith ThreadPoolExecutor(1) as ex:\n    f = ex.submit(boom)\n    try:\n        f.result()\n    except ValueError as e:\n        print("raised", e)`, `raised x`, [`Nothing is printed`, `raised`, `Raises ValueError at submit`],
      `An exception inside a worker is stored in the Future and re-raised when you call result().`,
      `Exceptions in threads are printed and ignored, or crash the program.`,
      [`How can you check for an error without raising it?`, `future.exception() returns it (or None).`]),
    iq("M", `What does this print?`, `import asyncio\n\nasync def slow():\n    await asyncio.sleep(1)\n\nasync def main():\n    try:\n        await asyncio.wait_for(slow(), 0.01)\n    except asyncio.TimeoutError:\n        return "timeout"\n\nprint(asyncio.run(main()))`, `timeout`, [`None`, `Raises RuntimeError`, `done`],
      `wait_for cancels the awaited task and raises TimeoutError when the time limit passes.`,
      `The slow coroutine keeps running to completion.`,
      [`What is the newer syntax in Python 3.11+?`, `async with asyncio.timeout(seconds):.`]),
    iq("M", `What does this print?`, `import asyncio\n\nrunning = 0\npeak = 0\n\nasync def job(sem):\n    global running, peak\n    async with sem:\n        running += 1\n        peak = max(peak, running)\n        await asyncio.sleep(0.01)\n        running -= 1\n\nasync def main():\n    sem = asyncio.Semaphore(2)\n    await asyncio.gather(*(job(sem) for _ in range(5)))\n\nasyncio.run(main())\nprint(peak)`, `2`, [`5`, `1`, `3`],
      `A semaphore with two permits lets at most two jobs be inside the protected block at once.`,
      `gather always runs all tasks at the same time.`,
      [`Why limit concurrency?`, `To respect rate limits and avoid exhausting connections or memory.`]),
    iq("M", `What does this print?`, `import asyncio\n\nasync def f():\n    return 1\n\nc = f()\nprint(type(c).__name__)\nc.close()`, `coroutine`, [`int`, `function`, `Future`],
      `An async function call returns a coroutine object; nothing runs until it is awaited or scheduled. (close() avoids the never-awaited warning.)`,
      `Calling an async def function returns its result.`,
      [`What turns a coroutine into a task?`, `asyncio.create_task, which schedules it on the loop.`]),
    iq("M", `What does this print?`, `import threading\n\ne = threading.Event()\nbefore = e.is_set()\ne.set()\nprint(before, e.is_set())`, `False True`, [`True True`, `False False`, `True False`],
      `An Event is a flag threads can wait on; set() raises it.`,
      `An Event starts in the set state.`,
      [`How does a thread wait for it?`, `e.wait(), optionally with a timeout.`]),
    iq("H", `What does this print?`, `import asyncio\n\nasync def child():\n    raise RuntimeError("bad")\n\nasync def main():\n    results = await asyncio.gather(child(), asyncio.sleep(0, "ok"), return_exceptions=True)\n    return [type(r).__name__ if isinstance(r, Exception) else r for r in results]\n\nprint(asyncio.run(main()))`, `['RuntimeError', 'ok']`, [`Raises RuntimeError`, `['bad', 'ok']`, `['ok']`],
      `With return_exceptions=True gather puts exceptions into the result list instead of raising the first one, so the other tasks still complete.`,
      `One failing task always cancels the others and hides the results.`,
      [`What is the default behaviour?`, `The first exception propagates to the awaiter; the other tasks keep running unless you cancel them.`]),
    iq("H", `What does this print?`, `import asyncio\n\nasync def main():\n    async with asyncio.TaskGroup() as tg:\n        t1 = tg.create_task(asyncio.sleep(0, 1))\n        t2 = tg.create_task(asyncio.sleep(0, 2))\n    return t1.result() + t2.result()\n\nprint(asyncio.run(main()))`, `3`, [`1`, `2`, `Raises RuntimeError`],
      `A TaskGroup waits for all its tasks when the async with block ends, and cancels the rest if one fails (structured concurrency, Python 3.11+).`,
      `The results are not available until you await each task separately.`,
      [`How does a TaskGroup report several failures?`, `It raises an ExceptionGroup, handled with except*.`]),
  ];
  lessons.push({
    title: "Interview Questions: Threads, Processes and asyncio",
    minutes: 60,
    learn: ["Choose between threads, processes and asyncio", "Predict result ordering and interleaving", "Use executors, queues, events, semaphores and task groups", "Explain the GIL and cooperative multitasking"],
    why: "Concurrency questions test whether you know which tool fits I/O-bound and CPU-bound work, and whether you understand ordering, blocking and shared state.",
    items,
    revision: ["Threads: I/O-bound work and simple concurrency; the GIL limits CPU parallelism.", "Processes: CPU-bound work; guard the entry point with __main__.", "asyncio: many waiting tasks; await hands control back; never block the loop.", "gather keeps input order; as_completed gives completion order.", "Protect shared state with locks; prefer queues and structured concurrency."],
    quiz: qaQuiz(items),
    tasks: [task("Completion Order", "Read n and then n tasks written as name and delay in milliseconds. Tasks all start at the same moment. Print order: followed by the task names in the order they finish (ties finish in input order) and then total: the time in milliseconds when the last task finishes.", "n = int(input())\ntasks = [input().split() for _ in range(n)]\n# order the tasks by finishing time\n", `n = int(input())
tasks = [input().split() for _ in range(n)]
ordered = sorted(enumerate(tasks), key=lambda item: (int(item[1][1]), item[0]))
print("order:", *(t[0] for _, t in ordered))
print("total:", max(int(t[1]) for t in tasks))`, [["3\nA 30\nB 10\nC 20", "order: B C A\ntotal: 30"], ["2\nx 5\ny 5", "order: x y\ntotal: 5"], ["1\nonly 100", "order: only\ntotal: 100"], ["4\na 0\nb 7\nc 7\nd 3", "order: a d b c\ntotal: 7"]])],
  });
}

// ---------------------------------------------------------------- 10
{
  const items = [
    iq("E", `What does this print when the file is run directly with python file.py?`, `if __name__ == "__main__":\n    print("script")`, `script`, [`Nothing`, `__main__`, `Raises NameError`],
      `When a file is run as a script its __name__ is "__main__"; when it is imported, __name__ is the module name and the block is skipped.`,
      `The block runs every time the file is imported.`,
      [`Why use this guard?`, `So that a module can be imported (and tested) without running its command-line behaviour.`]),
    iq("E", `What does this print?`, `import math\n\nprint(math.floor(-1.5), math.ceil(-1.5), int(-1.5), math.isclose(0.1 + 0.2, 0.3))`, `-2 -1 -1 True`, [`-1 -2 -1 False`, `-2 -1 -2 True`, `-2 -2 -1 True`],
      `floor goes down, ceil goes up, int() truncates toward zero, and isclose treats nearly equal floats as equal.`,
      `int() and floor behave the same for negative numbers.`,
      [`What tolerance does isclose use by default?`, `A relative tolerance of 1e-09.`]),
    iq("E", `What does this print?`, `x = 3.14159\nprint(f"{x:.2f}|{42:05d}|{255:x}|{0.5:.0%}|{1234567:,}")`, `3.14|00042|ff|50%|1,234,567`, [`3.14159|42|255|0.5|1234567`, `3.14|42000|ff|50|1,234,567`, `3.1|00042|FF|0.5%|1.234.567`],
      `After the colon come format specifiers: .2f two decimals, 05d zero-padded width 5, x hexadecimal, .0% percent, and the comma thousands separator.`,
      `f-strings can only insert values, not format them.`,
      [`How do you align text?`, `Use <, > or ^ with a width: f"{name:>10}".`]),
    iq("E", `What does this print?`, `from collections import Counter\n\nc = Counter("banana")\nprint(c.most_common(2), c["z"])`, `[('a', 3), ('n', 2)] 0`, [`[('b', 1), ('a', 3)] 0`, `[('a', 3), ('n', 2)] Raises KeyError`, `[('a', 3), ('n', 2)] None`],
      `Counter counts items, most_common returns the highest counts first, and a missing key counts as 0 instead of raising KeyError.`,
      `A Counter behaves exactly like a dict and raises KeyError for missing keys.`,
      [`What does Counter arithmetic do?`, `+ adds counts, - subtracts and drops non-positive counts.`]),
    iq("M", `What does this print?`, `from collections import defaultdict\n\nd = defaultdict(list)\nd["a"].append(1)\nprint(dict(d), d["b"], len(d))`, `{'a': [1]} [] 2`, [`{'a': [1]} Raises KeyError 1`, `{'a': [1]} None 1`, `{'a': [1]} [] 1`],
      `Reading a missing key in a defaultdict creates it with the default factory, so merely looking up "b" grows the dictionary.`,
      `Looking up a key never changes a defaultdict.`,
      [`How can you test for a key without creating it?`, `Use "b" in d or d.get("b").`]),
    iq("M", `What does this print?`, `import json\n\nprint(json.dumps({"a": [1, None, True], "b": "x"}), json.loads("[1, 2.0, null]"))`, `{"a": [1, null, true], "b": "x"} [1, 2.0, None]`, [`{'a': [1, None, True], 'b': 'x'} [1, 2.0, None]`, `{"a": [1, null, true], "b": "x"} [1, 2.0, null]`, `{"a": [1, none, True], "b": "x"} [1, 2, None]`],
      `JSON uses null, true and false; Python maps them to None, True and False. json.dumps always uses double quotes.`,
      `json.dumps produces the same text as print of a dict.`,
      [`What can json not serialise by default?`, `datetime, set, bytes and custom objects: pass default= or convert them first.`]),
    iq("M", `What does this print?`, `from pathlib import PurePosixPath as P\n\np = P("/a/b/c.txt")\nprint(p.name, p.suffix, p.parent, p.stem, p.parts)`, `c.txt .txt /a/b c ('/', 'a', 'b', 'c.txt')`, [`c.txt txt /a/b c ('a', 'b', 'c.txt')`, `c .txt /a/b c.txt ('/', 'a', 'b', 'c.txt')`, `c.txt .txt /a/b/c.txt c ('/', 'a', 'b', 'c.txt')`],
      `pathlib splits a path into name, suffix (with the dot), parent, stem and parts without touching the file system.`,
      `Paths are plain strings that must be sliced by hand.`,
      [`Why prefer pathlib to os.path?`, `Objects with operators (p / "x"), methods, and the same code on Windows and Linux.`]),
    iq("M", `What does this print?`, `data = [1, 2, 3]\nif (n := len(data)) > 2:\n    print(n, "big" if n > 2 else "small")`, `3 big`, [`True big`, `3 small`, `Raises SyntaxError`],
      `The walrus operator := assigns inside an expression, so n is set while the condition is evaluated.`,
      `:= is the same as == or only works in loops.`,
      [`When is the walrus helpful?`, `To avoid computing a value twice in conditions or comprehension filters.`]),
    iq("M", `What does this print?`, `a, *mid, z = [1, 2, 3, 4, 5]\nprint(a, mid, z)`, `1 [2, 3, 4] 5`, [`1 (2, 3, 4) 5`, `1 2 5`, `Raises ValueError`],
      `Starred unpacking collects the leftover items into a list.`,
      `You must unpack exactly as many names as there are items.`,
      [`Can you use two starred names?`, `No: only one starred target is allowed in an assignment.`]),
    iq("M", `What does this print?`, `import datetime\n\nd = datetime.date(2026, 1, 31)\nprint(d + datetime.timedelta(days=1), (datetime.date(2026, 3, 1) - d).days, d.strftime("%a %d %b"))`, `2026-02-01 29 Sat 31 Jan`, [`2026-01-32 29 Sat 31 Jan`, `2026-02-01 28 Sat 31 Jan`, `2026-02-01 29 Fri 31 Jan`],
      `Date arithmetic with timedelta handles month ends; subtracting dates gives a timedelta whose .days is 29 (28 days of February plus 1).`,
      `You must add one to the day and handle month overflow yourself.`,
      [`Which type represents a date and time with a time zone?`, `datetime.datetime with tzinfo, for example zoneinfo.ZoneInfo("Asia/Kolkata").`]),
    iq("M", `What does this print?`, `import re\n\nprint(re.findall(r"\\d+", "a1b22c333"), re.sub(r"\\s+", " ", "a   b \\n c"), bool(re.fullmatch(r"[a-z]+", "abc1")))`, `['1', '22', '333'] a b c False`, [`['1', '2', '3'] a b c False`, `['1', '22', '333'] a   b c True`, `['1', '22', '333'] a b c True`],
      `findall returns all runs of digits, \\s+ matches any whitespace run (including the newline), and fullmatch requires the whole string to match.`,
      `re.match and re.fullmatch behave the same.`,
      [`Why use raw strings for regular expressions?`, `So that backslashes reach the regex engine unchanged.`]),
    iq("M", `What does this print?`, `import itertools\n\nprint([(k, len(list(g))) for k, g in itertools.groupby("aabbbc")])`, `[('a', 2), ('b', 3), ('c', 1)]`, [`[('a', 3), ('b', 3), ('c', 1)]`, `[('a', 2), ('b', 2), ('c', 2)]`, `{'a': 2, 'b': 3, 'c': 1}`],
      `groupby groups consecutive equal items; sort first if you want one group per distinct key.`,
      `groupby groups all equal items, like SQL GROUP BY.`,
      [`What happens with "abab"?`, `Four groups, because equal items are not adjacent.`]),
    iq("M", `What does this print when run as a script?`, `import sys\n\nprint(len(sys.argv), __name__)`, `1 __main__`, [`0 __main__`, `1 main`, `2 __main__`],
      `sys.argv[0] is the script name, so with no extra arguments the length is 1; a script's __name__ is "__main__".`,
      `sys.argv holds only the extra arguments.`,
      [`Which module parses arguments properly?`, `argparse (or click, typer).`]),
    iq("M", `What does this print?`, `def f(x: int) -> str:\n    return x\n\nprint(f(5), type(f(5)).__name__)`, `5 int`, [`Raises TypeError`, `5 str`, `"5" str`],
      `Type hints are not enforced at run time; they are for readers and tools such as mypy.`,
      `Annotations convert or check the values.`,
      [`Which tool checks the hints?`, `A static type checker such as mypy or pyright, or a runtime library such as pydantic.`]),
    iq("H", `What does this print?`, `import functools\nimport operator\n\nprint(functools.reduce(operator.mul, range(1, 6)), list(map(operator.neg, [1, -2])))`, `120 [-1, 2]`, [`15 [-1, 2]`, `120 [1, -2]`, `24 [-1, 2]`],
      `operator.mul is the function form of *, so reduce computes 5 factorial; operator.neg negates each number.`,
      `You must write a lambda for every arithmetic operation.`,
      [`Why use the operator module?`, `Faster than lambdas and clearer in reduce, map and sort keys.`]),
    iq("H", `What does this print?`, `d = {"a": 1}\ntry:\n    v = d["b"]\nexcept KeyError:\n    v = "default"\nprint(v, d.setdefault("b", 2), d)`, `default 2 {'a': 1, 'b': 2}`, [`default None {'a': 1}`, `default 2 {'a': 1}`, `2 2 {'a': 1, 'b': 2}`],
      `This shows EAFP (ask forgiveness) with try/except, then setdefault, which inserts the default only when the key is missing and returns the value.`,
      `setdefault only reads; it never changes the dictionary.`,
      [`What is the difference between EAFP and LBYL?`, `EAFP tries and handles exceptions; LBYL checks conditions first. EAFP is more idiomatic in Python and avoids races.`]),
  ];
  lessons.push({
    title: "Interview Questions: Standard Library and Pythonic Idioms",
    minutes: 60,
    learn: ["Use collections, itertools, functools and operator confidently", "Format strings, handle dates, JSON, paths and regular expressions", "Use modern syntax: walrus, unpacking, f-strings, type hints", "Explain the module and script conventions"],
    why: "Knowing the standard library shows that you write Python, not C or Java in Python syntax. Interviewers look for idioms that make code short, readable and fast.",
    items,
    revision: ["__name__ == \"__main__\" separates script behaviour from import behaviour.", "Counter, defaultdict, deque, itertools and functools solve most helper problems.", "f-string format specs: .2f, 05d, x, %, comma.", "Type hints are not enforced at run time.", "EAFP: try and handle the exception; setdefault and get avoid KeyError."],
    quiz: qaQuiz(items),
    tasks: [task("List the Imports", "Read the lines of a Python source file from standard input. Find its import statements (import a.b, import a, b as c, and from a.b import c; ignore relative imports that start with a dot). Print the distinct top-level module names in alphabetical order on one line, or none if there are no imports.", "import sys\nmodules = set()\nfor line in sys.stdin.read().splitlines():\n    line = line.strip()\n    # collect the top-level module names\n", `import sys

modules = set()
for line in sys.stdin.read().splitlines():
    line = line.strip()
    if line.startswith("import "):
        for part in line[7:].split(","):
            name = part.strip().split(" as ")[0].strip()
            modules.add(name.split(".")[0])
    elif line.startswith("from "):
        name = line[5:].split()[0]
        if not name.startswith("."):
            modules.add(name.split(".")[0])
print(*sorted(modules) if modules else ["none"])`, [["import os\nimport sys, json\nfrom collections import deque\nimport os.path as p", "collections json os sys"], ["from . import x\nfrom .mod import y", "none"], ["import numpy as np\nimport pandas as pd", "numpy pandas"], ["x = 1", "none"]])],
  });
}

module.exports = { lessons };
