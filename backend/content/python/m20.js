// Phase 5 / Module 20: Introduction to AI and Machine Learning with Python. Lessons live in m20a.js to m20c.js; this file adds the module assessment.
"use strict";
const { task } = require("./lib");
const lessons = [...require("./m20a").lessons, ...require("./m20b").lessons, ...require("./m20c").lessons];

module.exports = {
  module: {
    title: "Phase 5 - Introduction to AI and Machine Learning with Python",
    description: "Machine learning concepts and workflow, the scikit-learn estimator API, preprocessing pipelines, regression, classification, evaluation with cross-validation, overfitting and underfitting, tuning and ensembles, and saving, serving and monitoring a model responsibly.",
    chapters: [
      { title: "Foundations", description: "Concepts, the scikit-learn pattern and data preparation.", lessons: lessons.slice(0, 3) },
      { title: "Models and Evaluation", description: "Regression, classification and honest evaluation.", lessons: lessons.slice(3, 6) },
      { title: "Better Models and Deployment", description: "Overfitting, tuning, ensembles and putting a model into service.", lessons: lessons.slice(6) },
    ],
    assessment: {
      title: "Module 20 Assessment: Introduction to AI and Machine Learning",
      description: "Standard-library problems on classification metrics, regression errors, encoding and cross-validation summaries.",
      questions: [
        task("Accuracy and macro F1", "Read two lines of class labels (words): the actual labels and the predicted labels. Print accuracy=A macro_f1=F, both with 2 decimals. Macro F1 is the plain average over all classes that appear in either line of each class's F1 score (a class with no true positives has F1 0).", "", `actual = input().split()
predicted = input().split()
classes = sorted(set(actual) | set(predicted))
accuracy = sum(1 for a, p in zip(actual, predicted) if a == p) / len(actual)
scores = []
for label in classes:
    tp = sum(1 for a, p in zip(actual, predicted) if a == label and p == label)
    fp = sum(1 for a, p in zip(actual, predicted) if a != label and p == label)
    fn = sum(1 for a, p in zip(actual, predicted) if a == label and p != label)
    scores.append(2 * tp / (2 * tp + fp + fn) if tp else 0.0)
print(f"accuracy={accuracy:.2f} macro_f1={sum(scores) / len(scores):.2f}")`, [["a b c a b c\na b c a c b", "accuracy=0.67 macro_f1=0.67"], ["x y\nx y", "accuracy=1.00 macro_f1=1.00"], ["a b\nb a", "accuracy=0.00 macro_f1=0.00"], ["a a b\na a a", "accuracy=0.67 macro_f1=0.40"]]),
        task("Regression errors", "Read two lines of numbers: the actual values and the predicted values. Print mae=A mse=B rmse=C r2=D with 3 decimals each. R squared is 1 minus the sum of squared errors divided by the total sum of squares around the mean of the actual values (print 0.000 when that total is 0).", "", `actual = list(map(float, input().split()))
predicted = list(map(float, input().split()))
n = len(actual)
errors = [a - p for a, p in zip(actual, predicted)]
mae = sum(abs(e) for e in errors) / n
mse = sum(e * e for e in errors) / n
mean = sum(actual) / n
ss_tot = sum((a - mean) ** 2 for a in actual)
r2 = 1 - sum(e * e for e in errors) / ss_tot if ss_tot else 0.0
print(f"mae={mae:.3f} mse={mse:.3f} rmse={mse ** 0.5:.3f} r2={r2:.3f}")`, [["10 20 30\n12 18 33", "mae=2.333 mse=5.667 rmse=2.380 r2=0.915"], ["1 2 3\n1 2 3", "mae=0.000 mse=0.000 rmse=0.000 r2=1.000"], ["2 4 6\n4 4 4", "mae=1.333 mse=2.667 rmse=1.633 r2=0.000"], ["1 2 3\n3 2 1", "mae=1.333 mse=2.667 rmse=1.633 r2=-3.000"]]),
        task("One-hot encoding", "Read a line of category words. Print a header line with the distinct categories in alphabetical order, then one line per input item with a 1 under its category and 0 elsewhere, columns separated by spaces.", "", `items = input().split()
categories = sorted(set(items))
print(" ".join(categories))
for item in items:
    print(" ".join("1" if item == category else "0" for category in categories))`, [["red green red blue", "blue green red\n0 0 1\n0 1 0\n0 0 1\n1 0 0"], ["a", "a\n1"], ["x y", "x y\n1 0\n0 1"], ["b a b a", "a b\n0 1\n1 0\n0 1\n1 0"]]),
        task("Cross-validation summary", "Read a line of cross-validation scores. Print mean=M std=S best_fold=B worst_fold=W, where mean and std (the population standard deviation, as numpy computes by default) have 4 decimals and the fold numbers start at 0 (the first fold wins ties).", "", `scores = list(map(float, input().split()))
mean = sum(scores) / len(scores)
std = (sum((s - mean) ** 2 for s in scores) / len(scores)) ** 0.5
best = scores.index(max(scores))
worst = scores.index(min(scores))
print(f"mean={mean:.4f} std={std:.4f} best_fold={best} worst_fold={worst}")`, [["0.9 0.8 0.85 0.95 0.9", "mean=0.8800 std=0.0510 best_fold=3 worst_fold=1"], ["0.5 0.5 0.5", "mean=0.5000 std=0.0000 best_fold=0 worst_fold=0"], ["1.0 0.0", "mean=0.5000 std=0.5000 best_fold=0 worst_fold=1"], ["0.96 0.97 0.98 1.0 0.98", "mean=0.9780 std=0.0133 best_fold=3 worst_fold=0"]]),
      ],
    },
  },
};
