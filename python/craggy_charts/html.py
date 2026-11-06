"""Standalone HTML export: the chart and the renderer in one file, no network needed."""

from __future__ import annotations

import functools
import html as _html
import json
import pathlib
import uuid
from typing import Any

_STATIC = pathlib.Path(__file__).parent / "static"


@functools.lru_cache(maxsize=1)
def _bundle() -> str:
    return (_STATIC / "craggy-charts.global.js").read_text(encoding="utf-8")


def _script_json(value: Any) -> str:
    """JSON that is safe inside a <script> element."""
    return json.dumps(value, separators=(",", ":")).replace("</", "<\\/").replace("<!--", "<\\!--")


def to_html(
    chart: Any,
    height: int | None = None,
    full_html: bool = True,
    title: str | None = None,
    include_js: bool = True,
) -> str:
    """HTML for a :class:`~craggy_charts.Chart` or a raw options dict.

    ``full_html=False`` returns a fragment (a ``<div>`` and scripts) for embedding in another page.
    Each fragment carries the renderer unless ``include_js=False``; with several charts on one page,
    pass ``include_js=False`` to all but the first so the file holds a single copy.
    """
    options = chart.options if hasattr(chart, "options") else dict(chart)
    h = height or getattr(chart, "height", None) or 320
    el = "cc-" + uuid.uuid4().hex[:12]
    renderer = f"<script>if(!window.CraggyCharts){{{_bundle()}\nwindow.CraggyCharts=CraggyCharts}}</script>\n"
    body = (
        f'<div id="{el}" style="height:{int(h)}px"></div>\n'
        + (renderer if include_js else "")
        + f'<script>CraggyCharts.chart(document.getElementById("{el}"),{_script_json(options)})</script>'
    )
    if not full_html:
        return body
    name = _html.escape(title or options.get("title") or "Chart")
    return (
        '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{name}</title></head>\n"
        '<body style="margin:0;padding:16px">\n'
        f"{body}\n</body>\n</html>\n"
    )
