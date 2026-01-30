#!/usr/bin/env python3
"""
Legacy single-asset fetch for XAUUSD.
Kept for safety, but the main workflow is fetch_assets.yml.

Outputs:
  data/xauusd_daily.json
  data/xauusd_15m.json
"""

import json
import sys
from datetime import timezone
from pathlib import Path

import pandas as pd
import yfinance as yf


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index, errors="coerce")
    df = df[~df.index.isna()]
    if df.index.tz is None:
        df.index = df.index.tz_localize(timezone.utc)
    else:
        df.index = df.index.tz_convert(timezone.utc)
    return df


def _to_records(df: pd.DataFrame):
    out = []
    for ts, row in df.iterrows():
        out.append({
            "t": ts.isoformat().replace("+00:00", "Z"),
            "o": float(row.get("Open", float("nan"))),
            "h": float(row.get("High", float("nan"))),
            "l": float(row.get("Low", float("nan"))),
            "c": float(row.get("Close", float("nan"))),
            "v": float(row.get("Volume", 0.0)) if pd.notna(row.get("Volume", 0.0)) else 0.0,
        })
    out = [r for r in out if r["c"] == r["c"]]
    return out


def main() -> int:
    yf_sym = "XAUUSD=X"

    daily = yf.download(yf_sym, interval="1d", period="6mo", auto_adjust=False, progress=False, threads=False)
    m15 = yf.download(yf_sym, interval="15m", period="7d", auto_adjust=False, progress=False, threads=False)

    daily = _normalize_df(daily)
    m15 = _normalize_df(m15)

    rec_d = _to_records(daily)
    rec_15 = _to_records(m15)

    (DATA_DIR / "xauusd_daily.json").write_text(json.dumps(rec_d, ensure_ascii=False), encoding="utf-8")
    (DATA_DIR / "xauusd_15m.json").write_text(json.dumps(rec_15, ensure_ascii=False), encoding="utf-8")

    print(f"OK daily rows={len(rec_d)} 15m rows={len(rec_15)}")
    return 0 if len(rec_d) >= 20 and len(rec_15) >= 40 else 1


if __name__ == "__main__":
    sys.exit(main())
