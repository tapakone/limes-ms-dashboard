import yfinance as yf
import pandas as pd
from datetime import datetime
import pytz
import json
import os

tz = pytz.timezone("Asia/Bangkok")

ticker = yf.Ticker("XAUUSD=X")
df = ticker.history(period="2d", interval="15m")

df = df.reset_index()
df["Datetime"] = df["Datetime"].dt.tz_convert(tz)

latest = df.iloc[-1]

output = {
    "symbol": "XAUUSD",
    "source": "Yahoo Finance",
    "updated_th": latest["Datetime"].strftime("%Y-%m-%d %H:%M"),
    "price": round(float(latest["Close"]), 2),
    "data": [
        {
            "time": row["Datetime"].strftime("%Y-%m-%d %H:%M"),
            "price": round(float(row["Close"]), 2)
        }
        for _, row in df.iterrows()
    ]
}

os.makedirs("data", exist_ok=True)

with open("data/xauusd.json", "w") as f:
    json.dump(output, f, indent=2)
