#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import json
import time
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf


DATA_DIR = "data"
TICKERS_FILE = "tickers.json"


def _load_json(path: str):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_json(path: str, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def _ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def _parse_tickers_config(cfg: dict | None):
    """
    รองรับหลายรูปแบบ (กันพังเวลาไฟล์คุณเปลี่ยน format)
    - {"tickers":[...], "aliases":{...}}
    - {"assets":[...], "aliases":{...}}
    - ["JEPQ","NVDA",...]
    """
    tickers = []
    aliases = {}

    if cfg is None:
        return tickers, aliases

    if isinstance(cfg, list):
        tickers = [str(x).strip() for x in cfg if str(x).strip()]
        return tickers, aliases

    if isinstance(cfg, dict):
        aliases = cfg.get("aliases") or cfg.get("alias") or {}
        if not isinstance(aliases, dict):
            aliases = {}

        if "tickers" in cfg and isinstance(cfg["tickers"], list):
            tickers = [str(x).strip() for x in cfg["tickers"] if str(x).strip()]
        elif "assets" in cfg and isinstance(cfg["assets"], list):
            tickers = [str(x).strip() for x in cfg["assets"] if str(x).strip()]
        elif "symbols" in cfg and isinstance(cfg["symbols"], list):
            tickers = [str(x).strip() for x in cfg["symbols"] if str(x).strip()]

    return tickers, aliases


def _normalize_symbol(user_symbol: str, aliases: dict):
    s = (user_symbol or "").strip()
    if not s:
        return "", ""
    key = s.upper()
    # map พิมพ์ย่อแบบ XAUUSD -> GC=F, BTC -> BTC-USD ฯลฯ
    mapped = aliases.get(key) or aliases.get(s) or s
    return s, mapped


def _download(symbol: str, interval: str, period: str, retries: int = 3, sleep_sec: float = 1.2):
    last_err = None
    for i in range(retries):
        try:
            df = yf.download(
                symbol,
                interval=interval,
                period=period,
                auto_adjust=False,
                progress=False,
                threads=False,
            )
            if df is None or len(df) == 0:
                raise RuntimeError(f"Empty dataframe for {symbol} interval={interval} period={period}")
            # ทำให้เป็นคอลัมน์มาตรฐาน
            df = df.reset_index()
            # yahoo บางทีชื่อคอลัมน์เป็น 'Datetime' หรือ 'Date'
            if "Datetime" in df.columns:
                df.rename(columns={"Datetime": "Time"}, inplace=True)
            elif "Date" in df.columns:
                df.rename(columns={"Date": "Time"}, inplace=True)

            # บังคับ Time เป็น ISO string (UTC)
            if "Time" in df.columns:
                # ถ้ามี tz อยู่แล้วอย่า tz_localize ซ้ำ
                t = pd.to_datetime(df["Time"], errors="coerce", utc=True)
                df["Time"] = t.dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            return df
        except Exception as e:
            last_err = e
            if i < retries - 1:
                time.sleep(sleep_sec * (i + 1))
            continue
    raise last_err


def _to_payload(df: pd.DataFrame):
    """
    payload สำหรับ frontend:
    { "t":[...], "o":[...], "h":[...], "l":[...], "c":[...], "v":[...] }
    """
    # yahoo บางครั้งคอลัมน์ Volume ไม่มีในบางสินทรัพย์
    t = df["Time"].tolist() if "Time" in df.columns else []
    def col(name):
        return df[name].astype(float).round(6).tolist() if name in df.columns else [None] * len(t)
    payload = {
        "t": t,
        "o": col("Open"),
        "h": col("High"),
        "l": col("Low"),
        "c": col("Close"),
        "v": df["Volume"].astype(float).round(6).tolist() if "Volume" in df.columns else [0] * len(t),
        "rows": len(t),
        "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return payload


def _write_if_valid(path: str, payload: dict, min_rows: int = 20):
    """
    กันกราฟหาย: ถ้าดึงได้ rows น้อย/ว่าง จะ "ไม่เขียนทับ" ไฟล์เดิม
    """
    rows = int(payload.get("rows") or 0)
    if rows < min_rows:
        print(f"SKIP write (too few rows={rows}) -> {path}")
        return False

    # sanity: ต้องมี close
    c = payload.get("c") or []
    if not isinstance(c, list) or len(c) != rows:
        print(f"SKIP write (bad close array) -> {path}")
        return False

    _save_json(path, payload)
    return True


def main():
    _ensure_data_dir()

    cfg = _load_json(TICKERS_FILE)
    tickers, aliases = _parse_tickers_config(cfg)

    if not tickers:
        # fallback กันพัง
        tickers = ["JEPQ", "QQQ", "VOO", "NVDA", "TSLA", "GOOGL", "AMD", "SCHD", "JNJ", "BTC-USD", "ETH-USD", "GC=F"]

    # aliases แนะนำ (เติมทับได้ใน tickers.json)
    default_aliases = {
        "XAUUSD": "GC=F",   # GOLD FUTURES
        "GOLD": "GC=F",
        "BTC": "BTC-USD",
        "ETH": "ETH-USD",
        "MAG7": "MAGS",     # ถ้าคุณใช้ ETF MAGS
        "MAGY": "MAGS",
    }
    # merge aliases (ไฟล์มีสิทธิ์ override)
    for k, v in default_aliases.items():
        if k not in aliases:
            aliases[k] = v

    failed = []

    for user_sym in tickers:
        disp, yf_sym = _normalize_symbol(user_sym, aliases)
        if not yf_sym:
            continue

        slug = disp.lower().replace("/", "-").replace("^", "").replace("=", "").replace(" ", "")
        daily_path = os.path.join(DATA_DIR, f"{slug}_daily.json")
        m15_path = os.path.join(DATA_DIR, f"{slug}_15m.json")

        try:
            # daily ~ 6 เดือน
            df_d = _download(yf_sym, interval="1d", period="6mo")
            payload_d = _to_payload(df_d)
            ok_d = _write_if_valid(daily_path, payload_d, min_rows=30)
            print(f"OK daily -> {daily_path} (rows={payload_d['rows']}) write={ok_d}")
        except Exception as e:
            failed.append((disp, "daily", str(e)))
            print(f"FAIL daily {disp}: {e}")

        try:
            # 15m ~ 7 วัน
            df_15 = _download(yf_sym, interval="15m", period="7d")
            payload_15 = _to_payload(df_15)
            ok_15 = _write_if_valid(m15_path, payload_15, min_rows=50)
            print(f"OK 15m  -> {m15_path} (rows={payload_15['rows']}) write={ok_15}")
        except Exception as e:
            failed.append((disp, "15m", str(e)))
            print(f"FAIL 15m {disp}: {e}")

    # ไม่ทำให้ workflow fail ทั้งหมด (กัน yahoo งอแง)
    if failed:
        print("\n--- Summary (some downloads failed, workflow will still succeed) ---")
        for sym, tf, err in failed:
            print(f"- {sym} {tf}: {err}")
    else:
        print("\nAll assets updated successfully.")


if __name__ == "__main__":
    main()
