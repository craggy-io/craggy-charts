"""The Jupyter widget: an anywidget whose ``options`` trait is the JS options object."""

from __future__ import annotations

import pathlib
from collections.abc import Callable
from typing import Any

import anywidget
import traitlets

from ._spec import rows, spec

_STATIC = pathlib.Path(__file__).parent / "static"
EVENTS = ("click", "select", "zoom", "legend")


class Chart(anywidget.AnyWidget):
    """A craggy chart. Build one with :func:`craggy_charts.chart`.

    ``options`` holds the same flat object the JS API takes; assigning to it (or calling :meth:`update`)
    animates the chart to the new state. :meth:`push` streams rows into live views.
    """

    _esm = _STATIC / "widget.js"
    options = traitlets.Dict().tag(sync=True)
    height = traitlets.Int(320).tag(sync=True)

    def __init__(self, options: dict[str, Any], height: int = 320, **kwargs: Any) -> None:
        super().__init__(options=options, height=height, **kwargs)
        self._handlers: dict[str, list[Callable[[Any], None]]] = {e: [] for e in EVENTS}
        self.on_msg(self._on_front_end)

    # ── Changes ────────────────────────────────────────────────────────────────────────

    def update(self, **options: Any) -> Chart:
        """Change any option; the chart animates to the new state."""
        self.options = {**self.options, **spec(options.pop("type", self.options["type"]), **options)}
        return self

    def push(self, *items: Any) -> Chart:
        """Append rows (dicts, numbers, or a DataFrame) to every live view. With ``window``, the oldest
        rows scroll off. The rows are also kept here, so ``chart.data`` stays current."""
        new = rows(items)
        data = self.options.get("data")
        if data is None:  # a live chart started empty
            data = self.options["data"] = []
        if isinstance(data, list):
            data.extend(new)
            window = self.options.get("window")
            if window:
                del data[: max(0, len(data) - int(window))]
        self.send({"kind": "push", "rows": new})
        return self

    def patch(self, row: dict[str, Any]) -> Chart:
        """Merge into the newest row (a live tick inside the current candle)."""
        new = rows((row,))[0]
        data = self.options.get("data")
        if isinstance(data, list) and data and isinstance(data[-1], dict):
            data[-1] = {**data[-1], **new}
        self.send({"kind": "patch", "row": new})
        return self

    def highlight(self, target: str | int | None) -> Chart:
        """Highlight a series or category by name, a row by index, or clear with None."""
        self.send({"kind": "highlight", "target": target})
        return self

    def toggle(self, name: str) -> Chart:
        """Show or hide a series, like clicking its legend entry."""
        self.send({"kind": "toggle", "name": name})
        return self

    @property
    def data(self) -> Any:
        return self.options.get("data")

    # ── Events ─────────────────────────────────────────────────────────────────────────

    def on(self, event: str, fn: Callable[[Any], None]) -> Chart:
        """Call ``fn(payload)`` on ``click``, ``select``, ``zoom`` or ``legend`` in the browser."""
        if event not in self._handlers:
            raise ValueError(f'craggy-charts: unknown event "{event}"; use one of {", ".join(EVENTS)}')
        self._handlers[event].append(fn)
        return self

    def off(self, event: str, fn: Callable[[Any], None] | None = None) -> Chart:
        handlers = self._handlers.get(event, [])
        handlers[:] = [] if fn is None else [h for h in handlers if h is not fn]
        return self

    def _on_front_end(self, _widget: Any, content: Any, _buffers: Any) -> None:
        if isinstance(content, dict) and content.get("event") in self._handlers:
            for fn in list(self._handlers[content["event"]]):
                fn(content.get("payload"))

    # ── Export ─────────────────────────────────────────────────────────────────────────

    def to_html(self, full_html: bool = True, include_js: bool = True) -> str:
        from .html import to_html

        return to_html(self, full_html=full_html, include_js=include_js)

    def save(self, path: str | pathlib.Path) -> None:
        """Write a standalone HTML file (no network needed to view it)."""
        pathlib.Path(path).write_text(self.to_html(), encoding="utf-8")
