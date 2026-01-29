import yfinance as yf
import pandas as pd
import json
from datetime import timezone

DATA_15M = "data/xauusd_15m.json"
DATA_DAILY = "data/xauusd_daily.json"

SYMBOL = "GC=F"   # ✅ ใช้ Gold Futures (เสถียร)

def fetch(interval, period):
    df = yf.download(
        SYMBOL,
        interval=interval,
        period=period,
        progress=False,
        auto_adjust=True
    )

    if df is None or df.empty:
        return [], []

    # ✅ บังคับให้เป็น Series แน่นอน
    close = df["Close"].astype(float)
    ts = df.index.tz_localize(None)

    return (
        ts.astype("datetime64[ms]").astype(str).tolist(),
        close.tolist()
    )

def save(path, ts, close):
    with open(path, "w") as f:
        json.dump(
            {
                "timestamps": ts,
                "close": close
            },
            f
        )

def main():
    # 15 นาที (ย้อนหลัง ~5 วัน)
    ts15, c15 = fetch("15m", "5d")
    save(DATA_15M, ts15, c15)

    # Daily (ย้อนหลัง ~6 เดือน)
    tsd, cd = fetch("1d", "6mo")
    save(DATA_DAILY, tsd, cd)

    print("Saved:", len(c15), "15m bars,", len(cd), "daily bars")

if __name__ == "__main__":
    main()
