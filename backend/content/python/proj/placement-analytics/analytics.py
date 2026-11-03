"""Placement readiness analytics with pandas: a transparent readiness index, group summaries and charts.

The data in students.csv is synthetic (made up for this exercise). It is not from any real college or student.
"""
import tempfile
from pathlib import Path

import pandas as pd

REQUIRED = ["student_id", "branch", "cgpa", "problems_solved", "mock_score", "projects", "internships", "communication", "placed"]
# The index is out of 100. Every component is turned into a fraction between 0 and 1 and multiplied by its weight.
WEIGHTS = {"cgpa": 25, "practice": 25, "mock tests": 25, "projects": 10, "internship": 10, "communication": 5}
BANDS = [(75, "Ready"), (55, "Almost ready"), (0, "Needs work")]
BAND_ORDER = [name for _, name in BANDS]
PNG_SIGNATURE = bytes([0x89]) + b"PNG\r\n" + bytes([0x1A]) + b"\n"


class DataError(ValueError):
    pass


def validate(df):
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise DataError("missing columns: " + ", ".join(missing))
    if df.empty:
        raise DataError("the file has no rows")
    if df[REQUIRED].isna().any().any():
        raise DataError("empty cells in: " + ", ".join(c for c in REQUIRED if df[c].isna().any()))
    if df["student_id"].duplicated().any():
        raise DataError("duplicate student_id values")
    ranges = {"cgpa": (0, 10), "mock_score": (0, 100), "communication": (1, 5), "problems_solved": (0, None), "projects": (0, None), "internships": (0, None)}
    for column, (low, high) in ranges.items():
        if not pd.api.types.is_numeric_dtype(df[column]):
            raise DataError(f"{column} must be numeric")
        if (df[column] < low).any() or (high is not None and (df[column] > high).any()):
            raise DataError(f"{column} is out of range")
    if not df["placed"].isin(["yes", "no"]).all():
        raise DataError("placed must be yes or no")


def load(source):
    df = pd.read_csv(source)
    validate(df)
    return df


def components(df):
    """Each part of the index as a fraction from 0 to 1 (1 means full marks for that part)."""
    return pd.DataFrame({
        "cgpa": df["cgpa"] / 10,
        "practice": (df["problems_solved"] / 100).clip(upper=1),
        "mock tests": df["mock_score"] / 100,
        "projects": (df["projects"] / 3).clip(upper=1),
        "internship": df["internships"].clip(upper=1),
        "communication": df["communication"] / 5,
    })


def band_for(score):
    return next(name for floor, name in BANDS if score >= floor)


def analyze(df):
    """Return a copy with the readiness index, its band and the weakest component of every student."""
    fractions = components(df)
    out = df.copy()
    out["readiness"] = (fractions * pd.Series(WEIGHTS)).sum(axis=1).round(1)
    out["band"] = out["readiness"].apply(band_for)
    out["weakest"] = fractions.idxmin(axis=1)
    return out


def branch_summary(df):
    groups = df.groupby("branch")
    return pd.DataFrame({
        "students": groups.size(),
        "average": groups["readiness"].mean().round(1),
        "ready_percent": groups["band"].apply(lambda bands: (bands == "Ready").mean() * 100),
    })


def placed_by_band(df):
    """(band, students, placed) for every band, in the order Ready, Almost ready, Needs work."""
    rows = []
    for band in BAND_ORDER:
        subset = df[df["band"] == band]
        rows.append((band, len(subset), int((subset["placed"] == "yes").sum())))
    return rows


def report(df):
    lines = [f"Loaded {len(df)} students from {df['branch'].nunique()} branches (synthetic data)."]
    counts = df["band"].value_counts()
    lines.append("Readiness bands: " + ", ".join(f"{band} {int(counts.get(band, 0))}" for band in BAND_ORDER))
    lines.append("Branch summary (average readiness, share ready):")
    for branch, row in branch_summary(df).iterrows():
        lines.append(f"  {branch:<6} n={int(row['students']):<3} average {row['average']:.1f}  ready {row['ready_percent']:.0f}%")
    lines.append("Placed by band:")
    for band, students, placed in placed_by_band(df):
        lines.append(f"  {band:<13} {placed} of {students} placed" + (f" ({placed * 100 / students:.0f}%)" if students else ""))
    lines.append(f"Correlation of problems solved with mock score: {df['problems_solved'].corr(df['mock_score']):.2f}")
    weakest = sorted(df["weakest"].value_counts().items(), key=lambda item: (-item[1], item[0]))
    lines.append("Most common weakest area: " + ", ".join(f"{name} ({count})" for name, count in weakest[:3]))
    lines.append("Five lowest readiness scores:")
    for row in df.sort_values(["readiness", "student_id"]).head(5).itertuples():
        lines.append(f"  {row.student_id} {row.branch:<5} {row.readiness:.1f}  weakest: {row.weakest}")
    lines.append("Note: bands and placement move together here, but this data cannot show that readiness caused placement.")
    return lines


def save_charts(df, path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, (left, right) = plt.subplots(1, 2, figsize=(10, 4))
    table = df.groupby(["branch", "band"]).size().unstack(fill_value=0).reindex(columns=BAND_ORDER, fill_value=0)
    table.plot(kind="bar", stacked=True, ax=left, color=["#2f855a", "#d69e2e", "#c53030"], rot=0)
    left.set_title("Readiness bands by branch")
    left.set_ylabel("Students")
    for placed, colour in (("yes", "#2b6cb0"), ("no", "#a0aec0")):
        subset = df[df["placed"] == placed]
        right.scatter(subset["problems_solved"], subset["mock_score"], label=f"placed: {placed}", color=colour)
    right.set_title("Practice versus mock score")
    right.set_xlabel("Problems solved")
    right.set_ylabel("Mock test score")
    right.legend()
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)


def main():
    df = analyze(load(Path(__file__).with_name("students.csv")))
    print("\n".join(report(df)))
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / "readiness.png"
        save_charts(df, target)
        is_png = target.read_bytes()[:8] == PNG_SIGNATURE
        print(f"Chart drawn: {target.name} ({'valid PNG' if is_png else 'not a PNG'})")


if __name__ == "__main__":
    main()
