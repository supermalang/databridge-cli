"""
Chart generation — 21 types via matplotlib.
bar, horizontal_bar, stacked_bar, grouped_bar, pie, donut,
line, area, histogram, scatter, box_plot,
heatmap, treemap, waterfall, funnel, table,
bullet_chart, likert, scorecard, pyramid, dot_map

New options supported across chart types:
  color        : hex string — overrides default palette color for single-series charts
  sort         : "value" (default) | "label" | "none" — sort order for bar/horizontal_bar
  normalize    : true/false — 100% stacked bar (stacked_bar only)
  freq         : "day"|"week"|"month"|"year" — time grouping for line/area
  xlabel       : override x-axis label
  ylabel       : override y-axis label
  basemap      : true/false — add OpenStreetMap tile basemap (dot_map, requires contextily)
  color_by     : column name to color dots by category (dot_map)
  size         : dot size in points (dot_map, default 20)
  distinct_by  : column name — deduplicate df by this column before charting
  expand_multi : true/false — split space-separated select_multiple values before counting
                 (bar, horizontal_bar, pie, donut, treemap, waterfall, funnel, table, likert)
                 Note: choice labels containing spaces will be split incorrectly (Kobo limitation)
"""
import logging
from pathlib import Path
from typing import Dict, List, Optional
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

log = logging.getLogger(__name__)
PALETTE = ["#1D9E75","#378ADD","#D85A30","#BA7517","#7F77DD","#D4537E","#5DCAA5","#85B7EB","#F0997B","#C0DD97"]
_rc = {
    "figure.facecolor":"white","axes.facecolor":"white","axes.edgecolor":"#CCCCCC",
    "axes.spines.top":False,"axes.spines.right":False,"axes.grid":True,"axes.axisbelow":True,
    "grid.color":"#EEEEEE","grid.linewidth":0.7,"font.family":"sans-serif","font.size":10,
    "axes.titlesize":12,"axes.titleweight":"bold","axes.titlepad":10,
}
if "axes.titleloc" in plt.rcParams:
    _rc["axes.titleloc"] = "left"
plt.rcParams.update(_rc)
CHART_DIR = Path("data/processed/charts")

def generate_chart(chart_cfg: Dict, df: pd.DataFrame, out_dir: Path = CHART_DIR) -> Optional[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    name = chart_cfg.get("name","chart"); chart_type = chart_cfg.get("type","bar")
    title = chart_cfg.get("title",name); questions = chart_cfg.get("questions",[])
    opts = chart_cfg.get("options",{}); out_path = out_dir / f"{name}.png"
    missing = [q for q in questions if q not in df.columns]
    if missing: log.warning(f"Chart '{name}': columns not found: {missing}"); return None
    # distinct_by: deduplicate df by a column before charting
    distinct_by = opts.get("distinct_by")
    if distinct_by:
        if distinct_by not in df.columns:
            log.warning(f"Chart '{name}': distinct_by column '{distinct_by}' not found — ignored")
        else:
            df = df.drop_duplicates(subset=[distinct_by], keep="first")
    # expand_multi: explode space-separated select_multiple values (first question column only)
    if opts.get("expand_multi") and questions:
        col = questions[0]
        df = df.copy()
        df[col] = df[col].astype(str).str.strip()
        df = df.assign(**{col: df[col].str.split(" ")}).explode(col)
        df = df[df[col].notna() & (df[col] != "") & (df[col] != "nan")]
    try:
        fn = CHART_DISPATCH.get(chart_type)
        if not fn: log.warning(f"Unknown chart type '{chart_type}'"); return None
        fn(df, questions, title, out_path, opts)
        log.info(f"  Chart generated: {name} ({chart_type})")
        return out_path
    except Exception as e:
        log.error(f"  Chart '{name}' failed: {e}"); return None

# ── helpers ────────────────────────────────────────────────────────────────────

def _fs(o, d=(7,4)):
    return (o.get("width_inches", d[0]), o.get("height_inches", d[1]))

def _top(s, n=15):
    return s.value_counts().head(n)

def _color(opts, index=0):
    """Return single color: opts.color if set, else PALETTE[index]."""
    return opts.get("color", PALETTE[index])

def _sort(counts, opts):
    """Sort a Series by opts.sort: 'value' (default) | 'label' | 'none'."""
    mode = opts.get("sort", "value")
    if mode == "label":
        return counts.sort_index()
    if mode == "none":
        return counts
    return counts.sort_values()  # default: by value ascending

def _labels(opts, default_x="", default_y=""):
    return opts.get("xlabel", default_x), opts.get("ylabel", default_y)

def _label_color(hex_color):
    """Return 'black' or 'white' for readable text on the given background hex color."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
    luminance = (0.299*r + 0.587*g + 0.114*b) / 255
    return "black" if luminance > 0.5 else "white"

def _freq_resample(df, x_col, y_col, freq):
    """Group a date+value series by freq: day/week/month/year."""
    freq_map = {"day":"D","week":"W","month":"ME","year":"YE"}
    rule = freq_map.get(freq, "ME")
    tmp = df[[x_col, y_col]].copy()
    tmp[x_col] = pd.to_datetime(tmp[x_col], errors="coerce")
    tmp = tmp.dropna(subset=[x_col])
    tmp = tmp.set_index(x_col).resample(rule)[y_col].mean().reset_index()
    return tmp

def _freq_count(series, freq):
    """Count occurrences of a date series grouped by freq."""
    freq_map = {"day":"D","week":"W","month":"ME","year":"YE"}
    rule = freq_map.get(freq, "ME")
    s = pd.to_datetime(series, errors="coerce").dropna()
    return s.value_counts().resample(rule).sum().sort_index()

# ── chart functions ────────────────────────────────────────────────────────────

def chart_bar(df, q, title, out, opts):
    c = q[0]
    counts = _sort(_top(df[c].dropna(), opts.get("top_n", 15)), opts)
    xl, yl = _labels(opts, c, "Count")
    fig, ax = plt.subplots(figsize=_fs(opts))
    ax.bar(counts.index, counts.values, color=_color(opts), alpha=0.87)
    ax.set_title(title); ax.set_xlabel(xl); ax.set_ylabel(yl)
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_horizontal_bar(df, q, title, out, opts):
    c = q[0]
    counts = _sort(_top(df[c].dropna(), opts.get("top_n", 15)), opts)
    xl, yl = _labels(opts, "Count", "")
    fig, ax = plt.subplots(figsize=_fs(opts, (7, max(3, len(counts)*0.4))))
    bars = ax.barh(counts.index, counts.values, color=_color(opts), alpha=0.87)
    for b in bars:
        w = b.get_width()
        ax.text(w + max(counts.values)*0.01, b.get_y()+b.get_height()/2, f"{int(w)}", va="center", fontsize=9)
    ax.set_title(title); ax.set_xlabel(xl); ax.set_ylabel(yl); ax.margins(x=0.12)
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_stacked_bar(df, q, title, out, opts):
    if len(q) < 2: raise ValueError("stacked_bar needs 2 questions")
    x, s = q[0], q[1]
    pivot = pd.crosstab(df[x], df[s])
    top_x = df[x].value_counts().head(opts.get("top_n", 10)).index
    pivot = pivot.loc[pivot.index.isin(top_x)]
    normalize = opts.get("normalize", False)
    if normalize:
        pivot = pivot.div(pivot.sum(axis=1), axis=0) * 100
    xl, yl = _labels(opts, "", "%" if normalize else "Count")
    fig, ax = plt.subplots(figsize=_fs(opts, (8, 5)))
    pivot.plot(kind="bar", stacked=True, ax=ax, color=PALETTE[:len(pivot.columns)], alpha=0.87)
    ax.set_title(title); ax.set_ylabel(yl); ax.set_xlabel(xl)
    if normalize:
        ax.set_ylim(0, 100)
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.0f}%"))
    ax.legend(title=s, bbox_to_anchor=(1.01, 1), loc="upper left", fontsize=9)
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_pie(df, q, title, out, opts):
    c = q[0]; counts = _top(df[c].dropna(), opts.get("top_n", 8))
    colors = PALETTE[:len(counts)]
    fig, ax = plt.subplots(figsize=_fs(opts, (6, 5)))
    _, _, at = ax.pie(counts.values, labels=counts.index, colors=colors,
                      autopct="%1.1f%%", startangle=90, pctdistance=0.82)
    for i, t in enumerate(at):
        t.set_fontsize(9)
        t.set_color(_label_color(colors[i % len(colors)]))
    ax.set_title(title); plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_donut(df, q, title, out, opts):
    c = q[0]; counts = _top(df[c].dropna(), opts.get("top_n", 8))
    colors = PALETTE[:len(counts)]
    fig, ax = plt.subplots(figsize=_fs(opts, (6, 5)))
    _, _, at = ax.pie(counts.values, labels=counts.index, colors=colors,
                      autopct="%1.1f%%", startangle=90, pctdistance=0.75,
                      wedgeprops={"width": 0.5})
    for i, t in enumerate(at):
        t.set_fontsize(9)
        t.set_color(_label_color(colors[i % len(colors)]))
    ax.set_title(title); plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_line(df, q, title, out, opts):
    x = q[0]; y = q[1] if len(q) > 1 else None
    freq = opts.get("freq")
    xl, yl = _labels(opts, x, y or "Count")
    fig, ax = plt.subplots(figsize=_fs(opts, (8, 4)))
    if y:
        if freq:
            tmp = _freq_resample(df, x, y, freq)
        else:
            tmp = df[[x, y]].dropna().sort_values(x)
        ax.plot(tmp[x], tmp[y], color=_color(opts), linewidth=2, marker="o", markersize=4)
    else:
        cnt = _freq_count(df[x], freq) if freq else df[x].value_counts().sort_index()
        ax.plot(cnt.index, cnt.values, color=_color(opts), linewidth=2, marker="o", markersize=4)
    ax.set_title(title); ax.set_xlabel(xl); ax.set_ylabel(yl)
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_area(df, q, title, out, opts):
    x = q[0]; y = q[1] if len(q) > 1 else None
    freq = opts.get("freq")
    xl, yl = _labels(opts, x, y or "Count")
    fig, ax = plt.subplots(figsize=_fs(opts, (8, 4)))
    col = _color(opts)
    if y:
        if freq:
            tmp = _freq_resample(df, x, y, freq)
        else:
            tmp = df[[x, y]].dropna().sort_values(x)
        ax.fill_between(tmp[x], tmp[y], alpha=0.4, color=col)
        ax.plot(tmp[x], tmp[y], color=col, linewidth=1.5)
    else:
        cnt = _freq_count(df[x], freq) if freq else df[x].value_counts().sort_index()
        ax.fill_between(cnt.index, cnt.values, alpha=0.4, color=col)
        ax.plot(cnt.index, cnt.values, color=col, linewidth=1.5)
    ax.set_title(title); ax.set_xlabel(xl); ax.set_ylabel(yl)
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_histogram(df, q, title, out, opts):
    c = q[0]; series = pd.to_numeric(df[c], errors="coerce").dropna()
    xl, yl = _labels(opts, c, "Count")
    fig, ax = plt.subplots(figsize=_fs(opts))
    ax.hist(series, bins=opts.get("bins", 15), color=_color(opts, 1), alpha=0.85, edgecolor="white")
    ax.set_title(title); ax.set_xlabel(xl); ax.set_ylabel(yl)
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_scatter(df, q, title, out, opts):
    if len(q) < 2: raise ValueError("scatter needs 2 questions")
    x, y = q[0], q[1]
    xl, yl = _labels(opts, x, y)
    fig, ax = plt.subplots(figsize=_fs(opts, (6, 5)))
    ax.scatter(pd.to_numeric(df[x], errors="coerce"), pd.to_numeric(df[y], errors="coerce"),
               color=_color(opts), alpha=0.6, s=40, edgecolors="white", linewidth=0.5)
    ax.set_title(title); ax.set_xlabel(xl); ax.set_ylabel(yl)
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_box_plot(df, q, title, out, opts):
    if len(q) < 2: raise ValueError("box_plot needs 2 questions")
    cat, num = q[0], q[1]; n = opts.get("top_n", 10)
    xl, yl = _labels(opts, cat, num)
    top_cats = df[cat].value_counts().head(n).index
    groups = [pd.to_numeric(df[df[cat]==c][num], errors="coerce").dropna() for c in top_cats]
    fig, ax = plt.subplots(figsize=_fs(opts, (8, 5)))
    bp = ax.boxplot(groups, patch_artist=True, labels=top_cats)
    for i, patch in enumerate(bp["boxes"]):
        patch.set_facecolor(PALETTE[i % len(PALETTE)]); patch.set_alpha(0.75)
    ax.set_title(title); ax.set_xlabel(xl); ax.set_ylabel(yl)
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_heatmap(df, q, title, out, opts):
    if len(q) < 2: raise ValueError("heatmap needs 2 questions")
    r, c = q[0], q[1]; n = opts.get("top_n", 10)
    top_r = df[r].value_counts().head(n).index; top_c = df[c].value_counts().head(n).index
    pivot = pd.crosstab(df[r], df[c]).loc[lambda x: x.index.isin(top_r), lambda x: x.columns.isin(top_c)]
    fig, ax = plt.subplots(figsize=_fs(opts, (8, 6)))
    im = ax.imshow(pivot.values, cmap="YlGn", aspect="auto")
    ax.set_xticks(range(len(pivot.columns))); ax.set_yticks(range(len(pivot.index)))
    ax.set_xticklabels(pivot.columns, rotation=30, ha="right", fontsize=9)
    ax.set_yticklabels(pivot.index, fontsize=9)
    for i in range(len(pivot.index)):
        for j in range(len(pivot.columns)):
            ax.text(j, i, pivot.values[i,j], ha="center", va="center", fontsize=8)
    xl, yl = _labels(opts, c, r)
    plt.colorbar(im, ax=ax, shrink=0.7); ax.set_title(title)
    ax.set_xlabel(xl); ax.set_ylabel(yl)
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_treemap(df, q, title, out, opts):
    import squarify
    c = q[0]; counts = _top(df[c].dropna(), opts.get("top_n", 15))
    fig, ax = plt.subplots(figsize=_fs(opts, (8, 5)))
    squarify.plot(sizes=counts.values, label=counts.index,
                  color=PALETTE[:len(counts)], alpha=0.8, ax=ax)
    ax.set_title(title); ax.axis("off")
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_waterfall(df, q, title, out, opts):
    c = q[0]
    counts = _sort(_top(df[c].dropna(), opts.get("top_n", 12)), opts)
    running = counts.cumsum(); bottoms = [0] + list(running.values[:-1])
    xl, yl = _labels(opts, c, "Cumulative count")
    fig, ax = plt.subplots(figsize=_fs(opts, (8, 4)))
    for i, (label, val, bottom) in enumerate(zip(counts.index, counts.values, bottoms)):
        ax.bar(label, val, bottom=bottom, color=PALETTE[i % len(PALETTE)], alpha=0.85, edgecolor="white")
    ax.set_title(title); ax.set_xlabel(xl); ax.set_ylabel(yl)
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_funnel(df, q, title, out, opts):
    c = q[0]; counts = _top(df[c].dropna(), opts.get("top_n", 10)).sort_values(ascending=False)
    fig, ax = plt.subplots(figsize=_fs(opts, (7, max(3, len(counts)*0.5))))
    max_val = counts.values[0]
    for i, (label, val) in enumerate(zip(counts.index, counts.values)):
        w = val / max_val; left = (1 - w) / 2
        color = PALETTE[i % len(PALETTE)]
        ax.barh(i, w, left=left, color=color, alpha=0.85, height=0.6)
        ax.text(0.5, i, f"{label}  ({val})", ha="center", va="center",
                fontsize=9, color=_label_color(color), fontweight="bold")
    ax.set_xlim(0, 1); ax.axis("off"); ax.set_title(title)
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_table(df, q, title, out, opts):
    c = q[0]; counts = _top(df[c].dropna(), opts.get("top_n", 15)).reset_index()
    counts.columns = [c, "Count"]
    counts["Percent"] = (counts["Count"] / counts["Count"].sum() * 100).round(1).astype(str) + "%"
    fig, ax = plt.subplots(figsize=_fs(opts, (6, max(2, len(counts)*0.35+1))))
    ax.axis("off")
    tbl = ax.table(cellText=counts.values, colLabels=counts.columns, cellLoc="center", loc="center")
    tbl.auto_set_font_size(False); tbl.set_fontsize(10); tbl.scale(1, 1.4)
    header_color = _color(opts)
    for (row, col), cell in tbl.get_celld().items():
        if row == 0:
            cell.set_facecolor(header_color)
            cell.set_text_props(color=_label_color(header_color), fontweight="bold")
        elif row % 2 == 0:
            cell.set_facecolor("#F5F5F5")
        cell.set_edgecolor("#DDDDDD")
    ax.set_title(title, pad=10)
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)

def chart_grouped_bar(df, q, title, out, opts):
    if len(q) < 2: raise ValueError("grouped_bar needs 2 questions: [category, group_by]")
    cat, grp = q[0], q[1]
    n = opts.get("top_n", 12)
    top_cats = df[cat].value_counts().head(n).index
    pivot = pd.crosstab(df[cat], df[grp]).loc[lambda x: x.index.isin(top_cats)]
    if opts.get("sort", "value") == "value":
        pivot = pivot.loc[pivot.sum(axis=1).sort_values().index]
    elif opts.get("sort") == "label":
        pivot = pivot.sort_index()
    xl, yl = _labels(opts, cat, "Count")
    fig, ax = plt.subplots(figsize=_fs(opts, (9, 5)))
    pivot.plot(kind="bar", ax=ax, color=PALETTE[:len(pivot.columns)], alpha=0.87, width=0.75)
    ax.set_title(title); ax.set_xlabel(xl); ax.set_ylabel(yl)
    ax.legend(title=grp, bbox_to_anchor=(1.01, 1), loc="upper left", fontsize=9)
    plt.xticks(rotation=30, ha="right")
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)


def chart_bullet_chart(df, q, title, out, opts):
    target = opts.get("target")
    if target is None: raise ValueError("bullet_chart requires options.target")
    target = float(target)
    c = q[0]
    achieved = float(pd.to_numeric(df[c], errors="coerce").sum()) if df[c].dtype.kind in "iuf" else float(df[c].notna().sum())
    pct = achieved / target * 100 if target > 0 else 0
    xl, _ = _labels(opts, "", "")
    col = _color(opts)
    fig, ax = plt.subplots(figsize=_fs(opts, (7, 1.6)))
    # background track
    ax.barh(0, target, color="#EEEEEE", height=0.5, zorder=1)
    # achieved bar
    ax.barh(0, achieved, color=col, height=0.5, alpha=0.87, zorder=2)
    # target line
    ax.axvline(target, color="#333333", linewidth=2, zorder=3)
    # label
    ax.text(achieved + target * 0.01, 0, f"{achieved:,.0f} / {target:,.0f}  ({pct:.1f}%)",
            va="center", fontsize=10, fontweight="bold", color="#333333")
    ax.set_xlim(0, target * 1.25)
    ax.set_yticks([]); ax.set_xlabel(xl or c); ax.set_title(title)
    ax.spines["left"].set_visible(False); ax.grid(False)
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)


def chart_likert(df, q, title, out, opts):
    c = q[0]
    scale = opts.get("scale")
    if not scale:
        # auto-detect: sort unique values
        scale = sorted(df[c].dropna().unique().tolist(), key=lambda x: str(x))
    neutral = opts.get("neutral", scale[len(scale) // 2] if scale else None)
    xl, yl = _labels(opts, "% of responses", "")

    counts = df[c].value_counts()
    # Order by scale
    ordered = pd.Series([counts.get(s, 0) for s in scale], index=scale)
    total = ordered.sum()
    if total == 0: raise ValueError("likert: no data")
    pcts = ordered / total * 100

    # Split at neutral
    neutral_idx = list(scale).index(neutral) if neutral in scale else len(scale) // 2
    neg_labels = scale[:neutral_idx]
    neu_labels = [scale[neutral_idx]] if neutral in scale else []
    pos_labels = scale[neutral_idx+1:] if neutral in scale else scale[neutral_idx:]

    neg_colors = ["#D85A30", "#F0997B"][:len(neg_labels)]
    neu_colors = ["#CCCCCC"]
    pos_colors = ["#5DCAA5", "#1D9E75"][:len(pos_labels)]
    colors = neg_colors + neu_colors + pos_colors

    # Build cumulative lefts: negatives go left (negative x), positives go right
    neg_total = pcts[neg_labels].sum()
    fig, ax = plt.subplots(figsize=_fs(opts, (9, max(2.5, 1.5))))
    left = -neg_total
    for i, lbl in enumerate(neg_labels):
        ax.barh(0, pcts[lbl], left=left, color=neg_colors[i % len(neg_colors)], height=0.5, label=lbl)
        left += pcts[lbl]
    for lbl, col in zip(neu_labels, neu_colors):
        ax.barh(0, pcts[lbl], left=left, color=col, height=0.5, label=lbl)
        left += pcts[lbl]
    for i, lbl in enumerate(pos_labels):
        ax.barh(0, pcts[lbl], left=left, color=pos_colors[i % len(pos_colors)], height=0.5, label=lbl)
        left += pcts[lbl]

    ax.axvline(0, color="#888888", linewidth=1, linestyle="--")
    ax.set_yticks([]); ax.set_xlabel(xl); ax.set_title(title)
    ax.legend(loc="lower center", bbox_to_anchor=(0.5, -0.35), ncol=len(scale), fontsize=8)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{abs(v):.0f}%"))
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)


def chart_scorecard(df, q, title, out, opts):
    stat = opts.get("stat", "count")
    ncols = opts.get("columns", min(3, len(q)))
    nrows = -(-len(q) // ncols)  # ceiling division
    col = _color(opts)
    text_col = _label_color(col)

    fig, axes = plt.subplots(nrows, ncols, figsize=_fs(opts, (ncols * 2.8, nrows * 2.0)))
    axes = np.array(axes).flatten()

    for i, col_name in enumerate(q):
        ax = axes[i]
        s = pd.to_numeric(df[col_name], errors="coerce")
        if stat == "mean" and s.notna().any():
            value = s.mean()
            fmt = f"{value:,.1f}"
        elif stat == "sum" and s.notna().any():
            value = s.sum()
            fmt = f"{value:,.0f}"
        else:  # count (non-null)
            value = df[col_name].notna().sum()
            fmt = f"{int(value):,}"

        ax.set_facecolor(col)
        ax.set_xticks([]); ax.set_yticks([])
        for spine in ax.spines.values(): spine.set_visible(False)
        ax.text(0.5, 0.62, fmt, transform=ax.transAxes, ha="center", va="center",
                fontsize=22, fontweight="bold", color=text_col)
        ax.text(0.5, 0.25, col_name, transform=ax.transAxes, ha="center", va="center",
                fontsize=9, color=text_col, alpha=0.85, wrap=True)

    # hide unused axes
    for j in range(len(q), len(axes)):
        axes[j].set_visible(False)

    fig.suptitle(title, fontsize=12, fontweight="bold", y=1.02)
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)


def chart_pyramid(df, q, title, out, opts):
    if len(q) < 2: raise ValueError("pyramid needs 2 questions: [age_group, gender]")
    age_col, gender_col = q[0], q[1]
    uniq = df[gender_col].dropna().unique()
    male_val = opts.get("male_value", uniq[0] if len(uniq) >= 1 else "Male")
    female_val = opts.get("female_value", uniq[1] if len(uniq) >= 2 else "Female")
    xl, yl = _labels(opts, "Count", age_col)

    age_order = sorted(df[age_col].dropna().unique(), key=lambda x: str(x))
    male = df[df[gender_col] == male_val][age_col].value_counts().reindex(age_order, fill_value=0)
    female = df[df[gender_col] == female_val][age_col].value_counts().reindex(age_order, fill_value=0)

    fig, ax = plt.subplots(figsize=_fs(opts, (8, max(4, len(age_order) * 0.45))))
    ax.barh(age_order, -male.values, color=PALETTE[1], alpha=0.85, label=male_val)
    ax.barh(age_order, female.values, color=PALETTE[5], alpha=0.85, label=female_val)
    ax.axvline(0, color="#888888", linewidth=1)
    max_val = max(male.max(), female.max()) if len(male) and len(female) else 1
    ax.set_xlim(-max_val * 1.2, max_val * 1.2)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{abs(int(v))}"))
    ax.set_xlabel(xl); ax.set_ylabel(yl); ax.set_title(title)
    ax.legend(loc="lower center", bbox_to_anchor=(0.5, -0.12), ncol=2, fontsize=9)
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)


def chart_dot_map(df, q, title, out, opts):
    if len(q) < 2: raise ValueError("dot_map needs 2 questions: [latitude, longitude]")
    lat_col, lon_col = q[0], q[1]
    color_by = opts.get("color_by")
    dot_size = opts.get("size", 20)
    use_basemap = opts.get("basemap", False)

    tmp = df[[lat_col, lon_col]].copy()
    if color_by and color_by in df.columns:
        tmp[color_by] = df[color_by]
    tmp[lat_col] = pd.to_numeric(tmp[lat_col], errors="coerce")
    tmp[lon_col] = pd.to_numeric(tmp[lon_col], errors="coerce")
    tmp = tmp.dropna(subset=[lat_col, lon_col])
    if tmp.empty: raise ValueError("dot_map: no valid GPS coordinates found")

    fig, ax = plt.subplots(figsize=_fs(opts, (8, 7)))

    if use_basemap:
        try:
            import contextily as ctx
            import pyproj
            # reproject to Web Mercator for contextily
            transformer = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
            xs, ys = transformer.transform(tmp[lon_col].values, tmp[lat_col].values)
            if color_by and color_by in tmp.columns:
                cats = tmp[color_by].astype(str)
                unique_cats = cats.unique()
                for i, cat in enumerate(unique_cats):
                    mask = cats == cat
                    ax.scatter(xs[mask], ys[mask], s=dot_size, color=PALETTE[i % len(PALETTE)],
                               alpha=0.75, edgecolors="white", linewidth=0.4, label=cat, zorder=3)
                ax.legend(title=color_by, bbox_to_anchor=(1.01, 1), loc="upper left", fontsize=8)
            else:
                ax.scatter(xs, ys, s=dot_size, color=_color(opts), alpha=0.75,
                           edgecolors="white", linewidth=0.4, zorder=3)
            ctx.add_basemap(ax, crs="EPSG:3857", source=ctx.providers.OpenStreetMap.Mapnik, zoom="auto")
            ax.set_axis_off()
        except ImportError:
            log.warning("dot_map: contextily or pyproj not installed — falling back to plain map")
            use_basemap = False

    if not use_basemap:
        if color_by and color_by in tmp.columns:
            cats = tmp[color_by].astype(str)
            for i, cat in enumerate(cats.unique()):
                mask = cats == cat
                ax.scatter(tmp[lon_col][mask], tmp[lat_col][mask], s=dot_size,
                           color=PALETTE[i % len(PALETTE)], alpha=0.75,
                           edgecolors="white", linewidth=0.4, label=cat)
            ax.legend(title=color_by, bbox_to_anchor=(1.01, 1), loc="upper left", fontsize=8)
        else:
            ax.scatter(tmp[lon_col], tmp[lat_col], s=dot_size, color=_color(opts),
                       alpha=0.75, edgecolors="white", linewidth=0.4)
        xl, yl = _labels(opts, "Longitude", "Latitude")
        ax.set_xlabel(xl); ax.set_ylabel(yl)
        ax.set_facecolor("#F0F4F8")

    ax.set_title(f"{title}  (n={len(tmp)})")
    plt.tight_layout(); fig.savefig(out, dpi=150, bbox_inches="tight"); plt.close(fig)


CHART_DISPATCH = {
    "bar": chart_bar, "horizontal_bar": chart_horizontal_bar, "stacked_bar": chart_stacked_bar,
    "pie": chart_pie, "donut": chart_donut, "line": chart_line, "area": chart_area,
    "histogram": chart_histogram, "scatter": chart_scatter, "box_plot": chart_box_plot,
    "heatmap": chart_heatmap, "treemap": chart_treemap, "waterfall": chart_waterfall,
    "funnel": chart_funnel, "table": chart_table,
    "grouped_bar": chart_grouped_bar, "bullet_chart": chart_bullet_chart,
    "likert": chart_likert, "scorecard": chart_scorecard, "pyramid": chart_pyramid,
    "dot_map": chart_dot_map,
}
