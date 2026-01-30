/* LIMES MS — Dashboard (single-file script)
   - Shows Thai time top-right
   - X axis uses real dates (not long timestamps)
   - Bottom-right single status summary + blink on HIGH RISK
*/

const $ = (id) => document.getElementById(id);

const el = {
  symbolInput: $("symbolInput"),
  btnLoad: $("btnLoad"),
  thaiTime: $("thaiTime"),
  statusTopRight: $("statusTopRight"),

  // State panel
  stateBadge: $("stateBadge"),
  refPrice: $("refPrice"),
  latest15: $("latest15"),
  fc1d: $("fc1d"),
  slope: $("slope"),
  hri: $("hri"),
  hriBar: $("hriBar"),

  // Day risk bars
  riskD: $("riskD"),
  risk2h: $("risk2h"),
  risk1h: $("risk1h"),
  riskDVal: $("riskDVal"),
  risk2hVal: $("risk2hVal"),
  risk1hVal: $("risk1hVal"),

  // Right buttons
  btnBuy: $("btnBuy"),
  btnWatch: $("btnWatch"),
  btnHigh: $("btnHigh"),

  // Bottom-right summary
  bottomStatus: $("bottomStatus"),
  bottomPill: $("bottomPill"),
  bottomTitle: $("bottomTitle"),
  bottomScore: $("bottomScore"),
};

let chart;

/* -------------------- Utilities -------------------- */

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function fmtNum(x, digits=2){
  if (x === null || x === undefined || Number.isNaN(x)) return "--";
  return Number(x).toFixed(digits);
}

function thaiNowString(){
  // Thai local time (Bangkok)
  const d = new Date();
  // Keep explicit tz to avoid device settings surprises
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }) + " (UTC+7)";
}

function formatThaiDateShort(isoOrMs){
  const d = new Date(isoOrMs);
  return d.toLocaleDateString("th-TH", { timeZone:"Asia/Bangkok", day:"2-digit", month:"short" });
}

function formatThaiDateTimeShort(isoOrMs){
  const d = new Date(isoOrMs);
  return d.toLocaleString("th-TH", {
    timeZone:"Asia/Bangkok",
    day:"2-digit",
    month:"short",
    hour:"2-digit",
    minute:"2-digit"
  });
}

function updateThaiClock(){
  el.thaiTime.textContent = thaiNowString();
}
setInterval(updateThaiClock, 1000);
updateThaiClock();

/* -------------------- Data loading -------------------- */

async function loadJSON(path){
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return await res.json();
}

async function loadData(symbol){
  // Your workflow writes to /data/<symbol>_daily.json and /data/<symbol>_15m.json
  const daily = await loadJSON(`./data/${symbol.toLowerCase()}_daily.json`);
  const m15  = await loadJSON(`./data/${symbol.toLowerCase()}_15m.json`);
  return { daily, m15 };
}

/* -------------------- Risk logic (slope-based + band position) -------------------- */
/*
  We don't have the old thresholds in this chat.
  So we implement a clean, adjustable spec:

  - slopePctPerDay: slope of last 40 daily points (linear regression) expressed as %/day relative to last price.
  - z: distance from mid (MA3) in σ units (based on last 40 daily closes).
  - riskScore (0..5) combines |slopePctPerDay| and |z|.
*/
function linregSlope(xs, ys){
  const n = xs.length;
  if (n < 2) return 0;
  let sx=0, sy=0, sxx=0, sxy=0;
  for (let i=0;i<n;i++){
    const x = xs[i], y = ys[i];
    sx += x; sy += y; sxx += x*x; sxy += x*y;
  }
  const denom = (n*sxx - sx*sx);
  if (denom === 0) return 0;
  return (n*sxy - sx*sy) / denom;
}

function mean(arr){ return arr.reduce((a,b)=>a+b,0)/Math.max(1,arr.length); }
function stdev(arr){
  const m = mean(arr);
  const v = mean(arr.map(x => (x-m)*(x-m)));
  return Math.sqrt(v);
}

function computeRisk(dailyClose){
  // Use last 40 points
  const N = Math.min(40, dailyClose.length);
  const y = dailyClose.slice(-N);
  const xs = Array.from({length:N}, (_,i)=>i);
  const slopeAbs = linregSlope(xs, y); // price units per day
  const last = y[y.length-1] || 1;
  const slopePctPerDay = (slopeAbs / last) * 100;

  // Mid = MA3 of last values, sigma from last 40
  const mid = mean(y.slice(-3));
  const sigma = stdev(y) || 1e-9;
  const z = (last - mid) / sigma;

  // Convert to risk score 0..5
  // slope component: 0 at |slope|<=5%/day, grows to 5 at |slope|>=25%/day
  const slopeScore = clamp((Math.abs(slopePctPerDay) - 5) / (25 - 5) * 5, 0, 5);

  // band component: 0 at |z|<=0.5, 5 at |z|>=2.5
  const zScore = clamp((Math.abs(z) - 0.5) / (2.5 - 0.5) * 5, 0, 5);

  // Combine (weight slope a bit more)
  const riskScore = clamp(0.6*slopeScore + 0.4*zScore, 0, 5);

  // State thresholds
  let state = "WATCH";
  if (riskScore < 2.0) state = "BUY";
  else if (riskScore >= 4.0) state = "HIGH RISK";

  return { slopePctPerDay, z, riskScore, state, mid, sigma };
}

/* -------------------- UI updates -------------------- */

function setBadge(state){
  el.stateBadge.textContent = state;
  el.stateBadge.classList.remove("buy","watch","high");
  if (state === "BUY") el.stateBadge.classList.add("buy");
  else if (state === "HIGH RISK") el.stateBadge.classList.add("high");
  else el.stateBadge.classList.add("watch");
}

function setTopRight(text){
  el.statusTopRight.textContent = text;
}

function setActions(state){
  // Right panel buttons highlight
  el.btnBuy.classList.toggle("active", state==="BUY");
  el.btnWatch.classList.toggle("active", state==="WATCH");
  el.btnHigh.classList.toggle("active", state==="HIGH RISK");

  // Bottom summary
  el.bottomStatus.classList.toggle("blinkHigh", state==="HIGH RISK");

  el.bottomPill.classList.remove("buy","watch","high");
  el.bottomPill.textContent = state;

  if (state === "BUY") el.bottomPill.classList.add("buy");
  else if (state === "HIGH RISK") el.bottomPill.classList.add("high");
  else el.bottomPill.classList.add("watch");
}

function setBars(riskScore){
  // same score for D for now (you can later wire 2h/1h from intraday slope if you want)
  const pct = clamp((riskScore/5)*100, 0, 100);
  el.riskD.style.width = `${pct}%`;
  el.riskDVal.textContent = `${fmtNum(riskScore,2)}/5`;

  // placeholders (keep existing design)
  el.risk2h.style.width = `${clamp(pct*0.45,0,100)}%`;
  el.risk2hVal.textContent = `${fmtNum(riskScore*0.45,2)}/5`;

  el.risk1h.style.width = `${clamp(pct*0.25,0,100)}%`;
  el.risk1hVal.textContent = `${fmtNum(riskScore*0.25,2)}/5`;
}

function setHumanRiskIndex(v){
  const pct = clamp((v/5)*100, 0, 100);
  el.hri.textContent = `${fmtNum(v,2)} / 5`;
  el.hriBar.style.width = `${pct}%`;
}

function setBottomSummary(symbol, state, riskScore){
  el.bottomTitle.textContent = `${symbol.toUpperCase()} — ${state}`;
  el.bottomScore.textContent = `Risk score: ${fmtNum(riskScore,2)}/5`;
}

/* -------------------- Chart -------------------- */

function buildDailySeries(daily){
  // Expect: {timestamps: [...], close:[...]}
  const ts = (daily.timestamps || []).slice();
  const close = (daily.close || []).slice();

  // Convert timestamps to short Thai date labels (avoid long strings)
  const labels = ts.map(t => formatThaiDateShort(t));
  return { labels, close, timestamps: ts };
}

function build15mLatest(m15){
  const ts = (m15.timestamps || []);
  const close = (m15.close || []);
  if (!ts.length || !close.length) return { latest: null, latestTime: null };
  return { latest: close[close.length-1], latestTime: ts[ts.length-1] };
}

function ensureChart(){
  if (chart) return;
  const ctx = document.getElementById("chart").getContext("2d");
  chart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor:"rgba(0,0,0,.85)",
          borderColor:"rgba(255,255,255,.12)",
          borderWidth:1,
          callbacks:{
            title: (items) => items?.[0]?.label || ""
          }
        }
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,.06)" },
          ticks: {
            color: "rgba(233,226,212,.55)",
            maxTicksLimit: 8,
            autoSkip: true,
            maxRotation: 0,
            minRotation: 0
          }
        },
        y: {
          grid: { color: "rgba(255,255,255,.06)" },
          ticks: { color: "rgba(233,226,212,.55)" }
        }
      }
    }
  });
}

function updateChart(dailyClose, labels){
  ensureChart();

  const N = Math.min(40, dailyClose.length);
  const y = dailyClose.slice(-N);
  const lbl = labels.slice(-N);

  // Mid (MA3)
  const mid = y.map((_,i)=>{
    const a = y.slice(Math.max(0,i-2), i+1);
    return mean(a);
  });

  // sigma bands from last 40 (constant sigma for simplicity)
  const sigma = stdev(y) || 1e-9;
  const upper = mid.map(m=> m + 2*sigma);
  const lower = mid.map(m=> m - 2*sigma);

  // Today marker
  const today = y.map((_,i)=> i===y.length-1 ? y[i] : null);

  chart.data.labels = lbl;
  chart.data.datasets = [
    {
      label: "Price",
      data: y,
      borderColor: "rgba(245,192,90,.95)",
      backgroundColor: "rgba(245,192,90,.10)",
      borderWidth: 2,
      pointRadius: 2.2,
      tension: 0.25
    },
    {
      label: "Phase / Mid (MA3)",
      data: mid,
      borderColor: "rgba(120,180,255,.85)",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25
    },
    {
      label: "Upper",
      data: upper,
      borderColor: "rgba(160,200,255,.45)",
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.25
    },
    {
      label: "Lower",
      data: lower,
      borderColor: "rgba(160,200,255,.45)",
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.25
    },
    {
      label: "Today",
      data: today,
      borderColor: "rgba(245,192,90,.95)",
      backgroundColor: "rgba(245,192,90,.95)",
      borderWidth: 0,
      pointRadius: 5,
      showLine: false
    }
  ];

  chart.update();
}

/* -------------------- Main run -------------------- */

function setWaiting(msg){
  setTopRight(msg);
  el.bottomPill.textContent = "WAITING";
  el.bottomPill.classList.remove("buy","watch","high");
  el.bottomPill.classList.add("watch");
  el.bottomTitle.textContent = msg || "Waiting for data…";
  el.bottomScore.textContent = "--";
  el.bottomStatus.classList.remove("blinkHigh");
}

async function run(){
  const symbol = (el.symbolInput.value || "XAUUSD").trim();
  if (!symbol) return;

  setWaiting("Loading…");

  const { daily, m15 } = await loadData(symbol);

  const dailySeries = buildDailySeries(daily);
  if (!dailySeries.close.length){
    setWaiting("Waiting for data… (JSON is empty/insufficient)");
    return;
  }

  // Chart
  updateChart(dailySeries.close, dailySeries.labels);

  // Latest 15m
  const { latest, latestTime } = build15mLatest(m15);

  // Risk
  const { slopePctPerDay, z, riskScore, state } = computeRisk(dailySeries.close);

  // Panels
  setBadge(state);
  setActions(state);
  setBars(riskScore);
  setHumanRiskIndex(clamp(riskScore,0,5));

  // Values
  el.refPrice.textContent = fmtNum(dailySeries.close[dailySeries.close.length-1], 2);
  el.latest15.textContent = (latest==null) ? "--" : fmtNum(latest, 2);

  // Forecast (+1D): simple extrapolation from slope %/day
  const last = dailySeries.close[dailySeries.close.length-1];
  const fc1d = last * (1 + (slopePctPerDay/100));
  el.fc1d.textContent = fmtNum(fc1d, 2);

  el.slope.textContent = `${slopePctPerDay >= 0 ? "+" : ""}${fmtNum(slopePctPerDay, 2)}%/day`;

  setBottomSummary(symbol, state, riskScore);

  const loadedInfo =
    `Loaded · slope=${fmtNum(slopePctPerDay,2)}%/day · z=${fmtNum(z,2)}σ` +
    (latestTime ? ` · latest15=${formatThaiDateTimeShort(latestTime)}` : "");
  setTopRight(loadedInfo);
}

// Load button
el.btnLoad.addEventListener("click", () => run().catch(err=>{
  console.error(err);
  setWaiting("Data load error (check /data/*.json)");
}));

// Run on load and refresh every 15 min
run().catch(err=>{
  console.error(err);
  setWaiting("Data load error (check /data/*.json)");
});
setInterval(()=>run().catch(()=>{}), 15*60*1000);
