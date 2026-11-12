"""ERCOT load forecasting dashboard.   Run:  streamlit run app/app.py"""
import json
import sys
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.config import MODEL_TABLE, OUT_REPORTS, PEAK_TABLE, ZONES            # noqa: E402
from src.agent import tools as T                                             # noqa: E402

st.set_page_config(page_title="ERCOT Load Forecasting", page_icon="⚡", layout="wide")
ZN = T.ZONE_NAMES
ZONE_LABELS = {v: k for k, v in ZN.items()}


@st.cache_data
def load_table():
    df = pd.read_parquet(MODEL_TABLE)
    return df[~df.DSTFlag] if "DSTFlag" in df else df


@st.cache_data
def leaderboard():
    p = OUT_REPORTS / "leaderboard_ratio.csv"
    return pd.read_csv(p) if p.exists() else None


@st.cache_data
def predictions():
    p = OUT_REPORTS / "test_predictions_ratio.parquet"
    return pd.read_parquet(p) if p.exists() else None


@st.cache_data
def peak_days():
    return pd.read_parquet(PEAK_TABLE) if PEAK_TABLE.exists() else None


df = load_table()
lb = leaderboard()
preds = predictions()
pk = peak_days()
dmin, dmax = df.timestamp.min().date(), df.timestamp.max().date()

st.sidebar.title("⚡ ERCOT Load Forecasting")
page = st.sidebar.radio("Page", ["Overview", "Explore data", "Forecast", "What-if", "Peak days", "Ask the analyst"])
st.sidebar.caption(f"Data: {dmin} to {dmax} · 8 weather zones · hourly")

# ------------------------------------------------------------------ Overview
if page == "Overview":
    st.title("Texas grid demand forecasting")
    sysload = df[df.zone == "northC"].set_index("timestamp")["system_total_mw"]
    peak = sysload.idxmax()
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Hours of data", f"{len(sysload):,}")
    c2.metric("Record system peak", f"{sysload.max():,.0f} MW", help=f"{peak}")
    c3.metric("Avg load 2026 vs 2018", f"{sysload['2026'].mean():,.0f} MW",
              f"{(sysload['2026'].mean() / sysload['2018'].mean() - 1) * 100:+.0f}%")
    if lb is not None:
        best = lb[lb.split == "test"].sort_values("MAPE_pct").iloc[0]
        c4.metric("Best test MAPE (2026)", f"{best.MAPE_pct:.2f}%", help=best.model)

    left, right = st.columns([3, 2])
    with left:
        yearly = sysload.groupby(sysload.index.year).agg(["mean", "max"]).reset_index()
        yearly.columns = ["year", "average", "peak hour"]
        fig = px.bar(yearly.melt("year"), x="year", y="value", color="variable", barmode="group",
                     title="System load by year (MW)", labels={"value": "MW", "variable": ""})
        st.plotly_chart(fig, use_container_width=True)
    with right:
        if lb is not None:
            t = lb[lb.split == "test"].sort_values("MAPE_pct", ascending=False)
            fig = px.bar(t, x="MAPE_pct", y="model", orientation="h", title="Test MAPE by model (2026)",
                         labels={"MAPE_pct": "MAPE (%)", "model": ""}, text="MAPE_pct")
            fig.update_traces(texttemplate="%{text:.2f}%")
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("Run `make train` to see the leaderboard.")

    share = df[df.timestamp.dt.year == 2026].groupby("zone").load_mw.mean()
    share.index = share.index.map(ZN)
    st.plotly_chart(px.pie(values=share.values, names=share.index, title="Share of 2026 load by zone", hole=0.4),
                    use_container_width=True)

# ------------------------------------------------------------------ Explore
elif page == "Explore data":
    st.title("Explore load and weather")
    c1, c2 = st.columns([1, 2])
    zone = c1.selectbox("Zone", list(ZN.values()), index=4)
    rng = c2.slider("Date range", dmin, dmax, (pd.Timestamp("2026-07-13").date(), pd.Timestamp("2026-07-27").date()))
    z = ZONE_LABELS[zone]
    s = df[(df.zone == z) & (df.timestamp.dt.date >= rng[0]) & (df.timestamp.dt.date <= rng[1])]
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=s.timestamp, y=s.load_mw, name="load (MW)"))
    fig.add_trace(go.Scatter(x=s.timestamp, y=s.temp_f, name="temperature (°F)", yaxis="y2", opacity=0.6))
    fig.update_layout(title=f"{zone}: load and temperature", yaxis=dict(title="MW"),
                      yaxis2=dict(title="°F", overlaying="y", side="right"), height=420)
    st.plotly_chart(fig, use_container_width=True)

    c1, c2 = st.columns(2)
    sm = df[(df.zone == z) & df.timestamp.dt.month.isin([6, 7, 8])]; sm = sm.sample(min(20000, len(sm)), random_state=1)
    c1.plotly_chart(px.scatter(sm, x="temp_f", y="load_mw", opacity=0.2, title=f"{zone}: summer load vs temperature",
                               labels={"temp_f": "°F", "load_mw": "MW"}), use_container_width=True)
    prof = df[df.zone == z].groupby([df.timestamp.dt.month.rename("month"), df.timestamp.dt.hour.rename("hour")]).load_mw.mean().unstack()
    c2.plotly_chart(px.imshow(prof, aspect="auto", title=f"{zone}: average load by month and hour",
                              labels=dict(x="hour", y="month", color="MW")), use_container_width=True)

# ------------------------------------------------------------------ Forecast
elif page == "Forecast":
    st.title("Day-ahead forecast vs actual")
    c1, c2 = st.columns(2)
    zone = c1.selectbox("Zone", list(ZN.values()), index=4)
    date = c2.date_input("Date", pd.Timestamp("2026-07-22").date(), min_value=dmin, max_value=dmax)
    try:
        f = T.forecast_load(zone, str(date))
        r = T._day_rows(ZONE_LABELS[zone], str(date))
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=list(range(24)), y=r.load_mw, name="actual", line=dict(width=3)))
        fig.add_trace(go.Scatter(x=list(range(24)), y=f["hourly_mw"], name=f"forecast ({f['model']})"))
        fig.add_trace(go.Scatter(x=list(range(24)), y=r.load_lag_168h, name="naive: last week", line=dict(dash="dot")))
        fig.update_layout(title=f"{zone}, {date}", xaxis_title="hour", yaxis_title="MW", height=420)
        st.plotly_chart(fig, use_container_width=True)
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Forecast peak", f"{f['peak_mw']:,} MW", help=f"hour {f['peak_hour']}")
        c2.metric("Actual peak", f"{f.get('actual_peak_mw', 0):,} MW")
        c3.metric("Day MAPE", f"{f.get('mape_pct', 0):.2f}%")
        w = T.get_weather(zone, str(date))
        c4.metric("Temp high / low", f"{w['temp_high_f']:.0f} / {w['temp_low_f']:.0f} °F")
        with st.expander("What drove this forecast"):
            e = T.explain(zone, str(date))
            st.dataframe(pd.DataFrame(e["top_features"], columns=["feature", "importance"]), hide_index=True)
            st.json(e["inputs"])
    except Exception as ex:
        st.error(str(ex))

    if preds is not None:
        st.subheader("Test-year error by zone and season")
        best = json.loads((OUT_REPORTS / "best_model_ratio.json").read_text())["best_on_validation"]
        p = preds.copy()
        p["ape"] = (p[best] - p.load_mw).abs() / p.load_mw * 100
        p["zone"] = p.zone.map(ZN)
        c1, c2 = st.columns(2)
        c1.plotly_chart(px.bar(p.groupby("zone").ape.mean().reset_index(), x="zone", y="ape",
                               title=f"{best}: MAPE by zone", labels={"ape": "MAPE (%)"}), use_container_width=True)
        c2.plotly_chart(px.line(p.groupby(p.timestamp.dt.hour).ape.mean().reset_index(), x="timestamp", y="ape",
                                title=f"{best}: MAPE by hour of day", labels={"ape": "MAPE (%)", "timestamp": "hour"}),
                        use_container_width=True)

# ------------------------------------------------------------------ What-if
elif page == "What-if":
    st.title("What if tomorrow is hotter or colder?")
    c1, c2, c3 = st.columns(3)
    zone = c1.selectbox("Zone", list(ZN.values()), index=0)
    date = c2.date_input("Date", pd.Timestamp("2026-08-15").date(), min_value=dmin, max_value=dmax)
    shift = c3.slider("Temperature shift (°F)", -15, 15, 5)
    try:
        base = T.forecast_load(zone, str(date), 0.0)
        alt = T.forecast_load(zone, str(date), float(shift))
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=list(range(24)), y=base["hourly_mw"], name="forecast, as observed"))
        fig.add_trace(go.Scatter(x=list(range(24)), y=alt["hourly_mw"], name=f"forecast, {shift:+d} °F"))
        fig.update_layout(title=f"{zone}, {date}", xaxis_title="hour", yaxis_title="MW", height=420)
        st.plotly_chart(fig, use_container_width=True)
        d = alt["peak_mw"] - base["peak_mw"]
        c1, c2, c3 = st.columns(3)
        c1.metric("Peak, as observed", f"{base['peak_mw']:,} MW")
        c2.metric(f"Peak at {shift:+d} °F", f"{alt['peak_mw']:,} MW", f"{d:+,} MW ({d / base['peak_mw'] * 100:+.1f}%)")
        c3.metric("Mean change", f"{alt['mean_mw'] - base['mean_mw']:+,} MW")
        # sensitivity curve
        shifts = list(range(-15, 16, 3))
        peaks = [T.forecast_load(zone, str(date), float(s))["peak_mw"] for s in shifts]
        st.plotly_chart(px.line(x=shifts, y=peaks, markers=True, title="Peak load vs temperature shift",
                                labels={"x": "shift (°F)", "y": "peak MW"}), use_container_width=True)
    except Exception as ex:
        st.error(str(ex))

# ------------------------------------------------------------------ Peak days
elif page == "Peak days":
    st.title("High-peak days")
    if pk is None:
        st.info("Run `make peak` first.")
    else:
        p = pk.copy()
        p["year"] = p.day.dt.year
        c1, c2, c3 = st.columns(3)
        c1.metric("Days labelled", f"{len(p):,}")
        c2.metric("High-peak share", f"{p.high_peak.mean() * 100:.1f}%")
        c3.metric("Highest ratio to trailing mean", f"{p.peak_ratio.max():.2f}×", help=str(p.loc[p.peak_ratio.idxmax(), 'day'].date()))
        fig = px.scatter(p, x="day", y="peak_mw", color=p.high_peak.map({1: "high-peak", 0: "normal"}),
                         title="Daily system peak and the rolling cutoff", labels={"peak_mw": "MW", "color": ""},
                         opacity=0.7)
        fig.add_trace(go.Scatter(x=p.day, y=p.cutoff_mw, name="cutoff", line=dict(color="black", width=1)))
        st.plotly_chart(fig, use_container_width=True)
        st.plotly_chart(px.bar(p.groupby("year").high_peak.mean().mul(100).reset_index(), x="year", y="high_peak",
                               title="Share of high-peak days by year (%)", labels={"high_peak": "%"}),
                        use_container_width=True)
        lbp = OUT_REPORTS / "peak_day_leaderboard.csv"
        if lbp.exists():
            st.subheader("Classifier results (test = 2025–26)")
            st.dataframe(pd.read_csv(lbp), hide_index=True)

# ------------------------------------------------------------------ Agent
else:
    st.title("Ask the grid analyst")
    st.caption("A tool-calling agent over the data and models. Every number comes from a tool call.")
    import os
    try:
        from dotenv import load_dotenv; load_dotenv(ROOT / ".env")
    except ImportError:
        pass
    if "ANTHROPIC_API_KEY" not in os.environ:
        st.warning("Set ANTHROPIC_API_KEY in .env to enable the agent. The tools below work without it.")
    if "chat" not in st.session_state:
        st.session_state.chat = []
    for role, text in st.session_state.chat:
        st.chat_message(role).write(text)
    q = st.chat_input("e.g. Will Coast break 24,000 MW on 2026-07-22? What if it is 5 °F hotter?")
    if q:
        st.session_state.chat.append(("user", q))
        st.chat_message("user").write(q)
        try:
            from src.agent.agent import ask
            with st.spinner("calling tools..."):
                answer, used = ask(q)
            answer = f"{answer}\n\n_tools called: {', '.join(used) or 'none'}_"
        except Exception as ex:
            answer = f"Agent unavailable: {ex}"
        st.session_state.chat.append(("assistant", answer))
        st.chat_message("assistant").write(answer)

    with st.expander("Try the tools directly (no API key needed)"):
        tool = st.selectbox("Tool", ["get_load", "get_weather", "forecast_load", "what_if", "peak_risk", "explain", "model_card"])
        zone = st.selectbox("Zone", list(ZN.values()), index=4, key="tz")
        d1 = st.date_input("Date / start", pd.Timestamp("2026-07-22").date(), key="td1")
        d2 = st.date_input("End (get_load only)", pd.Timestamp("2026-07-22").date(), key="td2")
        sh = st.number_input("Temperature shift °F (what_if)", value=5.0)
        if st.button("Run tool"):
            fn = getattr(T, tool)
            args = {"get_load": (zone, str(d1), str(d2)), "get_weather": (zone, str(d1)), "forecast_load": (zone, str(d1)),
                    "what_if": (zone, str(d1), sh), "peak_risk": (str(d1),), "explain": (zone, str(d1)), "model_card": ()}[tool]
            try:
                st.json(fn(*args))
            except Exception as ex:
                st.error(str(ex))
