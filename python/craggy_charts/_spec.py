"""Options and data → the JSON spec the JS renderer takes.

The spec is the same flat object as the JS API. Python spellings are accepted for keys that are not
valid or idiomatic identifiers (``from_`` → ``from``, ``x_axis`` → ``xAxis``), and dataframes, series,
numpy arrays and dates are converted to plain JSON values.
"""

from __future__ import annotations

import datetime as _dt
import decimal
import difflib
import math
from collections.abc import Mapping
from typing import Any

from ._generated import CHART_TYPES, OPTION_KEYS


def _camel(key: str) -> str:
    key = key.rstrip("_")  # from_ → from
    head, *rest = key.split("_")
    return head + "".join(w[:1].upper() + w[1:] for w in rest)


def _suggest(word: str, choices: list[str]) -> str:
    near = difflib.get_close_matches(word, choices, n=1)
    return f' (did you mean "{near[0]}"?)' if near else ""


def option_key(key: str) -> str:
    """The JS option name for a Python keyword argument; raises on unknown options."""
    name = _camel(key)
    if name not in OPTION_KEYS:
        raise TypeError(f'craggy-charts: unknown option "{key}"{_suggest(name, OPTION_KEYS)}')
    return name


def check_type(kind: Any) -> str:
    if kind not in CHART_TYPES:
        raise ValueError(f'craggy-charts: unknown chart type "{kind}"{_suggest(str(kind), CHART_TYPES)}')
    return kind


def plain(value: Any) -> Any:
    """Any value → JSON-safe Python (dates as ISO strings, NaN / NaT as None, numpy as builtins)."""
    if value is None or isinstance(value, (bool, str, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, decimal.Decimal):
        return plain(float(value))
    if isinstance(value, _dt.date):  # datetime too; pandas NaT subclasses datetime
        return None if _is_missing(value) else value.isoformat()
    if callable(value):
        raise TypeError("craggy-charts: functions cannot be sent to the browser; pass column names instead")
    if _is_frame_like(value) or _is_numpy(value):
        return plain(to_data(value))
    if isinstance(value, Mapping):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset, range)):
        return [plain(v) for v in value]
    # numpy / pandas scalars (np.float64, pd.Timestamp, pd.NaT, ...)
    if _module(value) in ("numpy", "pandas"):
        if _is_missing(value):
            return None
        if hasattr(value, "isoformat"):
            return value.isoformat()
        if hasattr(value, "item"):
            return plain(value.item())
    raise TypeError(f"craggy-charts: cannot serialise {type(value).__name__} values")


def _module(value: Any) -> str:
    return type(value).__module__.split(".")[0]


def _is_numpy(value: Any) -> bool:
    return _module(value) == "numpy" and type(value).__name__ == "ndarray"


def _is_frame_like(value: Any) -> bool:
    return _module(value) in ("pandas", "polars") and hasattr(value, "columns") or _is_series(value)


def _is_series(value: Any) -> bool:
    return _module(value) in ("pandas", "polars") and type(value).__name__ == "Series"


def _is_missing(value: Any) -> bool:
    try:
        return bool(value != value)  # NaN and NaT are not equal to themselves
    except (TypeError, ValueError):
        return False


def to_data(data: Any) -> Any:
    """Accepted data shapes → rows, numbers or columns (the three shapes the JS API takes).

    * pandas / polars DataFrame → columns ``{name: [...]}``. A pandas index that carries meaning (named,
      or not a plain 0..n-1 range, e.g. a DatetimeIndex) becomes the first column.
    * pandas / polars Series → numbers, or ``{index, name}`` columns when the pandas index carries meaning.
    * numpy 1-d array → numbers.
    * dict of sequences → columns; list of dicts / numbers → as is.
    """
    if data is None:
        return []
    mod = _module(data)
    if mod == "pandas" and hasattr(data, "columns"):
        frame = data.reset_index() if _meaningful_index(data) else data
        return {str(c): [plain(v) for v in frame[c].tolist()] for c in frame.columns}
    if mod == "pandas" and _is_series(data):
        name = str(data.name) if data.name is not None else "value"
        if _meaningful_index(data):
            idx = data.index.name or "index"
            return {str(idx): [plain(v) for v in data.index.tolist()], name: [plain(v) for v in data.tolist()]}
        return [plain(v) for v in data.tolist()]
    if mod == "polars" and hasattr(data, "columns"):
        return {str(c): [plain(v) for v in data[c].to_list()] for c in data.columns}
    if mod == "polars" and _is_series(data):
        return [plain(v) for v in data.to_list()]
    if _is_numpy(data):
        if data.ndim != 1:
            raise ValueError("craggy-charts: numpy data must be 1-d; use a DataFrame or dict of columns for more")
        return [plain(v) for v in data.tolist()]
    if isinstance(data, Mapping):
        return {str(k): plain(to_data(v) if _is_numpy(v) or _is_series(v) else v) for k, v in data.items()}
    if isinstance(data, (list, tuple)):
        return [plain(r) for r in data]
    raise TypeError(f"craggy-charts: unsupported data type {type(data).__name__}")


def _meaningful_index(obj: Any) -> bool:
    idx = obj.index
    if idx.name is not None or getattr(idx, "nlevels", 1) > 1:
        return True
    if type(idx).__name__ != "RangeIndex":
        return True
    return not (idx.start == 0 and idx.step == 1)


def spec(type: str, data: Any = None, **options: Any) -> dict[str, Any]:
    """The JS options object for a chart: validated keys, JSON-safe values."""
    out: dict[str, Any] = {"type": check_type(type)}
    if data is not None:
        out["data"] = to_data(data)
    for key, value in options.items():
        name = option_key(key)
        if name == "type":
            out["type"] = check_type(value)
        elif name == "data":
            out["data"] = to_data(value)
        else:
            out[name] = plain(value)
    return out


def rows(items: tuple[Any, ...]) -> list[Any]:
    """push(*rows) arguments → a flat list of JSON-safe rows (a DataFrame counts as many rows)."""
    flat: list[Any] = []
    for item in items:
        if _is_frame_like(item):
            converted = to_data(item)
            if isinstance(converted, dict):
                keys = list(converted)
                n = len(converted[keys[0]]) if keys else 0
                flat.extend({k: converted[k][i] for k in keys} for i in range(n))
            else:
                flat.extend(converted)
        elif isinstance(item, (list, tuple)):
            flat.extend(plain(r) for r in item)
        else:
            flat.append(plain(item))
    return flat
