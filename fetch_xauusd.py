import yfinance as yf
import pandas as pd
import json
from datetime import datetime
import pytz
import os

# timezone ไทย
tz = pytz.timezone("Asia/Bangkok")

# ดึงราคา XAUUSD
ticker = yf.Ticker("XAUUSD=X")
df = ticker.history(period="5d", interval="15m")

if df.empty:
    raise Exception("No data from yfinance")

df = df.reset_index()

data = []
for _, r in df.iterrows():
    data.append({
        "time": r["Datetime"].tz_convert(tz).isoformat(),
        "price": round(float(r["Close"]), 2)
    })

os.makedirs("data", exist_ok=True)

with open("data/xauusd_15m.json", "w") as f:
    json.dump(data, f, indent=2)

print("Saved data/xauusd_15m.json")
