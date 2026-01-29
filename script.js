// LIMES MS Spec v1 Demo
// Risk = slopeRisk(|slope%|) + positionBoost(z), clamp 0..5
// Flash RED when risk >= 4.5

const els = {
  c: document.getElementById("c"),
  statusLine: document.getElementById("statusLine"),
  assetInput: document.getElementById("assetInput"),
  assetList: document.getElementById("assetList"),
  loadBtn: document.getElementById("loadBtn"),
  stateBig: document.getElementById("stateBig"),
  stateBadge: document.getElementById("stateBadge"),
  stateBox: document.getElementById("stateBox"),
  riskPill: document.getElementById("riskPill"),
  latest15: document.getElementById("latest15"),
  slopeDay: document.getElementById("slopeDay"),
  riskScore: document.getElementById("riskScore"),
  barD: document.getElementById("barD"),
  bar2h: document.getElementById("bar2h"),
  bar1h: document.getElementById("bar1h"),
  valD: document.getElementById("valD"),
  val2h: document.getElementById("val2h"),
  val1h: document.getElementById("val1h"),
};

const ctx = els.c.getContext("2d");

let ASSETS = [];
let currentId = "xauusd";

// ---------- helpers ----------
function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
function fmt2(x){ return (x==null || Number.isNaN(x)) ? "—" : x.toFixed(2); }
function pct2(x){ return (x==null || Number.isNaN(x)) ? "—" : (x*100).toFixed(2) + "%"; }

async function loadJSON(path){
  const r = await fetch(path, {cache:"no-store"});
  if(!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return r.json();
}

function ma(arr, n){
  const out = [];
  for(let i=0;i<arr.length;i++){
    const s = Math.max(0, i-n+1);
    const slice = arr.slice(s, i+1);
    const m = slice.reduce((a,b)=>a+b,0)/slice.length;
    out.push(m);
  }
  return out;
}

function std(arr){
  const m = arr.reduce((a,b)=>a+b,0)/arr.length;
  const v = arr.reduce((a,b)=>a+(b-m)*(b-m),0)/arr.length;
  return Math.sqrt(v);
}

// --- risk from slope absolute percentage (0..5) ---
function slopeRisk(absSlopePct){
  // absSlopePct is in "percent" unit, e.g. 7.2 means 7.2%
  // bands: 0-5 low, 5-10 mid, 10-15 high, >=15 very high
  // map to 0..5 smoothly
  if(absSlopePct <= 5) return (absSlopePct/5)*1.6;                 // 0..1.6
  if(absSlopePct <= 10) return 1.6 + ((absSlopePct-5)/5)*1.2;      // 1.6..2.8
  if(absSlopePct <= 15) return 2.8 + ((absSlopePct-10)/5)*1.2;     // 2.8..4.0
  return clamp(4.0 + ((absSlopePct-15)/15)*1.2, 4.0, 5.0);         // 4.0..5.0
}

// --- boost from position in bands (z distance from mid / sigma) ---
function positionBoost(zAbs){
  // zAbs ~ 0..2 typically (beyond 2 = outside band)
  // small boost when near edges
  if(zAbs < 0.8) return 0.0;
  if(zAbs < 1.4) return (zAbs-0.8)/(0.6)*0.4;   // 0..0.4
  if(zAbs < 2.0) return 0.4 + (zAbs-1.4)/(0.6)*0.8; // 0.4..1.2
  return 1.2; // cap boost
}

function riskToState(risk){
  if(risk >= 4.5) return {label:"HIGH RISK", cls:"badge-high"};
  if(risk >= 2.6) return {label:"WATCH", cls:"badge-watch"};
  return {label:"BUY", cls:"badge-buy"};
}

// ---------- chart ----------
function drawChart(series){
  // series: {price, mid, up, lo}
  const W = els.c.width, H = els.c.height;
  ctx.clearRect(0,0,W,H);

  // padding
  const P = {l:60, r:18, t:18, b:34};

  const all = [...series.up, ...series.lo, ...series.price];
  const minY = Math.min(...all);
  const maxY = Math.max(...all);
  const pad = (maxY-minY)*0.08 || 1;
  const y0 = minY - pad;
  const y1 = maxY + pad;

  function x(i){ return P.l + (i/(series.price.length-1))*(W-P.l-P.r); }
  function y(v){ return P.t + (1-(v-y0)/(y1-y0))*(H-P.t-P.b); }

  // grid
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for(let g=0; g<=6; g++){
    const yy = P.t + (g/6)*(H-P.t-P.b);
    ctx.beginPath(); ctx.moveTo(P.l,yy); ctx.lineTo(W-P.r,yy); ctx.stroke();
  }

  // y labels
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "12px system-ui";
  for(let g=0; g<=6; g++){
    const v = y1 - (g/6)*(y1-y0);
    const yy = P.t + (g/6)*(H-P.t-P.b);
    ctx.fillText(v.toFixed(0), 8, yy+4);
  }

  // bands
  drawLine(series.up, "rgba(94,120,151,0.9)");
  drawLine(series.lo, "rgba(94,120,151,0.9)");
  // mid
  drawLine(series.mid, "rgba(127,209,255,0.95)", [4,3]);
  // price
  drawLine(series.price, "rgba(240,178,74,0.95)");

  // last point marker
  const i = series.price.length-1;
  ctx.fillStyle = "rgba(240,178,74,1)";
  ctx.beginPath(); ctx.arc(x(i), y(series.price[i]), 5, 0, Math.PI*2); ctx.fill();

  function drawLine(arr, color, dash=null){
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    arr.forEach((v,i)=>{
      if(i===0) ctx.moveTo(x(i),y(v));
      else ctx.lineTo(x(i),y(v));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ---------- main load ----------
async function loadAssets(){
  try{
    const j = await loadJSON("data/assets.json");
    ASSETS = j.assets || [];
    els.assetList.innerHTML = "";
    ASSETS.forEach(a=>{
      const opt = document.createElement("option");
      opt.value = a.label;
      els.assetList.appendChild(opt);
    });
  }catch(e){
    els.statusLine.textContent = "assets.json not found (using fallback)";
    // fallback minimal
    ASSETS = [{id:"xauusd",label:"XAUUSD"}];
  }
}

function resolveAssetId(input){
  const s = (input||"").trim().toUpperCase();
  const found = ASSETS.find(a => a.label.toUpperCase() === s);
  return found ? found.id : (s ? s.toLowerCase() : currentId);
}

async function loadAsset(assetId){
  currentId = assetId;
  els.statusLine.textContent = "Loading data...";
  try{
    const daily = await loadJSON(`data/${assetId}_daily.json`);
    const m15   = await loadJSON(`data/${assetId}_15m.json`);

    const priceD = (daily.close || []).map(Number);
    const price15 = (m15.close || []).map(Number);

    if(priceD.length < 10 || price15.length < 10){
      els.statusLine.textContent = "Waiting for data... (JSON is empty/insufficient)";
      return;
    }

    // compute bands on daily window (last 40)
    const w = 40;
    const p = priceD.slice(-w);
    const mid = ma(p, 3);
    const sigma = std(p);
    const up = mid.map(v=>v + 2*sigma);
    const lo = mid.map(v=>v - 2*sigma);

    // slope daily (% from first to last in window)
    const slopePct = ((p[p.length-1] - p[0]) / p[0]) * 100;

    // position z (distance from mid in sigma units)
    const last = p[p.length-1];
    const midLast = mid[mid.length-1];
    const zAbs = sigma>0 ? Math.abs((last - midLast)/sigma) : 0;

    // risk score
    const rSlope = slopeRisk(Math.abs(slopePct));
    const rBoost = positionBoost(zAbs);
    const risk = clamp(rSlope + rBoost, 0, 5);

    const st = riskToState(risk);

    // update UI
    els.latest15.textContent = fmt2(price15[price15.length-1]);
    els.slopeDay.textContent = (slopePct>=0?"+":"") + slopePct.toFixed(2) + "%";
    els.riskScore.textContent = fmt2(risk) + " / 5";

    els.stateBig.textContent = st.label;
    els.stateBig.className = "stateBig " + st.cls;

    els.stateBadge.textContent = st.label;
    els.stateBadge.className = "bigBadge " + st.cls;

    els.riskPill.textContent = `DAY RISK ${fmt2(risk)}/5`;

    // bars (demo: reuse risk for D, and scale down for 2hr/1hr)
    setBar(els.barD, els.valD, risk);
    setBar(els.bar2h, els.val2h, clamp(risk*0.44,0,5));
    setBar(els.bar1h, els.val1h, clamp(risk*0.24,0,5));

    // flash when >= 4.5
    if(risk >= 4.5){
      els.stateBox.classList.add("flash-red");
      els.stateBadge.classList.add("flash-red");
    }else{
      els.stateBox.classList.remove("flash-red");
      els.stateBadge.classList.remove("flash-red");
    }

    // draw chart
    drawChart({price:p, mid, up, lo});
    els.statusLine.textContent = `Loaded: ${assetId.toUpperCase()} | slope=${slopePct.toFixed(2)}% | z=${zAbs.toFixed(2)}σ`;

  }catch(e){
    els.statusLine.textContent = "Data load error: " + e.message;
  }
}

function setBar(fillEl, valEl, risk){
  fillEl.style.width = (risk/5*100).toFixed(0) + "%";
  valEl.textContent = fmt2(risk) + " / 5";
}

els.loadBtn.addEventListener("click", ()=>{
  const id = resolveAssetId(els.assetInput.value);
  loadAsset(id);
});

els.assetInput.addEventListener("keydown", (e)=>{
  if(e.key === "Enter"){
    const id = resolveAssetId(els.assetInput.value);
    loadAsset(id);
  }
});

// init
(async function(){
  await loadAssets();
  els.assetInput.value = "XAUUSD";
  loadAsset("xauusd");
})();
