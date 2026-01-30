#!/usr/bin/env python3
"""
Fetch multiple assets from Yahoo Finance via yfinance and write JSON files for the dashboard.

Outputs:
  data/<slug>_daily.json
  data/<slug>_15m.json
  assets.json   (metadata list)
  tickers.json  (symbols list + aliases + yf map)

This script is designed to be robust:
- It continues even if some tickers fail.
- It exits 0 unless *all* tickers fail.
"""

import json
import os
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd
import yfinance as yf


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

TICKERS_FILE = ROOT / "tickers.json"
ASSETS_FILE = ROOT / "assets.json"

DEFAULT_TICKERS = [
    "XAUUSD",
    "NVDA", "TSLA", "GOOGL", "AMD", "JNJ",
    "VOO", "QQQ", "SCHD", "JEPQ", "AGNC",
    "MAGS",
    "PTT.BK", "CPALL.BK", "AOT.BK", "ADVANC.BK", "KBANK.BK",
    "BTC-USD", "ETH-USD",
]

DEFAULT_YF_MAP = {
    # Display -> Yahoo/yfinance symbol
    "XAUUSD": "XAUUSD=X",
    # You can add more FX pairs here later.
}

DEFAULT_ALIASES = {
    "MAG7": "MAGS",
    "MAGY": "MAGS",
}


def safe_slug(symbol: str) -> str:
    """Make safe filename slug compatible with the dashboard JS."""
    return (
        symbol.strip().lower()
        .replace("^", "")
        .replace("=", "")
        .replace(".", "_")
    )


def _read_tickers() -> Tuple[List[str], Dict[str, str], Dict[str, str]]:
    """
    Returns: (symbols, aliases, yf_map)
    Accepts older schema:
      { "tickers": [...] }
    And new schema:
      { "symbols": [...], "aliases": {...}, "yf": {...} }
    """
    if not TICKERS_FILE.exists():
        return DEFAULT_TICKERS, DEFAULT_ALIASES, DEFAULT_YF_MAP

    try:
        obj = json.loads(TICKERS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return DEFAULT_TICKERS, DEFAULT_ALIASES, DEFAULT_YF_MAP

    symbols: List[str] = []
    aliases: Dict[str, str] = {}
    yf_map: Dict[str, str] = {}

    if isinstance(obj, dict):
        if isinstance(obj.get("symbols"), list):
            symbols = [str(x).strip() for x in obj["symbols"] if str(x).strip()]
        if isinstance(obj.get("tickers"), list) and not symbols:
            symbols = [str(x).strip() for x in obj["tickers"] if str(x).strip()]
        if isinstance(obj.get("aliases"), dict):
            aliases = {str(k).strip().upper(): str(v).strip() for k, v in obj["aliases"].items() if str(k).strip() and str(v).strip()}
        if isinstance(obj.get("yf"), dict):
            yf_map = {str(k).strip().upper(): str(v).strip() for k, v in obj["yf"].items() if str(k).strip() and str(v).strip()}

    if not symbols:
        symbols = DEFAULT_TICKERS

    # merge defaults (defaults win only if key missing)
    merged_aliases = dict(DEFAULT_ALIASES)
    merged_aliases.update(aliases)
    merged_yf = dict(DEFAULT_YF_MAP)
    merged_yf.update(yf_map)

    # normalize symbols to upper (keep dots and dashes)
    symbols = [s.upper() for s in symbols]

    return symbols, merged_aliases, merged_yf


def _normalize_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    # yfinance may return multiindex columns even for single ticker sometimes
    if isinstance(df.columns, pd.MultiIndex):
        # prefer "Close" etc level
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    df = df.copy()
    # Ensure datetime index
    if not isinstance(df.index, pd.DatetimeIndex):
        df.index = pd.to_datetime(df.index, errors="coerce")
    df = df[~df.index.isna()]
    # Make tz-aware to UTC
    if df.index.tz is None:
        df.index = df.index.tz_localize(timezone.utc)
    else:
        df.index = df.index.tz_convert(timezone.utc)
    return df


def _to_records(df: pd.DataFrame) -> List[dict]:
    """
    Convert to compact records: [{t, o, h, l, c, v}]
    t is ISO string (UTC).
    """
    out = []
    if df.empty:
        return out
    for ts, row in df.iterrows():
        out.append({
            "t": ts.isoformat().replace("+00:00", "Z"),
            "o": float(row.get("Open", float("nan"))),
            "h": float(row.get("High", float("nan"))),
            "l": float(row.get("Low", float("nan"))),
            "c": float(row.get("Close", float("nan"))),
            "v": float(row.get("Volume", 0.0)) if pd.notna(row.get("Volume", 0.0)) else 0.0,
        })
    # drop nan closes
    out = [r for r in out if r["c"] == r["c"]]
    return out


def fetch_one(display_symbol: str, yf_symbol: str, interval: str, period: str) -> pd.DataFrame:
    df = yf.download(
        yf_symbol,
        interval=interval,
        period=period,
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    df = _normalize_df(df)
    return df


def main() -> int:
    symbols, aliases, yf_map = _read_tickers()

    ok = 0
    fail = 0
    assets_meta: List[dict] = []

    # Load existing metadata to preserve names/types across updates
    existing_meta = {}
    if ASSETS_FILE.exists():
        try:
            old = json.loads(ASSETS_FILE.read_text(encoding="utf-8"))
            if isinstance(old, list):
                for a in old:
                    if isinstance(a, dict) and a.get("symbol"):
                        existing_meta[str(a["symbol"]).upper()] = a
        except Exception:
            pass


    for disp in symbols:
        # Apply alias for display symbol
        disp_upper = disp.upper()
        if disp_upper in aliases:
            disp_upper = aliases[disp_upper].upper()

        yf_sym = yf_map.get(disp_upper, disp_upper)  # map XAUUSD->XAUUSD=X etc

        slug = safe_slug(disp_upper)
        daily_path = DATA_DIR / f"{slug}_daily.json"
        m15_path = DATA_DIR / f"{slug}_15m.json"

        try:
            dfd = fetch_one(disp_upper, yf_sym, interval="1d", period="6mo")
            df15 = fetch_one(disp_upper, yf_sym, interval="15m", period="7d")

            rec_d = _to_records(dfd)
            rec_15 = _to_records(df15)

            if len(rec_d) < 20 or len(rec_15) < 40:
                raise RuntimeError(f"insufficient rows (daily={len(rec_d)} 15m={len(rec_15)})")

            daily_path.write_text(json.dumps(rec_d, ensure_ascii=False), encoding="utf-8")
            m15_path.write_text(json.dumps(rec_15, ensure_ascii=False), encoding="utf-8")

            base = {"symbol": disp_upper, "slug": slug, "yf": yf_sym, "aliases": []}
            if disp_upper in existing_meta:
                keep = existing_meta[disp_upper]
                # keep optional fields (name/type/market/aliases) if present
                for k in ["name","type","market","aliases"]:
                    if k in keep and keep[k]:
                        base[k] = keep[k]
            assets_meta.append(base)

            ok += 1
            print(f"OK daily -> {daily_path.as_posix()} (rows={len(rec_d)})")
            print(f"OK 15m  -> {m15_path.as_posix()} (rows={len(rec_15)})")

        except Exception as e:
            fail += 1
            print(f"FAIL {disp_upper} ({yf_sym}): {e}")

    # Write metadata files (always)
    assets_meta = sorted({a["symbol"]: a for a in assets_meta}.values(), key=lambda x: x["symbol"])
    ASSETS_FILE.write_text(json.dumps(assets_meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # Write tickers.json in the NEW schema (keep your manual edits if you want)
    tickers_out = {
        "symbols": sorted(list(set(symbols))),
        "aliases": {k: v for k, v in sorted(aliases.items())},
        "yf": {k: v for k, v in sorted(yf_map.items())},
        "updated_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    TICKERS_FILE.write_text(json.dumps(tickers_out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nDone: ok={ok} fail={fail}")

    # Exit policy: only fail the job if EVERYTHING failed
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
