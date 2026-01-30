/* LIMES MS — dashboard script (v1.2)
   - ✅ Thai time top-right
   - ✅ X-axis shows real dates (not long labels)
   - ✅ Prevent horizontal overflow
   - ✅ Bottom-right single status toast with blinking HIGH RISK
   - ✅ Risk: slope near 0 low, |slope| > 10%/day => HIGH RISK
*/

const TZ = "Asia/Bangkok";

// ------- DOM -------
const el = (id) => document.getElementById(id);

const stamp = el("stamp");
const brandTitle = el("brandTitle");
const symbolInput = el("symbolInput");
const btnLoad = el("btnLoad");

const stateBadge = el("stateBadge");
const day0El = el("day0");
const latestEl = el("latest");
const predEl = el("pred");
const slopeEl = el("slope");

const humanRiskEl = el("humanRisk");
const humanBar = el("humanBar");

const dayState = el("dayState");
const dFill = el("dFill");
const h2Fill = el("h2Fill");
const h1Fill = el("h1Fill");
const dScore = el("dScore");
const h2Score = el("h2Score");
const h1Score = el("h1Score");
const dArrow = el("dArrow");
const h2Arrow = el("h2Arrow");
const h1Arrow = el("h1Arrow");

const statusToast = el("statusToast");
const toastPill = el("toastPill");
const toastTitle = el("toastTitle");
const toastSub = el("toastSub");

// ------- Helpers -------
function fmtThaiNow() {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat("th-TH", {
    timeZone: TZ,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return fmt.format(d) + " (UTC+7)";
}

function fmtThaiDateFromISO(iso) {
  // iso: "2026-01-30T..." or "2026-01-30"
  const dt = new Date(iso);
  const fmt = new Intl.DateTimeFormat("th-TH", {
    timeZone: TZ,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(dt);
}

function fmtShortX(iso) {
  // แกนนอนให้สั้น: "30/01"
  const dt = new Date(iso);
  const fmt = new Intl.DateTimeFormat("th-TH", {
    timeZone: TZ,
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(dt);
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function setBar(fillEl, score5) {
  const pct = clamp((score5 / 5) * 100, 0, 100);
  fillEl.style.width = pct.toFixed(0) + "%";
}

function arrowFromSlope(slopePctPerDay) {
  if (slopePctPerDay > 0.25) return "↗";
  if (slopePctPerDay < -0.25) return "↘";
  return "→";
}

// ------- Risk model (ตามที่คุย: ใกล้ 0 ต่ำ, ชันมากทั้ง +/- = high risk) -------
// LOW: |slope| <= 5%/day
// WATCH: 5–10%/day
// HIGH RISK: > 10%/day  (กระพริบแดง)
function riskFromSlopeAndZ(absSlopePctPerDay, absZ) {
  // slope component: 0..5 where 10% -> 5
  const slopeScore = clamp((absSlopePctPerDay / 10) * 5, 0, 5);

  // z component: 0..5 where z=2 -> 5
  const zScore = clamp((absZ / 2) * 5, 0, 5);

  // final uses the worse one (ปลอดภัยสุด)
  const final = Math.max(slopeScore, zScore);

  let state = "BUY";
  if (final >= 3.2) state = "HIGH RISK";
  else if (final >= 1.8) state = "WATCH";
  else state = "BUY";

  // force HIGH RISK if slope very steep
  if (absSlopePctPerDay > 10) state = "HIGH RISK";

  return { score: final, state, slopeScore, zScore };
}

function paintState(state, score) {
  // side badge (ใช้ class เดิมจาก style.css ถ้ามี)
  stateBadge.textContent = state;

  // toast
  statusToast.style.display = "flex";
  toastPill.textContent = state;
  toastTitle.textContent = (currentSymbol || "—") + " — " + state;
  toastSub.textContent = `Risk score: ${score.toFixed(2)}/5`;

  // reset classes
  toastPill.classList.remove("toast-buy", "toast-watch", "toast-risk");
  statusToast.classList.remove("blink-red");

  if (state === "BUY") toastPill.classList.add("toast-buy");
  if (state === "WATCH") toastPill.classList.add("toast-watch");
  if (state === "HIGH RISK") {
    toastPill.classList.add("toast-risk");
    statusToast.classList.add("blink-red"); // ✅ กระพริบ
  }

  dayState.textContent = state;
}

// ------- Chart -------
let chart;
let currentSymbol = "XAUUSD";

function ensureChart() {
  if (chart) return chart;

  const ctx = el("chart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        { label: "Price", data: [], borderWidth: 2, pointRadius: 2, tension: 0.25 },
        { label: "MA3", data: [], borderWidth: 2, pointRadius: 0, borderDash: [4,4], tension: 0.25 },
        { label: "Upper", data: [], borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: "Lower", data: [], borderWidth: 2, pointRadius: 0, tension: 0.25 },
        { label: "Forecast+1D", data: [], borderWidth: 2, pointRadius: 0, borderDash: [6,3], tension: 0.25 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false, // ✅ ใช้ความสูงจาก CSS
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true }
      },
      scales: {
        x: {
          ticks: {
            autoSkip: true,
            maxTicksLimit: 9, // ✅ ลดจำนวน tick เพื่อไม่ให้ยาวล้น
            callback: (val, idx) => {
              const label = chart.data.labels?.[idx];
              return label ?? "";
            }
          },
          grid: { display: true }
        },
        y: {
          ticks: { maxTicksLimit: 7 },
          grid: { display: true }
        }
      }
    }
  });

  return chart;
}

// ------- Data load -------
// คาดว่าไฟล์ใน repo เป็นรูปแบบเดิม: data/<symbolLower>_daily.json และ data/<symbolLower>_15m.json
async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.json();
}

function normalizeSymbolForFile(sym) {
  // XAUUSD -> xauusd
  // PTT.BK -> ptt.bk  (ชื่อไฟล์จะมี dot ได้บน github pages)
  // BTC-USD -> btc-usd
  return sym.trim().toLowerCase();
}

function calcMA3(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i-2], b = arr[i-1], c = arr[i];
    if (i < 2) out.push(null);
    else out.push((a + b + c) / 3);
  }
  return out;
}

function calcBands(arr, ma, k=2) {
  // rolling std 10
  const win = 10;
  const upper = [];
  const lower = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < win) { upper.push(null); lower.push(null); continue; }
    const slice = arr.slice(i-win+1, i+1);
    const m = ma[i] ?? slice.reduce((s,x)=>s+x,0)/slice.length;
    const v = slice.reduce((s,x)=>s+(x-m)*(x-m),0)/slice.length;
    const sd = Math.sqrt(v);
    upper.push(m + k*sd);
    lower.push(m - k*sd);
  }
  return { upper, lower };
}

function calcSlopePctPerDay(close) {
  // slope จาก last 10 จุด (daily) แบบ linear approx
  const n = Math.min(10, close.length);
  if (n < 3) return 0;
  const y = close.slice(-n);
  const x = [...Array(n)].map((_,i)=>i);

  const xbar = x.reduce((s,v)=>s+v,0)/n;
  const ybar = y.reduce((s,v)=>s+v,0)/n;

  let num=0, den=0;
  for (let i=0;i<n;i++){
    num += (x[i]-xbar)*(y[i]-ybar);
    den += (x[i]-xbar)*(x[i]-xbar);
  }
  const slope = den===0 ? 0 : num/den; // price units per day step
  const last = close[close.length-1] || 1;
  return (slope/last)*100; // %/day
}

function calcZ(last, mid, upper, lower) {
  // z ประมาณจาก mid และ band
  if (!mid || !upper || !lower) return 0;
  const sd = (upper - mid) / 2;
  if (!sd || sd === 0) return 0;
  return (last - mid) / sd;
}

async function loadSymbol(sym) {
  currentSymbol = sym.trim().toUpperCase();
  if (!currentSymbol) return;

  // UI titles
  brandTitle.textContent = `LIMES MS — ${currentSymbol}`;
  el("subTitle").textContent = "Daily Close | Forecast vs Actual (+1D)";

  const fileKey = normalizeSymbolForFile(currentSymbol);
  const dailyUrl = `data/${fileKey}_daily.json`;
  const m15Url = `data/${fileKey}_15m.json`;

  // Stamp
  stamp.textContent = fmtThaiNow();

  let daily, m15;
  try {
    daily = await fetchJSON(dailyUrl);
  } catch (e) {
    // ถ้าไม่มีไฟล์ daily ให้ขึ้นข้อความใน toast
    statusToast.style.display = "flex";
    toastPill.textContent = "WAITING";
    toastTitle.textContent = `${currentSymbol} — ไม่มีไฟล์ข้อมูล`;
    toastSub.textContent = `รอให้ GitHub Actions สร้างไฟล์: ${dailyUrl}`;
    return;
  }

  try {
    m15 = await fetchJSON(m15Url);
  } catch {
    m15 = { timestamps: [], close: [] };
  }

  const ts = daily.timestamps || [];
  const close = (daily.close || []).map(Number).filter((x)=>Number.isFinite(x));

  if (ts.length === 0 || close.length === 0) {
    statusToast.style.display = "flex";
    toastPill.textContent = "WAITING";
    toastTitle.textContent = `${currentSymbol} — JSON ว่าง/ไม่พอ`;
    toastSub.textContent = "Waiting for data…";
    return;
  }

  // X labels as short Thai dates
  const labels = ts.map((t)=>fmtShortX(t));

  const ma3 = calcMA3(close);
  const bands = calcBands(close, ma3, 2);

  // Forecast +1D (เส้นประจุดเดียวต่อท้าย)
  const last = close[close.length-1];
  const slopePct = calcSlopePctPerDay(close);
  const pred = last * (1 + slopePct/100);

  const forecast = new Array(close.length).fill(null);
  forecast.push(pred);

  // Update chart
  const c = ensureChart();
  c.data.labels = labels;

  // Price
  c.data.datasets[0].data = close;

  // MA3
  c.data.datasets[1].data = ma3;

  // Bands
  c.data.datasets[2].data = bands.upper;
  c.data.datasets[3].data = bands.lower;

  // Forecast: ทำให้ปลายกราฟต่ออีก 1 จุด (label ปลายเป็น "+1")
  c.data.labels = [...labels, "+1"];
  c.data.datasets[0].data = [...close, null];
  c.data.datasets[1].data = [...ma3, null];
  c.data.datasets[2].data = [...bands.upper, null];
  c.data.datasets[3].data = [...bands.lower, null];
  c.data.datasets[4].data = forecast;

  c.update();

  // Side panel values
  const latest15 = (m15.close && m15.close.length) ? Number(m15.close[m15.close.length-1]) : null;

  day0El.textContent = fmtThaiDateFromISO(ts[0]);
  latestEl.textContent = latest15 ? latest15.toFixed(2) : last.toFixed(2);
  predEl.textContent = pred.toFixed(2);

  slopeEl.textContent = `${slopePct >= 0 ? "+" : ""}${slopePct.toFixed(2)}%/day`;

  // Human Risk default
  const humanRisk = 2.29;
  humanRiskEl.textContent = humanRisk.toFixed(2);
  humanBar.querySelector(".fill").style.width = clamp(humanRisk/5*100,0,100).toFixed(0) + "%";

  // Z score from last point (use latest band where exists)
  let mid = ma3[ma3.length-1];
  let up = bands.upper[bands.upper.length-1];
  let lo = bands.lower[bands.lower.length-1];

  // ถ้าปลายยัง null (เพราะ window) ให้ไล่ย้อนหาค่าที่มี
  for (let i = ma3.length-1; i>=0; i--){
    if (mid == null && ma3[i]!=null) mid = ma3[i];
    if (up == null && bands.upper[i]!=null) up = bands.upper[i];
    if (lo == null && bands.lower[i]!=null) lo = bands.lower[i];
    if (mid!=null && up!=null && lo!=null) break;
  }

  const z = calcZ(last, mid, up, lo);
  const absSlope = Math.abs(slopePct);
  const absZ = Math.abs(z);

  // Risk score (0..5)
  const r = riskFromSlopeAndZ(absSlope, absZ);
  paintState(r.state, r.score);

  // Bars and arrows
  setBar(dFill, r.score);
  setBar(h2Fill, clamp(r.score * 0.44, 0, 5));
  setBar(h1Fill, clamp(r.score * 0.24, 0, 5));

  dScore.textContent = `${r.score.toFixed(2)}/5`;
  h2Score.textContent = `${clamp(r.score * 0.44, 0, 5).toFixed(2)}/5`;
  h1Score.textContent = `${clamp(r.score * 0.24, 0, 5).toFixed(2)}/5`;

  dArrow.textContent = arrowFromSlope(slopePct);
  h2Arrow.textContent = arrowFromSlope(slopePct);
  h1Arrow.textContent = arrowFromSlope(slopePct);

  // อัปเดต stamp ให้มีเวลาล่าสุดของ 15m ถ้ามี
  if (m15.timestamps && m15.timestamps.length) {
    const t15 = m15.timestamps[m15.timestamps.length-1];
    const dt15 = new Date(t15);
    const fmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
    stamp.textContent = `${fmtThaiNow()} • latest15=${fmt.format(dt15)}`;
  }
}

// ------- Events -------
btnLoad?.addEventListener("click", () => loadSymbol(symbolInput.value || currentSymbol));
symbolInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadSymbol(symbolInput.value || currentSymbol);
});

// Initial
(function init(){
  stamp.textContent = fmtThaiNow();
  symbolInput.value = currentSymbol;
  ensureChart();
  loadSymbol(currentSymbol);
})();
