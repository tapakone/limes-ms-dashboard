#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import pandas as pd
import yfinance as yf

DATA_DIR = "data"
TICKERS_FILE = "tickers.json"

# --- Naming must match index.html symToFileBase():
# lowercased and "." replaced with "_"
def sym_to_base(sym: str) -> str:
    return sym.strip().lower().replace(".", "_")

def ensure_data_dir() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def to_utc_index(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """
    Robust tz handling:
    - if tz-aware => tz_convert('UTC')
    - if tz-naive => tz_localize('UTC')
    This avoids: TypeError: Already tz-aware, use tz_convert to convert.
    """
    if getattr(idx, "tz", None) is not None:
        return idx.tz_convert("UTC")
    return idx.tz_localize("UTC")

def df_to_payload(df: pd.DataFrame, symbol: str, interval: str, range_str: str) -> Dict:
    """
    Payload schema:
    {
      symbol, interval, range, generated_at_utc,
      timestamps: [ISO strings],
      close: [floats]
    }
    """
    if df is None or df.empty:
        raise ValueError(f"No data returned for {symbol} ({interval}, {range_str})")

    # yfinance returns DateTimeIndex
    idx_utc = to_utc_index(df.index)
    close = df["Close"].astype(float)

    payload = {
        "symbol": symbol,
        "interval": interval,
        "range": range_str,
        "generated_at_utc": now_utc_iso(),
        "timestamps": [ts.to_pydatetime().replace(tzinfo=timezone.utc).isoformat() for ts in idx_utc],
        "close": [float(x) for x in close.to_list()],
        "source": "Yahoo Finance via yfinance"
    }
    return payload

def fetch_history(symbol: str, interval: str, range_str: str) -> pd.DataFrame:
    """
    Use yf.Ticker().history for robustness.
    For daily: interval='1d', range='6mo'
    For 15m:  interval='15m', range='7d'
    """
    t = yf.Ticker(symbol)
    df = t.history(interval=interval, period=range_str, auto_adjust=False, actions=False)
    # Ensure standardized columns exist
    if df is None or df.empty:
        return df
    # keep only Close and drop NaN
    df = df[["Close"]].dropna()
    return df

def write_json(path: str, payload: Dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

def load_tickers_from_file() -> List[str]:
    if not os.path.exists(TICKERS_FILE):
        raise FileNotFoundError(f"Missing {TICKERS_FILE} at repo root.")
    with open(TICKERS_FILE, "r", encoding="utf-8") as f:
        j = json.load(f)
    tickers = j.get("tickers", [])
    if not isinstance(tickers, list) or not tickers:
        raise ValueError("tickers.json must contain a non-empty array: {\"tickers\": [...] }")
    # de-dup & strip
    out = []
    seen = set()
    for s in tickers:
        if not isinstance(s, str):
            continue
        sym = s.strip()
        if not sym:
            continue
        if sym.lower() in seen:
            continue
        seen.add(sym.lower())
        out.append(sym)
    return out

def run_for_symbol(symbol: str) -> Tuple[bool, List[str]]:
    """
    Returns (success, messages)
    """
    msgs = []
    base = sym_to_base(symbol)
    daily_path = os.path.join(DATA_DIR, f"{base}_daily.json")
    m15_path = os.path.join(DATA_DIR, f"{base}_15m.json")

    try:
        df_daily = fetch_history(symbol, interval="1d", range_str="6mo")
        payload_daily = df_to_payload(df_daily, symbol, "1d", "6mo")
        write_json(daily_path, payload_daily)
        msgs.append(f"OK daily -> {daily_path} (rows={len(df_daily)})")
    except Exception as e:
        msgs.append(f"FAIL daily {symbol}: {e}")
        return False, msgs

    try:
        df_15 = fetch_history(symbol, interval="15m", range_str="7d")
        payload_15 = df_to_payload(df_15, symbol, "15m", "7d")
        write_json(m15_path, payload_15)
        msgs.append(f"OK 15m  -> {m15_path} (rows={len(df_15)})")
    except Exception as e:
        msgs.append(f"FAIL 15m {symbol}: {e}")
        # still keep daily if 15m fails, but mark overall failed
        return False, msgs

    return True, msgs

def main():
    ensure_data_dir()

    # Optional: allow running one ticker via CLI arg (used by workflow_dispatch input)
    if len(sys.argv) >= 2 and sys.argv[1].strip():
        tickers = [sys.argv[1].strip()]
    else:
        tickers = load_tickers_from_file()

    print(f"Tickers: {tickers}")

    ok_all = True
    for sym in tickers:
        ok, msgs = run_for_symbol(sym)
        for m in msgs:
            print(m)
        if not ok:
            ok_all = False

    if not ok_all:
        # Exit non-zero so Actions shows failure and you notice tickers that broke
        sys.exit(1)

if __name__ == "__main__":
    main()
