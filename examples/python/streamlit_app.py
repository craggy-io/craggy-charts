"""A Streamlit app: pick a chart type and a tile size, and the chart redraws.

    pip install "craggy-charts[streamlit]" pandas
    streamlit run streamlit_app.py
"""

from __future__ import annotations

import math

import pandas as pd
import streamlit as st

import craggy_charts as cc
from craggy_charts.streamlit import st_chart

st.set_page_config(page_title="craggy-charts", layout="wide")
st.title("craggy-charts in Streamlit")

kind = st.sidebar.selectbox("Type", ["line", "area", "bar", "scatter"], index=1)
cell = st.sidebar.radio("Tiles", ["fine", "normal", "chunky"], index=1)
stack = st.sidebar.checkbox("Stack", value=kind in ("area", "bar"))

days = pd.date_range("2026-01-01", periods=60, freq="D", name="date")
df = pd.DataFrame(
    {
        "web": [round(120 + 40 * math.sin(i / 6) + i) for i in range(len(days))],
        "app": [round(80 + 30 * math.sin(i / 4 + 1) + i) for i in range(len(days))],
    },
    index=days,
)

left, right = st.columns([3, 1])
with left:
    st_chart(cc.chart(df, type=kind, cell=cell, stack=stack, title="Visits"), height=360)
with right:
    st_chart(cc.chart(type="stat", value=int(df["web"].iloc[-1]), label="web today", cell=cell), height=160)
    st_chart(cc.chart(type="gauge", value=72, label="goal", format="percent", cell=cell), height=180)
