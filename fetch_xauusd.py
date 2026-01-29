import json
import re
from datetime import datetime
import yfinance as yf
import pandas as pd

# ====== CONFIG: เพิ่ม/ลดสินทรัพย์ตรงนี้ ======
# key = "ชื่อที่จะแสดง/พิมพ์ในเว็บ"
# value = list ของ Yahoo symbols (ตัวแรกคือหลัก, ถ้า fail จะลองตัวถัดไป)
ASSETS = {
    # Gold (ลอง spot ก่อน ถ้าไม่ได้จะ fallback futures)
    "XAUUSD": ["XAUUSD=X", "GC=F"],

    # US Stocks / ETFs
    "AGNC": ["AGNC"],
    "JEPQ": ["JEPQ"],
    "NVDA": ["NVDA"],
    "SCHD": ["SCHD"],
    "TSLA": ["TSLA"],
    "GOOGL": ["GOOGL"],
    "AMD": ["AMD"],
    "JNJ": ["JNJ"],
    "VOO": ["VOO"],
    "QQQ": ["QQQ"],

    # Mag7 / Mag7 ETF (แนะนำใช้ ETF ที่มีจริง)
    "MAG7": ["MAGS"],  # Roundhill Magnificent Seven ETF

    # Crypto
    "BTC": ["BTC-USD"],
    "ETH": ["ETH-USD"],

    # Thai stocks (เติม .BK)
    # ตัวอย่าง:
    # "CPALL": ["CPALL.BK"],
    # "AOT": ["AOT.BK"],
}

INTERVALS = {
    "15m": {"period": "7d"},
    "1d": {"period": "180d"},
}

DATA_DIR = "data"


def slugify(name: str) -> str:
    s = name.strip().upper()
    s = re.sub(r"[^A-Z0-9]+", "_", s)
    return s.lower().strip("_")


def _normalize_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()

    # yfinance บางทีได้ MultiIndex columns
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]

    # บางครั้งได้ "Adj Close" อย่างเดียว
    close_col = None
    for c in ["Close", "Adj Close"]:
        if c in df.columns:
            close_col = c
            break
    if close_col is None:
        return pd.DataFrame()

    out = df[[close_col]].copy()
    out.rename(columns={close_col: "Close"}, inplace=True)

    # index เป็น datetime
    if not isinstance(out.index, pd.DatetimeIndex):
        out.index = pd.to_datetime(out.index, errors="coerce")
    out = out.dropna()

    return out


def _to_iso_list(ts_index: pd.DatetimeIndex) -> list:
    # ถ้า tz-aware ใช้ tz_convert, ถ้า tz-naive ใช้ tz_localize
    if ts_index.tz is None:
        ts = ts_index.tz_localize("UTC")
    else:
        ts = ts_index.tz_convert("UTC")
    return [t.isoformat() for t in ts.to_pydatetime()]


def fetch_one(symbols: list[str], interval: str, period: str):
    last_err = None
    for sym in symbols:
        try:
            df = yf.download(
                sym,
                interval=interval,
                period=period,
                progress=False,
                auto_adjust=False,
                threads=False,
            )
            df = _normalize_df(df)
            if df.empty:
                raise ValueError("Empty dataframe")
            ts = _to_iso_list(df.index)
            close = df["Close"].astype(float).tolist()
            return sym, ts, close
        except Exception as e:
            last_err = f"{sym}: {repr(e)}"
            continue
    raise RuntimeError(last_err or "No symbols worked")


def write_json(path: str, payload: dict):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)


def main():
    meta_list = []

    for asset_key, yahoo_symbols in ASSETS.items():
        asset_id = slugify(asset_key)

        for interval, cfg in INTERVALS.items():
            yahoo_used, ts, close = fetch_one(
                yahoo_symbols, interval=interval, period=cfg["period"]
            )

            if interval == "1d":
                out_path = f"{DATA_DIR}/{asset_id}_daily.json"
            else:
                out_path = f"{DATA_DIR}/{asset_id}_{interval}.json"

            write_json(out_path, {"timestamps": ts, "close": close})

            # เก็บ meta สำหรับ assets.json
            if interval == "1d":
                daily_used = yahoo_used
            else:
                intraday_used = yahoo_used

        meta_list.append(
            {
                "id": asset_id,
                "label": asset_key.upper(),
                "yahoo": yahoo_symbols,
                "used_daily": daily_used,
                "used_15m": intraday_used,
                "updated_utc": datetime.utcnow().isoformat() + "Z",
            }
        )

    # สร้างไฟล์สำหรับ autocomplete
    write_json(f"{DATA_DIR}/assets.json", {"assets": meta_list})


if __name__ == "__main__":
    main()
