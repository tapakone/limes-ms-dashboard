import json
import time
import yfinance as yf

DATA_15M = "data/xauusd_15m.json"
DATA_DAILY = "data/xauusd_daily.json"

# ลองหลายตัว เผื่อบางช่วง Yahoo ตอบไม่ครบ
TICKERS = [
    "GC=F",      # Gold Futures (แนะนำ)
    "XAUUSD=X",  # Gold spot (บางช่วงอาจ 404)
    "XAU=X",     # Gold spot alt (บางบัญชีมี/ไม่มี)
]

def download_one(ticker: str, interval: str, period: str):
    df = yf.download(
        ticker,
        interval=interval,
        period=period,
        progress=False,
        auto_adjust=True,
        threads=False,
    )
    if df is None or df.empty:
        return None
    if "Close" not in df.columns:
        return None
    # ทำให้ index เป็น string ได้แน่ ๆ (ตัด timezone ออก)
    idx = df.index
    try:
        idx = idx.tz_localize(None)
    except Exception:
        pass

    ts = [str(x) for x in idx.to_pydatetime()]
    close = [float(x) for x in df["Close"].tolist()]
    return ts, close

def fetch_with_fallback(interval: str, period: str, retries: int = 3):
    for attempt in range(1, retries + 1):
        for tk in TICKERS:
            try:
                out = download_one(tk, interval, period)
                if out is not None:
                    print(f"OK: {tk} {interval} {period} -> {len(out[1])} rows")
                    return out
                else:
                    print(f"EMPTY: {tk} {interval} {period}")
            except Exception as e:
                print(f"ERR: {tk} {interval} {period} -> {e}")
        # backoff
        time.sleep(2 * attempt)
    return [], []

def save(path: str, ts, close):
    with open(path, "w") as f:
        json.dump({"timestamps": ts, "close": close}, f)

def main():
    ts15, c15 = fetch_with_fallback("15m", "5d", retries=3)
    save(DATA_15M, ts15, c15)

    tsd, cd = fetch_with_fallback("1d", "6mo", retries=3)
    save(DATA_DAILY, tsd, cd)

    print("Saved:", len(c15), "15m bars,", len(cd), "daily bars")

if __name__ == "__main__":
    main()
