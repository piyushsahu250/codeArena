// Phase 5 / Module 20, lessons 1-3: machine learning concepts, the scikit-learn estimator API, and preprocessing pipelines.
// Examples need scikit-learn, numpy and pandas (installed in the course's virtual environment; verified with scikit-learn 1.9). Judged tasks use the standard library only.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 1
lessons.push({
  title: "Machine Learning Concepts: Data, Models, Training and Testing",
  minutes: 55,
  learn: ["Explain what machine learning is and how it differs from ordinary programming", "Tell supervised, unsupervised and reinforcement learning apart", "Describe features, labels, training and test sets, and the ML workflow", "Use a baseline and avoid data leakage"],
  why: "Machine learning powers recommendations, spam filters, fraud detection and forecasting. Even if you never become an ML specialist, you will work with teams that use models, and you must know what they can and cannot do.",
  realWorld: "A college wants to flag students at risk of failing early. Past records (attendance, marks, assignments) with known outcomes train a model that gives a risk score for current students, which a mentor then reviews.",
  simple: "In ordinary programming you write the rules. In <strong>machine learning</strong> you give the computer <em>examples</em> (inputs and the right answers) and it <strong>learns the rules</strong> that you then use on new data. The model is only as good as the data and the way you test it.",
  detail: `<h3>Kinds of learning</h3>
${table(["Kind", "Data", "Example tasks"], [["supervised", "inputs <strong>and</strong> known answers (labels)", "classification (spam or not), regression (house price)"], ["unsupervised", "inputs only", "clustering customers, reducing dimensions, finding anomalies"], ["reinforcement", "an agent acts and receives rewards", "game playing, robot control"], ["self-supervised / generative", "learns from the structure of huge unlabeled data", "language and image models"]])}
<p>This module focuses on <strong>supervised learning on tables</strong> with scikit-learn: it is the most common business use and the foundation for everything else.</p>
<h3>Vocabulary</h3>
<ul><li><strong>Sample (row)</strong>: one example, such as one student.</li><li><strong>Features (X)</strong>: the input columns, such as hours studied.</li><li><strong>Label or target (y)</strong>: the answer to predict, such as passed or not.</li><li><strong>Model</strong>: the learned function from X to y; <strong>training</strong> or <strong>fitting</strong> is learning it.</li><li><strong>Classification</strong> predicts a category; <strong>regression</strong> predicts a number.</li></ul>
<h3>The workflow</h3>
<ol><li>Define the problem and how success is measured (the metric).</li><li>Collect and clean the data (Module 19).</li><li><strong>Split</strong> into training and test sets <em>before</em> anything is learned.</li><li>Build a <strong>baseline</strong> (the simplest guess).</li><li>Train and compare models; tune them using only the training data (validation).</li><li>Evaluate <strong>once</strong> on the untouched test set.</li><li>Deploy, monitor and retrain when the world changes.</li></ol>
<h3>Why we split the data</h3>
<p>A model that memorises the training data scores perfectly on it and fails on new data. The test set plays the role of the future: it must never influence training or any decision about the model. Typical split: 70 to 80 percent train, 20 to 30 percent test; use <code>random_state</code> for repeatability and <code>stratify=y</code> to keep class proportions equal in both parts.</p>
<h3>Baselines</h3>
<p>If 60 percent of students pass, always predicting &quot;pass&quot; is 60 percent accurate. A model must clearly beat such a baseline to be useful (<code>DummyClassifier</code>, or the mean for regression).</p>
<h3>Data leakage</h3>
<p>Leakage means information from outside the training data sneaks into training: computing the mean or scaling on <em>all</em> rows before splitting, a feature that is only known after the outcome (for example &quot;final grade&quot; when predicting pass), or duplicate rows on both sides of the split. Leaked results look wonderful and collapse in production. Always split first and fit every transformation on the training part only (pipelines help, lesson 3).</p>
<h3>Honest limits</h3>
<p>Models find patterns, not truth: they inherit bias in the data, can be confidently wrong on unusual inputs, and need monitoring. For decisions that affect people (loans, admissions, hiring) keep a human in the loop and check fairness (lesson 9).</p>`,
  syntax: { code: `from sklearn.model_selection import train_test_split\nX_train, X_test, y_train, y_test = train_test_split(\n    X, y, test_size=0.25, random_state=0, stratify=y)`, note: "Split first; the test set is for the end." },
  diagram: chain("The ML workflow", "Left to right: define the problem and metric, prepare the data, split into train and test, train models against a baseline, evaluate once on the test set, then deploy and monitor.",
    [{ k: "proc", t: "problem +\nmetric" }, { k: "proc", t: "clean\ndata" }, { k: "proc", t: "split\ntrain / test" }, { k: "proc", t: "train vs\nbaseline" }, { k: "dec", t: "test\nscore ok?" }, { k: "term", t: "deploy and\nmonitor" }], { w: 112, gap: 26, hgt: 62 }),
  example: { code: `import numpy as np
from sklearn.dummy import DummyClassifier
from sklearn.model_selection import train_test_split

hours = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 2, 3, 8, 9, 5, 6, 1, 7, 4, 10])
passed = np.array([0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1])
X = hours.reshape(-1, 1)
X_train, X_test, y_train, y_test = train_test_split(X, passed, test_size=0.25, random_state=0, stratify=passed)
print(X_train.shape, X_test.shape, round(y_train.mean(), 2), round(y_test.mean(), 2))

baseline = DummyClassifier(strategy="most_frequent").fit(X_train, y_train)
print("baseline accuracy:", baseline.score(X_test, y_test))


def fit_threshold(x, y):
    candidates = sorted(set(x.ravel().tolist()))
    return max(candidates, key=lambda t: ((x.ravel() >= t) == y).mean())


threshold = fit_threshold(X_train, y_train)
prediction = (X_test.ravel() >= threshold).astype(int)
print("threshold:", threshold, "accuracy:", (prediction == y_test).mean())
print(sorted(X_test.ravel().tolist()))`, out: `(15, 1) (5, 1) 0.53 0.6
baseline accuracy: 0.6
threshold: 5 accuracy: 1.0
[1, 3, 7, 9, 10]` },
  lineByLine: [["hours and passed", "Twenty students: hours studied (the feature) and whether they passed (the label)."], ["train_test_split(..., test_size=0.25, stratify=passed)", "15 rows to learn from and 5 to test on, with the same share of passes in both (about 53 and 60 percent)."], ["DummyClassifier(\"most_frequent\")", "The baseline: always predict the most common label of the training data. It scores 0.6 on the test set."], ["fit_threshold", "A model written by hand: learn the number of hours at which students start passing by trying every value on the training data."], ["threshold: 5", "Students with 5 or more hours are predicted to pass."], ["accuracy: 1.0 on the test set", "Better than the 0.6 baseline. With only five test rows this is weak evidence, which is why real projects use more data and cross-validation."]],
  dryRun: { intro: "Applying the learned rule (5 hours or more means pass) to the five test students:", headers: ["Hours", "Predicted", "Actual"], rows: [["1", "0", "0"], ["3", "0", "0"], ["7", "1", "1"], ["9", "1", "1"], ["10", "1", "1"]] },
  realExample: { intro: "Why the split must come first: statistics computed on all rows include the test rows.", code: `import numpy as np

values = np.array([10.0, 12.0, 11.0, 13.0, 12.0, 11.0, 50.0, 52.0])
train, test = values[:6], values[6:]
print("mean from training data only:", train.mean())
print("mean from all data (leaks the test set):", values.mean())


def accuracy(actual, predicted):
    return float(np.mean(np.array(actual) == np.array(predicted)))


print(accuracy([1, 0, 1, 1], [1, 0, 0, 1]))
print(np.bincount([0, 1, 1, 0, 1, 1]).tolist())`, out: `mean from training data only: 11.5
mean from all data (leaks the test set): 21.375
0.75
[2, 4]` },
  mistakes: ["Testing on the data the model was trained on.", "Scaling or filling missing values before splitting.", "Using a feature that would not be known at prediction time.", "Not building a baseline, so a weak model looks good.", "Looking at the test set repeatedly while tuning."],
  practices: ["Split first, use <code>random_state</code> and <code>stratify</code> for classification.", "Always compare with a simple baseline.", "Define the metric before modelling.", "Keep the test set untouched until the end."],
  interview: ["Supervised versus unsupervised learning?", "What is data leakage and how do you avoid it?", "Why do we need a test set?", "What is a baseline model?"],
  practiceQs: ["Name the features and the label for predicting house prices.", "Is predicting a student's marks classification or regression?", "Why use stratify=y?", "Why can a feature like final grade be harmful?"],
  revision: ["Features X, label y; classification versus regression.", "Split first; the test set is for the end.", "Beat the baseline.", "Fit every transformation on training data only."],
  hinglish: "Machine learning mein hum examples dete hain (input aur sahi jawab) aur model rules khud seekhta hai. Data ko pehle train aur test mein baant do, test set ko end tak mat chhuo, aur hamesha ek simple baseline se compare karo. Split se pehle scaling karna data leakage hai.",
  quiz: [
    mcq("Which problem is regression?", ["Predict whether an email is spam", "Predict a house's price in rupees", "Group customers without labels", "Decide pass or fail"], 1, "Regression predicts a number; the others predict categories or find groups."),
    mcq("What is the purpose of the test set?", ["To train the model faster", "To estimate how the model performs on new data", "To clean the data", "To store the model"], 1, "It represents unseen future data."),
    mcq("A model scores 95% accuracy, but 95% of the labels are the majority class. What does this tell you?", ["The model is excellent", "It may be no better than always guessing the majority class", "The data is clean", "The test set is too large"], 1, "Compare with the baseline before celebrating."),
    mcq("Which is an example of data leakage?", ["Splitting before scaling", "Fitting a scaler on all rows before the split", "Using random_state", "Stratifying the split"], 1, "The test rows then influenced the scaler's mean and spread."),
    mcq("Which kind of learning uses inputs without any labels?", ["Supervised", "Unsupervised", "Reinforcement only", "Regression"], 1, "Clustering is a typical unsupervised task.")
  ],
  tasks: [task("Majority-class baseline", "Read a line of labels (words) and then a test fraction f. The last int(n * f) labels form the test set and the earlier ones the training set (no shuffling). Print train=A test=B, then majority=L where L is the most common training label (ties go to the alphabetically first label), then accuracy=P with 2 decimals: the share of test labels equal to L (0.00 when the test set is empty).", "labels = input().split()\nfraction = float(input())\n# split, find the majority label and score it\n", `labels = input().split()
fraction = float(input())
n_test = int(len(labels) * fraction)
train = labels[: len(labels) - n_test]
test = labels[len(labels) - n_test:]
majority = max(sorted(set(train)), key=lambda label: train.count(label))
accuracy = sum(1 for label in test if label == majority) / len(test) if test else 0.0
print(f"train={len(train)} test={len(test)}")
print(f"majority={majority}")
print(f"accuracy={accuracy:.2f}")`, [["1 1 0 1 0 0 1 1 0 1\n0.3", "train=7 test=3\nmajority=1\naccuracy=0.67"], ["a a b\n0.34", "train=2 test=1\nmajority=a\naccuracy=0.00"], ["0 1\n0.5", "train=1 test=1\nmajority=0\naccuracy=0.00"], ["x y x y\n0.5", "train=2 test=2\nmajority=x\naccuracy=0.50"]])],
});

// ---------------------------------------------------------------- 2
lessons.push({
  title: "scikit-learn Basics: The fit, predict and score Pattern",
  minutes: 55,
  learn: ["Install scikit-learn and load its built-in datasets", "Use the estimator API: create, fit, predict, predict_proba and score", "Read learned attributes and hyper-parameters", "Compare several models on the same split"],
  why: "scikit-learn gives every algorithm the same interface, so once you know the pattern you can try dozens of models with a few lines. It is the most widely used library for classical machine learning and a frequent subject of interview tasks.",
  realWorld: "You train a classifier to recognise iris flower species from four measurements. Switching from k-nearest neighbours to logistic regression changes only the line that creates the model.",
  simple: "Every scikit-learn model follows three steps: <code>model = Algorithm(settings)</code>, <code>model.fit(X_train, y_train)</code> to learn, <code>model.predict(X_new)</code> to use it, and <code>model.score(X_test, y_test)</code> to measure it.",
  detail: `<p><strong>Install:</strong> <code>python -m pip install scikit-learn</code> (imported as <code>sklearn</code>). Examples here were checked with scikit-learn 1.9.</p>
<h3>Data shapes</h3>
<ul><li><code>X</code> is 2-D: shape <code>(n_samples, n_features)</code>. A single feature needs <code>X.reshape(-1, 1)</code>.</li><li><code>y</code> is 1-D: shape <code>(n_samples,)</code>.</li><li>DataFrames work too; scikit-learn converts them to arrays (and remembers the column names).</li><li>Built-in learning datasets need no download: <code>load_iris()</code>, <code>load_breast_cancer()</code>, <code>load_wine()</code>, <code>load_diabetes()</code>, plus generators such as <code>make_classification</code> and <code>make_moons</code>.</li></ul>
<h3>The estimator API</h3>
${table(["Call", "Meaning"], [["<code>model = KNeighborsClassifier(n_neighbors=5)</code>", "create with <strong>hyper-parameters</strong> (settings you choose before training)"], ["<code>model.fit(X_train, y_train)</code>", "learn from data; returns the model itself"], ["<code>model.predict(X_new)</code>", "predicted labels or numbers"], ["<code>model.predict_proba(X_new)</code>", "class probabilities (one column per class, in <code>model.classes_</code> order)"], ["<code>model.score(X_test, y_test)</code>", "default metric: accuracy for classifiers, R squared for regressors"], ["<code>model.get_params()</code> / <code>set_params(...)</code>", "read or change hyper-parameters"], ["<code>model.coef_</code>, <code>model.classes_</code> ...", "learned values end with an underscore and exist only after <code>fit</code>"], ["<code>clone(model)</code>", "a fresh, unfitted copy with the same settings"]])}
<p>Other transformers use <code>fit</code> and <code>transform</code> (or <code>fit_transform</code> on training data only, then <code>transform</code> on test data).</p>
<h3>Choosing a first model</h3>
<ul><li><strong>Logistic regression</strong>: fast, a strong baseline for classification (despite the name), gives probabilities.</li><li><strong>k-nearest neighbours</strong>: predicts from the most similar training samples; needs scaled features.</li><li><strong>Decision tree</strong>: easy to explain; overfits if grown too deep.</li><li><strong>Random forest</strong>: many trees voting; strong default for tables.</li><li><strong>Linear and ridge regression</strong>: baseline for numbers.</li></ul>
<h3>Predictions are not facts</h3>
<p>A probability of 0.98 means the model is confident, not that it is right. Always report the evaluation on unseen data, and test numbers exactly the way your model will be used.</p>
<h3>Reproducibility</h3>
<p>Pass <code>random_state</code> to anything random (splits, trees, forests). Accuracy on a small test set is noisy: tiny changes move it in big steps (one of 45 samples is 2.2 percent).</p>`,
  syntax: { code: `from sklearn.neighbors import KNeighborsClassifier\nmodel = KNeighborsClassifier(n_neighbors=5)\nmodel.fit(X_train, y_train)\nmodel.predict(X_test)\nmodel.score(X_test, y_test)`, note: "Create, fit, predict, score." },
  diagram: chain("The estimator pattern", "Left to right: create the model with its settings, fit it to the training data, predict labels for new data, and score it against the known answers.",
    [{ k: "proc", t: "create\nModel(settings)" }, { k: "proc", t: "fit\n(X_train, y_train)" }, { k: "proc", t: "predict\n(X_new)" }, { k: "term", t: "score\n(X_test, y_test)" }], { w: 150, gap: 40, hgt: 62 }),
  example: { code: `from sklearn.datasets import load_iris
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier

iris = load_iris()
print(iris.data.shape, iris.feature_names, iris.target_names.tolist())
X_train, X_test, y_train, y_test = train_test_split(
    iris.data, iris.target, test_size=0.3, random_state=42, stratify=iris.target)
print(X_train.shape, X_test.shape)

model = KNeighborsClassifier(n_neighbors=5)
print(model.get_params()["n_neighbors"])
model.fit(X_train, y_train)
print(round(model.score(X_test, y_test), 2))
print(model.predict(X_test[:3]).tolist(), y_test[:3].tolist())
print(model.predict_proba(X_test[:1]).round(2).tolist())

clf = LogisticRegression(max_iter=1000).fit(X_train, y_train)
print(clf.coef_.shape, clf.intercept_.shape, clf.classes_.tolist(), round(clf.score(X_test, y_test), 2))
print(iris.target_names[clf.predict([[5.1, 3.5, 1.4, 0.2]])].tolist())`, out: `(150, 4) ['sepal length (cm)', 'sepal width (cm)', 'petal length (cm)', 'petal width (cm)'] ['setosa', 'versicolor', 'virginica']
(105, 4) (45, 4)
5
0.98
[2, 1, 2] [2, 1, 2]
[[0.0, 0.0, 1.0]]
(3, 4) (3,) [0, 1, 2] 0.93
['setosa']` },
  lineByLine: [["load_iris()", "150 flowers, 4 measurements each, 3 species. Built in, no download."], ["train_test_split(..., test_size=0.3, stratify=...)", "105 rows to train, 45 to test, with equal species proportions."], ["KNeighborsClassifier(n_neighbors=5)", "Predicts the majority species among the 5 most similar training flowers."], ["model.fit(...)", "For k-NN, fitting stores the training data; other models learn parameters."], ["model.score(...)", "Accuracy on the test set: 0.98 means 44 of 45 correct."], ["predict_proba", "Three probabilities, one per species, for the first test flower: certain it is class 2 (virginica)."], ["clf.coef_.shape == (3, 4)", "Logistic regression learned one weight per feature for each of 3 classes."], ["clf.predict([[5.1, 3.5, 1.4, 0.2]])", "A typical setosa measurement is classified as setosa. Passing a list of rows (2-D) is required."]],
  dryRun: { intro: "What a 5-nearest-neighbour vote looks like for one flower:", headers: ["Step", "Result"], rows: [["distance to every training flower", "105 numbers"], ["pick the 5 smallest", "5 neighbours"], ["their species", "2, 2, 2, 2, 2"], ["majority vote", "class 2 (virginica), probability 5/5 = 1.0"]] },
  realExample: { intro: "Same data, three algorithms: only the line that creates the model changes. clone() gives a fresh copy and set_params() changes a setting.", code: `from sklearn.base import clone
from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.tree import DecisionTreeClassifier

iris = load_iris()
X_train, X_test, y_train, y_test = train_test_split(
    iris.data, iris.target, test_size=0.3, random_state=42, stratify=iris.target)

models = {
    "knn": KNeighborsClassifier(),
    "tree": DecisionTreeClassifier(max_depth=3, random_state=0),
    "naive bayes": GaussianNB(),
}
for name, model in models.items():
    fitted = clone(model).fit(X_train, y_train)
    print(f"{name:12} {fitted.score(X_test, y_test):.2f}")

knn = KNeighborsClassifier().set_params(n_neighbors=1)
print(knn.get_params()["n_neighbors"], hasattr(knn, "classes_"), hasattr(knn.fit(X_train, y_train), "classes_"))`, out: `knn          0.98
tree         0.93
naive bayes  0.91
1 False True` },
  mistakes: ["Passing a 1-D array as X (use <code>reshape(-1, 1)</code> for one feature).", "Calling <code>predict</code> before <code>fit</code>.", "Scoring on the training data and reporting it as performance.", "Forgetting <code>random_state</code> and getting different results every run.", "Trusting accuracy from a very small test set."],
  practices: ["Keep the same split when comparing models.", "Start with a simple model and a baseline.", "Read <code>model.get_params()</code> to learn the settings.", "Wrap steps in a Pipeline (lesson 3)."],
  interview: ["What is a hyper-parameter?", "What does fit return?", "What is the difference between predict and predict_proba?", "Why are learned attributes suffixed with an underscore?"],
  practiceQs: ["What shape must X have?", "What does score return for a classifier?", "Which method gives probabilities?", "How do you make an unfitted copy of a model?"],
  revision: ["create, fit, predict, score.", "X is 2-D, y is 1-D.", "Hyper-parameters are chosen by you; attributes with an underscore are learned.", "random_state makes results repeatable."],
  hinglish: "scikit-learn mein har model ka pattern same hai: model banao, fit se seekho, predict se istemal karo aur score se naapo. X do dimension ka hota hai (rows, features) aur y ek dimension ka. Seekhi hui cheezein underscore se khatam hoti hain, jaise coef_.",
  quiz: [
    mcq("What shape must X have when you have 100 samples and one feature?", ["(100,)", "(100, 1)", "(1, 100)", "(100, 100)"], 1, "scikit-learn expects (n_samples, n_features)."),
    mcq("Which method returns one probability per class?", ["predict", "score", "predict_proba", "fit"], 2, "predict_proba columns follow model.classes_."),
    mcq("What does model.score(X_test, y_test) return for a classifier?", ["The loss", "The accuracy", "The number of samples", "The probabilities"], 1, "The default metric for classifiers is accuracy."),
    mcq("What is n_neighbors in KNeighborsClassifier?", ["A learned attribute", "A hyper-parameter chosen before training", "The number of classes", "The test size"], 1, "Hyper-parameters are set by you when you create the model."),
    mcq("Which call creates a fresh unfitted copy of a model?", ["copy.copy(model)", "sklearn.base.clone(model)", "model.reset()", "model.fit(None)"], 1, "clone copies the settings but not the learned state.")
  ],
  tasks: [task("k-nearest neighbours", "Read k, then n, then n training rows x y label (two numeric features and a word), then m, then m query rows x y. For every query print the predicted label: find the k training points with the smallest Euclidean distance (ties by position in the training list), then take the label that occurs most among them; if labels tie, choose the one that appears first among the neighbours ordered from nearest to farthest.", "k = int(input())\nn = int(input())\ntraining = [input().split() for _ in range(n)]\nm = int(input())\n# predict a label for each query\n", `k = int(input())
n = int(input())
training = []
for _ in range(n):
    x, y, label = input().split()
    training.append((float(x), float(y), label))
m = int(input())
for _ in range(m):
    qx, qy = map(float, input().split())
    order = sorted(range(n), key=lambda i: ((training[i][0] - qx) ** 2 + (training[i][1] - qy) ** 2, i))
    labels = [training[i][2] for i in order[:k]]
    print(max(labels, key=lambda label: (labels.count(label), -labels.index(label))))`, [["3\n6\n0 0 red\n1 0 red\n0 1 red\n5 5 blue\n6 5 blue\n5 6 blue\n2\n1 1\n5 5.5", "red\nblue"], ["1\n3\n0 0 a\n10 10 b\n5 5 c\n1\n9 9", "b"], ["2\n2\n0 0 a\n10 0 b\n2\n4 0\n7 0", "a\nb"], ["3\n4\n0 0 x\n1 0 y\n2 0 y\n9 0 x\n1\n1.2 0", "y"]])],
});

// ---------------------------------------------------------------- 3
lessons.push({
  title: "Preprocessing and Pipelines: Scaling, Encoding and Missing Values",
  minutes: 60,
  learn: ["Scale numeric features and know which models need it", "Encode categories with one-hot encoding", "Impute missing values safely", "Combine steps with ColumnTransformer and Pipeline to avoid leakage"],
  why: "Models need clean numeric input. Real data has text categories, missing values and features on very different scales. Doing these steps by hand on all data leaks information; a pipeline applies them correctly in training, testing and production.",
  realWorld: "A loan model gets age (years), income (rupees), city (text) and sometimes a missing age. A single pipeline imputes ages, scales numbers, one-hot encodes cities and then fits the classifier, and the same pipeline object is used for new applicants.",
  simple: "<strong>Transformers</strong> learn something from training data (a mean, the list of categories) and then apply it with <code>transform</code>. A <strong>Pipeline</strong> chains them with a final model so that <code>fit</code> and <code>predict</code> run every step in the right order, learning only from the training rows.",
  detail: `<h3>Common transformers</h3>
${table(["Tool", "What it does", "Needed by"], [["<code>StandardScaler</code>", "subtract the mean, divide by the standard deviation (mean 0, spread 1)", "k-NN, SVM, logistic regression, neural networks, PCA"], ["<code>MinMaxScaler</code>", "rescale to a range such as 0 to 1", "when a bounded range is wanted"], ["<code>SimpleImputer</code>", "fill missing values (mean, median, most_frequent, constant)", "almost every model"], ["<code>OneHotEncoder</code>", "one 0/1 column per category (<code>handle_unknown=\"ignore\"</code> for unseen categories)", "unordered text categories"], ["<code>OrdinalEncoder</code>", "integers for categories that have an order (low, medium, high)", "ordered categories"], ["<code>ColumnTransformer</code>", "apply different steps to different columns", "mixed tables"], ["<code>Pipeline</code> / <code>make_pipeline</code>", "chain transformers and a model", "always"]])}
<p>Tree-based models (decision tree, random forest) do not need scaling, but still need numeric input and handled missing values.</p>
<h3>fit_transform versus transform</h3>
<p>Call <code>fit_transform</code> (or <code>fit</code>) <strong>only on the training data</strong>, then <code>transform</code> on test and new data. The scaler keeps the training mean; the encoder keeps the training categories. A Pipeline does this for you, including inside cross-validation, where each fold re-fits the steps on its own training part.</p>
<h3>Encoding categories</h3>
<p>Never turn unordered categories into 0, 1, 2: the model would read &quot;Mumbai (2) is twice Delhi (1)&quot;. One-hot columns avoid that. Very many categories (thousands of ids) need other techniques such as grouping rare values or target encoding done carefully.</p>
<h3>Missing values</h3>
<p>Imputation with the median is a robust default for numbers, the most frequent value for categories. Fit the imputer on training data only. Consider adding an indicator (<code>add_indicator=True</code>) when missingness itself carries meaning.</p>
<h3>Feature ideas</h3>
<p>Good features often beat clever models: ratios (income / loan), dates split into month and weekday, counts, text length, flags. Create them with pandas before the pipeline, or inside it with <code>FunctionTransformer</code>.</p>`,
  syntax: { code: `from sklearn.compose import ColumnTransformer\nfrom sklearn.pipeline import Pipeline\nprep = ColumnTransformer([("num", numeric, ["age"]), ("cat", categorical, ["city"])])\nmodel = Pipeline([("prep", prep), ("clf", LogisticRegression())])`, note: "One object, no leakage." },
  diagram: graph("A preprocessing pipeline", "A table is split by column type: numeric columns go through imputation and scaling, category columns through imputation and one-hot encoding; both outputs are joined and fed to the model.", 780, 230,
    [{ id: "t", k: "io", t: "raw table", x: 90, y: 115, w: 130, h: 50 }, { id: "n", k: "proc", t: "numeric: impute\nthen scale", x: 345, y: 55, w: 200, h: 54 }, { id: "c", k: "proc", t: "categories: impute\nthen one-hot", x: 345, y: 175, w: 200, h: 54 }, { id: "m", k: "term", t: "model\n(fit / predict)", x: 670, y: 115, w: 160, h: 60 }],
    [{ from: "t", to: "n" }, { from: "t", to: "c" }, { from: "n", to: "m" }, { from: "c", to: "m" }]),
  example: { code: `import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

df = pd.DataFrame({
    "age": [22, 25, np.nan, 31, 40],
    "city": ["Pune", "Delhi", "Pune", np.nan, "Mumbai"],
    "income": [30, 45, 38, 52, 70],
})
numeric = Pipeline([("fill", SimpleImputer(strategy="median")), ("scale", StandardScaler())])
categorical = Pipeline([("fill", SimpleImputer(strategy="most_frequent")), ("onehot", OneHotEncoder(handle_unknown="ignore"))])
prep = ColumnTransformer([("num", numeric, ["age", "income"]), ("cat", categorical, ["city"])])

out = prep.fit_transform(df)
print(out.shape)
print(prep.get_feature_names_out().tolist())
print(out.round(2)[:2].tolist())
print(prep.named_transformers_["num"].named_steps["fill"].statistics_.tolist())

new = pd.DataFrame({"age": [28], "city": ["Chennai"], "income": [41]})
print(prep.transform(new).round(2).tolist())

scaler = StandardScaler().fit([[1.0], [2.0], [3.0]])
print(scaler.mean_.tolist(), scaler.scale_.round(3).tolist(), scaler.transform([[4.0]]).round(3).tolist())`, out: `(5, 5)
['num__age', 'num__income', 'cat__city_Delhi', 'cat__city_Mumbai', 'cat__city_Pune']
[[-1.17, -1.25, 0.0, 0.0, 1.0], [-0.68, -0.15, 1.0, 0.0, 0.0]]
[28.0, 45.0]
[[-0.19, -0.44, 0.0, 0.0, 0.0]]
[2.0] [0.816] [[2.449]]` },
  lineByLine: [["df with NaN values", "One missing age and one missing city."], ["numeric pipeline", "Fill missing numbers with the median, then standardise."], ["categorical pipeline", "Fill missing categories with the most frequent one, then one-hot encode (handle_unknown=\"ignore\" lets unseen cities pass)."], ["prep.fit_transform(df)", "Learns medians, means, spreads and the city list from df and returns a 5 x 5 matrix: two scaled numbers plus three city columns."], ["statistics_ [28.0, 45.0]", "The learned medians for age and income (the median of 22, 25, 31, 40 is 28)."], ["prep.transform(new)", "A new person from Chennai: numbers are scaled with the training statistics; the unseen city becomes all zeros."], ["scaler.mean_ / scale_", "The training mean 2 and spread 0.816 are reused: 4 becomes (4 - 2) / 0.816 = 2.449."]],
  dryRun: { intro: "Standardising age 22 (imputed ages: 22, 25, 28, 31, 40):", headers: ["Quantity", "Value"], rows: [["mean of ages", "29.2"], ["standard deviation (population)", "sqrt(190.8 / 5) = 6.18"], ["(22 - 29.2) / 6.18", "-1.17"]] },
  realExample: { intro: "A complete model in one pipeline: unseen categories and missing values are handled at prediction time with no extra code.", code: `import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

df = pd.DataFrame({
    "hours": [2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 4, 6],
    "tier": ["A", "B", "A", "C", "B", "A", "C", "B", "A", "C", "B", "A"],
    "passed": [0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1],
})
X, y = df[["hours", "tier"]], df["passed"]
prep = ColumnTransformer([
    ("num", Pipeline([("fill", SimpleImputer(strategy="median")), ("scale", StandardScaler())]), ["hours"]),
    ("cat", OneHotEncoder(handle_unknown="ignore"), ["tier"]),
])
model = Pipeline([("prep", prep), ("clf", LogisticRegression())]).fit(X, y)
print(list(model.named_steps))
print(model.predict(pd.DataFrame({"hours": [9.5, 1.0, np.nan], "tier": ["Z", "A", "B"]})).tolist())
print(model.predict_proba(pd.DataFrame({"hours": [9.5], "tier": ["Z"]})).shape)`, out: `['prep', 'clf']
[1, 0, 1]
(1, 2)` },
  mistakes: ["Scaling or imputing on all data before the split.", "Encoding unordered categories as 1, 2, 3.", "Re-fitting the scaler on test data.", "Forgetting that the new data must have the same columns as the training data.", "Dropping rows with missing values without checking how many are lost."],
  practices: ["Put all preprocessing and the model in one Pipeline.", "Use <code>handle_unknown=\"ignore\"</code> in the encoder.", "Scale for distance-based and linear models.", "Inspect <code>get_feature_names_out()</code> to see what the model receives."],
  interview: ["Why use a Pipeline?", "When is scaling necessary?", "One-hot versus label encoding?", "How do you handle missing values in a model?"],
  practiceQs: ["Why does fit_transform belong on training data only?", "Which models do not need scaling?", "What does ColumnTransformer do?", "What happens to an unseen category with handle_unknown=\"ignore\"?"],
  revision: ["fit on train, transform on test.", "Scale numbers, one-hot categories, impute gaps.", "ColumnTransformer for mixed columns.", "Pipeline = preprocessing + model in one object."],
  hinglish: "Model ko saaf numeric input chahiye. Missing values SimpleImputer se bharo, numbers StandardScaler se scale karo aur categories OneHotEncoder se 0/1 columns mein badlo. Ye sab Pipeline ke andar rakho taaki fit sirf training data par ho aur leakage na ho.",
  quiz: [
    mcq("Which call must be used only on the training data?", ["transform on the test data", "fit or fit_transform of the scaler", "predict", "score"], 1, "Fitting learns statistics, which must not come from the test set."),
    mcq("Why not encode the cities Delhi, Mumbai, Pune as 0, 1, 2?", ["It is slower", "The model would treat them as ordered numbers with distances", "scikit-learn forbids it", "It uses more memory"], 1, "One-hot columns carry no false order."),
    mcq("Which model type usually does not need feature scaling?", ["k-nearest neighbours", "Logistic regression with regularisation", "Decision tree", "Support vector machine"], 2, "Trees split on thresholds, so scale does not matter."),
    mcq("What does ColumnTransformer allow?", ["Different preprocessing for different columns", "Sorting rows", "Training two models at once", "Plotting"], 0, "For example numeric columns are scaled and category columns encoded."),
    mcq("What does handle_unknown=\"ignore\" do in OneHotEncoder?", ["Raises an error for new categories", "Encodes an unseen category as all zeros", "Drops the column", "Sorts categories"], 1, "It lets the pipeline accept categories not seen in training.")
  ],
  tasks: [task("Standardise columns", "Read r and c, then r rows of c numbers. Replace every value by its z-score within its column, (x - mean) / std, using the population standard deviation (divide by r) like StandardScaler. A column whose std is 0 becomes all 0.00. Print the rows with 2 decimals separated by spaces.", "r, c = map(int, input().split())\nrows = [list(map(float, input().split())) for _ in range(r)]\n# standardise each column\n", `r, c = map(int, input().split())
rows = [list(map(float, input().split())) for _ in range(r)]
columns = []
for j in range(c):
    values = [row[j] for row in rows]
    mean = sum(values) / r
    std = (sum((v - mean) ** 2 for v in values) / r) ** 0.5
    columns.append([(v - mean) / std if std else 0.0 for v in values])
for i in range(r):
    print(" ".join(f"{columns[j][i]:.2f}" for j in range(c)))`, [["3 2\n1 10\n2 10\n3 10", "-1.22 0.00\n0.00 0.00\n1.22 0.00"], ["2 1\n0\n4", "-1.00\n1.00"], ["4 2\n1 100\n2 200\n3 300\n4 400", "-1.34 -1.34\n-0.45 -0.45\n0.45 0.45\n1.34 1.34"], ["1 3\n5 6 7", "0.00 0.00 0.00"]])],
});

module.exports = { lessons };
