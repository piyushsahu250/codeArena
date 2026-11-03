"""Draw the monthly totals as a bar chart. matplotlib is imported here only, so the rest of the tracker works without it."""
from tracker import TrackerError


def save_chart(totals, path):
    if not totals:
        raise TrackerError("there is nothing to chart yet")
    import matplotlib

    matplotlib.use("Agg")  # draw to a file, no window needed
    import matplotlib.pyplot as plt

    months = [month for month, _ in totals]
    values = [cents / 100 for _, cents in totals]
    fig, ax = plt.subplots(figsize=(6, 3.5))
    ax.bar(months, values, color="#2b6cb0")
    ax.set_title("Spending per month")
    ax.set_ylabel("Amount")
    for month, value in zip(months, values):
        ax.annotate(f"{value:,.0f}", (month, value), ha="center", va="bottom", fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)
