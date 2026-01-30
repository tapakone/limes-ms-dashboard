import os
import json
import sys
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

DATA_DIR = "data"
TICKERS_FILE = "tickers.json"

# ตั้งค่านี้เป็น 1 ถ้าคุณ "อยากให้ fail เมื่อมีตัวไหนเสีย" (โหมดเข้ม)
STRICT_FAIL = os.environ.get("STRICT_FAIL", "0") == "1"


def safe_slug(sym: str) -> str:
    return sym.strip().lower().replace("^", "").replace("=", "").replace(".", "_").replace("-", "-")


def ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def write_json(path: str, payload: dict):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, path)


def empty_payload(symbol: str, interval: str, reason: str):
    return {
        "symbol": symbol,
        "interval": interval,
        "timestamps": [],
        "close": [],
        "meta": {
            "ok": False,
            "reason": reason,
            "generated_utc": datetime.now(timezone.utc).isoformat(),
        },
    }


def ok_payload(symbol: str, interval: str, ts, close):
    return {
        "symbol": symbol,
        "interval": interval,
        "timestamps": ts,
        "close": close,
        "meta": {
            "ok": True,
            "generated_utc": datetime.now(timezone.utc).isoformat(),
        },
    }


def fetch_history(symbol: str, interval: str, period: str) -> pd.DataFrame:
    """
    yfinance download:
    - daily: interval="1d"
    - 15m : interval="15m"
    """
    df = yf.download(
        tickers=symbol,
        interval=interval,
        period=period,
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    # yfinance อาจคืน empty df ถ้าหา symbol ไม่เจอ/โดนจำกัด
    if df is None or df.empty:
        return pd.DataFrame()
    # บางครั้งคอลัมน์เป็น MultiIndex ถ้าส่งหลาย ticker (แต่เราส่งทีละตัว) เผื่อไว้
    if isinstance(df.columns, pd.MultiIndex):
        # เลือก level ที่ชื่อ "Close" ถ้ามี
        if "Close" in df.columns.get_level_values(0):
            df = df["Close"].to_frame("Close")
        else:
            # fallback: พยายามหา Close
            close_col = [c for c in df.columns if "Close" in str(c)]
            if close_col:
                df = df[close_col[0]].to_frame("Close")

    return df


def to_series_close(df: pd.DataFrame) -> pd.Series:
    # ให้แน่ใจว่าได้ Series
    if df is None or df.empty:
        return pd.Series(dtype="float64")
    if "Close" in df.columns:
        s = df["Close"]
    elif "close" in df.columns:
        s = df["close"]
    else:
        # ถ้า df เป็น Series อยู่แล้ว
        if isinstance(df, pd.Series):
            s = df
        else:
            return pd.Series(dtype="float64")
    return pd.to_numeric(s, errors="coerce").dropna()


def build_file(symbol: str, kind: str) -> str:
    slug = safe_slug(symbol)
    return os.path.join(DATA_DIR, f"{slug}_{kind}.json")


def run_one(symbol: str):
    """
    สร้าง 2 ไฟล์ต่อ 1 symbol:
      - *_daily.json (1d / 6mo)
      - *_15m.json   (15m / 7d)
    """
    results = {}

    # DAILY
    daily_path = build_file(symbol, "daily")
    try:
        df_d = fetch_history(symbol, interval="1d", period="6mo")
        s_d = to_series_close(df_d)
        if s_d.empty:
            payload = empty_payload(symbol, "1d", "no daily data")
            write_json(daily_path, payload)
            results["daily"] = (False, 0, "no daily data")
        else:
            ts = [t.isoformat() for t in s_d.index.to_pydatetime()]
            close = [float(x) for x in s_d.values.tolist()]
            payload = ok_payload(symbol, "1d", ts, close)
            write_json(daily_path, payload)
            results["daily"] = (True, len(close), "ok")
    except Exception as e:
        payload = empty_payload(symbol, "1d", f"exception: {e}")
        write_json(daily_path, payload)
        results["daily"] = (False, 0, f"exception: {e}")

    # 15m
    m15_path = build_file(symbol, "15m")
    try:
        df_15 = fetch_history(symbol, interval="15m", period="7d")
        s_15 = to_series_close(df_15)
        if s_15.empty:
            payload = empty_payload(symbol, "15m", "no 15m data")
            write_json(m15_path, payload)
            results["15m"] = (False, 0, "no 15m data")
        else:
            ts = [t.isoformat() for t in s_15.index.to_pydatetime()]
            close = [float(x) for x in s_15.values.tolist()]
            payload = ok_payload(symbol, "15m", ts, close)
            write_json(m15_path, payload)
            results["15m"] = (True, len(close), "ok")
    except Exception as e:
        payload = empty_payload(symbol, "15m", f"exception: {e}")
        write_json(m15_path, payload)
        results["15m"] = (False, 0, f"exception: {e}")

    return results


def load_tickers() -> list[str]:
    if not os.path.exists(TICKERS_FILE):
        return ["XAUUSD=X"]
    with open(TICKERS_FILE, "r", encoding="utf-8") as f:
        obj = json.load(f)
    arr = obj.get("tickers", [])
    # กันซ้ำ/กันค่าว่าง
    out = []
    seen = set()
    for x in arr:
        if not x or not str(x).strip():
            continue
        s = str(x).strip()
        if s not in seen:
            out.append(s)
            seen.add(s)
    return out


def write_manifest(tickers: list[str], summary: dict):
    """
    ทำไฟล์ manifest สำหรับ autocomplete / เช็คว่ามีตัวไหนพร้อมใช้งาน
    """
    payload = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "tickers": tickers,
        "summary": summary,
    }
    write_json(os.path.join(DATA_DIR, "manifest.json"), payload)


def main():
    ensure_data_dir()
    tickers = load_tickers()

    any_fail = False
    summary = {}

    for sym in tickers:
        res = run_one(sym)

        d_ok, d_rows, d_msg = res["daily"]
        m_ok, m_rows, m_msg = res["15m"]

        if d_ok:
            print(f"OK daily -> {build_file(sym, 'daily')} (rows={d_rows})")
        else:
            print(f"WARN daily -> {build_file(sym, 'daily')} ({d_msg})")
            any_fail = True

        if m_ok:
            print(f"OK 15m   -> {build_file(sym, '15m')} (rows={m_rows})")
        else:
            print(f"WARN 15m   -> {build_file(sym, '15m')} ({m_msg})")
            any_fail = True

        summary[sym] = {
            "daily": {"ok": d_ok, "rows": d_rows, "msg": d_msg},
            "15m": {"ok": m_ok, "rows": m_rows, "msg": m_msg},
        }

    write_manifest(tickers, summary)

    # ✅ จุดสำคัญ: ปกติให้ผ่าน (exit 0) เพื่อให้ commit/push ทำงานต่อ
    # ถ้าคุณอยาก strict: ตั้ง env STRICT_FAIL=1 ใน workflow
    if STRICT_FAIL and any_fail:
        print("STRICT_FAIL=1 and some tickers failed -> exit(1)")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
