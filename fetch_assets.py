#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch data and write JSON for the LIMES MS dashboard.

สำคัญสุด:
- ไฟล์ใน /data ตั้งชื่อตาม "symbol ที่ผู้ใช้พิมพ์" (display symbol) เสมอ
- ถ้าต้องใช้ Yahoo symbol คนละตัว ให้ map ผ่าน aliases ใน tickers.json

ตัวอย่าง:
- ผู้ใช้พิมพ์ XAUUSD  -> data/xauusd_daily.json และ data/xauusd_15m.json
- แต่ไปโหลด Yahoo ด้วย GC=F (จาก aliases)

แบบนี้จะไม่เกิดอาการ "ทองขึ้นแต่หุ้นไม่ขึ้น / หุ้นขึ้นแต่ทองไม่ขึ้น" เพราะชื่อไฟล์ตรงกันทั้งหน้าเว็บและ backend
"""

from __future__ import annotations

import json
import os
import re
from typing import Dict, List, Tuple, Optional

import pandas as pd
import yfinance as yf

TZ_TH = "Asia/Bangkok"


def slugify(sym: str) -> str:
    s = sym.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"^-+|-+$", "", s)
    return s


def ensure_tz(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    if getattr(idx, "tz", None) is None:
        return idx.tz_localize("UTC").tz_convert(TZ_TH)
    return idx.tz_convert(TZ_TH)


def df_to_rows(df: pd.DataFrame) -> List[dict]:
    idx = ensure_tz(df.index)
    out = []
    for t, c in zip(idx, df["Close"].astype(float).tolist()):
        out.append({"time": t.isoformat(), "close": float(c)})
    return out


def write_json(path: str, obj: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def load_tickers(path: str = "tickers.json") -> Tuple[Dict[str, str], List[str]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    aliases = (data.get("aliases") or {})

    tickers_raw = data.get("tickers") or []
    display_syms: List[str] = []
    for t in tickers_raw:
        if isinstance(t, dict):
            s = t.get("symbol")
        else:
            s = str(t)
        if s:
            display_syms.append(s.strip())

    # de-dup keep order
    seen = set()
    ordered = []
    for s in display_syms:
        if s not in seen:
            seen.add(s)
            ordered.append(s)
    return aliases, ordered


def download_one(yahoo_symbol: str, interval: str, period: str) -> Optional[pd.DataFrame]:
    try:
        df = yf.download(
            tickers=yahoo_symbol,
            interval=interval,
            period=period,
            progress=False,
            auto_adjust=False,
            threads=False,
        )
        if df is None or df.empty:
            return None

        # if multi-index columns
        if isinstance(df.columns, pd.MultiIndex):
            df = df.xs(yahoo_symbol, axis=1, level=0, drop_level=True)

        if "Close" not in df.columns:
            return None
        df = df.dropna(subset=["Close"])
        return None if df.empty else df
    except Exception:
        return None


def main() -> int:
    aliases, display_symbols = load_tickers("tickers.json")

    now_th = pd.Timestamp.now(tz=TZ_TH)
    ref = now_th.normalize() + pd.Timedelta(hours=4)
    ref_th = ref.strftime("%d %b %Y %H:%M")

    for disp in display_symbols:
        yahoo = aliases.get(disp.upper(), disp)
        slug = slugify(disp)
        daily_path = os.path.join("data", f"{slug}_daily.json")
        m15_path = os.path.join("data", f"{slug}_15m.json")

        df_daily = download_one(yahoo, interval="1d", period="180d")
        df_15m = download_one(yahoo, interval="15m", period="7d")

        if df_daily is None or df_15m is None:
            # เขียนไฟล์ว่างไว้ก่อน หน้าเว็บจะขึ้นข้อความว่า JSON ยังว่าง/สั้นเกินไป
            write_json(daily_path, {"symbol": disp, "yahoo": yahoo, "ref_th": ref_th, "rows": []})
            write_json(m15_path, {"symbol": disp, "yahoo": yahoo, "ref_th": ref_th, "rows": []})
            print(f"WARN {disp}: no data (yahoo={yahoo})")
            continue

        daily_rows = df_to_rows(df_daily)
        m15_rows = df_to_rows(df_15m)

        write_json(daily_path, {"symbol": disp, "yahoo": yahoo, "ref_th": ref_th, "rows": daily_rows})
        write_json(m15_path, {"symbol": disp, "yahoo": yahoo, "ref_th": ref_th, "rows": m15_rows})
        print(f"OK   {disp} -> {daily_path} ({len(daily_rows)}), {m15_path} ({len(m15_rows)})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
