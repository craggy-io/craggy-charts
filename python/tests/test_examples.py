"""Every Python example in ../examples/python runs."""

from __future__ import annotations

import json
import pathlib
import runpy
import time

import pytest

EXAMPLES = pathlib.Path(__file__).resolve().parents[2] / "examples" / "python"


def test_report_writes_one_self_contained_page(tmp_path, monkeypatch):
    script = tmp_path / "report.py"
    script.write_text((EXAMPLES / "report.py").read_text(encoding="utf-8"), encoding="utf-8")
    runpy.run_path(str(script), run_name="__main__")
    page = (tmp_path / "report.html").read_text(encoding="utf-8")
    assert page.count("window.CraggyCharts=CraggyCharts") == 1  # the renderer is embedded once
    assert page.count("CraggyCharts.chart(") == 3
    for title in ("Daily visits", "Sales by region", "Channels"):
        assert title in page


def test_notebook_cells_run(tmp_path, monkeypatch):
    nb = json.loads((EXAMPLES / "notebook.ipynb").read_text(encoding="utf-8"))
    cells = ["".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code"]
    shown: list[object] = []
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(time, "sleep", lambda _s: None)
    ns: dict[str, object] = {"display": shown.append}
    for src in cells:
        exec(compile(src, "notebook", "exec"), ns)  # noqa: S102 - our own example
    visits, cpu = ns["visits"], ns["cpu"]
    assert visits.options["type"] == "area" and visits.options["stack"] is True  # the morph cell ran
    assert len(cpu.data) == 60  # 120 pushes, trimmed to the window
    assert shown == [cpu]
    visits._on_front_end(None, {"event": "click", "payload": {"title": "2026-01-05"}}, None)
    assert "click 2026-01-05" in "".join(o["text"] for o in ns["log"].outputs)
    assert (tmp_path / "visits.html").read_text(encoding="utf-8").startswith("<!doctype html>")


def test_streamlit_app_runs():
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest

    app = AppTest.from_file(str(EXAMPLES / "streamlit_app.py"), default_timeout=30).run()
    assert not app.exception
    assert app.title[0].value == "craggy-charts in Streamlit"
    app.sidebar.selectbox[0].set_value("bar").run()
    assert not app.exception
