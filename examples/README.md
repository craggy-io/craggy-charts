# Examples

Small, runnable examples, each showing one way to use craggy-charts. The full gallery of every chart type is
[`docs/index.html`](../docs/index.html).

The examples load the packages from this repository, so build the JS package first:

```bash
cd js && npm install && npm run build && npm run build:python
```

In your own project, use the published packages instead. The comment above each import shows the npm form.

## JavaScript

Open a page straight from disk: double-click it, or drag it into a browser. They use the script-tag build,
so no server is needed.

| Example | Shows |
|---|---|
| [`js/quickstart.html`](js/quickstart.html) | One `<script>` tag and one stacked bar chart. No build step. |
| [`js/live-dashboard.html`](js/live-dashboard.html) | A full-window dashboard: stat tiles, a gauge, a live window fed by `push()`, morphing with `update()`, and `click` / `select` / `legend` events. |
| [`js/web-component.html`](js/web-component.html) | `<craggy-chart>` with options as HTML attributes (on a server, `src` loads data from a URL). |
| [`js/terminal.mjs`](js/terminal.mjs) | The headless core in Node: a settled tile field printed to the terminal in 24-bit colour. `node examples/js/terminal.mjs donut` |

## Python

```bash
cd python && uv sync                # or: pip install craggy-charts pandas
```

| Example | Shows |
|---|---|
| [`python/notebook.ipynb`](python/notebook.ipynb) | Jupyter widgets: a pandas time series, morphing, events back into Python, a live `push()` loop and `save()`. |
| [`python/report.py`](python/report.py) | A static HTML report with three charts in one self-contained file. `uv run python ../examples/python/report.py` |
| [`python/streamlit_app.py`](python/streamlit_app.py) | A Streamlit app with controls for type, tile size and stacking. `uv run streamlit run ../examples/python/streamlit_app.py` |

## Flutter

The Flutter example stays inside the package, at [`flutter/example`](../flutter/example), where pub.dev expects
it. It has a gallery of every type, a live chart driven by a `CraggyController`, and a light/dark toggle.

```bash
cd flutter/example && flutter run -d chrome
```

## Tests

Every example runs in the test suites. `js/test/browser/examples.spec.ts` loads each page, both served and from
`file://`, and checks that it draws without console errors, and it runs `terminal.mjs` for several types. `python/tests/test_examples.py`
runs the report script, executes the notebook and runs the Streamlit app headless.
