import datetime as dt
import json
import math

import numpy as np
import pandas as pd
import polars as pl
import pytest

import craggy_charts as cc
from craggy_charts._spec import plain, rows, to_data


# ── Data conversion ───────────────────────────────────────────────────────────────────────


def test_rows_and_numbers_pass_through():
    assert to_data([{"m": "Jan", "v": 1}]) == [{"m": "Jan", "v": 1}]
    assert to_data([1, 2.5, None]) == [1, 2.5, None]


def test_pandas_frame_becomes_columns():
    df = pd.DataFrame({"month": ["Jan", "Feb"], "sales": [10, 12.5]})
    assert to_data(df) == {"month": ["Jan", "Feb"], "sales": [10, 12.5]}


def test_pandas_datetime_index_becomes_first_column():
    df = pd.DataFrame({"v": [1.0, float("nan")]}, index=pd.to_datetime(["2024-01-01", "2024-01-02"]))
    df.index.name = "date"
    out = to_data(df)
    assert list(out) == ["date", "v"]
    assert out["date"] == ["2024-01-01T00:00:00", "2024-01-02T00:00:00"]
    assert out["v"] == [1.0, None]  # NaN → null


def test_pandas_series_and_nat():
    assert to_data(pd.Series([3, 4])) == [3, 4]
    s = pd.Series([1, 2], index=pd.Index(["a", "b"], name="k"), name="n")
    assert to_data(s) == {"k": ["a", "b"], "n": [1, 2]}
    assert plain(pd.NaT) is None


def test_polars_and_numpy():
    assert to_data(pl.DataFrame({"x": [1, 2], "y": ["a", "b"]})) == {"x": [1, 2], "y": ["a", "b"]}
    assert to_data(pl.Series("v", [1.5, None])) == [1.5, None]
    assert to_data(np.array([1, 2, 3])) == [1, 2, 3]
    assert to_data({"v": np.array([1.0, np.nan])}) == {"v": [1.0, None]}
    with pytest.raises(ValueError, match="1-d"):
        to_data(np.zeros((2, 2)))


def test_plain_values():
    assert plain(dt.date(2024, 3, 1)) == "2024-03-01"
    assert plain(dt.datetime(2024, 3, 1, 12, tzinfo=dt.timezone.utc)) == "2024-03-01T12:00:00+00:00"
    assert plain(np.float32(1.5)) == 1.5 and isinstance(plain(np.int64(2)), int)
    assert plain(math.inf) is None
    with pytest.raises(TypeError, match="functions"):
        plain(lambda r: r)


def test_push_rows_flatten_frames():
    df = pd.DataFrame({"v": [1, 2]})
    assert rows(({"v": 0}, [3, 4], df)) == [{"v": 0}, 3, 4, {"v": 1}, {"v": 2}]


# ── Options ───────────────────────────────────────────────────────────────────────────────


def test_spec_uses_js_names():
    s = cc.spec("bar", [1, 2], stack=True, x_axis={"label": "Month"}, from_="from", to="to")
    assert s == {"type": "bar", "data": [1, 2], "stack": True, "xAxis": {"label": "Month"}, "from": "from", "to": "to"}
    json.dumps(s)  # always serialisable


def test_unknown_option_and_type_suggest_a_fix():
    with pytest.raises(TypeError, match='did you mean "stack"'):
        cc.spec("bar", stak=True)
    with pytest.raises(ValueError, match='did you mean "donut"'):
        cc.spec("donutt")


def test_generated_lists_match_the_schema():
    schema = json.load(open(__file__.rsplit("python", 1)[0] + "spec/options.schema.json", encoding="utf-8"))
    assert set(cc.OPTION_KEYS) == set(schema["properties"])
    assert len(cc.CHART_TYPES) == 24


# ── Widget ────────────────────────────────────────────────────────────────────────────────


class Sent(list):
    def __call__(self, content, buffers=None):
        self.append(content)


def widget(**kw):
    c = cc.chart([{"t": 1, "v": 2}], type="line", **kw)
    c.send = Sent()
    return c


def test_chart_widget_state():
    c = cc.chart(pd.DataFrame({"m": ["a"], "v": [1]}), type="bar", height=200, title="T")
    assert c.options == {"type": "bar", "data": {"m": ["a"], "v": [1]}, "title": "T"}
    assert c.height == 200
    esm = c._esm.read_text(encoding="utf-8") if hasattr(c._esm, "read_text") else str(c._esm)
    assert "export" in esm and "render" in esm  # the bundled front end, not a placeholder


def test_update_merges_and_keeps_data():
    c = widget()
    c.update(type="area", stack=True)
    assert c.options["type"] == "area" and c.options["stack"] is True and c.options["data"] == [{"t": 1, "v": 2}]
    with pytest.raises(TypeError):
        c.update(nope=1)


def test_push_patch_stream_and_trim_to_window():
    c = widget(window=3)
    c.push({"t": 2, "v": 3}, [{"t": 3, "v": 4}, {"t": 4, "v": 5}])
    assert c.send[-1] == {"kind": "push", "rows": [{"t": 2, "v": 3}, {"t": 3, "v": 4}, {"t": 4, "v": 5}]}
    assert [r["t"] for r in c.data] == [2, 3, 4]  # oldest dropped, like the browser
    c.patch({"v": 9})
    assert c.send[-1] == {"kind": "patch", "row": {"v": 9}} and c.data[-1] == {"t": 4, "v": 9}
    c.highlight("v").toggle("v")
    assert c.send[-2:] == [{"kind": "highlight", "target": "v"}, {"kind": "toggle", "name": "v"}]


def test_push_into_a_chart_started_empty():
    c = cc.chart(type="line", window=2)
    c.send = Sent()
    c.push({"v": 1}, {"v": 2}, {"v": 3})
    assert c.data == [{"v": 2}, {"v": 3}]


def test_events_reach_python_handlers():
    c = widget()
    got = []
    c.on("click", got.append)
    c._on_front_end(c, {"event": "click", "payload": {"index": 0}}, [])
    c._on_front_end(c, {"event": "select", "payload": {}}, [])
    assert got == [{"index": 0}]
    c.off("click")
    c._on_front_end(c, {"event": "click", "payload": 1}, [])
    assert got == [{"index": 0}]
    with pytest.raises(ValueError, match="unknown event"):
        c.on("hovr", print)


# ── HTML export ───────────────────────────────────────────────────────────────────────────


def test_to_html_is_standalone_and_script_safe(tmp_path):
    c = cc.chart([{"m": "</script><b>", "v": 1}], type="bar", title="Sales & more")
    page = c.to_html()
    assert page.startswith("<!doctype html>") and "<title>Sales &amp; more</title>" in page
    assert "CraggyCharts" in page and "</script><b>" not in page  # data cannot close the script element
    assert page.count("<script>") == 2
    frag = cc.to_html({"type": "pie", "data": [1, 2]}, height=150, full_html=False)
    assert frag.startswith('<div id="cc-') and "height:150px" in frag
    bare = cc.to_html({"type": "pie", "data": [1, 2]}, full_html=False, include_js=False)
    assert "window.CraggyCharts" not in bare and bare.count("<script>") == 1
    assert "window.CraggyCharts" not in c.to_html(full_html=False, include_js=False)
    out = tmp_path / "c.html"
    c.save(out)
    assert out.read_text(encoding="utf-8").startswith("<!doctype html>")


def test_streamlit_helper(monkeypatch):
    import sys
    import types

    calls = []
    components = types.ModuleType("streamlit.components.v1")
    components.html = lambda html, height: calls.append((html, height))
    monkeypatch.setitem(sys.modules, "streamlit", types.ModuleType("streamlit"))
    monkeypatch.setitem(sys.modules, "streamlit.components", types.ModuleType("streamlit.components"))
    monkeypatch.setitem(sys.modules, "streamlit.components.v1", components)
    from craggy_charts.streamlit import st_chart

    st_chart(cc.chart([1, 2], type="line", height=240))
    assert calls and calls[0][1] == 272 and "height:240px" in calls[0][0]
