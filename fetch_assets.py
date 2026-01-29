#!/usr/bin/env python3
"""
Fetch price history for multiple assets and write JSON files into /data for GitHub Pages.

- Asset list is defined in assets.json (repo root).
- For each asset, we try its ticker candidates in order until yfinance returns data.
- Outputs:
    data/<asset_id>_15m.json   (7d of 15m)
    data/<asset_id>_daily.json (180d of 1d)
JSON schema:
{
  "asset_id": "xauusd",
  "label": "Gold (spot)",
  "resolved_symbol": "XAUUSD=X",
  "interval": "15m",
  "period": "7d",
  "timestamps": ["2026-01-29T07:00:00Z", ...],
  "close": [5568.1, ...]
}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent
ASSETS_FILE = ROOT / "assets.json"
DATA_DIR = ROOT / "data"


def _to_iso_utc(ts: pd.Timestamp) -> str:
    if ts.tzinfo is None:
        ts = ts.tz_localize("UTC")
    else:
        ts = ts.tz_convert("UTC")
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _normalize_index_utc(df: pd.DataFrame) -> pd.DataFrame:
    idx = df.index
    df = df.copy()
    if getattr(idx, "tz", None) is None:
        df.index = idx.tz_localize("UTC")
    else:
        df.index = idx.tz_convert("UTC")
    return df


def fetch_one(symbol: str, interval: str, period: str) -> Optional[pd.DataFrame]:
    try:
        df = yf.download(
            tickers=symbol,
            interval=interval,
            period=period,
            progress=False,
            auto_adjust=True,
            threads=False,
        )
    except Exception as e:
        print(f"[WARN] yfinance exception for {symbol} {interval}/{period}: {e}", file=sys.stderr)
        return None

    if df is None or df.empty:
        return None

    if isinstance(df.columns, pd.MultiIndex):
        # If multiindex happens, attempt to reduce (should be rare with single ticker)
        try:
            df = df.xs(symbol, axis=1, level=-1, drop_level=True)
        except Exception:
            pass

    if "Close" not in df.columns:
        return None

    df = _normalize_index_utc(df)
    df = df.dropna(subset=["Close"])
    if df.empty:
        return None
    return df


def try_candidates(candidates: List[str], interval: str, period: str) -> Tuple[Optional[str], Optional[pd.DataFrame]]:
    for sym in candidates:
        df = fetch_one(sym, interval=interval, period=period)
        if df is not None and not df.empty:
            return sym, df
    return None, None


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    if not ASSETS_FILE.exists():
        print(f"[ERROR] assets.json not found at {ASSETS_FILE}", file=sys.stderr)
        return 2

    assets = json.loads(ASSETS_FILE.read_text(encoding="utf-8"))
    if not isinstance(assets, list) or not assets:
        print("[ERROR] assets.json must be a non-empty JSON array.", file=sys.stderr)
        return 2

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    failures: List[str] = []

    for a in assets:
        asset_id = a.get("id")
        label = a.get("label", asset_id)
        candidates = a.get("tickers") or []
        if not asset_id or not isinstance(candidates, list) or not candidates:
            print(f"[WARN] skipping invalid asset entry: {a}", file=sys.stderr)
            continue

        # 15m (7d)
        sym15, df15 = try_candidates(candidates, interval="15m", period="7d")
        if df15 is None:
            failures.append(f"{asset_id} (15m)")
            write_json(DATA_DIR / f"{asset_id}_15m.json", {
                "asset_id": asset_id, "label": label, "resolved_symbol": sym15,
                "interval": "15m", "period": "7d", "timestamps": [], "close": []
            })
        else:
            write_json(DATA_DIR / f"{asset_id}_15m.json", {
                "asset_id": asset_id,
                "label": label,
                "resolved_symbol": sym15,
                "interval": "15m",
                "period": "7d",
                "timestamps": [_to_iso_utc(pd.Timestamp(x)) for x in df15.index],
                "close": [float(x) for x in df15["Close"].astype(float).tolist()],
            })

        # daily (180d)
        symd, dfd = try_candidates(candidates, interval="1d", period="180d")
        if dfd is None:
            failures.append(f"{asset_id} (daily)")
            write_json(DATA_DIR / f"{asset_id}_daily.json", {
                "asset_id": asset_id, "label": label, "resolved_symbol": symd,
                "interval": "1d", "period": "180d", "timestamps": [], "close": []
            })
        else:
            write_json(DATA_DIR / f"{asset_id}_daily.json", {
                "asset_id": asset_id,
                "label": label,
                "resolved_symbol": symd,
                "interval": "1d",
                "period": "180d",
                "timestamps": [_to_iso_utc(pd.Timestamp(x)) for x in dfd.index],
                "close": [float(x) for x in dfd["Close"].astype(float).tolist()],
            })

        print(f"[OK] {asset_id}: 15m={len(df15) if df15 is not None else 0}, daily={len(dfd) if dfd is not None else 0}")

    if failures:
        # ไม่ทำให้ workflow fail ทั้งก้อน เพื่อให้ตัวอื่นยังขึ้นได้
        print("[WARN] Some assets failed to fetch:", ", ".join(failures), file=sys.stderr)
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
