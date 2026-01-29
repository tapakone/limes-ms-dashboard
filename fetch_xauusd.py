import yfinance as yf
import json
from datetime import datetime, timezone

DATA_15M = "data/xauusd_15m.json"
DATA_DAILY = "data/xauusd_daily.json"

SYMBOL = "GC=F"  # Gold Futures (stable)

def fetch(interval, period):
    df = yf.download(
        SYMBOL,
        interval=interval,
        period=period,
        progress=False
    )

    if df.empty:
        print(f"No data for {interval}")
        return [], []

    df = df.dropna()

    timestamps = [
        int(ts.to_pydatetime().replace(tzinfo=timezone.utc).timestamp() * 1000)
        for ts in df.index
    ]

    close = df["Close"].astype(float).to_list()

    return timestamps, close


def save(path, timestamps, close):
    with open(path, "w") as f:
        json.dump(
            {
                "timestamps": timestamps,
                "close": close,
                "updated_utc": datetime.utcnow().isoformat()
            },
            f
        )


def main():
    t15, c15 = fetch("15m", "7d")
    td, cd = fetch("1d", "6mo")

    save(DATA_15M, t15, c15)
    save(DATA_DAILY, td, cd)

    print("XAUUSD data updated successfully")


if __name__ == "__main__":
    main()
