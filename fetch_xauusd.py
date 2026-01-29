import json
import os
from datetime import datetime, timedelta, time
import pytz

import yfinance as yf
import pandas as pd

TZ = pytz.timezone("Asia/Bangkok")

DATA_DIR = "data"
FILE_15M = os.path.join(DATA_DIR, "xauusd_15m.json")
FILE_DAILY = os.path.join(DATA_DIR, "xauusd_daily.json")


def _safe_mkdir(path: str):
    os.makedirs(path, exist_ok=True)


def _iso_z(dt: pd.Timestamp) -> str:
    # Keep timezone info in ISO string
    if dt.tzinfo is None:
        return dt.to_pydatetime().replace(tzinfo=pytz.UTC).isoformat()
    return dt.to_pydatetime().isoformat()


def _write_json(path: str, payload: dict):
    _safe_mkdir(os.path.dirname(path))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)


def _read_json_if_exists(path: str):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _yf_download_first_available(tickers, interval, period) -> pd.DataFrame:
    """
    Try multiple tickers and return first non-empty dataframe with Close.
    """
    last_err = None
    for t in tickers:
        try:
            df = yf.download(
                t,
                interval=interval,
                period=period,
                auto_adjust=False,
                progress=False,
                threads=False,
            )
            if df is None or df.empty:
                continue
            # Sometimes columns are multiindex; normalize
            if isinstance(df.columns, pd.MultiIndex):
                # yfinance may return like ('Close', 'XAUUSD=X')
                if ("Close", t) in df.columns:
                    df = df[[("Close", t)]].rename(columns={("Close", t): "Close"})
                elif "Close" in df.columns.get_level_values(0):
                    # take first Close column
                    close_cols = [c for c in df.columns if c[0] == "Close"]
                    df = df[[close_cols[0]]]
                    df.columns = ["Close"]
                else:
                    continue
            else:
                if "Close" not in df.columns:
                    continue
                df = df[["Close"]]

            df = df.dropna()
            if df.empty:
                continue

            # Ensure index is tz-aware; yfinance often gives tz-aware already for intraday
            idx = df.index
            if getattr(idx, "tz", None) is None:
                # assume UTC
                df.index = df.index.tz_localize("UTC")
            return df
        except Exception as e:
            last_err = e
            continue

    if last_err:
        raise last_err
    return pd.DataFrame()


def _compute_day0_ref_04th_from_15m(df15m: pd.DataFrame) -> float | None:
    """
    Find the close nearest to 04:00 Thailand time of the latest date present.
    """
    try:
        # Convert index to Bangkok
        dft = df15m.copy()
        dft.index = dft.index.tz_convert(TZ)

        if dft.empty:
            return None

        latest_dt = dft.index.max()
        target_date = latest_dt.date()

        target_dt = TZ.localize(datetime.combine(target_date, time(4, 0)))
        # Find nearest timestamp
        diffs = (dft.index - target_dt).to_series().abs()
        nearest_idx = diffs.idxmin()
        val = float(dft.loc[nearest_idx, "Close"])
        return val
    except Exception:
        return None


def _to_payload(df: pd.DataFrame, extra: dict | None = None) -> dict:
    ts = [_iso_z(pd.Timestamp(i).to_pydatetime().astimezone(pytz.UTC) if pd.Timestamp(i).tzinfo else pd.Timestamp(i)) for i in df.index]
    close = [float(x) for x in df["Close"].tolist()]
    out = {"timestamps": ts, "close": close}
    if extra:
        out.update(extra)
    return out


def main():
    # Try XAUUSD spot first; fallback to Gold futures
    tickers_spot = ["XAUUSD=X", "XAUUSD", "XAUUSDUSD=X"]
    tickers_fallback = ["GC=F"]  # Gold futures on Yahoo

    # ---- 15m (rolling 7d) ----
    prev15 = _read_json_if_exists(FILE_15M)
    try:
        df15 = _yf_download_first_available(tickers_spot + tickers_fallback, interval="15m", period="7d")
        day0 = _compute_day0_ref_04th_from_15m(df15)
        payload15 = _to_payload(df15, extra={"day0_ref_04th": day0})
        # DO NOT overwrite with empty
        if len(payload15["timestamps"]) >= 10:
            _write_json(FILE_15M, payload15)
        else:
            # keep previous
            if prev15 is None:
                _write_json(FILE_15M, {"timestamps": [], "close": []})
    except Exception as e:
        # keep previous; only create empty if nothing exists
        if prev15 is None:
            _write_json(FILE_15M, {"timestamps": [], "close": []})
        print(f"[WARN] 15m fetch failed: {e}")

    # ---- daily (rolling 180d) ----
    prevd = _read_json_if_exists(FILE_DAILY)
    try:
        dfd = _yf_download_first_available(tickers_spot + tickers_fallback, interval="1d", period="180d")
        payloadd = _to_payload(dfd)
        if len(payloadd["timestamps"]) >= 20:
            _write_json(FILE_DAILY, payloadd)
        else:
            if prevd is None:
                _write_json(FILE_DAILY, {"timestamps": [], "close": []})
    except Exception as e:
        if prevd is None:
            _write_json(FILE_DAILY, {"timestamps": [], "close": []})
        print(f"[WARN] daily fetch failed: {e}")


if __name__ == "__main__":
    main()
