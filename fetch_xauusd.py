# fetch_xauusd.py
# Run in GitHub Actions to fetch XAUUSD and write JSON files for the static site.
# Source: Yahoo Finance via yfinance (no API key)
import json
import os
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytz

def _try_download(ticker: str, period: str, interval: str):
    import yfinance as yf
    df = yf.download(ticker, period=period, interval=interval, auto_adjust=False, progress=False, threads=False)
    if df is None or df.empty:
        return None
    # Normalize columns
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    df = df.rename(columns={c: c.lower() for c in df.columns})
    # Use Close as close
    if "close" not in df.columns:
        return None
    return df

def main():
    tz_th = pytz.timezone("Asia/Bangkok")

    # 1) Intraday for risk (15m) — try XAUUSD spot, fallback to Gold futures
    df15 = _try_download("XAUUSD=X", period="7d", interval="15m")
    if df15 is None:
        df15 = _try_download("GC=F", period="7d", interval="15m")
    if df15 is None:
        raise SystemExit("Failed to download intraday data from Yahoo Finance")

    df15 = df15.dropna(subset=["close"]).copy()
    df15.index = pd.to_datetime(df15.index)
    if df15.index.tz is None:
        df15.index = df15.index.tz_localize("UTC")
    df15_th = df15.tz_convert(tz_th)

    # Day0 ref at 04:00 TH (nearest timestamp in last 2 days)
    now_th = datetime.now(tz_th)
    target = now_th.replace(hour=4, minute=0, second=0, microsecond=0)
    if now_th.hour < 4:
        target = target - timedelta(days=1)
    # nearest row within +- 60 minutes
    window = df15_th.loc[(df15_th.index >= target - timedelta(minutes=60)) & (df15_th.index <= target + timedelta(minutes=60))]
    day0_ref = None
    if not window.empty:
        # pick closest
        idx = (window.index - target).abs().argmin()
        day0_ref = float(window.iloc[idx]["close"])

    out15 = {
        "ticker": "XAUUSD",
        "interval": "15m",
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "day0_ref_04th": day0_ref,
        "timestamps": [ts.astimezone(timezone.utc).isoformat() for ts in df15_th.index.to_pydatetime()],
        "close": [float(x) for x in df15_th["close"].tolist()],
    }

    os.makedirs("data", exist_ok=True)
    with open("data/xauusd_15m.json", "w", encoding="utf-8") as f:
        json.dump(out15, f, ensure_ascii=False)

    # 2) Daily for chart
    df1d = _try_download("XAUUSD=X", period="200d", interval="1d")
    if df1d is None:
        df1d = _try_download("GC=F", period="200d", interval="1d")
    if df1d is None:
        raise SystemExit("Failed to download daily data from Yahoo Finance")

    df1d = df1d.dropna(subset=["close"]).copy()
    df1d.index = pd.to_datetime(df1d.index)
    if df1d.index.tz is None:
        df1d.index = df1d.index.tz_localize("UTC")

    out1d = {
        "ticker": "XAUUSD",
        "interval": "1d",
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "timestamps": [ts.isoformat() for ts in df1d.index.to_pydatetime()],
        "close": [float(x) for x in df1d["close"].tolist()],
    }
    with open("data/xauusd_daily.json", "w", encoding="utf-8") as f:
        json.dump(out1d, f, ensure_ascii=False)

    print("OK: wrote data/xauusd_15m.json and data/xauusd_daily.json")

if __name__ == "__main__":
    main()
