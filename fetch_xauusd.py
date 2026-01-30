import os, json
from datetime import datetime, timezone
import pandas as pd
import yfinance as yf

DATA_DIR = os.environ.get("DATA_DIR", "data")
os.makedirs(DATA_DIR, exist_ok=True)

def now_iso_utc():
    return datetime.now(timezone.utc).isoformat()

def to_iso_index(df: pd.DataFrame) -> pd.DataFrame:
    # Ensure an ISO-8601 UTC string column "t" for the frontend
    idx = df.index
    if getattr(idx, "tz", None) is None:
        idx = idx.tz_localize("UTC")
    else:
        idx = idx.tz_convert("UTC")
    out = df.copy()
    out["t"] = idx.strftime("%Y-%m-%dT%H:%M:%SZ")
    return out

def fetch_one(symbol: str, interval: str, period: str) -> pd.DataFrame:
    df = yf.download(symbol, interval=interval, period=period, progress=False, auto_adjust=False, threads=False)
    if df is None or df.empty:
        return pd.DataFrame()
    # yfinance can return multi-index cols; normalize
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    if "Close" not in df.columns:
        return pd.DataFrame()
    df = df[["Close"]].dropna()
    return df

def write_json(path: str, rows: list, meta: dict):
    payload = {"meta": meta, "rows": rows}
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)

def safe_update(symbol_alias: str, candidates: list[str]):
    """Fetch daily+15m. If fails, keep existing files and exit OK."""
    meta_base = {
        "symbol": symbol_alias,
        "updated_utc": now_iso_utc(),
        "source": "Yahoo Finance via yfinance",
        "candidates": candidates,
    }

    def try_fetch(interval, period):
        for sym in candidates:
            try:
                df = fetch_one(sym, interval=interval, period=period)
                if df is not None and not df.empty and len(df) >= 10:
                    meta = dict(meta_base)
                    meta["symbol_used"] = sym
                    meta["interval"] = interval
                    meta["period"] = period
                    df = to_iso_index(df)
                    rows = [{"t": r.t, "c": float(r.Close)} for r in df.itertuples()]
                    return sym, rows, meta
            except Exception as e:
                print(f"WARN: {sym} {interval} {period} failed: {e}")
        return None, [], None

    # Daily
    used_d, rows_d, meta_d = try_fetch("1d", "6mo")
    # 15m
    used_15, rows_15, meta_15 = try_fetch("15m", "7d")

    base = symbol_alias.lower().replace("=", "").replace("^", "").replace("-", "_")
    out_daily = os.path.join(DATA_DIR, f"{base}_daily.json")
    out_15m = os.path.join(DATA_DIR, f"{base}_15m.json")

    if rows_d and meta_d:
        write_json(out_daily, rows_d, meta_d)
        print(f"OK daily -> {out_daily} (rows={len(rows_d)}) used={used_d}")
    else:
        print(f"WARN daily: no data for {symbol_alias}. Keeping existing file if present.")

    if rows_15 and meta_15:
        write_json(out_15m, rows_15, meta_15)
        print(f"OK 15m -> {out_15m} (rows={len(rows_15)}) used={used_15}")
    else:
        print(f"WARN 15m: no data for {symbol_alias}. Keeping existing file if present.")

if __name__ == "__main__":
    # Primary gold spot pair often used on Yahoo; if blocked, fall back to GC=F.
    symbol_alias = os.environ.get("SYMBOL", "XAUUSD")
    candidates = os.environ.get("CANDIDATES", "XAUUSD=X,GC=F").split(",")
    candidates = [c.strip() for c in candidates if c.strip()]
    safe_update(symbol_alias, candidates)
    # Always exit 0 so Pages keeps serving last good data.
