"""A static HTML report from pandas: three charts in one self-contained file that opens with no network.

    pip install craggy-charts pandas
    python report.py            # writes report.html next to this script
"""

from __future__ import annotations

import math
import pathlib

import pandas as pd

import craggy_charts as cc

# A DatetimeIndex becomes the x column, so there is no need for reset_index().
days = pd.date_range("2026-01-01", periods=120, freq="D", name="date")
visits = pd.DataFrame(
    {
        "web": [round(1200 + 400 * math.sin(i / 14) + 6 * i) for i in range(len(days))],
        "app": [round(700 + 250 * math.sin(i / 9 + 1) + 4 * i) for i in range(len(days))],
    },
    index=days,
)

sales = pd.DataFrame(
    {
        "month": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
        "north": [42, 47, 51, 58, 63, 71],
        "south": [31, 35, 33, 41, 44, 49],
        "west": [18, 22, 29, 34, 39, 45],
    }
)

channels = {"name": ["Search", "Direct", "Social", "Email"], "value": [42, 26, 18, 9]}  # a dict of columns

charts = [
    cc.chart(visits, type="area", stack=True, title="Daily visits", format="number"),
    cc.chart(sales, type="bar", x="month", stack=True, format="currency", title="Sales by region"),
    cc.chart(channels, type="donut", title="Channels", height=280),
]

# One fragment per chart. Only the first carries the renderer, so the file holds a single copy of it.
body = "\n".join(cc.to_html(c, full_html=False, include_js=i == 0) for i, c in enumerate(charts))
page = f"""<!doctype html>
<meta charset="utf-8">
<title>Report</title>
<style>body {{ margin: 0; padding: 32px; background: #111a20; display: grid; gap: 24px; max-width: 960px }}</style>
{body}
"""

out = pathlib.Path(__file__).with_name("report.html")
out.write_text(page, encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size // 1024} KB)")
