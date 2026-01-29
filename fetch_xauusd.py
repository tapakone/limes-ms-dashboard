import yfinance as yf
import pandas as pd
import json
from datetime import timezone

DATA_15M = "data/xauusd_15m.json"
DATA_DAILY = "data/xauusd_daily.json"

SYMBOL = "GC=F"  # Gold Futures (stable, Yahoo-supported)

def fetch(interval, period):
    df = yf.download(
        SYMBOL,
        interval=interval,
        period=period,
        progress=False
    )

    if df is None or df.empty or "Close" not in df:
        print(f"[WARN] No data for {interval}")
        return [], []

    df = df.dropna()

    times = [
        int(ts.replace(tzinfo=timezone.utc).timestamp() * 1000)
        for ts in df.index
    ]
    close = df["Close"].astype(float).tolist()

    return times, close


def save(path, times, close):
    with open(path, "w") as f:
        json.dump(
            {
                "timestamps": times,
                "close": close
            },
            f
        )


def main():
    t15, c15 = fetch("15m", "7d")
    td, cd = fetch("1d", "6mo")

    if len(c15) >= 2:
        save(DATA_15M, t15, c15)
        print(f"[OK] 15m saved ({len(c15)})")
    else:
        print("[SKIP] 15m insufficient data")

    if len(cd) >= 2:
        save(DATA_DAILY, td, cd)
        print(f"[OK] daily saved ({len(cd)})")
    else:
        print("[SKIP] daily insufficient data")


if __name__ == "__main__":
    main()
