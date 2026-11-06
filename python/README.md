# craggy-charts (Python)

Tile charts for Jupyter, Streamlit and static HTML. Every value is drawn as a field of rounded tiles that
spring into place when the data changes. The charts are rendered by the
[craggy-charts](../js) JavaScript package; this package passes your data and options across.

```bash
pip install craggy-charts
```

## Jupyter

```python
import craggy_charts as cc

cc.chart(df, type="line", x="date")                  # pandas or polars DataFrame
cc.chart(df, type="bar", x="month", stack=True, format="currency")
cc.chart(sales, type="donut", title="Channels")      # list of dicts, dict of columns, Series, numpy array
```

The chart is a widget (anywidget), so it works in JupyterLab, Notebook, VS Code and Colab.

* `chart.update(type="area")` animates to the new options.
* `chart.push({"t": now, "v": 3.2})` streams rows into a live chart (`window=60` keeps the last 60).
* `chart.on("click", fn)` receives `click`, `select`, `zoom` and `legend` events from the browser.

A DataFrame's columns become the chart's columns. A meaningful index (named, or a `DatetimeIndex`)
becomes the first column, so time series plot against their dates without `reset_index()`.

## Options

Options are the same flat object as the JavaScript API; see [docs/options.md](../docs/options.md).
Unknown names raise a `TypeError` with a suggestion. Python spellings work where the JS name is not an
identifier: `from_=` for `from`, and `x_axis=` / `y_axis=` for `xAxis` / `yAxis`.

## Static HTML

```python
cc.chart(df, type="area").save("report.html")     # one file, no network needed to view it
html = cc.to_html(chart, full_html=False)           # a fragment to embed in another page
more = cc.to_html(other, full_html=False, include_js=False)  # later fragments on the same page
```

## Streamlit

```python
from craggy_charts.streamlit import st_chart

st_chart(cc.chart(df, type="bar", x="month"), height=320)
```

## Development

```bash
node build.mjs        # rebuild craggy_charts/static/ from ../js (needs npm install in js/)
uv run pytest
```

Package builds generate the browser assets when they are absent. From a clean checkout,
install Node.js and run `npm ci` in `js/` before running `uv build` in `python/`.
The source distribution includes the generated assets, so building a wheel from it does
not require Node.js.

MIT licence.
