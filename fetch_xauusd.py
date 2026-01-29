import json
import os
import yfinance as yf
import pandas as pd
from datetime import datetime, time
import pytz

TZ = pytz.timezone("Asia/Bangkok")

DATA_DIR = "data"
FILE_15M = os.path.join(DATA_DIR, "xauusd_15m.json")
FILE_DAILY = os.path.join(DATA_DIR, "xauusd_daily.json")

os.makedirs(DATA_DIR, exist_ok=True)

# ลำดับการ fallback: Spot ก่อน แล้วค่อย Futures
SYMBOLS = [
    ("XAUUSD=X", "yahoo_spot"),
    ("GC=F", "yahoo_futures"),
]

def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f)

def download_one(symbol: str, interval: str, period: str) -> pd.DataFrame:
    df = yf.download(symbol, interval=interval, period=period, progress=False)
    if df is None or df.empty:
        return pd.DataFrame()
    df = df.dropna()
    return df

def fetch_with_fallback(interval: str, period: str):
    """
    return (df, source_name, symbol_used) or (None, None, None)
    """
    for sym, src in SYMBOLS:
        df = download_one(sym, interval, period)
        # กันเคสได้ df แต่อยู่ไม่กี่แถว/ใช้ไม่ได้
        if not df.empty and len(df) >= 20:
            # ปรับ timezone ให้เป็น UTC ISO สม่ำเสมอ
            if df.index.tz is None:
                df.index = df.index.tz_localize("UTC")
            else:
                df.index = df.index.tz_convert("UTC")
            return df, src, sym
    return None, None, None

def compute_day0_ref_04th(df_utc: pd.DataFrame) -> float:
    """
    หา Day0 ref ใกล้ 04:00 TH ของวันล่าสุด (อิง index)
    """
    df_th = df_utc.copy()
    df_th.index = df_th.index.tz_convert(TZ)
    latest_day = df_th.index[-1].date()
    target = TZ.localize(datetime.combine(latest_day, time(4, 0)))
    nearest = df_th.index.get_indexer([target], method="nearest")[0]
    return float(df_th.iloc[nearest]["Close"])

def main():
    # -------- 15m --------
    df15, src15, sym15 = fetch_with_fallback("15m", "7d")
    if df15 is not None and "Close" in df15.columns and len(df15) >= 20:
        ts = [t.isoformat() for t in df15.index]
        close = df15["Close"].astype(float).tolist()
        day0 = compute_day0_ref_04th(df15)

        save_json(FILE_15M, {
            "timestamps": ts,
            "close": close,
            "day0_ref_04th": day0,
            "source": src15,
            "symbol": sym15
        })
    else:
        # กันพัง: ยังเขียนไฟล์ให้หน้าเว็บอ่านได้
        save_json(FILE_15M, {"timestamps": [], "close": [], "source": None, "symbol": None})

    # -------- daily --------
    dfd, srcd, symd = fetch_with_fallback("1d", "180d")
    if dfd is not None and "Close" in dfd.columns and len(dfd) >= 50:
        ts = [t.isoformat() for t in dfd.index]
        close = dfd["Close"].astype(float).tolist()
        save_json(FILE_DAILY, {
            "timestamps": ts,
            "close": close,
            "source": srcd,
            "symbol": symd
        })
    else:
        save_json(FILE_DAILY, {"timestamps": [], "close": [], "source": None, "symbol": None})

if __name__ == "__main__":
    main()
