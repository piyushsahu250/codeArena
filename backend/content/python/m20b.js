// Phase 5 / Module 20, lessons 4-6: regression, classification, and model evaluation.
// Examples need scikit-learn and numpy (installed in the course's virtual environment; verified with scikit-learn 1.9). Judged tasks use the standard library only.
"use strict";
const { chain, graph, table, terminal } = require("./render");
const { mcq, task } = require("./lib");

const lessons = [];

// ---------------------------------------------------------------- 4
lessons.push({
  title: "Regression: Predicting Numbers with Linear Models",
  minutes: 55,
  learn: ["Fit a linear regression and read its coefficient and intercept", "Measure error with MAE, MSE, RMSE and R squared", "Use several features and polynomial features", "Know what regularisation (Ridge, Lasso) is for and the limits of linear models"],
  why: "Forecasting prices, sales, demand and time are regression problems. Linear regression is the baseline against which every other regression model is compared, and it is easy to explain to non-technical people.",
  realWorld: "A property site predicts a flat's price from its area, number of rooms and distance to the metro. The coefficients also say how much each extra square foot is worth.",
  simple: "Linear regression draws the <strong>best straight line</strong> (or plane) through the data: <code>price = slope x area + intercept</code>. &quot;Best&quot; means the smallest sum of squared errors between the line and the real points.",
  detail: `<h3>The model</h3>
<p>For features x1, x2, ... the prediction is <code>intercept + w1 x x1 + w2 x x2 + ...</code>. scikit-learn's <code>LinearRegression</code> finds the weights directly (least squares), so there is no learning rate or randomness. After <code>fit</code>: <code>model.coef_</code> holds the weights and <code>model.intercept_</code> the intercept.</p>
<h3>Measuring error</h3>
${table(["Metric", "Meaning", "Notes"], [["MAE", "mean of |actual - predicted|", "same unit as the target; easy to explain"], ["MSE", "mean of squared errors", "punishes big errors"], ["RMSE", "square root of MSE", "same unit as the target"], ["R squared", "1 - (error of the model / error of always predicting the mean)", "1 is perfect, 0 is no better than the mean, negative is worse"]])}
<p>In scikit-learn: <code>mean_absolute_error</code>, <code>mean_squared_error</code> (take the square root for RMSE), <code>r2_score</code>. <code>model.score</code> returns R squared. Compute them on the <strong>test set</strong>.</p>
<h3>Improving a linear model</h3>
<ul><li><strong>More features</strong>: area, rooms, age, distance.</li><li><strong>Polynomial features</strong>: <code>PolynomialFeatures(degree=2)</code> lets a linear model draw curves.</li><li><strong>Scaling</strong>: needed before regularisation so that all weights are comparable.</li><li><strong>Regularisation</strong>: <code>Ridge</code> shrinks weights (L2), <code>Lasso</code> can set some weights to exactly zero (L1, a form of feature selection). The strength is the hyper-parameter <code>alpha</code>. It fights overfitting when features are many or correlated (lesson 7).</li></ul>
<h3>Assumptions and traps</h3>
<ul><li>The relationship should be roughly linear; plot the <em>residuals</em> (actual minus predicted): a pattern means the model is missing something.</li><li><strong>Outliers</strong> pull the line towards them.</li><li><strong>Extrapolation</strong> (predicting far outside the training range) is unreliable: a line keeps going even where reality does not.</li><li>Correlated features make single coefficients unstable; do not over-interpret them.</li><li>Predict the right thing: price in rupees versus its logarithm for very skewed targets.</li></ul>
<h3>Other regressors</h3>
<p><code>DecisionTreeRegressor</code>, <code>RandomForestRegressor</code>, <code>GradientBoostingRegressor</code> handle non-linear patterns. Use the linear model first as a baseline and an explanation.</p>`,
  syntax: { code: `from sklearn.linear_model import LinearRegression\nfrom sklearn.metrics import mean_absolute_error, r2_score\nmodel = LinearRegression().fit(X_train, y_train)\npred = model.predict(X_test)\nmean_absolute_error(y_test, pred)`, note: "Fit the line, predict, measure error on the test set." },
  diagram: chain("A regression project", "Left to right: choose numeric features, fit the line by least squares, predict on the test set, then measure the error with MAE, RMSE and R squared.",
    [{ k: "io", t: "features X\ntarget y (number)" }, { k: "proc", t: "fit line\nLinearRegression" }, { k: "proc", t: "predict\non test set" }, { k: "term", t: "MAE / RMSE\nR squared" }], { w: 150, gap: 40, hgt: 62 }),
  example: { code: `import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

sqft = np.array([500, 650, 800, 900, 1100, 1200, 1500, 1800, 2000, 2400]).reshape(-1, 1)
price = np.array([32, 40, 52, 57, 70, 74, 95, 110, 124, 150])
X_train, X_test, y_train, y_test = train_test_split(sqft, price, test_size=0.3, random_state=1)

model = LinearRegression().fit(X_train, y_train)
print(round(float(model.coef_[0]), 4), round(float(model.intercept_), 2))
pred = model.predict(X_test)
print(pred.round(1).tolist(), y_test.tolist())
print(round(mean_absolute_error(y_test, pred), 2), round(mean_squared_error(y_test, pred) ** 0.5, 2), round(r2_score(y_test, pred), 4))
print(model.predict([[1000]]).round(1).tolist())

full = LinearRegression().fit(sqft, price)
print(round(full.score(sqft, price), 3))`, out: `0.061 1.46
[50.2, 147.7, 92.9] [52, 150, 95]
2.05 2.06 0.9974
[62.4]
0.999` },
  lineByLine: [["reshape(-1, 1)", "One feature, so X must be a column: shape (10, 1)."], ["train_test_split(..., test_size=0.3)", "7 houses to learn from, 3 to test."], ["coef_[0] = 0.061", "Each extra square foot adds about 0.061 to the price (in lakh rupees here); the intercept is the price at zero area (1.46), which is only a mathematical anchor."], ["predict(X_test)", "Predictions 50.2, 147.7, 92.9 against the real 52, 150, 95: always a little low here."], ["MAE, RMSE", "On average the error is about 2 price units; RMSE is slightly larger because it punishes the bigger misses."], ["R squared 0.9974", "The line explains 99.7 percent of the variation in the test prices."], ["predict([[1000]])", "A 1,000 sq ft house is predicted at about 62.4. Remember the 2-D shape."], ["full.score(...)", "R squared on the training data (0.999): optimistic, shown only to contrast with the test score."]],
  dryRun: { intro: "How the error metrics are built from the three test houses:", headers: ["Actual", "Predicted", "Error", "Squared error"], rows: [["52", "50.2", "1.8", "3.24"], ["150", "147.7", "2.3", "5.29"], ["95", "92.9", "2.1", "4.41"], ["mean", "", "MAE about 2.05", "MSE about 4.31, RMSE about 2.06"]] },
  realExample: { intro: "Two features with an exactly linear target: scikit-learn and a hand-built least-squares solution recover the same weights.", code: `import numpy as np
from sklearn.linear_model import LinearRegression

X = np.array([[1, 0], [2, 1], [3, 0], [4, 1], [5, 0], [6, 1], [7, 1]])
y = 2 * X[:, 0] + 5 * X[:, 1] + 1

model = LinearRegression().fit(X, y)
print(model.coef_.round(3).tolist(), round(float(model.intercept_), 3), round(model.score(X, y), 3))

A = np.column_stack([X, np.ones(len(X))])
weights, *_ = np.linalg.lstsq(A, y, rcond=None)
print(weights.round(3).tolist())
print(model.predict([[10, 1]]).round(2).tolist())`, out: `[2.0, 5.0] 1.0 1.0
[2.0, 5.0, 1.0]
[26.0]` },
  mistakes: ["Evaluating on the training data only.", "Extrapolating far outside the range the model saw.", "Reading coefficients as causes when features are correlated.", "Forgetting to scale before Ridge or Lasso.", "Using accuracy (a classification metric) for a regression problem."],
  practices: ["Start with a linear baseline and report MAE in business units.", "Plot actual versus predicted and the residuals.", "Compare against predicting the mean.", "Use cross-validation for small datasets (lesson 6)."],
  interview: ["What does R squared mean?", "MAE versus RMSE?", "What is the difference between Ridge and Lasso?", "How do outliers affect linear regression?"],
  practiceQs: ["What does the intercept represent?", "Which metric is in the same unit as the target?", "What does a negative R squared mean?", "How can a linear model fit a curve?"],
  revision: ["Least squares line: coef_ and intercept_.", "MAE, MSE, RMSE, R squared on the test set.", "Polynomial features for curves; Ridge/Lasso against overfitting.", "Beware outliers and extrapolation."],
  hinglish: "Linear regression data ke beech se sabse achhi seedhi line kheenchti hai: price = slope x area + intercept. Error MAE, RMSE aur R squared se naapte hain, hamesha test set par. Line training range ke bahar bharosemand nahi hoti aur outlier use kheench lete hain.",
  quiz: [
    mcq("What does an R squared of 0 mean?", ["A perfect model", "The model is no better than always predicting the mean", "The model is broken", "The data is empty"], 1, "R squared compares the model's error with the mean-predictor's error."),
    mcq("Which metric is in the same unit as the target and punishes big errors more than MAE?", ["R squared", "RMSE", "Accuracy", "Precision"], 1, "RMSE is the square root of the mean squared error."),
    mcq("What does Lasso regularisation do that Ridge does not?", ["Nothing", "It can set some coefficients exactly to zero", "It scales the data", "It adds more rows"], 1, "The L1 penalty gives sparse weights."),
    mcq("Why is extrapolation risky for a linear model?", ["It is slow", "The straight line continues even where the real relationship changes", "It raises an error", "It needs more memory"], 1, "The model knows nothing outside its training range."),
    mcq("Which array shape do you pass as X for one feature and 10 samples?", ["(10,)", "(10, 1)", "(1, 10)", "(10, 10)"], 1, "scikit-learn expects (n_samples, n_features).")
  ],
  tasks: [task("Simple linear regression", "Read a line of x values and a line of y values. Print slope=S intercept=I r2=R, each with 3 decimals, for the least-squares line (use statistics.linear_regression) and R squared as the square of statistics.correlation. Avoid printing -0.000.", "import statistics\nx = list(map(float, input().split()))\ny = list(map(float, input().split()))\n# fit the line and print slope, intercept and r2\n", `import statistics

x = list(map(float, input().split()))
y = list(map(float, input().split()))
slope, intercept = statistics.linear_regression(x, y)
r2 = statistics.correlation(x, y) ** 2


def fmt(value):
    return f"{round(value, 3) + 0.0:.3f}"


print(f"slope={fmt(slope)} intercept={fmt(intercept)} r2={fmt(r2)}")`, [["1 2 3 4 5\n2 4 6 8 10", "slope=2.000 intercept=0.000 r2=1.000"], ["1 2 3 4\n3 2 2 1", "slope=-0.600 intercept=3.500 r2=0.900"], ["500 650 800 900 1100 1200 1500 1800 2000 2400\n32 40 52 57 70 74 95 110 124 150", "slope=0.062 intercept=1.307 r2=0.999"], ["2 4 6\n1 1.5 2.4", "slope=0.350 intercept=0.233 r2=0.974"]])],
});

// ---------------------------------------------------------------- 5
lessons.push({
  title: "Classification: Logistic Regression, Trees and the Confusion Matrix",
  minutes: 60,
  learn: ["Train logistic regression, k-NN and decision trees for classification", "Read a confusion matrix and compute precision, recall, F1 and accuracy from it", "Explain a decision tree with export_text", "Choose a model by comparing scores on the same split"],
  why: "Most business predictions are yes/no or multi-class: will the customer leave, is the transaction fraud, is the tumour malignant. You must understand not only accuracy but which kind of mistake the model makes.",
  realWorld: "A hospital screening model is judged by how many sick patients it misses (false negatives), while a spam filter is judged by how many good emails it wrongly blocks (false positives). The same accuracy can hide very different risks.",
  simple: "A classifier assigns each sample to a class. The <strong>confusion matrix</strong> counts the four outcomes for a yes/no problem: true positives, false positives, false negatives and true negatives, and every metric is made from those four numbers.",
  detail: `<h3>Popular classifiers</h3>
${table(["Model", "Idea", "Good for", "Watch out"], [["LogisticRegression", "weighted sum squashed into a probability", "fast strong baseline, explainable", "scale features; linear boundary"], ["KNeighborsClassifier", "vote of the k most similar samples", "small data, simple", "slow on big data; needs scaling"], ["DecisionTreeClassifier", "a flowchart of yes/no questions", "explanation, mixed data", "overfits when deep"], ["RandomForestClassifier", "many trees vote", "strong default for tables", "less explainable"], ["SVC", "widest-margin boundary", "medium data", "needs scaling; slow when very large"]])}
<h3>The confusion matrix</h3>
<p>For a binary problem with the positive class marked 1 (rows are actual, columns predicted):</p>
${table(["", "predicted 0", "predicted 1"], [["actual 0", "true negative (TN)", "false positive (FP)"], ["actual 1", "false negative (FN)", "true positive (TP)"]])}
<ul><li><strong>Accuracy</strong> = (TP + TN) / all.</li><li><strong>Precision</strong> = TP / (TP + FP): of the cases we flagged, how many were real?</li><li><strong>Recall</strong> (sensitivity) = TP / (TP + FN): of the real cases, how many did we find?</li><li><strong>F1</strong> = 2 x precision x recall / (precision + recall): one number that is low if either is low.</li></ul>
<p>In scikit-learn: <code>confusion_matrix(y_true, y_pred)</code> returns <code>[[TN, FP], [FN, TP]]</code> when labels are 0 and 1; <code>classification_report</code> prints all metrics per class. Note which class is &quot;positive&quot;: in the breast-cancer dataset used below, label 1 means <em>benign</em>.</p>
<h3>Decision trees you can read</h3>
<p>A tree asks questions such as &quot;petal width &lt;= 0.8?&quot; and ends in a class. <code>export_text(tree, feature_names=...)</code> prints the rules. Limit <code>max_depth</code> or <code>min_samples_leaf</code> to stop it memorising the training set.</p>
<h3>Picking a model</h3>
<p>Use the same train/test split (or cross-validation) for all candidates and keep the simplest model that is good enough. A small difference on a small test set is noise.</p>`,
  syntax: { code: `from sklearn.metrics import confusion_matrix\ntn, fp, fn, tp = confusion_matrix(y_test, pred).ravel()\nprecision = tp / (tp + fp)\nrecall = tp / (tp + fn)`, note: "Every metric comes from TN, FP, FN and TP." },
  diagram: graph("Confusion matrix", "A two by two grid. Rows are the actual class and columns the predicted class: top left true negative, top right false positive, bottom left false negative, bottom right true positive.", 560, 250,
    [{ id: "tn", k: "proc", t: "TN\nactual 0, predicted 0", x: 170, y: 70, w: 230, h: 70 }, { id: "fp", k: "proc", t: "FP\nactual 0, predicted 1", x: 400, y: 70, w: 230, h: 70 }, { id: "fn", k: "proc", t: "FN\nactual 1, predicted 0", x: 170, y: 160, w: 230, h: 70 }, { id: "tp", k: "proc", t: "TP\nactual 1, predicted 1", x: 400, y: 160, w: 230, h: 70 }],
    []),
  example: { code: `from sklearn.datasets import load_breast_cancer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

data = load_breast_cancer()
X_train, X_test, y_train, y_test = train_test_split(
    data.data, data.target, test_size=0.25, random_state=0, stratify=data.target)
print(data.data.shape, data.target_names.tolist(), round(y_test.mean(), 2))

models = {
    "logistic": make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)),
    "knn": make_pipeline(StandardScaler(), KNeighborsClassifier(n_neighbors=5)),
    "tree": DecisionTreeClassifier(max_depth=3, random_state=0),
}
for name, model in models.items():
    model.fit(X_train, y_train)
    print(name, round(model.score(X_test, y_test), 2))

pred = models["logistic"].predict(X_test)
print(confusion_matrix(y_test, pred).tolist())
tn, fp, fn, tp = confusion_matrix(y_test, pred).ravel()
print(tn, fp, fn, tp)
precision, recall = tp / (tp + fp), tp / (tp + fn)
f1 = 2 * precision * recall / (precision + recall)
accuracy = (tp + tn) / (tp + tn + fp + fn)
print("benign precision", round(precision, 2), "recall", round(recall, 2), "f1", round(f1, 2), "accuracy", round(accuracy, 2))`, out: `(569, 30) ['malignant', 'benign'] 0.63
logistic 0.96
knn 0.95
tree 0.92
[[50, 3], [3, 87]]
50 3 3 87
benign precision 0.97 recall 0.97 f1 0.97 accuracy 0.96` },
  lineByLine: [["load_breast_cancer()", "569 tumours, 30 measurements each; label 0 is malignant, label 1 is benign."], ["stratify=data.target", "Both parts keep the 63 percent benign share."], ["make_pipeline(StandardScaler(), ...)", "k-NN and logistic regression get scaled features; the tree does not need it."], ["scores", "Logistic regression 0.96, k-NN 0.95, tree 0.92 on the same test set."], ["confusion_matrix(...).tolist()", "Rows are the actual class, columns the prediction. Row 0 (actual malignant): 50 recognised, 3 wrongly called benign. Row 1 (actual benign): 3 wrongly called malignant, 87 recognised."], ["tn, fp, fn, tp = ... ravel()", "With benign as the positive class: 50 true negatives, 3 false positives, 3 false negatives, 87 true positives."], ["precision = tp / (tp + fp)", "87 / 90 = 0.97: of the tumours called benign, 97 percent were."], ["recall = tp / (tp + fn)", "87 / 90 = 0.97: of the benign tumours, 97 percent were recognised."], ["accuracy", "(87 + 50) / 143 = 0.96."]],
  dryRun: { intro: "Metrics from the matrix [[50, 3], [3, 87]] (benign = positive):", headers: ["Metric", "Formula", "Value"], rows: [["accuracy", "(87 + 50) / 143", "0.958"], ["precision", "87 / (87 + 3)", "0.967"], ["recall", "87 / (87 + 3)", "0.967"], ["F1", "2 x 0.967 x 0.967 / (0.967 + 0.967)", "0.967"]] },
  realExample: { intro: "A decision tree you can read: the rules for telling iris species apart, printed as text.", code: `from sklearn.datasets import load_iris
from sklearn.tree import DecisionTreeClassifier, export_text

iris = load_iris()
tree = DecisionTreeClassifier(max_depth=2, random_state=0).fit(iris.data, iris.target)
print(export_text(tree, feature_names=iris.feature_names))
print(tree.predict([[5.0, 3.4, 1.5, 0.2], [6.5, 3.0, 5.5, 2.0]]).tolist())`, out: `|--- petal width (cm) <= 0.80
|   |--- class: 0
|--- petal width (cm) >  0.80
|   |--- petal width (cm) <= 1.75
|   |   |--- class: 1
|   |--- petal width (cm) >  1.75
|   |   |--- class: 2

[0, 2]` },
  mistakes: ["Judging a classifier by accuracy alone.", "Forgetting which class is the positive class.", "Reading the confusion matrix with rows and columns swapped.", "Growing a decision tree without limits.", "Comparing models on different splits."],
  practices: ["Always look at the confusion matrix.", "Name the positive class explicitly.", "Use a scaled pipeline for k-NN, SVM and logistic regression.", "Choose the metric from the cost of each kind of mistake."],
  interview: ["Precision versus recall?", "When is accuracy misleading?", "How does a decision tree decide where to split?", "Why does logistic regression have 'regression' in its name?"],
  practiceQs: ["Which cells make up the denominator of recall?", "What does a false negative mean for a disease test?", "What does max_depth control?", "How do you read confusion_matrix output?"],
  revision: ["TN, FP, FN, TP.", "Precision = TP / (TP + FP); recall = TP / (TP + FN); F1 balances them.", "Trees are readable but overfit; limit depth.", "Compare models on the same split."],
  hinglish: "Confusion matrix mein chaar ginti hoti hain: TN, FP, FN aur TP, aur har metric inhi se bante hain. Precision batati hai ki jitne ko humne positive kaha unme se kitne sach the, recall batata hai ki asli positive mein se kitne mile. Sirf accuracy par bharosa mat karo.",
  quiz: [
    mcq("In a cancer screening test, what is a false negative?", ["A healthy person flagged as sick", "A sick person reported as healthy", "A sick person flagged as sick", "A healthy person reported healthy"], 1, "The model missed a real case, which is the dangerous mistake here."),
    mcq("Which formula is recall?", ["TP / (TP + FP)", "TP / (TP + FN)", "(TP + TN) / all", "TN / (TN + FP)"], 1, "Recall asks how many of the real positives were found."),
    mcq("What does confusion_matrix(y_true, y_pred).ravel() return for a binary problem?", ["tp, fp, fn, tn", "tn, fp, fn, tp", "fp, tn, tp, fn", "tn, tp, fp, fn"], 1, "The matrix is [[TN, FP], [FN, TP]] read row by row."),
    mcq("Why can a very deep decision tree score 100% on training data but poorly on new data?", ["It memorised the training samples", "It was scaled twice", "It used too few features", "Trees cannot generalise"], 0, "That is overfitting; limit the depth."),
    mcq("Which metric is best when false alarms are costly and you want few of them?", ["Precision", "Recall", "R squared", "MAE"], 0, "Precision is the share of flagged cases that are real.")
  ],
  tasks: [task("Confusion matrix metrics", "Read two lines of 0/1 labels: the actual labels and the predicted labels (1 is the positive class). Print tn=A fp=B fn=C tp=D, then accuracy=W precision=X recall=Y f1=Z with 2 decimals each. Use 0.00 whenever a division would be by zero.", "actual = list(map(int, input().split()))\npredicted = list(map(int, input().split()))\n# count the four outcomes and print the metrics\n", `actual = list(map(int, input().split()))
predicted = list(map(int, input().split()))
pairs = list(zip(actual, predicted))
tp = sum(1 for a, p in pairs if a == 1 and p == 1)
tn = sum(1 for a, p in pairs if a == 0 and p == 0)
fp = sum(1 for a, p in pairs if a == 0 and p == 1)
fn = sum(1 for a, p in pairs if a == 1 and p == 0)


def ratio(top, bottom):
    return top / bottom if bottom else 0.0


precision = ratio(tp, tp + fp)
recall = ratio(tp, tp + fn)
f1 = ratio(2 * precision * recall, precision + recall)
print(f"tn={tn} fp={fp} fn={fn} tp={tp}")
print(f"accuracy={ratio(tp + tn, len(pairs)):.2f} precision={precision:.2f} recall={recall:.2f} f1={f1:.2f}")`, [["1 0 1 1 0 0 1 0\n1 0 0 1 0 1 1 0", "tn=3 fp=1 fn=1 tp=3\naccuracy=0.75 precision=0.75 recall=0.75 f1=0.75"], ["1 1 0\n0 0 0", "tn=1 fp=0 fn=2 tp=0\naccuracy=0.33 precision=0.00 recall=0.00 f1=0.00"], ["1 0\n1 0", "tn=1 fp=0 fn=0 tp=1\naccuracy=1.00 precision=1.00 recall=1.00 f1=1.00"], ["0 0 0\n1 1 1", "tn=0 fp=3 fn=0 tp=0\naccuracy=0.00 precision=0.00 recall=0.00 f1=0.00"]])],
});

// ---------------------------------------------------------------- 6
lessons.push({
  title: "Model Evaluation: Cross-Validation, Imbalanced Data and Thresholds",
  minutes: 60,
  learn: ["Estimate performance reliably with k-fold cross-validation", "Recognise why accuracy fails on imbalanced data and choose better metrics", "Trade precision against recall by moving the decision threshold", "Report results honestly with a baseline and uncertainty"],
  why: "A single train/test split can be lucky or unlucky. Real data is often imbalanced (1 fraud in 1,000 payments). Choosing the wrong metric makes a useless model look excellent, which is the most common failure in applied machine learning.",
  realWorld: "A fraud model that never flags anything is 99.9 percent accurate and worthless. The bank instead looks at recall (how much fraud is caught), precision (how many alerts are real) and the cost of investigating each alert.",
  simple: "<strong>Cross-validation</strong> splits the training data into k parts, trains on k-1 and tests on the remaining one, k times, and averages the scores. For imbalanced data use precision, recall, F1 or ROC AUC instead of accuracy, and pick the threshold that matches the cost of each mistake.",
  detail: `<h3>k-fold cross-validation</h3>
<p><code>cross_val_score(model, X, y, cv=5)</code> returns k scores. Report the <strong>mean and the spread</strong>: 0.98 +/- 0.01 is trustworthy, 0.80 +/- 0.15 is not. Use <code>StratifiedKFold(n_splits=5, shuffle=True, random_state=0)</code> for classification so every fold keeps the class proportions. Put preprocessing inside a Pipeline so it is re-fitted on each fold's training part (no leakage).</p>
<p>Three sets are common: <strong>train</strong> (learn), <strong>validation</strong> or cross-validation folds (choose and tune), <strong>test</strong> (final report, used once).</p>
<h3>Imbalanced data</h3>
<ul><li>With 5 percent positives, predicting &quot;never positive&quot; gives 95 percent accuracy and 0 percent recall.</li><li>Use <strong>precision, recall, F1, ROC AUC</strong> or <strong>average precision</strong>, and always look at the confusion matrix.</li><li>Ways to help the model: <code>class_weight=&quot;balanced&quot;</code>, resampling the training set (never the test set), collecting more minority examples, and tuning the threshold.</li></ul>
<h3>Thresholds</h3>
<p>Classifiers output probabilities; <code>predict</code> uses 0.5. Lowering the threshold flags more cases: <strong>recall goes up, precision usually goes down</strong>; raising it does the opposite. Choose it from the business costs (missing a fraud versus reviewing a false alarm), on validation data. <code>roc_auc_score</code> measures how well the model ranks positives above negatives regardless of threshold (0.5 is random, 1.0 perfect).</p>
${table(["Situation", "Prefer"], [["balanced classes, equal costs", "accuracy or F1"], ["rare positives", "precision, recall, F1, average precision"], ["missing a case is very costly (disease, fraud)", "high recall; accept more false alarms"], ["false alarms are costly (blocking a customer)", "high precision"], ["ranking quality", "ROC AUC"]])}
<h3>Honest reporting</h3>
<ul><li>Always show the baseline next to the model.</li><li>Give the metric, the data it was measured on and its uncertainty.</li><li>Evaluate on data that looks like production (time-ordered data: train on the past, test on the future with <code>TimeSeriesSplit</code>).</li><li>Check results per group (for example gender, region) to find unfair gaps.</li></ul>`,
  syntax: { code: `from sklearn.model_selection import cross_val_score, StratifiedKFold\ncv = StratifiedKFold(5, shuffle=True, random_state=0)\nscores = cross_val_score(pipeline, X, y, cv=cv, scoring="f1")\nscores.mean(), scores.std()`, note: "Report the mean and the spread." },
  diagram: graph("5-fold cross-validation", "Three of the five folds shown as rows: in each row four blocks are used for training and one block, a different one each time, is used for testing.", 640, 230,
    [{ id: "a1", k: "term", t: "test", x: 110, y: 40, w: 150, h: 40 }, { id: "a2", k: "proc", t: "train", x: 285, y: 40, w: 150, h: 40 }, { id: "a3", k: "proc", t: "train", x: 460, y: 40, w: 150, h: 40 }, { id: "b1", k: "proc", t: "train", x: 110, y: 115, w: 150, h: 40 }, { id: "b2", k: "term", t: "test", x: 285, y: 115, w: 150, h: 40 }, { id: "b3", k: "proc", t: "train", x: 460, y: 115, w: 150, h: 40 }, { id: "c1", k: "proc", t: "train", x: 110, y: 190, w: 150, h: 40 }, { id: "c2", k: "proc", t: "train", x: 285, y: 190, w: 150, h: 40 }, { id: "c3", k: "term", t: "test", x: 460, y: 190, w: 150, h: 40 }],
    []),
  example: { code: `import numpy as np
from sklearn.datasets import load_breast_cancer
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_score, recall_score
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

y = np.zeros(1000, dtype=int)
y[:50] = 1
X = np.zeros((1000, 1))
guess = DummyClassifier(strategy="most_frequent").fit(X, y).predict(X)
print(accuracy_score(y, guess), recall_score(y, guess), precision_score(y, guess, zero_division=0))

data = load_breast_cancer()
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)
candidates = {
    "logistic": make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)),
    "forest": RandomForestClassifier(n_estimators=100, random_state=0),
}
for name, model in candidates.items():
    scores = cross_val_score(model, data.data, data.target, cv=cv)
    print(name, len(scores), round(scores.mean(), 2), round(scores.std(), 2))`, out: `0.95 0.0 0.0
logistic 5 0.98 0.01
forest 5 0.96 0.01` },
  lineByLine: [["y with 50 ones in 1000", "5 percent positive cases: an imbalanced problem."], ["DummyClassifier(\"most_frequent\")", "Always predicts 0. Its accuracy is 0.95, yet it finds none of the 50 positives: recall 0.0 and precision 0.0."], ["StratifiedKFold(5, shuffle=True, random_state=0)", "Five folds that each keep the class proportions, shuffled repeatably."], ["cross_val_score(model, X, y, cv=cv)", "Trains and scores the model five times and returns five accuracies. The pipeline is re-fitted inside every fold."], ["mean 0.98, std 0.01", "Logistic regression is both accurate and stable across folds."], ["forest 0.96", "Slightly lower here: the most complex model is not automatically best."]],
  dryRun: { intro: "Five folds over 569 samples (about 114 test samples each):", headers: ["Fold", "Trained on", "Tested on"], rows: [["1", "folds 2, 3, 4, 5", "fold 1"], ["2", "folds 1, 3, 4, 5", "fold 2"], ["3", "folds 1, 2, 4, 5", "fold 3"], ["4", "folds 1, 2, 3, 5", "fold 4"], ["5", "folds 1, 2, 3, 4", "fold 5"]] },
  realExample: { intro: "Moving the decision threshold on ten scored cases: a lower threshold finds every real case but raises false alarms.", code: `import numpy as np

proba = np.array([0.95, 0.8, 0.7, 0.6, 0.55, 0.4, 0.35, 0.3, 0.2, 0.1])
actual = np.array([1, 1, 0, 1, 0, 1, 0, 1, 0, 0])
for threshold in (0.5, 0.3):
    predicted = (proba >= threshold).astype(int)
    tp = int(((predicted == 1) & (actual == 1)).sum())
    fp = int(((predicted == 1) & (actual == 0)).sum())
    fn = int(((predicted == 0) & (actual == 1)).sum())
    print(threshold, tp, fp, fn, round(tp / (tp + fp), 3), round(tp / (tp + fn), 3))`, out: `0.5 3 2 2 0.6 0.6
0.3 5 3 0 0.625 1.0` },
  mistakes: ["Reporting accuracy on imbalanced data.", "Tuning on the test set.", "Pre-processing the whole dataset before cross-validation.", "Resampling before splitting, so copies of the same case land in train and test.", "Reporting only the best score instead of mean and spread."],
  practices: ["Use stratified folds and a Pipeline.", "Always include a dummy baseline.", "Pick the metric from the business cost before modelling.", "Choose the threshold on validation data and report it."],
  interview: ["Why use cross-validation?", "How do you evaluate a model on imbalanced data?", "What does ROC AUC measure?", "What happens to precision and recall when you lower the threshold?"],
  practiceQs: ["What is stratification?", "Why can 99% accuracy be useless?", "What does class_weight=\"balanced\" do?", "When would you prefer recall over precision?"],
  revision: ["k-fold: train on k-1 parts, test on one, average.", "Imbalance: use precision, recall, F1, AUC.", "Lower threshold: recall up, precision down.", "Baseline, mean, spread."],
  hinglish: "Cross-validation data ko k hisson mein baant kar har baar ek hissa test aur baaki train karta hai, phir scores ka average aur spread batata hai. Imbalanced data mein accuracy dhokha deti hai, isliye precision, recall aur F1 dekho. Threshold kam karne par recall badhta hai aur precision aam taur par ghatti hai.",
  quiz: [
    mcq("A dataset has 2% positive cases. A model that always predicts negative has what accuracy?", ["2%", "50%", "98%", "100%"], 2, "98 percent, which shows why accuracy is a poor metric here."),
    mcq("What does 5-fold cross-validation produce?", ["One score", "Five scores from five train/test rounds", "Five models trained on all data", "A confusion matrix"], 1, "Each fold is the test part exactly once."),
    mcq("You lower the classification threshold from 0.5 to 0.3. What usually happens?", ["Recall rises and precision falls", "Both rise", "Precision rises and recall falls", "Nothing"], 0, "More cases are flagged, so more real cases and more false alarms are caught."),
    mcq("Why must preprocessing be inside the Pipeline when using cross-validation?", ["To save memory", "So each fold fits it on its own training part only", "scikit-learn requires it", "It makes it slower"], 1, "Otherwise statistics from the validation part leak into training."),
    mcq("Which metric measures ranking quality independently of the threshold?", ["Accuracy", "ROC AUC", "MAE", "Precision at 0.5"], 1, "AUC compares how often a positive is scored above a negative.")
  ],
  tasks: [task("k-fold test ranges", "Read n (the number of samples) and k (the number of folds, at most n). Split the indices 0 to n-1 into k consecutive folds like scikit-learn's KFold without shuffling: the first n mod k folds have one extra sample. For every fold print fold i: test=A-B train=T, with the first and last test index (inclusive) and the number of training samples.", "n, k = map(int, input().split())\n# print the test range and the training size of every fold\n", `n, k = map(int, input().split())
start = 0
for i in range(k):
    size = n // k + (1 if i < n % k else 0)
    print(f"fold {i}: test={start}-{start + size - 1} train={n - size}")
    start += size`, [["10 3", "fold 0: test=0-3 train=6\nfold 1: test=4-6 train=7\nfold 2: test=7-9 train=7"], ["5 5", "fold 0: test=0-0 train=4\nfold 1: test=1-1 train=4\nfold 2: test=2-2 train=4\nfold 3: test=3-3 train=4\nfold 4: test=4-4 train=4"], ["7 2", "fold 0: test=0-3 train=3\nfold 1: test=4-6 train=4"], ["6 3", "fold 0: test=0-1 train=4\nfold 1: test=2-3 train=4\nfold 2: test=4-5 train=4"]])],
});

module.exports = { lessons };
