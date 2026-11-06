"""craggy-charts: tile charts for Jupyter, Streamlit and static HTML.

>>> import craggy_charts as cc
>>> cc.chart(df, type="line", x="date")            # a Jupyter widget
>>> cc.chart(df, type="bar", stack=True).save("sales.html")

Options are the same flat object as the JavaScript API (see docs/options.md). Python spellings work for
keys that are not identifiers: ``from_=`` for ``from``, ``x_axis=`` for ``xAxis``.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from typing import Any

from ._generated import CHART_TYPES, OPTION_KEYS
from ._spec import spec
from .html import to_html
from .widget import Chart

try:
    __version__ = version("craggy-charts")
except PackageNotFoundError:  # running from a source checkout
    __version__ = "0+local"

__all__ = ["CHART_TYPES", "OPTION_KEYS", "Chart", "chart", "spec", "to_html", "__version__"]


def chart(data: Any = None, type: str = "line", *, height: int = 320, **options: Any) -> Chart:
    """A chart widget. ``data`` is a DataFrame (pandas or polars), Series, numpy array, dict of columns,
    or a list of rows / numbers. Every other keyword is a chart option."""
    return Chart(spec(type, data, **options), height=height)
