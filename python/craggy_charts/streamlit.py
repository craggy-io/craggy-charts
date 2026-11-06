"""Streamlit: ``from craggy_charts.streamlit import st_chart; st_chart(cc.chart(df, type="area"))``."""

from __future__ import annotations

from typing import Any

from .html import to_html


def st_chart(chart: Any, height: int | None = None) -> None:
    """Render a chart (or a raw options dict) in a Streamlit app."""
    import streamlit.components.v1 as components

    h = int(height or getattr(chart, "height", None) or 320)
    components.html(to_html(chart, height=h, full_html=True), height=h + 32)  # + the page's 16px padding
