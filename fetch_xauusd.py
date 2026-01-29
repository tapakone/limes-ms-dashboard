import yfinance as yf
import json
from datetime import timezone
import os

DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

SYMBOL = "GC=F"  # Gold Futures (stable)

def fetch(interval, period):
    df = yf.download(
        SYMBOL,
        interval=interval,
        period=period,
        progress=False
    )

    if df.empty:
        raise RuntimeError("No data returned from Yahoo Finance")

    # ใช้ values.tolist() เท่านั้น
    timestamps = (
        df.index
        .tz_localize(timezone.utc, nonexistent="shift_forward")
        .tz_convert("Asia/Bangkok")
        .strftime("%Y-%m-%d %H:%M")
        .tolist()
    )

    close = df["Close"].astype(float).values.tolist()
    return timestamps, close


def save_json(filename, timestamps, close):
    with open(os.path.join(DATA_DIR, filename), "w") as f:
        json.dump(
            {
                "symbol": SYMBOL,
                "timestamps": timestamps,
                "close": close
            },
            f
        )


def main():
    t15, c15 = fetch("15m", "7d")
    save_json("xauusd_15m.json", t15, c15)

    td, cd = fetch("1d", "6mo")
    save_json("xauusd_daily.json", td, cd)


if __name__ == "__main__":
    main()
