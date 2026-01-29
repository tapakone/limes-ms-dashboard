#!/usr/bin/env python3
"""
Fetch XAUUSD data and write JSON for GitHub Pages dashboard.

Outputs:
  data/xauusd_15m.json   -> {"timestamps":[...], "close":[...], "meta":{...}}
  data/xauusd_daily.json -> {"timestamps":[...], "close":[...], "meta":{...}}

Design goals:
- Be resilient to Yahoo "symbol not found" glitches.
- Never overwrite good data with empty arrays.
- Prefer spot gold (XAUUSD=X). Fall back to gold futures (GC=F) if needed.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

import pandas as pd
import yfinance as yf


REPO_ROOT = Path(__file__).resolve().parent
DATA_DIR = REPO_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

OUT_15M = DATA_DIR / "xauusd_15m.json"
OUT_DAILY = DATA_DIR / "xauusd_daily.json"

# 1) try spot XAUUSD, 2) fallback to gold futures (usually works reliably)
PREFERRED_TICKERS = ["XAUUSD=X", "GC=F"]


def _iso_utc(ts: pd.Timestamp) -> str:
    """Return ISO-8601 string in UTC with trailing Z."""
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    else:
        ts = ts.tz_convert("UTC")
    return ts.to_pydatetime().replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_close_series(df: pd.DataFrame) -> Optional[pd.Series]:
    """Extract Close series from yfinance output robustly."""
    if df is None or df.empty:
        return None

    # MultiIndex columns can happen
    if isinstance(df.columns, pd.MultiIndex):
        if "Close" in df.columns.get_level_values(0):
            close_df = df["Close"]
            if isinstance(close_df, pd.DataFrame):
                return close_df.iloc[:, 0]
            return close_df
        if "Close" in df.columns.get_level_values(-1):
            close_cols = [c for c in df.columns if c[-1] == "Close"]
            if close_cols:
                return df[close_cols[0]]

    if "Close" in df.columns:
        return df["Close"]

    for c in df.columns:
        if str(c).lower() == "close":
            return df[c]

    return None


def _fetch_once(ticker: str, interval: str, period: str) -> Optional[pd.DataFrame]:
    """Try download() then history() as fallback."""
    try:
        df = yf.download(
            tickers=ticker,
            interval=interval,
            period=period,
            auto_adjust=False,
            progress=False,
            threads=False,
        )
    except Exception:
        df = pd.DataFrame()

    if df is not None and not df.empty:
        return df

    try:
        df2 = yf.Ticker(ticker).history(period=period, interval=interval, auto_adjust=False)
        return df2 if (df2 is not None and not df2.empty) else None
    except Exception:
        return None


def fetch_best(interval: str, period: str) -> Tuple[str, pd.Series]:
    """Try PREFERRED_TICKERS and return the first non-empty close series."""
    last_err: Optional[str] = None

    for t in PREFERRED_TICKERS:
        df = _fetch_once(t, interval=interval, period=period)
        if df is None or df.empty:
            last_err = f"{t}: empty dataframe"
            continue

        close = _safe_close_series(df)
        if close is None or close.dropna().empty:
            last_err = f"{t}: close series missing/empty"
            continue

        close = close.dropna()

        if not isinstance(close.index, pd.DatetimeIndex):
            try:
                close.index = pd.to_datetime(close.index)
            except Exception:
                last_err = f"{t}: cannot parse datetime index"
                continue

        return t, close

    raise RuntimeError(f"All tickers failed for interval={interval} period={period}. Last: {last_err}")


def write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def build_payload(ticker_used: str, close: pd.Series, kind: str) -> Dict[str, Any]:
    timestamps = [_iso_utc(ts) for ts in close.index]
    closes = [float(x) for x in close.values]

    return {
        "timestamps": timestamps,
        "close": closes,
        "meta": {
            "symbol": "XAUUSD",
            "source": "yfinance",
            "ticker_used": ticker_used,
            "interval": kind,
            "generated_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        },
    }


def main() -> int:
    # --- 15m: last ~7 days ---
    t15, s15 = fetch_best(interval="15m", period="7d")
    if len(s15) > 800:
        s15 = s15.iloc[-800:]

    # --- daily: need >= ~60 points (dashboard uses 40 trading days + buffer) ---
    td, sd = fetch_best(interval="1d", period="365d")
    if len(sd) < 60:
        td, sd = fetch_best(interval="1d", period="5y")
    if len(sd) > 600:
        sd = sd.iloc[-600:]

    # Hard validation: NEVER write empty/too-short arrays (will crash frontend)
    if len(s15) < 20:
        raise RuntimeError(f"Too few 15m points: {len(s15)} (ticker={t15})")
    if len(sd) < 60:
        raise RuntimeError(f"Too few daily points: {len(sd)} (ticker={td})")

    payload_15 = build_payload(t15, s15, kind="15m")
    payload_d = build_payload(td, sd, kind="1d")

    if not payload_15["timestamps"] or not payload_d["timestamps"]:
        raise RuntimeError("Refusing to write empty data payloads.")

    write_json_atomic(OUT_15M, payload_15)
    write_json_atomic(OUT_DAILY, payload_d)

    print(f"OK: wrote {OUT_15M} ({len(s15)} pts, ticker={t15})")
    print(f"OK: wrote {OUT_DAILY} ({len(sd)} pts, ticker={td})")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        # exit 1 so workflow becomes red, and you won't overwrite good data with empty
        raise SystemExit(1)
