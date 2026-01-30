/* LIMES MS Dashboard — multi-asset (static JSON loader)
   Expects:
     data/<tickerLower>_daily.json  => { timestamps:[], close:[] }
     data/<tickerLower>_15m.json    => { timestamps:[], close:[] }
*/

let chart;

const DEFAULT_TICKER = "XAUUSD";
const WINDOW_DAYS = 40;        // keep “old look”: last 40 trading days-ish
const MA = 3;

// slope thresholds (%/day) for risk classification
const SLOPE_LOW = 5;           // |slope%/day| <= 5  => low risk
const SLOPE_HIGH = 12;         // |slope%/day| >= 12 => high risk (flash red)

function fmtThaiNow(d = new Date()) {
  const opt = { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit", timeZone:"Asia/Bangkok" };
  return new Intl.DateTimeFormat("th-TH", opt).format(d) + " (UTC+7)";
}

function fmtThaiShortDate(d) {
  // axis labels: dd/MM
  const opt = { day:"2-digit", month:"2-digit", timeZone:"Asia/Bangkok" };
  return new Intl.DateTimeFormat("th-TH", opt).format(d);
}

function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

function ma(arr, n){
  const out = new Array(arr.length).fill(null);
  for(let i=0;i<arr.length;i++){
    if(i < n-1) continue;
    let s=0;
    for(let k=i-n+1;k<=i;k++) s += arr[k];
    out[i]= s/n;
  }
  return out;
}

function std(arr){
  const xs = arr.filter(v => Number.isFinite(v));
  if(xs.length < 2) return 0;
  const m = xs.reduce((a,b)=>a+b,0)/xs.length;
  const v = xs.reduce((a,b)=>a+(b-m)*(b-m),0)/(xs.length-1);
  return Math.sqrt(v);
}

function safeParseISO(s){
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function fetchJSON(path){
  const r = await fetch(path, { cache: "no-store" });
  if(!r.ok) throw new Error(`HTTP ${r.status} ${path}`);
  return await r.json();
}

function computeBands(close){
  const mid = ma(close, MA);
  // residuals on points where mid exists
  const resid = close.map((v,i)=> (mid[i]==null ? null : (v - mid[i])));
  const sigma = std(resid.slice(-WINDOW_DAYS)); // keep it local
  const upper = mid.map(v => v==null ? null : v + 2*sigma);
  const lower = mid.map(v => v==null ? null : v - 2*sigma);
  return { mid, upper, lower, sigma };
}

function slopePctPerDay(close){
  // linear-ish slope using last 6 valid daily closes
  const n = Math.min(6, close.length);
  if(n < 3) return 0;
  const y = close.slice(-n);
  const y0 = y[0];
  const y1 = y[y.length-1];
  const delta = y1 - y0;
  const perDay = delta / (n-1);
  const pct = (y1 !== 0) ? (perDay / y1) * 100 : 0;
  return pct; // %/day
}

function slopeRiskScore(absSlopePct){
  // map to 0..5 (using your rule)
  // <=5% => low
  // 5..12 => watch
  // >=12 => high
  if(absSlopePct <= SLOPE_LOW) return 1.0;
  if(absSlopePct >= 20) return 5.0;

  if(absSlopePct <= SLOPE_HIGH){
    // 5..12 => 1.0..3.5
    const t = (absSlopePct - SLOPE_LOW) / (SLOPE_HIGH - SLOPE_LOW);
    return 1.0 + t*(3.5-1.0);
  }else{
    // 12..20 => 3.5..5.0
    const t = (absSlopePct - SLOPE_HIGH) / (20 - SLOPE_HIGH);
    return 3.5 + t*(5.0-3.5);
  }
}

function classify(score){
  if(score >= 3.8) return { label:"HIGH RISK", cls:"bad", flash:true };
  if(score >= 2.2) return { label:"WATCH", cls:"warn", flash:false };
  return { label:"BUY", cls:"good", flash:false };
}

function updateThaiClock(){
  const now = new Date();
  document.getElementById("stamp").textContent = fmtThaiNow(now);
  document.getElementById("pillTime").textContent = new Intl.DateTimeFormat("th-TH", { hour:"2-digit", minute:"2-digit", timeZone:"Asia/Bangkok" }).format(now);
}
setInterval(updateThaiClock, 1000);

function setLoadedMeta(ticker, slope, z){
  const el = document.getElementById("loadedMeta");
  const s = (slope>=0?"+":"") + slope.toFixed(2) + "%/day";
  el.textContent = `Loaded: ${ticker} • slope=${s} • z=${z.toFixed(2)}`;
}

function renderState(ticker, latest15, fc1d, slopePct, score, day0refStr){
  const cls = classify(score);

  // right panel badge
  const badge = document.getElementById("stateBadge");
  badge.className = `badge ${cls.cls}` + (cls.flash ? " flash" : "");
  badge.textContent = cls.label;

  document.getElementById("titleTicker").textContent = ticker;
  document.getElementById("day0ref").textContent = day0refStr || "--";
  document.getElementById("latest15").textContent = latest15 != null ? latest15.toFixed(2) : "--";
  document.getElementById("fc1d").textContent = fc1d != null ? fc1d.toFixed(2) : "--";
  document.getElementById("slope").textContent = (slopePct>=0?"+":"") + slopePct.toFixed(2) + "%/day";

  document.getElementById("riskScore").textContent = score.toFixed(2);
  document.getElementById("riskNeedle").style.left = `${clamp((score/5)*100,0,100)}%`;

  // floating single status bottom-right
  document.getElementById("pillTicker").textContent = ticker;
  const pill = document.getElementById("pill");
  pill.className = `pill ${cls.cls}` + (cls.flash ? " flash" : "");
  pill.textContent = cls.label;

  document.getElementById("pillScore").textContent = score.toFixed(2);
}

function buildChart(labels, price, mid, upper, lower){
  const ctx = document.getElementById("chart").getContext("2d");
  if(chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Upper",
          data: upper,
          borderColor: "rgba(110,143,179,0.75)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25
        },
        {
          label: "Lower",
          data: lower,
          borderColor: "rgba(110,143,179,0.75)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25
        },
        {
          label: "Phase/Mid (MA3)",
          data: mid,
          borderColor: "rgba(77,182,255,0.95)",
          borderWidth: 2,
          pointRadius: 0,
          borderDash: [4,4],
          tension: 0.25
        },
        {
          label: "Price",
          data: price,
          borderColor: "rgba(240,180,75,0.95)",
          borderWidth: 3,
          pointRadius: 2,
          pointHoverRadius: 3,
          tension: 0.25
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display:false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed?.(2) ?? ctx.parsed.y}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: {
            color: "rgba(232,238,252,0.70)",
            autoSkip: true,
            maxTicksLimit: 10   // ✅ ทำให้แกนนอนไม่แน่น/ไม่ยาวจนล้น
          }
        },
        y: {
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: "rgba(232,238,252,0.70)" }
        }
      }
    }
  });
}

function computeForecast1D(lastClose, midLast, slopePct){
  // simple: forecast = lastClose + (slopePct% of lastClose)
  if(lastClose == null) return null;
  return lastClose * (1 + (slopePct/100));
}

function computeDay0RefTH(dailyTimestamps){
  // your rule: day0 ref at 04:00 TH
  // show latest daily date at 04:00 TH (display only)
  const last = dailyTimestamps.length ? safeParseISO(dailyTimestamps[dailyTimestamps.length-1]) : null;
  if(!last) return "--";
  // Force Asia/Bangkok display; show date + 04:00
  const dateStr = new Intl.DateTimeFormat("th-TH", { day:"2-digit", month:"short", year:"numeric", timeZone:"Asia/Bangkok" }).format(last);
  return `${dateStr} 04:00`;
}

async function loadTicker(tickerRaw){
  const ticker = (tickerRaw || DEFAULT_TICKER).trim().toUpperCase();
  const tLower = ticker.toLowerCase();

  // show Thai time immediately
  updateThaiClock();

  const dailyPath = `data/${tLower}_daily.json`;
  const m15Path   = `data/${tLower}_15m.json`;

  // fetch both
  const [daily, m15] = await Promise.all([fetchJSON(dailyPath), fetchJSON(m15Path)]);

  if(!daily?.timestamps?.length || !daily?.close?.length){
    throw new Error(`Daily JSON empty/invalid: ${dailyPath}`);
  }

  // take last WINDOW_DAYS points
  const tsAll = daily.timestamps;
  const closeAll = daily.close.map(Number);

  const start = Math.max(0, closeAll.length - WINDOW_DAYS);
  const ts = tsAll.slice(start);
  const close = closeAll.slice(start);

  const labels = ts.map(s => {
    const d = safeParseISO(s);
    return d ? fmtThaiShortDate(d) : String(s);
  });

  const { mid, upper, lower, sigma } = computeBands(close);
  buildChart(labels, close, mid, upper, lower);

  // latest 15m
  let latest15 = null;
  if(m15?.close?.length) latest15 = Number(m15.close[m15.close.length-1]);

  // risk components (slope-driven)
  const slope = slopePctPerDay(close);
  const absSlope = Math.abs(slope);
  const slopeScore = slopeRiskScore(absSlope);

  // z-score vs mid & sigma (secondary)
  const lastClose = close[close.length-1];
  const midLast = mid[mid.length-1] ?? lastClose;
  const z = (sigma > 0) ? ((lastClose - midLast) / sigma) : 0;
  const zScore = clamp(Math.abs(z) * 1.2, 0, 5); // mild

  const score = Math.max(slopeScore, zScore); // ✅ ใช้ทั้ง slope + price-position แต่ slope เป็นตัวหลัก

  const fc1d = computeForecast1D(lastClose, midLast, slope);
  const day0refStr = computeDay0RefTH(tsAll);

  setLoadedMeta(ticker, slope, z);
  renderState(ticker, latest15, fc1d, slope, score, day0refStr);

  // update title ticker
  document.getElementById("titleTicker").textContent = ticker;
}

function wireUI(){
  const input = document.getElementById("tickerInput");
  const btn = document.getElementById("loadBtn");

  btn.addEventListener("click", () => loadTicker(input.value).catch(err => alert(err.message)));
  input.addEventListener("keydown", (e) => {
    if(e.key === "Enter") loadTicker(input.value).catch(err => alert(err.message));
  });

  // initial load
  loadTicker(DEFAULT_TICKER).catch(err => alert(err.message));
}

wireUI();
