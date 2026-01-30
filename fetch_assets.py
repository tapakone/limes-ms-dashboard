#!/usr/bin/env python3
"""
fetch_assets.py

- อ่าน tickers.json (รูปแบบ {"tickers":[{"key":"JEPQ","yahoo":"JEPQ","name":"..."} , ...]})
- ดึงข้อมูลจาก Yahoo Finance ผ่าน yfinance แล้วเซฟเป็น:
    data/<slug>_daily.json
    data/<slug>_15m.json
  โดย <slug> = key แบบ lower (เช่น "JEPQ" -> "jepq")

กัน "กราฟหาย" เวลา Yahoo ส่งข้อมูลว่าง:
- ถ้าดึงได้ข้อมูลน้อย/ว่าง จะ "ไม่เขียนทับ" ไฟล์เดิมที่มีอยู่แล้ว (คงไฟล์เก่าไว้)
- Workflow จะไม่ล้ม (exit 0) แม้บางตัวดึงไม่ได้

หมายเหตุ:
- XAUUSD ใช้ Yahoo symbol "GC=F" (Gold Futures) เพราะ XAUUSD=X ไม่เสถียร
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Dict, Any, Tuple, Optional, List

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
TICKERS_FILE = ROOT / "tickers.json"

MIN_ROWS_DAILY = 40
MIN_ROWS_15M = 60


def safe_slug(s: str) -> str:
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9_\-]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s or "asset"


def load_tickers() -> List[Dict[str, Any]]:
    if not TICKERS_FILE.exists():
        return []
    obj = json.loads(TICKERS_FILE.read_text(encoding="utf-8"))
    return obj.get("tickers", []) or []


def fetch_history(yahoo_symbol: str, interval: str, period: str) -> pd.DataFrame:
    last_err: Optional[Exception] = None
    for attempt in range(3):
        try:
            df = yf.download(
                yahoo_symbol,
                interval=interval,
                period=period,
                auto_adjust=False,
                progress=False,
                threads=False,
            )
            if isinstance(df, pd.DataFrame) and len(df) > 0:
                return df
            time.sleep(1.5 * (attempt + 1))
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    if last_err:
        raise last_err
    return pd.DataFrame()


def df_to_payload(df: pd.DataFrame) -> Dict[str, Any]:
    df2 = df.copy()

    # flatten multiindex if any
    if isinstance(df2.columns, pd.MultiIndex):
        df2.columns = [c[0] for c in df2.columns]

    df2 = df2.dropna(subset=["Close"])
    idx = pd.to_datetime(df2.index)

    def col(name: str):
        if name in df2.columns:
            return [float(x) if pd.notna(x) else None for x in df2[name].tolist()]
        return [None] * len(df2)

    return {
        "t": [t.isoformat() for t in idx.to_pydatetime()],
        "o": col("Open"),
        "h": col("High"),
        "l": col("Low"),
        "c": col("Close"),
        "v": col("Volume"),
        "rows": int(len(df2)),
        "updated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def write_payload_safely(path: Path, payload: Dict[str, Any], min_rows: int) -> Tuple[bool, str]:
    rows = int(payload.get("rows", 0))
    if rows >= min_rows:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return True, f"OK -> {path.as_posix()} (rows={rows})"

    # ถ้าข้อมูลสั้น/ว่าง: เขียนเฉพาะกรณีไฟล์ยังไม่เคยมี
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return True, f"NEW but short -> {path.as_posix()} (rows={rows})"

    # มีไฟล์เดิมอยู่แล้ว: ไม่เขียนทับ
    return False, f"SKIP overwrite (too short rows={rows}) keep existing {path.as_posix()}"


def main() -> int:
    tickers = load_tickers()
    if not tickers:
        print("No tickers in tickers.json")
        return 0

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    failures: List[str] = []
    for t in tickers:
        key = str(t.get("key", "")).strip()
        yahoo = str(t.get("yahoo", "")).strip() or key
        if not key:
            continue

        slug = safe_slug(key)

        # daily
        try:
            df_d = fetch_history(yahoo, interval="1d", period="6mo")
            payload_d = df_to_payload(df_d)
            _, msg = write_payload_safely(DATA_DIR / f"{slug}_daily.json", payload_d, MIN_ROWS_DAILY)
            print(msg)
        except Exception as e:
            failures.append(f"{key} daily: {e}")
            print(f"FAIL daily {key}: {e}")

        # 15m
        try:
            df_15 = fetch_history(yahoo, interval="15m", period="7d")
            payload_15 = df_to_payload(df_15)
            _, msg = write_payload_safely(DATA_DIR / f"{slug}_15m.json", payload_15, MIN_ROWS_15M)
            print(msg)
        except Exception as e:
            failures.append(f"{key} 15m: {e}")
            print(f"FAIL 15m {key}: {e}")

    if failures:
        print("\n--- Failures (non-fatal) ---")
        for f in failures:
            print(" -", f)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
