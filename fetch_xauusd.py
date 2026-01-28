import json
import os
import datetime
import yfinance as yf

# ensure data dir exists
os.makedirs("data", exist_ok=True)

symbol = "XAUUSD=X"
ticker = yf.Ticker(symbol)

# ดึงข้อมูลย้อนหลัง 2 วัน (พอสำหรับ D / intraday)
hist = ticker.history(period="2d", interval="15m")

prices = hist["Close"].dropna().tolist()
timestamps = [str(ts) for ts in hist.index]

now_th = datetime.datetime.utcnow() + datetime.timedelta(hours=7)

data = {
    "symbol": "XAUUSD",
    "updated_th": now_th.strftime("%Y-%m-%d %H:%M:%S"),
    "prices": prices,
    "timestamps": timestamps,
    "latest": prices[-1] if prices else None
}

with open("data/xauusd.json", "w") as f:
    json.dump(data, f, indent=2)

print("Saved data/xauusd.json")
