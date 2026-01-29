import json
import os
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf


OUT_DIR = "data"
OUT_15M = os.path.join(OUT_DIR, "xauusd_15m.json")
OUT_DAILY = os.path.join(OUT_DIR, "xauusd_daily.json")

# Primary + fallback tickers
# XAUUSD=X sometimes fails on Yahoo. GC=F (Gold Futures) is a reliable fallback.
TICKERS = ["XAUUSD=X", "GC=F"]


def _download_first_available(period: str, interval: str) -> tuple[str, pd.DataFrame]:
    """
    Try tickers in order; return (ticker_used, df) for the first one that yields non-empty data.
    """
    last_err = None
    for t in TICKERS:
        try:
            df = yf.download(
                t,
                period=period,
                interval=interval,
                progress=False,
                auto_adjust=False,
                threads=False,
            )

            # Normalize columns: yfinance sometimes returns multiindex columns
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = [c[0] for c in df.columns]

            if df is None or df.empty:
                continue

            # Ensure Close exists and has data
            if "Close" not in df.columns:
                continue
            df = df.dropna(subset=["Close"])
            if df.empty:
                continue

            return t, df

        except Exception as e:
            last_err = e
            continue

    # If all failed
    if last_err:
        raise RuntimeError(f"All tickers failed for period={period}, interval={interval}. Last error: {last_err}")
    raise RuntimeError(f"No data found for any ticker for period={period}, interval={interval} (empty result).")


def _to_payload(df: pd.DataFrame, tz: str = "UTC") -> dict:
    # Convert index to ISO timestamps
    # yfinance index is typically tz-aware UTC or naive; handle both.
    idx = df.index
    timestamps = []
    closes = []

    for ts, close in zip(idx, df["Close"].tolist()):
        if pd.isna(close):
            continue
        # Convert pandas timestamp to python datetime
        if hasattr(ts, "to_pydatetime"):
            dt = ts.to_pydatetime()
        else:
            dt = ts

        # Make timezone explicit (assume UTC if naive)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        timestamps.append(dt.isoformat())
        closes.append(float(close))

    return {"timestamps": timestamps, "close": closes, "meta": {"generated_at": datetime.now(timezone.utc).isoformat(), "tz": tz}}


def _write_json(path: str, payload: dict):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


def main():
    # 15m (last ~7 days)
    t15, df15 = _download_first_available(period="7d", interval="15m")
    payload15 = _to_payload(df15)

    # Daily (last ~1y)
    td, dfd = _download_first_available(period="1y", interval="1d")
    payloadd = _to_payload(dfd)

    # IMPORTANT: Do not write empty arrays (fail instead)
    if len(payload15["timestamps"]) == 0 or len(payload15["close"]) == 0:
        raise RuntimeError(f"15m payload empty (ticker used: {t15})")
    if len(payloadd["timestamps"]) == 0 or len(payloadd["close"]) == 0:
        raise RuntimeError(f"daily payload empty (ticker used: {td})")

    _write_json(OUT_15M, payload15)
    _write_json(OUT_DAILY, payloadd)

    print(f"OK 15m: {len(payload15['close'])} points (ticker={t15})")
    print(f"OK daily: {len(payloadd['close'])} points (ticker={td})")


if __name__ == "__main__":
    main()
