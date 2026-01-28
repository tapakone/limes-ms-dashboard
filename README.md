# LIMES MS — XAUUSD (Gold) (Static + Auto Data)

โปรเจกต์นี้เป็นเว็บแอพแบบ Static (รันบน GitHub Pages ได้) ที่:
- แสดงกราฟ LIMES MS เวอร์ชัน “เต็ม” (กราฟซ้าย + พาแนลขวา)
- อัปเดตข้อมูลทุก 15 นาทีด้วย GitHub Actions (ไม่ต้องเปิดเครื่องทิ้ง)
- ใช้ข้อมูล XAUUSD จาก Yahoo Finance ผ่าน `yfinance` (รันในฝั่ง Action แล้วเซฟเป็น JSON ใน repo)

> หมายเหตุ: โค้ดนี้เป็น “โครงใช้งานจริง” (รันได้จริง) และคุณสามารถปรับสูตร risk / forecast ให้ตรงนิยาม LIMES MS ของคุณได้ต่อ

---

## โครงไฟล์
- `index.html` หน้าเว็บ
- `style.css` ธีม/เลย์เอาต์
- `script.js` วาดกราฟ + คำนวณ risk/forecast
- `fetch_xauusd.py` สคริปต์ฝั่ง Action: ดึงราคาจาก Yahoo Finance แล้วสร้างไฟล์ JSON
- `.github/workflows/fetch_xauusd.yml` ตั้ง schedule ทุก 15 นาที + push JSON กลับเข้า repo
- `data/` โฟลเดอร์เก็บ JSON (Action จะสร้าง/อัปเดตให้)

---

## วิธีอัปขึ้น GitHub (มือถือ/ไอแพดก็ทำได้)
1) เข้า repo ของคุณบน GitHub  
2) กด **Add file → Upload files**  
3) อัปโหลด “ทั้งโฟลเดอร์/ไฟล์” ตามรายการด้านล่างให้ครบ:
   - index.html
   - style.css
   - script.js
   - fetch_xauusd.py
   - (โฟลเดอร์) .github/workflows/fetch_xauusd.yml
   - (โฟลเดอร์) data/ (ว่างก็ได้)
4) กด Commit

---

## เปิด GitHub Pages
1) ไปที่ **Settings → Pages**  
2) Source: **Deploy from a branch**  
3) Branch: **main** และ folder: **/(root)**  
4) กด Save  
5) URL จะเป็น `https://<username>.github.io/<repo>/`

---

## ถ้าหน้าเว็บขึ้น แต่ไม่มีข้อมูล
ให้รอ 1–2 รอบ schedule ของ Actions (15 นาที) หรือเข้าแท็บ **Actions** ดูว่า workflow “Fetch XAUUSD data” รันผ่านไหม

---

## กติกาเวลา (ตามที่คุณกำหนด)
- ระบบนี้ “อัปเดตข้อมูลทุก 15 นาที” (ตาม workflow)
- ค่า Day 0 ref (04:00 TH): สคริปต์จะพยายามหา “ราคาใกล้ 04:00 เวลาไทย” จากข้อมูล intraday เพื่อใช้เป็น anchor

---

## การกระพริบสีแดง
ถ้า score ใด ๆ (D/2H/1H หรือ human) >= 4.5 จะกระพริบสีแดงที่ STATE และปุ่ม HIGH RISK ตามสเปคที่คุณขอ
