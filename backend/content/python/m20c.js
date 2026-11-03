// Phase 5 / Module 20, lessons 7-9: overfitting, tuning and ensembles, and saving, serving and monitoring a model.
// Examples need scikit-learn, numpy, joblib, fastapi and httpx (installed in the course's virtual environment). Judged tasks use the standard library only.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 7
lessons.push({
  title: "Overfitting and Underfitting: The Bias and Variance Trade-off",
  minutes: 55,
  learn: ["Recognise underfitting and overfitting from training and test scores", "Explain bias and variance in plain words", "Control model complexity (tree depth, k, polynomial degree, regularisation)", "Use more data, simpler models and validation to fix the problem"],
  why: "The central problem of machine learning is a model that works on the data it has seen but fails on new data. Knowing how to diagnose and fix it separates a working project from a demo that collapses in production.",
  realWorld: "A model that predicts exam results from last year's students perfectly memorises their quirks (a student who always wears a red shirt passes) and fails on this year's students.",
  simple: "<strong>Underfitting</strong>: the model is too simple, so it does badly even on the training data. <strong>Overfitting</strong>: the model is too flexible, so it does very well on the training data but badly on new data. You want the middle: a good fit that generalises.",
  detail: `<h3>Reading the two scores</h3>
${table(["Training score", "Test score", "Diagnosis", "What to try"], [["low", "low", "underfitting (high bias)", "a more flexible model, more or better features, less regularisation"], ["high", "much lower", "overfitting (high variance)", "more data, simpler model, regularisation, fewer features, early stopping"], ["high", "about the same", "good fit", "stop; check it with cross-validation"]])}
<h3>Bias and variance</h3>
<ul><li><strong>Bias</strong> is the error from wrong assumptions: a straight line cannot follow a curve, however much data you give it.</li><li><strong>Variance</strong> is the error from sensitivity to the particular training sample: a very deep tree changes completely if a few rows change.</li><li>Making a model more complex lowers bias and raises variance. The best test score is at a balance point, found with a validation set or cross-validation.</li></ul>
<h3>Complexity knobs</h3>
${table(["Model", "Higher complexity", "Lower complexity"], [["decision tree", "larger <code>max_depth</code>, smaller <code>min_samples_leaf</code>", "smaller depth, larger leaves"], ["k-NN", "small k (k = 1 memorises)", "large k"], ["polynomial regression", "high degree", "low degree"], ["Ridge / Lasso / logistic", "small <code>alpha</code> / large <code>C</code>", "large <code>alpha</code> / small <code>C</code>"], ["neural network", "more layers and units, long training", "fewer, early stopping, dropout"]])}
<h3>Practical remedies</h3>
<ul><li><strong>More (and cleaner) data</strong> is the most reliable cure for overfitting.</li><li><strong>Fewer or better features</strong>: remove noisy and leaking ones.</li><li><strong>Regularisation</strong> penalises large weights.</li><li><strong>Ensembles</strong> (random forests) average many overfit trees, which cancels much of the variance.</li><li><strong>Cross-validation</strong> to choose complexity; never choose it on the test set.</li><li>Check for leakage when a score looks too good to be true.</li></ul>
<h3>Learning curves</h3>
<p>Plot the score against the training-set size. If training and validation curves meet at a low score, you have high bias (more data will not help; use a richer model). If there is a large gap, you have high variance (more data helps).</p>`,
  syntax: { code: `for depth in (1, 3, 5, None):\n    tree = DecisionTreeClassifier(max_depth=depth, random_state=0).fit(X_train, y_train)\n    print(depth, tree.score(X_train, y_train), tree.score(X_test, y_test))`, note: "Sweep a complexity setting and compare train and test scores." },
  diagram: chain("Underfit, good fit, overfit", "Left to right: a model that is too simple (high bias), a balanced model that generalises, and a model that is too complex (high variance), with the training and test score pattern of each.",
    [{ k: "proc", t: "underfit\ntrain low, test low" }, { k: "term", t: "good fit\ntrain high, test high" }, { k: "proc", t: "overfit\ntrain very high,\ntest much lower" }], { w: 190, gap: 40, hgt: 70 }),
  example: { code: `from sklearn.datasets import make_moons
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

X, y = make_moons(n_samples=300, noise=0.35, random_state=0)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=0)

rows = []
for depth in (1, 3, 5, None):
    tree = DecisionTreeClassifier(max_depth=depth, random_state=0).fit(X_train, y_train)
    rows.append((depth, tree.score(X_train, y_train), tree.score(X_test, y_test), tree.get_n_leaves()))
    print(depth, round(rows[-1][1], 2), round(rows[-1][2], 2), rows[-1][3])

best = max(rows, key=lambda row: row[2])
print("best test score at depth", best[0])
print("unlimited tree memorises the training set:", rows[-1][1] == 1.0)
print("its train-test gap is larger than depth 3:", rows[-1][1] - rows[-1][2] > rows[1][1] - rows[1][2])`, out: `1 0.82 0.71 2
3 0.89 0.83 7
5 0.95 0.9 16
None 1.0 0.84 29
best test score at depth 5
unlimited tree memorises the training set: True
its train-test gap is larger than depth 3: True` },
  lineByLine: [["make_moons(noise=0.35)", "Two interleaved half-circles with a lot of random noise: no model can be perfect."], ["max_depth=1", "A single yes/no question (2 leaves): too simple. Both scores are low (0.82 and 0.71): underfitting."], ["max_depth=3 and 5", "More questions fit the shape better; the test score rises from 0.71 to 0.83 to 0.90."], ["max_depth=None", "The tree grows until every training sample is classified: 29 leaves and a training score of exactly 1.0."], ["test score 0.84 at depth None", "Lower than at depth 5: the extra leaves memorised noise. That is overfitting."], ["best = max(rows, key=...)", "Chooses the depth with the best score on held-out data."]],
  dryRun: { intro: "The pattern as complexity grows:", headers: ["Depth", "Leaves", "Train", "Test", "Gap", "Verdict"], rows: [["1", "2", "0.82", "0.71", "0.11", "underfit"], ["3", "7", "0.89", "0.83", "0.06", "good"], ["5", "16", "0.95", "0.90", "0.05", "best"], ["None", "29", "1.00", "0.84", "0.16", "overfit"]] },
  realExample: { intro: "k-NN as a complexity dial: k = 1 memorises, a huge k is too simple. Scores are on the breast-cancer data with scaled features.", code: `from sklearn.datasets import load_breast_cancer
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

data = load_breast_cancer()
X_train, X_test, y_train, y_test = train_test_split(
    data.data, data.target, test_size=0.25, random_state=0, stratify=data.target)
for k in (1, 5, 25, 150):
    model = make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=k)).fit(X_train, y_train)
    print(k, round(model.score(X_train, y_train), 2), round(model.score(X_test, y_test), 2))`, out: `1 1.0 0.95
5 0.98 0.95
25 0.96 0.95
150 0.91 0.9` },
  mistakes: ["Choosing complexity by looking at the test score again and again.", "Celebrating a 100% training score.", "Blaming the algorithm when the real problem is too little data or leakage.", "Adding features without checking validation scores.", "Ignoring a large gap between training and validation scores."],
  practices: ["Always report train and validation (or cross-validated) scores together.", "Sweep one complexity setting at a time.", "Prefer the simplest model whose score is close to the best.", "Plot a learning curve when unsure whether more data would help."],
  interview: ["What is overfitting and how do you detect it?", "Explain the bias-variance trade-off.", "How does regularisation help?", "Why does a random forest overfit less than a single tree?"],
  practiceQs: ["Training accuracy 99%, test 70%: what is happening?", "Name three ways to reduce overfitting.", "What does k = 1 do in k-NN?", "What does a learning curve show?"],
  revision: ["Low/low = underfit; high/much lower = overfit.", "More complexity: bias down, variance up.", "Cures: more data, simpler model, regularisation, ensembles.", "Choose complexity with validation, not the test set."],
  hinglish: "Underfitting mein model itna simple hota hai ki training data par bhi kharab chalta hai; overfitting mein wo training data ratta maar leta hai aur naye data par fail hota hai. Training aur test score ka gap dekho. Gap bada ho to zyada data, simple model ya regularisation try karo.",
  quiz: [
    mcq("A model has 99% training accuracy and 70% test accuracy. What is the likely problem?", ["Underfitting", "Overfitting", "Perfect fit", "Missing baseline"], 1, "A large gap between training and test scores signals overfitting."),
    mcq("Both training and test accuracy are about 55% on a task where 60% is the baseline. What is it?", ["Overfitting", "Underfitting", "Leakage", "A good fit"], 1, "The model is too simple (or the features carry no signal)."),
    mcq("Which change makes a decision tree more complex?", ["Reducing max_depth", "Increasing max_depth", "Increasing min_samples_leaf", "Scaling the features"], 1, "Deeper trees can fit finer detail, including noise."),
    mcq("What does k = 1 in k-NN tend to do?", ["Underfit", "Memorise the training data and overfit", "Ignore the labels", "Always predict the same class"], 1, "Each training point is its own nearest neighbour, so training accuracy is perfect."),
    mcq("Which remedy mainly fights high variance?", ["Add more training data", "Use a simpler model or regularisation", "Both of these", "Remove the test set"], 2, "More data and simpler models both reduce sensitivity to the particular sample.")
  ],
  tasks: [task("Diagnose the fit", "Read n, then n lines depth train test (accuracies as decimals). For each line print depth D: gap=G label, where G is train minus test rounded to 2 decimals and label is underfit when train is below 0.70, otherwise overfit when the rounded gap is above 0.10, otherwise good fit. Finish with best depth: D, the depth with the highest test accuracy (ties go to the smaller depth).", "n = int(input())\nrows = []\nfor _ in range(n):\n    depth, train, test = input().split()\n    rows.append((int(depth), float(train), float(test)))\n# label each row and find the best depth\n", `n = int(input())
rows = []
for _ in range(n):
    depth, train, test = input().split()
    rows.append((int(depth), float(train), float(test)))
for depth, train, test in rows:
    gap = round(train - test, 2) + 0.0
    if train < 0.70:
        label = "underfit"
    elif gap > 0.10:
        label = "overfit"
    else:
        label = "good fit"
    print(f"depth {depth}: gap={gap:.2f} {label}")
best = max(rows, key=lambda row: (row[2], -row[0]))
print("best depth:", best[0])`, [["3\n1 0.62 0.60\n4 0.90 0.88\n12 1.00 0.80", "depth 1: gap=0.02 underfit\ndepth 4: gap=0.02 good fit\ndepth 12: gap=0.20 overfit\nbest depth: 4"], ["2\n2 0.85 0.85\n6 0.95 0.85", "depth 2: gap=0.00 good fit\ndepth 6: gap=0.10 good fit\nbest depth: 2"], ["1\n5 0.5 0.55", "depth 5: gap=-0.05 underfit\nbest depth: 5"], ["3\n2 0.9 0.8\n3 0.95 0.8\n4 0.99 0.79", "depth 2: gap=0.10 good fit\ndepth 3: gap=0.15 overfit\ndepth 4: gap=0.20 overfit\nbest depth: 2"]])],
});

// ---------------------------------------------------------------- 8
lessons.push({
  title: "Tuning and Ensembles: Grid Search, Random Forests and Feature Importance",
  minutes: 60,
  learn: ["Tune hyper-parameters with GridSearchCV and RandomizedSearchCV inside a pipeline", "Explain bagging, random forests and gradient boosting", "Read feature importances and understand their limits", "Select a final model without touching the test set"],
  why: "Default settings are rarely the best, and a single model is rarely the strongest. Systematic tuning and ensembles are how practical projects squeeze out the last gains, and interviewers often ask how you would choose settings without cheating.",
  realWorld: "A churn model team compares a logistic baseline, a random forest and gradient boosting, tunes the winner's depth and learning rate with cross-validation on the training set, and finally reports a single score on the untouched test set.",
  simple: "<strong>Hyper-parameters</strong> are the settings you choose (tree depth, k, C). <strong>Grid search</strong> tries every combination with cross-validation and keeps the best. An <strong>ensemble</strong> combines many models: a random forest averages many different trees, which is more accurate and stable than one tree.",
  detail: `<h3>GridSearchCV</h3>
<pre style="background:#16181c;color:#d8dee9;padding:12px 14px;border-radius:8px;overflow:auto"><code>pipe = Pipeline([("scale", StandardScaler()), ("svm", SVC())])
grid = GridSearchCV(pipe, {"svm__C": [0.1, 1, 10], "svm__kernel": ["linear", "rbf"]}, cv=5)
grid.fit(X_train, y_train)
grid.best_params_, grid.best_score_   # chosen with cross-validation on the training data
grid.score(X_test, y_test)            # final check on the untouched test set</code></pre>
<ul><li>Parameter names inside a Pipeline use <code>step__parameter</code>.</li><li>Number of model fits = (number of combinations) x (number of folds), plus one final refit on all training data (<code>refit=True</code> by default). Grids grow multiplicatively, so keep them small.</li><li><code>RandomizedSearchCV</code> samples a fixed number of combinations, usually better when there are many parameters.</li><li>Use <code>scoring=&quot;f1&quot;</code> (or another metric) to optimise what matters. <code>n_jobs=-1</code> uses all processor cores.</li><li><code>grid.cv_results_</code> has every combination's scores; look at the spread, not only the winner.</li></ul>
<h3>Ensembles</h3>
${table(["Method", "How it works", "Strength", "Care"], [["bagging / random forest", "many trees on random samples of rows and features, averaged", "robust, little tuning, reduces variance", "bigger, less explainable"], ["gradient boosting (<code>HistGradientBoostingClassifier</code>, XGBoost, LightGBM)", "trees added one by one, each fixing the previous errors", "often the best on tables", "needs tuning; can overfit"], ["voting / stacking", "combine different model types", "small extra gains", "complexity"]])}
<h3>Feature importance</h3>
<p><code>forest.feature_importances_</code> sums to 1 and shows which features the trees used most. It helps to understand and prune the model, but it favours features with many distinct values and can split credit between correlated features. <code>sklearn.inspection.permutation_importance</code> (shuffle one feature and see how much the score drops, on validation data) is more reliable. Importance is not causation.</p>
<h3>A sensible process</h3>
<ol><li>Baseline (dummy), then a simple model (logistic regression).</li><li>A strong model (random forest or boosting) with defaults.</li><li>Tune the best candidate with cross-validation on the training set only.</li><li>Evaluate once on the test set and report the metric with a baseline.</li><li>Keep the pipeline simple enough to maintain; a 0.5 percent gain rarely justifies much complexity.</li></ol>`,
  syntax: { code: `grid = GridSearchCV(pipe, {"svm__C": [0.1, 1, 10]}, cv=5)\ngrid.fit(X_train, y_train)\ngrid.best_params_\nforest = RandomForestClassifier(n_estimators=200, random_state=0)\nforest.feature_importances_`, note: "Tune with cross-validation; test once at the end." },
  diagram: chain("Tuning without cheating", "Left to right: split off a test set, run cross-validated search on the training set, refit the best settings on all training data, and score once on the test set.",
    [{ k: "proc", t: "hold out\ntest set" }, { k: "proc", t: "grid search\n(CV on train)" }, { k: "proc", t: "refit best\nsettings" }, { k: "term", t: "score once\non test set" }], { w: 150, gap: 40, hgt: 62 }),
  example: { code: `from sklearn.datasets import load_iris
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

iris = load_iris()
X_train, X_test, y_train, y_test = train_test_split(
    iris.data, iris.target, test_size=0.3, random_state=42, stratify=iris.target)

pipe = Pipeline([("scale", StandardScaler()), ("svm", SVC())])
grid = GridSearchCV(pipe, {"svm__C": [0.1, 1, 10], "svm__kernel": ["linear", "rbf"]},
                    cv=StratifiedKFold(5, shuffle=True, random_state=0))
grid.fit(X_train, y_train)
print(len(grid.cv_results_["params"]), sorted(grid.best_params_))
print(grid.best_score_ > 0.9, grid.score(X_test, y_test) > 0.85)

forest = RandomForestClassifier(n_estimators=100, random_state=0).fit(X_train, y_train)
print(forest.score(X_test, y_test) > 0.85)
ranked = sorted(zip(iris.feature_names, forest.feature_importances_), key=lambda pair: -pair[1])
print(sorted(name for name, _ in ranked[:2]))
print(round(float(sum(forest.feature_importances_)), 2))`, out: `6 ['svm__C', 'svm__kernel']
True True
True
['petal length (cm)', 'petal width (cm)']
1.0` },
  lineByLine: [["Pipeline([... SVC()])", "The scaler and the support vector classifier are tuned as one unit; the scaler is re-fitted inside every fold."], ["{\"svm__C\": [...], \"svm__kernel\": [...]}", "3 values of C times 2 kernels = 6 combinations; with 5 folds that is 30 fits plus one refit."], ["len(grid.cv_results_[\"params\"])", "6 combinations were evaluated."], ["best_score_ > 0.9", "The best cross-validated accuracy on the training data. The exact value is not printed because small numerical differences between machines do not matter; the check is what counts."], ["grid.score(X_test, y_test)", "The one final check on data the search never saw."], ["feature_importances_", "A random forest ranks the features: the two petal measurements carry almost all the information."], ["sum(...) == 1.0", "Importances are normalised to add up to 1."]],
  dryRun: { intro: "How many models does this search train?", headers: ["Item", "Count"], rows: [["values of C", "3"], ["kernels", "2"], ["combinations", "3 x 2 = 6"], ["cross-validation folds", "5"], ["fits during search", "6 x 5 = 30"], ["final refit on all training data", "1"]] },
  realExample: { intro: "Comparing a single tree with ensembles by cross-validation on the same folds (mean accuracy).", code: `from sklearn.datasets import load_breast_cancer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.tree import DecisionTreeClassifier

data = load_breast_cancer()
cv = StratifiedKFold(5, shuffle=True, random_state=0)
models = {
    "single tree": DecisionTreeClassifier(random_state=0),
    "random forest": RandomForestClassifier(n_estimators=100, random_state=0),
    "gradient boosting": HistGradientBoostingClassifier(random_state=0),
}
scores = {name: cross_val_score(model, data.data, data.target, cv=cv).mean() for name, model in models.items()}
for name, score in scores.items():
    print(f"{name:18} {score:.2f}")
print("ensembles beat the single tree:", scores["random forest"] > scores["single tree"] and scores["gradient boosting"] > scores["single tree"])`, out: `single tree        0.93
random forest      0.96
gradient boosting  0.97
ensembles beat the single tree: True` },
  mistakes: ["Tuning on the test set or reporting the best cross-validation score as the final result.", "Grids so large they take hours for tiny gains.", "Forgetting the <code>step__name</code> prefix inside pipelines.", "Treating feature importance as proof of cause.", "Skipping a simple baseline before reaching for boosting."],
  practices: ["Search inside a Pipeline with stratified cross-validation.", "Start with a coarse grid, then refine around the best values.", "Set <code>random_state</code> for forests and boosting.", "Report the final test score once, with the baseline."],
  interview: ["How do you tune hyper-parameters without leaking the test set?", "How does a random forest reduce overfitting?", "Bagging versus boosting?", "Are feature importances reliable?"],
  practiceQs: ["How many fits does a 3 x 4 grid with 5 folds need?", "What does refit=True do?", "Why prefer RandomizedSearchCV for many parameters?", "What does permutation importance measure?"],
  revision: ["GridSearchCV: combinations x folds, refit at the end.", "step__parameter names in pipelines.", "Forest = averaged trees; boosting = trees fixing errors.", "Test set only for the final score."],
  hinglish: "Hyper-parameters woh settings hain jo hum chunte hain, jaise tree depth ya C. GridSearchCV har combination ko cross-validation se parakhta hai aur sabse achhi chunta hai. Random forest kai trees ka average hai, isliye ek tree se zyada sthir aur sahi hota hai. Final score sirf ek baar test set par nikalo.",
  quiz: [
    mcq("A grid has 4 values of one parameter and 3 of another, with cv=5. How many fits happen during the search (not counting the final refit)?", ["12", "20", "60", "7"], 2, "4 x 3 = 12 combinations, each evaluated 5 times: 60 fits."),
    mcq("In a Pipeline with a step named svm, how do you name the parameter C in the grid?", ["C", "svm.C", "svm__C", "pipeline_C"], 2, "Use step name, two underscores, parameter name."),
    mcq("Why is a random forest usually more stable than a single decision tree?", ["It uses fewer features", "Averaging many different trees reduces variance", "It is never deep", "It ignores noise completely"], 1, "Each tree overfits differently, and the average cancels much of that."),
    mcq("Which data should the final reported score come from?", ["The cross-validation folds of the grid search", "The training set", "A test set that was never used for tuning", "The best fold"], 2, "Only untouched data gives an honest estimate."),
    mcq("What does RandomizedSearchCV do differently from GridSearchCV?", ["Tries a fixed number of random combinations", "Ignores cross-validation", "Trains without data", "Only works for trees"], 0, "It samples the search space instead of trying everything.")
  ],
  tasks: [task("Grid size", "Read the number of cross-validation folds, then lines of the form name v1 v2 ... describing a parameter grid (one parameter per line, until the end of the input). Print combinations=N (the product of the value counts), fits=F (combinations times folds), first=... and last=... where those are the first and last combinations in order, written as name=value pairs separated by spaces, the first parameter varying slowest.", "import itertools, sys\nfolds = int(input())\ngrid = [line.split() for line in sys.stdin.read().splitlines() if line.strip()]\n# print the size of the search and the first and last combination\n", `import itertools
import sys

folds = int(input())
grid = [line.split() for line in sys.stdin.read().splitlines() if line.strip()]
names = [row[0] for row in grid]
combos = list(itertools.product(*[row[1:] for row in grid]))
print(f"combinations={len(combos)}")
print(f"fits={len(combos) * folds}")
for label, combo in (("first", combos[0]), ("last", combos[-1])):
    print(label + "=" + " ".join(f"{name}={value}" for name, value in zip(names, combo)))`, [["5\nC 0.1 1 10\nkernel linear rbf", "combinations=6\nfits=30\nfirst=C=0.1 kernel=linear\nlast=C=10 kernel=rbf"], ["3\nmax_depth 3 5 7 9", "combinations=4\nfits=12\nfirst=max_depth=3\nlast=max_depth=9"], ["10\na 1 2\nb x y z\nc p q", "combinations=12\nfits=120\nfirst=a=1 b=x c=p\nlast=a=2 b=z c=q"], ["2\nk 1", "combinations=1\nfits=2\nfirst=k=1\nlast=k=1"]])],
});

// ---------------------------------------------------------------- 9
lessons.push({
  title: "From Notebook to Service: Saving, Serving and Monitoring a Model",
  minutes: 60,
  learn: ["Save and load a trained pipeline with joblib and version it", "Serve predictions through an API with input validation", "Monitor a model for data drift and plan retraining", "Describe responsible-AI basics: bias, privacy, explainability and human oversight"],
  why: "A model that lives only in a notebook helps nobody. Deploying it, keeping it healthy and using it responsibly are the skills that turn a data-science exercise into a product, and they connect everything you learned about APIs, testing and security.",
  realWorld: "The churn model is saved with its preprocessing in one file, a FastAPI service loads it at start-up and answers /predict, a dashboard watches the input distribution, and a monthly job retrains it when the data changes.",
  simple: "Save the whole <strong>pipeline</strong> (not just the model) to a file, load it once when the service starts, <strong>validate</strong> every request before predicting, return the result with a model version, and <strong>monitor</strong> the inputs and outcomes because the world changes.",
  detail: `<h3>Saving a model</h3>
<ul><li><code>joblib.dump(pipeline, &quot;model.joblib&quot;)</code> and <code>joblib.load(...)</code>. Save the <em>Pipeline</em> so preprocessing travels with the model.</li><li>Also store the scikit-learn version, training date, feature names, metrics and a model version string (a small dictionary or a model-registry entry). A model saved with one scikit-learn version may not load in another: pin versions in <code>requirements.txt</code>.</li><li><strong>Security:</strong> joblib and pickle files can run code when loaded. Only load files you created or fully trust; never load a model file uploaded by a user. Safer formats exist (for example ONNX or skops for some cases).</li></ul>
<h3>Serving</h3>
<ul><li>Wrap the model in an API (FastAPI or Flask, Module 17): load it <strong>once</strong> at start-up, not on every request.</li><li><strong>Validate the input</strong> with a schema (pydantic): required fields, types and sensible ranges. Return 422 for bad input instead of a confusing 500.</li><li>Return the prediction, a confidence where meaningful, and the <code>model_version</code>. Log requests (without personal data) and latency.</li><li>For large volumes use batch predictions on a schedule; for real time keep the model small and fast. Containers (Docker) make the service repeatable.</li><li>Test the endpoint with the framework's test client, as in the example.</li></ul>
<h3>Monitoring</h3>
<ul><li><strong>Data drift</strong>: live inputs differ from training data (new customer type, a sensor change). Compare simple statistics or distributions regularly.</li><li><strong>Concept drift</strong>: the relationship changes (behaviour after a price rise). Needs fresh labels to detect: track the live metric once outcomes are known.</li><li>Watch service health too: errors, latency, empty or out-of-range inputs.</li><li>Retrain on a schedule or when drift is detected; keep the previous model to roll back.</li></ul>
<h3>Responsible use</h3>
${table(["Concern", "What to do"], [["bias and fairness", "check metrics per group (recall, false-positive rate); look at how the data was collected; do not use protected attributes or close proxies without a clear legal and ethical reason"], ["privacy", "collect the minimum, protect and delete data on schedule, follow the applicable law (for India, the Digital Personal Data Protection Act, 2023)"], ["explainability", "prefer simple models where decisions affect people; give reasons and a way to appeal"], ["human oversight", "keep a person in the loop for high-impact decisions; define what happens when the model is unsure"], ["honesty about limits", "document intended use, data, metrics and known failures in a model card"]])}
<p>Machine learning amplifies whatever is in the data. Treat the model as a tool whose errors have owners.</p>`,
  syntax: { code: `import joblib\njoblib.dump({"model": pipeline, "version": "1.0"}, "model.joblib")\nbundle = joblib.load("model.joblib")   # only files you trust!\nbundle["model"].predict(rows)`, note: "Save the pipeline, load once, validate every request." },
  diagram: chain("A model in production", "Left to right: train and save the pipeline, serve it behind an API with validation, monitor inputs and results, and retrain when drift appears.",
    [{ k: "proc", t: "train and save\npipeline" }, { k: "proc", t: "API with\nvalidation" }, { k: "proc", t: "monitor\ndrift and errors" }, { k: "dec", t: "drift or\ndecay?" }, { k: "term", t: "retrain and\nversion" }], { w: 135, gap: 28, hgt: 62 }),
  example: { code: `import pathlib
import shutil
import tempfile

import joblib
import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from sklearn.datasets import load_iris
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

iris = load_iris()
model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)).fit(iris.data, iris.target)

folder = pathlib.Path(tempfile.mkdtemp())
path = folder / "iris.joblib"
joblib.dump({"model": model, "classes": iris.target_names.tolist(), "version": "1.0"}, path)
bundle = joblib.load(path)
print(path.stat().st_size > 1000, bundle["version"], np.array_equal(model.predict(iris.data), bundle["model"].predict(iris.data)))

app = FastAPI()


class Flower(BaseModel):
    sepal_length: float = Field(gt=0, lt=20)
    sepal_width: float = Field(gt=0, lt=20)
    petal_length: float = Field(gt=0, lt=20)
    petal_width: float = Field(gt=0, lt=20)


@app.post("/predict")
def predict(flower: Flower):
    row = [[flower.sepal_length, flower.sepal_width, flower.petal_length, flower.petal_width]]
    probabilities = bundle["model"].predict_proba(row)[0]
    best = int(probabilities.argmax())
    return {"species": bundle["classes"][best], "confidence": round(float(probabilities[best]), 2), "model_version": bundle["version"]}


client = TestClient(app)
response = client.post("/predict", json={"sepal_length": 5.1, "sepal_width": 3.5, "petal_length": 1.4, "petal_width": 0.2})
body = response.json()
print(response.status_code, body["species"], body["confidence"] > 0.9, body["model_version"])
response = client.post("/predict", json={"sepal_length": -1, "sepal_width": 3.5, "petal_length": 1.4, "petal_width": 0.2})
print(response.status_code, response.json()["detail"][0]["loc"])
shutil.rmtree(folder, ignore_errors=True)`, out: `True 1.0 True
200 setosa True 1.0
422 ['body', 'sepal_length']` },
  lineByLine: [["make_pipeline(StandardScaler(), LogisticRegression())", "One object that scales and predicts, so the service cannot forget the scaling."], ["joblib.dump({...}, path)", "Saves the pipeline together with its class names and a version string."], ["joblib.load(path) and array_equal", "The reloaded model gives exactly the same predictions as the original."], ["class Flower(BaseModel)", "The request schema: four numbers, each greater than 0 and below 20."], ["@app.post(\"/predict\")", "The endpoint uses the model that was loaded once at start-up."], ["confidence and model_version", "The reply says how sure the model is and which model answered."], ["first request: 200 setosa", "A typical setosa flower: success, a confident prediction (above 0.9)."], ["second request: 422", "A negative sepal length is rejected by validation before the model is called; the error points at body.sepal_length."]],
  dryRun: { intro: "What happens to a request, step by step:", headers: ["Step", "Action"], rows: [["1", "client sends JSON to POST /predict"], ["2", "FastAPI checks it against Flower; invalid input stops here with 422"], ["3", "the pipeline scales the numbers and predicts probabilities"], ["4", "the service returns species, confidence and model version"]] },
  realExample: { intro: "A simple drift check: how far has the live average moved from the training average, in training standard deviations?", code: `import numpy as np

train_ages = np.array([22, 25, 31, 40, 28, 35, 30, 27])
live_ages = np.array([45, 52, 48, 50, 47, 55])
shift = abs(live_ages.mean() - train_ages.mean()) / train_ages.std()
print(round(train_ages.mean(), 2), round(live_ages.mean(), 2), round(shift, 2), shift > 1)`, out: `29.75 49.5 3.7 True` },
  mistakes: ["Saving only the model and forgetting the preprocessing.", "Loading the model file on every request.", "No input validation, so bad data causes errors or silent nonsense.", "Loading a model file from an untrusted source.", "Never checking live performance after launch."],
  practices: ["Version the model and the data it was trained on.", "Pin library versions used for training.", "Validate, log (without personal data) and monitor.", "Document intended use and limits in a model card."],
  interview: ["How do you deploy a scikit-learn model?", "What is data drift?", "Why is unpickling untrusted files dangerous?", "How would you check a model for bias?"],
  practiceQs: ["Why save the whole pipeline?", "What status code does FastAPI return for invalid input?", "What is concept drift?", "Name two responsible-AI practices."],
  revision: ["joblib the pipeline plus metadata and version.", "Load once; validate every request.", "Monitor drift and live metrics; retrain and roll back safely.", "Fairness, privacy, explainability, human oversight."],
  hinglish: "Model ko notebook se bahar laane ke liye poora pipeline joblib se save karo, service start hote hi ek baar load karo aur har request ko validate karo. Live data training data se alag ho jaye to drift kehte hain, isliye monitoring zaroori hai. Fairness, privacy aur insaan ki nigrani ka dhyan rakho.",
  quiz: [
    mcq("Why should you save the whole Pipeline rather than only the final model?", ["It is smaller", "Preprocessing must be applied identically at prediction time", "joblib requires it", "Pipelines train faster"], 1, "A saved model without its scaler or encoder would receive the wrong inputs."),
    mcq("Why is loading a joblib or pickle file from a stranger dangerous?", ["It is slow", "Loading can execute arbitrary code", "It deletes the data", "It changes the Python version"], 1, "These formats can contain code that runs while loading."),
    mcq("What does data drift mean?", ["The model file changes name", "Live input data differs from the training data", "The test set shrinks", "The API is slow"], 1, "The model may then be used outside the range it learned."),
    mcq("Which HTTP status does FastAPI return when the request body fails pydantic validation?", ["200", "404", "422", "500"], 2, "422 Unprocessable Content with details of the invalid fields."),
    mcq("For a model that decides loan approvals, which practice is most appropriate?", ["Fully automatic decisions with no review", "Checking fairness across groups and keeping human review for borderline cases", "Hiding the model from regulators", "Using any available personal data"], 1, "High-impact decisions need fairness checks, explanations and human oversight.")
  ],
  tasks: [task("Validate a prediction request", "Read one line holding a JSON object. It must contain the numeric fields sepal_length, sepal_width, petal_length and petal_width, each greater than 0 and less than 20 (booleans and text are not numbers; extra fields are ignored). For each field in that order that has a problem print FIELD: missing, FIELD: not a number or FIELD: out of range. If everything is fine print ok.", "import json\nrequest = json.loads(input())\nFIELDS = [\"sepal_length\", \"sepal_width\", \"petal_length\", \"petal_width\"]\n# check every field\n", `import json

request = json.loads(input())
FIELDS = ["sepal_length", "sepal_width", "petal_length", "petal_width"]
problems = []
for field in FIELDS:
    if field not in request:
        problems.append(f"{field}: missing")
        continue
    value = request[field]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        problems.append(f"{field}: not a number")
    elif not 0 < value < 20:
        problems.append(f"{field}: out of range")
print("\\n".join(problems) if problems else "ok")`, [['{"sepal_length": 5.1, "sepal_width": 3.5, "petal_length": 1.4, "petal_width": 0.2}', "ok"], ['{"sepal_length": 5.1, "sepal_width": 3.5, "petal_length": 1.4}', "petal_width: missing"], ['{"sepal_length": "5.1", "sepal_width": -3, "petal_length": 1.4, "petal_width": 25}', "sepal_length: not a number\nsepal_width: out of range\npetal_width: out of range"], ['{"sepal_length": true, "sepal_width": 3.5, "petal_length": 1.4, "petal_width": 0.2, "extra": 1}', "sepal_length: not a number"]])],
});

module.exports = { lessons };
