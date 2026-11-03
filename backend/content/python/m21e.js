// Phase 7 / Module 21, lesson 9: trees and graphs, with tagged practice problems.
// Trees are given in level-order with the word null for a missing child, for example "3 9 20 null null 15 7".
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, prob: p } = require("./lib");

const lessons = [];

// Shared Python helper for the tree problems (inlined into each reference solution).
const TREE = `from collections import deque


class Node:
    def __init__(self, val):
        self.val = val
        self.left = None
        self.right = None


def build(tokens):
    if not tokens or tokens[0] == "null":
        return None
    root = Node(int(tokens[0]))
    queue = deque([root])
    i = 1
    while queue and i < len(tokens):
        node = queue.popleft()
        if i < len(tokens) and tokens[i] != "null":
            node.left = Node(int(tokens[i]))
            queue.append(node.left)
        i += 1
        if i < len(tokens) and tokens[i] != "null":
            node.right = Node(int(tokens[i]))
            queue.append(node.right)
        i += 1
    return root


`;

lessons.push({
  title: "Trees and Graphs: Traversals, Paths, Components and Shortest Paths",
  minutes: 100,
  learn: ["Traverse binary trees recursively and level by level", "Use BFS and DFS on graphs, grids and implicit graphs", "Detect cycles, find components and order tasks topologically", "Compute shortest paths (BFS, Dijkstra) and minimum spanning trees"],
  why: "Trees model file systems, HTML pages and organisation charts; graphs model maps, networks, dependencies and social connections. Together they are a very large part of interview questions and real systems.",
  realWorld: "Route planners run Dijkstra, build tools order tasks topologically, social apps count connected groups, and image tools flood-fill regions (islands) in a grid.",
  simple: "A <strong>tree</strong> is a graph with no cycles where each node has one parent. A <strong>graph</strong> is nodes plus edges. To explore it, either go as deep as possible first (<strong>DFS</strong>, a stack or recursion) or layer by layer (<strong>BFS</strong>, a queue).",
  detail: `<h3>Binary trees</h3>
<ul><li>A node has <code>val</code>, <code>left</code>, <code>right</code>. The problems here give the tree as level-order tokens (&quot;3 9 20 null null 15 7&quot;); the helper <code>build()</code> in each solution turns them into nodes.</li><li><strong>Traversals</strong>: preorder (node, left, right), inorder (left, node, right: sorted order for a BST), postorder (left, right, node), level order (BFS with a queue).</li><li>Most tree answers are a recursive function that combines the answers of the two children: depth = 1 + max(left, right); diameter, path sums and validity track extra values on the way up.</li><li>A <strong>binary search tree</strong> keeps left &lt; node &lt; right: validate with bounds passed down, find the k-th smallest by an inorder walk.</li></ul>
<h3>Graph representations</h3>
${table(["Form", "How", "Use"], [["adjacency list", "<code>graph[u]</code> is a list of neighbours (a dict or list of lists)", "default; O(V + E) memory"], ["edge list", "list of (u, v, w) tuples", "Kruskal, Bellman-Ford"], ["grid", "neighbours are (r+1, c), (r-1, c), (r, c+1), (r, c-1)", "islands, mazes, rotting oranges"], ["implicit", "neighbours computed on the fly (change one letter of a word)", "word ladder, puzzles"]])}
<h3>Algorithms and when to use them</h3>
${table(["Task", "Algorithm", "Cost"], [["visit everything, count components", "DFS or BFS, or union-find", "O(V + E)"], ["shortest path, equal edge costs", "BFS from the source", "O(V + E)"], ["shortest path, positive weights", "Dijkstra with a heap", "O((V + E) log V)"], ["detect a cycle (undirected)", "union-find: an edge joining two nodes already connected", "O(E alpha(V))"], ["order tasks with prerequisites", "topological sort (Kahn: repeatedly take nodes with in-degree 0); fewer nodes taken than exist means a cycle", "O(V + E)"], ["two-colouring / bipartite", "BFS colouring, fail on an edge with equal colours", "O(V + E)"], ["cheapest network joining all nodes", "Kruskal (sort edges + union-find) or Prim", "O(E log E)"]])}
<h3>Habits</h3>
<ul><li>Mark nodes visited when you <em>enqueue</em> them in BFS (not when you dequeue), or the same node enters the queue many times.</li><li>Deep recursion on a path-like tree can exceed Python's recursion limit; use an explicit stack or queue when the input can be 10^5 deep.</li><li>Always ask: directed or undirected? weighted? can there be cycles, self-loops, parallel edges, disconnected parts?</li></ul>`,
  syntax: { code: `from collections import deque\ndist = {s: 0}\nq = deque([s])\nwhile q:\n    u = q.popleft()\n    for v in graph[u]:\n        if v not in dist:\n            dist[v] = dist[u] + 1\n            q.append(v)`, note: "BFS gives shortest paths when every edge costs the same." },
  diagram: chain("Breadth-first search", "Left to right: put the start node in a queue, take the oldest node, visit its unvisited neighbours and add them to the queue, and repeat until the queue is empty.",
    [{ k: "proc", t: "queue = [start]\nmark start" }, { k: "dec", t: "queue\nempty?" }, { k: "proc", t: "pop a node,\nvisit neighbours" }, { k: "proc", t: "push and mark\nunseen neighbours" }], { w: 165, gap: 32, hgt: 62 }),
  example: { code: `from collections import deque


class Node:
    def __init__(self, val, left=None, right=None):
        self.val, self.left, self.right = val, left, right


def inorder(node):
    return inorder(node.left) + [node.val] + inorder(node.right) if node else []


def levels(root):
    out, queue = [], deque([root])
    while queue:
        out.append([node.val for node in queue])
        queue = deque(child for node in queue for child in (node.left, node.right) if child)
    return out


def bfs_distances(graph, start):
    dist = {start: 0}
    queue = deque([start])
    while queue:
        u = queue.popleft()
        for v in graph[u]:
            if v not in dist:
                dist[v] = dist[u] + 1
                queue.append(v)
    return dist


def topological_order(n, edges):
    graph, indegree = [[] for _ in range(n)], [0] * n
    for u, v in edges:
        graph[u].append(v)
        indegree[v] += 1
    queue = deque(i for i in range(n) if indegree[i] == 0)
    order = []
    while queue:
        u = queue.popleft()
        order.append(u)
        for v in graph[u]:
            indegree[v] -= 1
            if indegree[v] == 0:
                queue.append(v)
    return order if len(order) == n else None


tree = Node(3, Node(9), Node(20, Node(15), Node(7)))
print(inorder(tree), levels(tree))
print(bfs_distances({0: [1, 2], 1: [3], 2: [3], 3: [4], 4: []}, 0))
print(topological_order(4, [(0, 1), (0, 2), (1, 3), (2, 3)]), topological_order(2, [(0, 1), (1, 0)]))`, out: `[9, 3, 15, 20, 7] [[3], [9, 20], [15, 7]]
{0: 0, 1: 1, 2: 1, 3: 2, 4: 3}
[0, 1, 2, 3] None` },
  lineByLine: [["inorder", "Left subtree, the node, then the right subtree: 9 3 15 20 7."], ["levels", "Each loop turn collects one whole level, then builds the next level from the children of the current one."], ["bfs_distances", "dist doubles as the visited set. Node 3 is reached through 1 or 2 at distance 2; node 4 is at distance 3."], ["topological_order", "Nodes with no unmet prerequisite are processed first; removing them lowers the in-degree of their successors. A cycle leaves some nodes unprocessed, so None is returned."]],
  dryRun: { intro: "Kahn's algorithm on edges 0-&gt;1, 0-&gt;2, 1-&gt;3, 2-&gt;3:", headers: ["pop", "order so far", "in-degrees after", "queue after"], rows: [["start", "[]", "[0, 1, 1, 2]", "[0]"], ["0", "[0]", "[0, 0, 0, 2]", "[1, 2]"], ["1", "[0, 1]", "[0, 0, 0, 1]", "[2]"], ["2", "[0, 1, 2]", "[0, 0, 0, 0]", "[3]"], ["3", "[0, 1, 2, 3]", "-", "[]"]] },
  realExample: { intro: "Dijkstra's algorithm: the cheapest distance from node 0 to every node of a small weighted graph, using a heap of (distance, node).", code: `import heapq

edges = [(0, 1, 4), (0, 2, 1), (2, 1, 2), (1, 3, 1)]
graph = {i: [] for i in range(4)}
for u, v, w in edges:
    graph[u].append((v, w))
    graph[v].append((u, w))

dist = {i: float("inf") for i in range(4)}
dist[0] = 0
heap = [(0, 0)]
while heap:
    d, u = heapq.heappop(heap)
    if d > dist[u]:
        continue
    for v, w in graph[u]:
        if d + w < dist[v]:
            dist[v] = d + w
            heapq.heappush(heap, (dist[v], v))
print([dist[i] for i in range(4)])`, out: `[0, 3, 1, 4]` },
  mistakes: ["Marking visited on dequeue in BFS (duplicates in the queue).", "Forgetting disconnected components when scanning every node.", "Using DFS recursion on a 10^5-node chain.", "Using BFS for weighted shortest paths.", "Treating an undirected edge as one-directional (or counting the parent as a cycle)."],
  practices: ["Draw the graph for a small input.", "Decide directed or undirected before coding.", "Pick the algorithm from the task table.", "State complexity in V and E."],
  interview: ["BFS versus DFS: when each?", "How do you detect a cycle in a directed graph?", "Explain Dijkstra and why it fails with negative edges.", "How do you validate a binary search tree?"],
  practiceQs: ["What does an inorder walk of a BST give?", "Why is BFS correct for unweighted shortest paths?", "How does Kahn's algorithm detect a cycle?", "What is the complexity of Dijkstra with a heap?"],
  revision: ["Tree answers combine children answers.", "BFS = queue = shortest paths (equal costs); DFS = stack/recursion.", "Topological sort, union-find, Dijkstra, Kruskal.", "Mark visited when enqueuing."],
  hinglish: "Tree ke zyadatar sawal recursion se hote hain jahan dono bachchon ke jawab milakar parent ka jawab banta hai. Graph mein BFS queue se layer by layer chalta hai aur barabar weight wale edges mein sabse chhota raasta deta hai; weighted ke liye Dijkstra. Dependency ka order topological sort se milta hai.",
  quiz: [
    mcq("What does an inorder traversal of a binary search tree produce?", ["Values in descending order", "Values in ascending order", "A random order", "Level by level"], 1, "Left subtree, node, right subtree visits smaller values first."),
    mcq("Which algorithm gives the shortest path in an unweighted graph?", ["DFS", "BFS", "Kruskal", "Topological sort"], 1, "BFS explores nodes in order of their distance."),
    mcq("How does Kahn's topological sort detect a cycle?", ["It never can", "Fewer nodes are output than exist in the graph", "The queue becomes empty at the start", "A node has in-degree 0"], 1, "Nodes on a cycle never reach in-degree 0."),
    mcq("Why does Dijkstra's algorithm need non-negative edge weights?", ["It does not", "A finalised node's distance could be improved later by a negative edge", "The heap only stores positive numbers", "Python cannot add negatives"], 1, "The greedy choice of the closest node is only safe if later edges cannot reduce a path."),
    mcq("In BFS, when should a node be marked visited?", ["When it is dequeued", "When it is enqueued", "After the loop", "Never"], 1, "Otherwise the same node can be added to the queue several times.")
  ],
  tasks: [
    p({ t: "Maximum Depth of a Binary Tree", d: "E", tags: ["tree", "recursion"], tc: "O(n)", sc: "O(h)", goal: "Compute a tree property by combining the answers of the two subtrees.", hint: "depth(node) = 1 + max(depth(left), depth(right)), and 0 for an empty tree.",
      s: "Read a binary tree in level-order (null for missing children). Print its maximum depth: the number of nodes on the longest path from the root down to a leaf.", inp: "One line of level-order tokens.", out: "An integer.", edge: "a single node, a skewed tree",
      sol: `${TREE}def depth(node):
    return 0 if node is None else 1 + max(depth(node.left), depth(node.right))


print(depth(build(input().split())))`, c: [["3 9 20 null null 15 7", "3"], ["1 null 2", "2"], ["5", "1"], ["1 2 3 4 null null 5", "3"]] }),
    p({ t: "Inorder Traversal", d: "E", tags: ["tree", "traversal"], tc: "O(n)", sc: "O(h)", goal: "Walk left, visit, then right; practise it iteratively with an explicit stack.", hint: "Push nodes while going left, pop to visit, then move to the right child.",
      s: "Read a binary tree in level-order. Print its inorder traversal (left subtree, node, right subtree) on one line.", inp: "One line.", out: "The values.", edge: "no left children",
      sol: `${TREE}root = build(input().split())
out, stack, node = [], [], root
while stack or node:
    while node:
        stack.append(node)
        node = node.left
    node = stack.pop()
    out.append(node.val)
    node = node.right
print(*out)`, c: [["1 null 2 3", "1 3 2"], ["4 2 6 1 3 5 7", "1 2 3 4 5 6 7"], ["7", "7"], ["2 1", "1 2"]] }),
    p({ t: "Symmetric Tree", d: "E", tags: ["tree", "recursion"], tc: "O(n)", sc: "O(h)", goal: "Compare two subtrees as mirror images using a two-argument recursion.", hint: "Two nodes mirror each other when their values match, left of one mirrors right of the other, and vice versa.",
      s: "Read a binary tree in level-order. Print yes if it is a mirror image of itself around its centre, otherwise no.", inp: "One line.", out: "yes or no.", edge: "single node",
      sol: `${TREE}def mirror(a, b):
    if a is None or b is None:
        return a is b
    return a.val == b.val and mirror(a.left, b.right) and mirror(a.right, b.left)


root = build(input().split())
print("yes" if mirror(root, root) else "no")`, c: [["1 2 2 3 4 4 3", "yes"], ["1 2 2 null 3 null 3", "no"], ["1", "yes"], ["1 2 3", "no"]] }),
    p({ t: "Root-to-Leaf Path Sum", d: "E", tags: ["tree", "recursion"], tc: "O(n)", sc: "O(h)", goal: "Pass the remaining target down and test it at the leaves only.", hint: "Subtract the node value on the way down; at a leaf the remainder must be 0.",
      s: "Read a binary tree in level-order and then a target sum. Print yes if some path from the root to a leaf (a node with no children) has values adding up to the target, otherwise no.", inp: "Line 1: the tree. Line 2: the target.", out: "yes or no.", edge: "a path that ends at an inner node does not count",
      sol: `${TREE}def has_path(node, remaining):
    if node is None:
        return False
    remaining -= node.val
    if node.left is None and node.right is None:
        return remaining == 0
    return has_path(node.left, remaining) or has_path(node.right, remaining)


root = build(input().split())
print("yes" if has_path(root, int(input())) else "no")`, c: [["5 4 8 11 null 13 4 7 2 null null null 1\n22", "yes"], ["1 2 3\n5", "no"], ["1 2\n1", "no"], ["1\n1", "yes"]] }),
    p({ t: "Number of Connected Components", d: "E", tags: ["graph", "dfs", "union-find"], tc: "O(V + E)", sc: "O(V)", goal: "Count how many times a fresh search must be started to cover all nodes.", hint: "Loop over nodes; start a DFS or BFS from every unvisited node and count the starts.",
      s: "Read n and m and then m undirected edges (u v) between nodes 0..n-1. Print the number of connected components.", inp: "Line 1: n m. Then m edges.", out: "An integer.", edge: "no edges",
      sol: `n, m = map(int, input().split())
adj = [[] for _ in range(n)]
for _ in range(m):
    u, v = map(int, input().split())
    adj[u].append(v)
    adj[v].append(u)
seen = [False] * n
count = 0
for start in range(n):
    if not seen[start]:
        count += 1
        stack = [start]
        seen[start] = True
        while stack:
            u = stack.pop()
            for v in adj[u]:
                if not seen[v]:
                    seen[v] = True
                    stack.append(v)
print(count)`, c: [["5 3\n0 1\n1 2\n3 4", "2"], ["3 0", "3"], ["4 3\n0 1\n1 2\n2 3", "1"], ["1 0", "1"]] }),
    p({ t: "Level Order Traversal", d: "M", tags: ["tree", "bfs"], tc: "O(n)", sc: "O(n)", goal: "Process a tree one level at a time with a queue.", hint: "At each round take exactly the nodes currently in the queue as one level.",
      s: "Read a binary tree in level-order. Print its values level by level, one level per line, left to right.", inp: "One line.", out: "One line per level.", edge: "single node",
      sol: `${TREE}root = build(input().split())
level = [root] if root else []
while level:
    print(*(node.val for node in level))
    level = [child for node in level for child in (node.left, node.right) if child]`, c: [["3 9 20 null null 15 7", "3\n9 20\n15 7"], ["1", "1"], ["1 2 3 4 5", "1\n2 3\n4 5"], ["1 null 2", "1\n2"]] }),
    p({ t: "Diameter of a Binary Tree", d: "M", tags: ["tree", "recursion"], tc: "O(n)", sc: "O(h)", goal: "Track the best path through each node while returning the height upwards.", hint: "At every node the longest path through it is left height + right height; keep the maximum in a variable outside the recursion.",
      s: "Read a binary tree in level-order. Print its diameter: the number of edges on the longest path between any two nodes (the path may or may not pass through the root).", inp: "One line.", out: "An integer.", edge: "single node",
      sol: `${TREE}best = [0]


def height(node):
    if node is None:
        return 0
    left, right = height(node.left), height(node.right)
    best[0] = max(best[0], left + right)
    return 1 + max(left, right)


height(build(input().split()))
print(best[0])`, c: [["1 2 3 4 5", "3"], ["1 2", "1"], ["1", "0"], ["1 2 null 3 null 4", "3"]] }),
    p({ t: "Validate a Binary Search Tree", d: "M", tags: ["tree", "bst", "recursion"], tc: "O(n)", sc: "O(h)", goal: "Pass the allowed value range down the recursion; comparing only with the parent is not enough.", hint: "Each node must lie strictly between a lower and an upper bound inherited from its ancestors.",
      s: "Read a binary tree in level-order. Print yes if it is a valid binary search tree (every node is greater than everything in its left subtree and smaller than everything in its right subtree, with no equal values), otherwise no.", inp: "One line.", out: "yes or no.", edge: "equal values, a deep violation",
      sol: `${TREE}def valid(node, low, high):
    if node is None:
        return True
    if not low < node.val < high:
        return False
    return valid(node.left, low, node.val) and valid(node.right, node.val, high)


print("yes" if valid(build(input().split()), float("-inf"), float("inf")) else "no")`, c: [["2 1 3", "yes"], ["5 1 4 null null 3 6", "no"], ["1 1", "no"], ["5 3 7 2 4 6 8", "yes"]] }),
    p({ t: "Lowest Common Ancestor", d: "M", tags: ["tree", "recursion"], tc: "O(n)", sc: "O(h)", goal: "Let each subtree report whether it contains one of the two nodes; the first node that sees both sides is the answer.", hint: "Return the node itself when it equals p or q; if both subtrees return something, the current node is the LCA.",
      s: "Read a binary tree in level-order with distinct values, then two values p and q that exist in the tree. Print the value of their lowest common ancestor (a node may be its own ancestor).", inp: "Line 1: the tree. Line 2: p and q.", out: "An integer.", edge: "one node is the ancestor of the other",
      sol: `${TREE}def lca(node, p, q):
    if node is None or node.val in (p, q):
        return node
    left, right = lca(node.left, p, q), lca(node.right, p, q)
    return node if left and right else left or right


root = build(input().split())
p_val, q_val = map(int, input().split())
print(lca(root, p_val, q_val).val)`, c: [["3 5 1 6 2 0 8 null null 7 4\n5 1", "3"], ["3 5 1 6 2 0 8 null null 7 4\n5 4", "5"], ["1 2\n1 2", "1"], ["6 2 8 0 4 7 9\n2 8", "6"]] }),
    p({ t: "Right Side View", d: "M", tags: ["tree", "bfs"], tc: "O(n)", sc: "O(n)", goal: "Take the last node of every level from a level-order walk.", hint: "Do a level-order traversal and keep the final value of each level.",
      s: "Read a binary tree in level-order. Imagine standing on its right side. Print the values you can see from top to bottom (the last node of each level) on one line.", inp: "One line.", out: "One line.", edge: "left-only branches are visible too",
      sol: `${TREE}root = build(input().split())
level = [root] if root else []
view = []
while level:
    view.append(level[-1].val)
    level = [child for node in level for child in (node.left, node.right) if child]
print(*view)`, c: [["1 2 3 null 5 null 4", "1 3 4"], ["1 null 3", "1 3"], ["1", "1"], ["1 2 3 4", "1 3 4"]] }),
    p({ t: "Kth Smallest in a BST", d: "M", tags: ["tree", "bst", "traversal"], tc: "O(h + k)", sc: "O(h)", goal: "Use the fact that an inorder walk of a BST visits values in ascending order and stop after k.", hint: "Walk inorder with a stack and count visited nodes until the kth.",
      s: "Read a binary search tree in level-order and then k. Print its kth smallest value (k starts at 1).", inp: "Line 1: the tree. Line 2: k.", out: "An integer.", edge: "k = 1",
      sol: `${TREE}root = build(input().split())
k = int(input())
stack, node = [], root
answer = None
while stack or node:
    while node:
        stack.append(node)
        node = node.left
    node = stack.pop()
    k -= 1
    if k == 0:
        answer = node.val
        break
    node = node.right
print(answer)`, c: [["3 1 4 null 2\n1", "1"], ["5 3 6 2 4 null null 1\n3", "3"], ["2\n1", "2"], ["4 2 6 1 3 5 7\n6", "6"]] }),
    p({ t: "Number of Islands", d: "M", tags: ["graph", "grid", "dfs"], tc: "O(r x c)", sc: "O(r x c)", goal: "Treat a grid as a graph and flood-fill each land region once.", hint: "For every unvisited 1 start a DFS or BFS that marks the whole connected region, and count the starts.",
      s: "Read r and c and then r rows of 0 and 1 characters (1 is land). Print the number of islands: groups of land cells connected up, down, left or right (diagonals do not connect).", inp: "Line 1: r c. Then r rows.", out: "An integer.", edge: "diagonal cells",
      sol: `r, c = map(int, input().split())
grid = [list(input()) for _ in range(r)]
count = 0
for i in range(r):
    for j in range(c):
        if grid[i][j] == "1":
            count += 1
            stack = [(i, j)]
            grid[i][j] = "0"
            while stack:
                x, y = stack.pop()
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < r and 0 <= ny < c and grid[nx][ny] == "1":
                        grid[nx][ny] = "0"
                        stack.append((nx, ny))
print(count)`, c: [["4 5\n11000\n11000\n00100\n00011", "3"], ["1 1\n1", "1"], ["2 2\n00\n00", "0"], ["3 3\n101\n010\n101", "5"]] }),
    p({ t: "Shortest Path in an Unweighted Graph", d: "M", tags: ["graph", "bfs"], tc: "O(V + E)", sc: "O(V)", goal: "Use BFS because the first time it reaches a node is along a shortest path.", hint: "Keep a distance dictionary, and push a neighbour only the first time you see it.",
      s: "Read n, m, s and t, then m undirected edges (u v). Print the minimum number of edges on a path from s to t, or -1 if t cannot be reached.", inp: "Line 1: n m s t. Then m edges.", out: "An integer.", edge: "s equals t, unreachable",
      sol: `from collections import deque

n, m, s, t = map(int, input().split())
adj = [[] for _ in range(n)]
for _ in range(m):
    u, v = map(int, input().split())
    adj[u].append(v)
    adj[v].append(u)
dist = {s: 0}
queue = deque([s])
while queue:
    u = queue.popleft()
    for v in adj[u]:
        if v not in dist:
            dist[v] = dist[u] + 1
            queue.append(v)
print(dist.get(t, -1))`, c: [["5 5 0 4\n0 1\n1 2\n2 4\n0 3\n3 4", "2"], ["3 1 0 2\n0 1", "-1"], ["2 1 0 0\n0 1", "0"], ["4 4 0 3\n0 1\n1 2\n2 3\n0 3", "1"]] }),
    p({ t: "Cycle in an Undirected Graph", d: "M", tags: ["graph", "union-find"], tc: "O(E alpha(V))", sc: "O(V)", goal: "Use union-find: an edge whose ends are already connected closes a cycle.", hint: "Union the two ends of each edge; if they already share a root, a cycle exists.",
      s: "Read n and m and then m undirected edges (no repeated edges and no self-loops). Print yes if the graph contains a cycle, otherwise no.", inp: "Line 1: n m. Then m edges.", out: "yes or no.", edge: "forest",
      sol: `n, m = map(int, input().split())
parent = list(range(n))


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


cycle = False
for _ in range(m):
    u, v = map(int, input().split())
    ru, rv = find(u), find(v)
    if ru == rv:
        cycle = True
    else:
        parent[ru] = rv
print("yes" if cycle else "no")`, c: [["4 4\n0 1\n1 2\n2 3\n3 1", "yes"], ["3 2\n0 1\n1 2", "no"], ["3 3\n0 1\n1 2\n2 0", "yes"], ["2 0", "no"]] }),
    p({ t: "Course Schedule", d: "M", tags: ["graph", "topological-sort"], tc: "O(V + E)", sc: "O(V + E)", goal: "Detect a cycle in a directed graph with Kahn's algorithm.", hint: "Repeatedly remove courses with no remaining prerequisites; if all courses are removed there is no cycle.",
      s: "Read n and m and then m pairs a b meaning course b must be taken before course a. Print yes if all n courses can be completed, otherwise no.", inp: "Line 1: n m. Then m pairs.", out: "yes or no.", edge: "a cycle of length 2",
      sol: `from collections import deque

n, m = map(int, input().split())
adj = [[] for _ in range(n)]
indegree = [0] * n
for _ in range(m):
    a, b = map(int, input().split())
    adj[b].append(a)
    indegree[a] += 1
queue = deque(i for i in range(n) if indegree[i] == 0)
done = 0
while queue:
    u = queue.popleft()
    done += 1
    for v in adj[u]:
        indegree[v] -= 1
        if indegree[v] == 0:
            queue.append(v)
print("yes" if done == n else "no")`, c: [["2 1\n1 0", "yes"], ["2 2\n1 0\n0 1", "no"], ["4 3\n1 0\n2 1\n3 2", "yes"], ["3 3\n0 1\n1 2\n2 0", "no"]] }),
    p({ t: "Smallest Topological Order", d: "M", tags: ["graph", "topological-sort", "heap"], tc: "O((V + E) log V)", sc: "O(V + E)", goal: "Pick the smallest available node each time by keeping the zero in-degree nodes in a min-heap.", hint: "Kahn's algorithm with heapq instead of a plain queue.",
      s: "Read n and m and then m directed edges u v (u must come before v). Print the lexicographically smallest topological order of the nodes 0..n-1 on one line, or the word impossible if the graph has a cycle.", inp: "Line 1: n m. Then m edges.", out: "The order or impossible.", edge: "no edges, a cycle",
      sol: `import heapq

n, m = map(int, input().split())
adj = [[] for _ in range(n)]
indegree = [0] * n
for _ in range(m):
    u, v = map(int, input().split())
    adj[u].append(v)
    indegree[v] += 1
heap = [i for i in range(n) if indegree[i] == 0]
heapq.heapify(heap)
order = []
while heap:
    u = heapq.heappop(heap)
    order.append(u)
    for v in adj[u]:
        indegree[v] -= 1
        if indegree[v] == 0:
            heapq.heappush(heap, v)
print(*order if len(order) == n else ["impossible"])`, c: [["4 3\n0 1\n0 2\n2 3", "0 1 2 3"], ["3 2\n2 1\n1 0", "2 1 0"], ["3 0", "0 1 2"], ["2 2\n0 1\n1 0", "impossible"]] }),
    p({ t: "Rotting Oranges", d: "M", tags: ["graph", "grid", "bfs"], tc: "O(r x c)", sc: "O(r x c)", goal: "Start a BFS from all rotten oranges at once (multi-source) and count the layers.", hint: "Put every rotten cell in the queue at time 0; each BFS layer is one minute.",
      s: "Read r and c and then an r by c grid with 0 (empty), 1 (fresh orange) and 2 (rotten orange). Each minute every fresh orange next to (up, down, left, right) a rotten one becomes rotten. Print the number of minutes until no fresh orange remains, or -1 if that never happens.", inp: "Line 1: r c. Then r rows.", out: "An integer.", edge: "no fresh oranges, unreachable oranges",
      sol: `from collections import deque

r, c = map(int, input().split())
grid = [list(map(int, input().split())) for _ in range(r)]
queue = deque()
fresh = 0
for i in range(r):
    for j in range(c):
        if grid[i][j] == 2:
            queue.append((i, j, 0))
        elif grid[i][j] == 1:
            fresh += 1
minutes = 0
while queue:
    x, y, t = queue.popleft()
    minutes = max(minutes, t)
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < r and 0 <= ny < c and grid[nx][ny] == 1:
            grid[nx][ny] = 2
            fresh -= 1
            queue.append((nx, ny, t + 1))
print(minutes if fresh == 0 else -1)`, c: [["3 3\n2 1 1\n1 1 0\n0 1 1", "4"], ["3 3\n2 1 1\n0 1 1\n1 0 1", "-1"], ["1 1\n0", "0"], ["1 2\n2 1", "1"]] }),
    p({ t: "Is the Graph Bipartite", d: "M", tags: ["graph", "bfs", "colouring"], tc: "O(V + E)", sc: "O(V)", goal: "Two-colour the graph by BFS; an edge joining two nodes of the same colour proves an odd cycle.", hint: "Give neighbours the opposite colour; a conflict means the graph is not bipartite. Check every component.",
      s: "Read n and m and then m undirected edges. Print yes if the nodes can be split into two groups so that every edge joins nodes of different groups, otherwise no.", inp: "Line 1: n m. Then m edges.", out: "yes or no.", edge: "disconnected graph, odd cycle",
      sol: `from collections import deque

n, m = map(int, input().split())
adj = [[] for _ in range(n)]
for _ in range(m):
    u, v = map(int, input().split())
    adj[u].append(v)
    adj[v].append(u)
color = [-1] * n
ok = True
for start in range(n):
    if color[start] != -1:
        continue
    color[start] = 0
    queue = deque([start])
    while queue and ok:
        u = queue.popleft()
        for v in adj[u]:
            if color[v] == -1:
                color[v] = 1 - color[u]
                queue.append(v)
            elif color[v] == color[u]:
                ok = False
print("yes" if ok else "no")`, c: [["4 4\n0 1\n1 2\n2 3\n3 0", "yes"], ["3 3\n0 1\n1 2\n2 0", "no"], ["2 0", "yes"], ["5 4\n0 1\n1 2\n2 3\n3 1", "no"]] }),
    p({ t: "Binary Tree Maximum Path Sum", d: "H", tags: ["tree", "recursion"], tc: "O(n)", sc: "O(h)", goal: "Return the best downward gain to the parent while recording the best path that bends at each node.", hint: "At a node, take max(child gain, 0) from both sides to form a path through it; return node value plus the better single side.",
      s: "Read a binary tree in level-order with integer values (possibly negative). Print the maximum sum over all paths that connect any two nodes along parent-child edges (a path needs at least one node and need not pass through the root).", inp: "One line.", out: "An integer.", edge: "all negative values",
      sol: `${TREE}best = [float("-inf")]


def gain(node):
    if node is None:
        return 0
    left = max(gain(node.left), 0)
    right = max(gain(node.right), 0)
    best[0] = max(best[0], node.val + left + right)
    return node.val + max(left, right)


gain(build(input().split()))
print(best[0])`, c: [["1 2 3", "6"], ["-10 9 20 null null 15 7", "42"], ["-3", "-3"], ["2 -1", "2"]] }),
    p({ t: "Cheapest Path (Dijkstra)", d: "H", tags: ["graph", "dijkstra", "heap"], tc: "O((V + E) log V)", sc: "O(V + E)", goal: "Always expand the closest unfinished node using a heap, skipping stale heap entries.", hint: "Push (distance, node) pairs; ignore a popped pair whose distance is larger than the best known.",
      s: "Read n, m, s and t, then m undirected weighted edges u v w (positive integers). Print the minimum total weight of a path from s to t, or -1 if t is unreachable.", inp: "Line 1: n m s t. Then m edges.", out: "An integer.", edge: "s equals t, unreachable",
      sol: `import heapq

n, m, s, t = map(int, input().split())
adj = [[] for _ in range(n)]
for _ in range(m):
    u, v, w = map(int, input().split())
    adj[u].append((v, w))
    adj[v].append((u, w))
dist = [float("inf")] * n
dist[s] = 0
heap = [(0, s)]
while heap:
    d, u = heapq.heappop(heap)
    if d > dist[u]:
        continue
    for v, w in adj[u]:
        if d + w < dist[v]:
            dist[v] = d + w
            heapq.heappush(heap, (dist[v], v))
print(dist[t] if dist[t] != float("inf") else -1)`, c: [["4 4 0 3\n0 1 1\n1 3 5\n0 2 2\n2 3 1", "3"], ["3 1 0 2\n0 1 4", "-1"], ["2 1 0 1\n0 1 7", "7"], ["1 0 0 0", "0"]] }),
    p({ t: "Word Ladder Length", d: "H", tags: ["graph", "bfs", "implicit-graph"], tc: "O(N x L^2)", sc: "O(N x L)", goal: "Model words as nodes, link words that differ by one letter, and use BFS for the shortest chain.", hint: "Group words by wildcard patterns such as h*t so neighbours are found without comparing all pairs.",
      s: "Read a begin word, an end word, a number n and then n dictionary words (all of equal length, lower case). Each step changes exactly one letter and the new word must be in the dictionary. Print the number of words in the shortest sequence from begin to end including both, or 0 if there is none (the end word must be in the dictionary).", inp: "Begin, end, n, then n words.", out: "An integer.", edge: "end word missing",
      sol: `from collections import defaultdict, deque

begin = input()
end = input()
n = int(input())
words = {input() for _ in range(n)}
answer = 0
if end in words:
    buckets = defaultdict(list)
    for w in words | {begin}:
        for i in range(len(w)):
            buckets[w[:i] + "*" + w[i + 1:]].append(w)
    seen = {begin}
    queue = deque([(begin, 1)])
    while queue:
        word, steps = queue.popleft()
        if word == end:
            answer = steps
            break
        for i in range(len(word)):
            for nxt in buckets[word[:i] + "*" + word[i + 1:]]:
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append((nxt, steps + 1))
print(answer)`, c: [["hit\ncog\n6\nhot\ndot\ndog\nlot\nlog\ncog", "5"], ["hit\ncog\n5\nhot\ndot\ndog\nlot\nlog", "0"], ["a\nc\n3\na\nb\nc", "2"], ["cat\ncot\n1\ncot", "2"]] }),
    p({ t: "Minimum Spanning Tree Weight", d: "H", tags: ["graph", "union-find", "mst"], tc: "O(E log E)", sc: "O(V)", goal: "Sort edges by weight and add each one that connects two different components (Kruskal).", hint: "Union-find tells whether an edge joins two separate components; stop after V - 1 edges.",
      s: "Read n and m and then m undirected weighted edges u v w. Print the total weight of a minimum spanning tree, or -1 if the graph is not connected.", inp: "Line 1: n m. Then m edges.", out: "An integer.", edge: "disconnected graph, single node",
      sol: `n, m = map(int, input().split())
edges = sorted((tuple(map(int, input().split())) for _ in range(m)), key=lambda e: e[2])
parent = list(range(n))


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


total = used = 0
for u, v, w in edges:
    ru, rv = find(u), find(v)
    if ru != rv:
        parent[ru] = rv
        total += w
        used += 1
print(total if used == n - 1 else -1)`, c: [["4 5\n0 1 1\n1 2 2\n2 3 3\n0 3 4\n0 2 5", "6"], ["2 1\n0 1 5", "5"], ["3 1\n0 1 1", "-1"], ["1 0", "0"]] }),
  ],
});

module.exports = { lessons };
