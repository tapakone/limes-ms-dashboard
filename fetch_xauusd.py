import yfinance as yf
import pandas as pd
import json
from datetime import timezone
import pytz
from pathlib import Path

Path("data").mkdir(exist_ok=True)

tz = pytz.timezone("Asia/Bangkok")
ticker = yf.Ticker("XAUUSD=X")

# 15m
df15 = ticker.history(period="7d", interval="15m")
df15 = df15.dropna()
out15 = {
    "timestamps": [t.tz_convert(tz).isoformat() for t in df15.index],
    "close": df15["Close"].round(2).tolist()
}
with open("data/xauusd_15m.json", "w") as f:
    json.dump(out15, f)

# daily
dfd = ticker.history(period="180d", interval="1d")
dfd = dfd.dropna()
outd = {
    "timestamps": [t.tz_convert(tz).isoformat() for t in dfd.index],
    "close": dfd["Close"].round(2).tolist()
}
with open("data/xauusd_daily.json", "w") as f:
    json.dump(outd, f)
