// LIMES MS — UI like previous dashboard
// Risk rules (slope-driven + band position boost):
// - Use ABS slope% (daily window) => risk rises when slope is strong both + and -
// - Low risk when |slope| <= 5%
// - Mid risk when 5–10%
// - High risk when 10–15%
// - Very high when >= 15%
// Add boost when price is near/outside ±2σ bands
// Flash red when risk >= 4.5

const el = (id)=>document.getElementById(id);

const ui = {
  canvas: el("c"),
  assetTitle: el("assetTitle"),
  assetInput: el("assetInput"),
  assetList: el("assetList"),
  loadBtn: el("loadBtn"),
  topMsg: el("topMsg"),

  stateBadge: el("stateBadge"),
  dayRiskPill: el("dayRiskPill"),

  day0ref: el("day0ref"),
  latest15: el("latest15"),
  forecast1d: el("forecast1d"),
  slopeDay: el("slopeDay"),

  humanRiskVal: el("humanRiskVal"),
  humanRiskFill: el("humanRiskFill"),

  barD: el("barD"),
  bar2h: el("bar2h"),
  bar1h: el("bar1h"),
  valD: el("valD"),
  val2h: el("val2h"),
  val1h: el("val1h"),

  btnBuy: el("btnBuy"), btnWatch: el("btnWatch"), btnHigh: el("btnHigh"),
  btnBuy2: el("btnBuy2"), btnWatch2: el("btnWatch2"), btnHigh2: el("btnHigh2"),
};

const ctx = ui.canvas.getContext("2d");

let ASSETS = [];
let currentId = "xauusd";

// ---------- helpers ----------
function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }
function fmt2(x){ return (x==null || Number.isNaN(x)) ? "--" : Number(x).toFixed(2); }
function fmtSignedPct(p){
  if(p==null || Number.isNaN(p)) return "--";
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(2)}%`;
}
async function loadJSON(path){
  const r = await fetch(path, {cache:"no-store"});
  if(!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return r.json();
}
function ma(arr, n){
  const out=[];
  for(let i=0;i<arr.length;i++){
    const s=Math.max(0,i-n+1);
    const slice=arr.slice(s,i+1);
    out.push(slice.reduce((a,b)=>a+b,0)/slice.length);
  }
  return out;
}
function std(arr){
  const m=arr.reduce((a,b)=>a+b,0)/arr.length;
  const v=arr.reduce((a,b)=>a+(b-m)*(b-m),0)/arr.length;
  return Math.sqrt(v);
}

// ---------- risk model ----------
function slopeRisk(absSlopePct){
  // 0..5% => 0..1.6
  if(absSlopePct <= 5) return (absSlopePct/5)*1.6;
  // 5..10 => 1.6..2.8
  if(absSlopePct <= 10) return 1.6 + ((absSlopePct-5)/5)*1.2;
  // 10..15 => 2.8..4.0
  if(absSlopePct <= 15) return 2.8 + ((absSlopePct-10)/5)*1.2;
  // >=15 => 4.0..5.0
  return clamp(4.0 + ((absSlopePct-15)/15)*1.2, 4.0, 5.0);
}
function positionBoost(zAbs){
  // zAbs near edges => add boost
  if(zAbs < 0.8) return 0.0;
  if(zAbs < 1.4) return ((zAbs-0.8)/0.6)*0.4;        // 0..0.4
  if(zAbs < 2.0) return 0.4 + ((zAbs-1.4)/0.6)*0.8;  // 0.4..1.2
  return 1.2;
}
function riskToState(risk){
  if(risk >= 4.5) return {label:"HIGH RISK", cls:"state-high"};
  if(risk >= 2.6) return {label:"WATCH", cls:"state-watch"};
  return {label:"BUY", cls:"state-buy"};
}

// ---------- UI setters ----------
function setState(state, risk){
  ui.stateBadge.textContent = state.label;
  ui.stateBadge.className = `stateBadge ${state.cls}`;

  ui.dayRiskPill.textContent = `▲ DAY RISK ${fmt2(risk)}/5`;

  // flash on high risk
  if(risk >= 4.5){
    ui.stateBadge.classList.add("flash-red");
  }else{
    ui.stateBadge.classList.remove("flash-red");
  }

  // highlight bottom buttons lightly (optional)
  const allBtns = [ui.btnBuy,ui.btnWatch,ui.btnHigh,ui.btnBuy2,ui.btnWatch2,ui.btnHigh2];
  allBtns.forEach(b=>b.classList.remove("flash-red"));
  if(risk >= 4.5) [ui.btnHigh,ui.btnHigh2].forEach(b=>b.classList.add("flash-red"));
}

function setBar(fillEl, valEl, risk){
  fillEl.style.width = (clamp(risk,0,5)/5*100).toFixed(0) + "%";
  valEl.textContent = `${fmt2(risk)}/5`;
}

function setHumanRisk(val){
  const v = clamp(val,0,5);
  ui.humanRiskVal.textContent = fmt2(v);
  ui.humanRiskFill.style.width = (v/5*100).toFixed(0) + "%";
}

// ---------- chart ----------
function drawChart(p, mid, up, lo){
  const W = ui.canvas.width, H = ui.canvas.height;
  ctx.clearRect(0,0,W,H);

  const P = {l:66, r:18, t:18, b:42};

  const all = [...p, ...up, ...lo];
  const minY = Math.min(...all);
  const maxY = Math.max(...all);
  const pad = (maxY-minY)*0.10 || 1;
  const y0 = minY - pad;
  const y1 = maxY + pad;

  function X(i){ return P.l + (i/(p.length-1))*(W-P.l-P.r); }
  function Y(v){ return P.t + (1-(v-y0)/(y1-y0))*(H-P.t-P.b); }

  // grid
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for(let g=0; g<=7; g++){
    const yy = P.t + (g/7)*(H-P.t-P.b);
    ctx.beginPath(); ctx.moveTo(P.l,yy); ctx.lineTo(W-P.r,yy); ctx.stroke();
  }

  // y labels
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = "12px system-ui";
  for(let g=0; g<=7; g++){
    const v = y1 - (g/7)*(y1-y0);
    const yy = P.t + (g/7)*(H-P.t-P.b);
    ctx.fillText(v.toFixed(0), 12, yy+4);
  }

  // lines
  drawLine(up, "rgba(94,120,151,0.95)");
  drawLine(lo, "rgba(94,120,151,0.95)");
  drawLine(mid, "rgba(127,209,255,0.95)", [4,3]);
  drawLine(p,  "rgba(240,178,74,0.95)");

  // last marker
  const i = p.length-1;
  ctx.fillStyle = "rgba(240,178,74,1)";
  ctx.beginPath(); ctx.arc(X(i), Y(p[i]), 6, 0, Math.PI*2); ctx.fill();

  function drawLine(arr, color, dash=null){
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    arr.forEach((v,i)=>{
      if(i===0) ctx.moveTo(X(i),Y(v));
      else ctx.lineTo(X(i),Y(v));
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ---------- assets + load ----------
async function loadAssets(){
  try{
    const j = await loadJSON("data/assets.json");
    ASSETS = j.assets || [];
    ui.assetList.innerHTML = "";
    ASSETS.forEach(a=>{
      const opt = document.createElement("option");
      opt.value = a.label;
      ui.assetList.appendChild(opt);
    });
  }catch{
    ASSETS = [{id:"xauusd",label:"XAUUSD"}];
  }
}

function resolveAssetId(input){
  const s = (input||"").trim().toUpperCase();
  const found = ASSETS.find(a => a.label.toUpperCase() === s);
  if(found) return found.id;
  // allow user to type raw id (e.g., btc-usd)
  return s ? s.toLowerCase() : currentId;
}

async function loadAsset(assetId){
  currentId = assetId;
  ui.assetTitle.textContent = assetId.toUpperCase();
  ui.topMsg.textContent = "Loading…";

  try{
    const daily = await loadJSON(`data/${assetId}_daily.json`);
    const m15   = await loadJSON(`data/${assetId}_15m.json`);

    const dailyClose = (daily.close || []).map(Number);
    const m15Close   = (m15.close || []).map(Number);

    if(dailyClose.length < 12 || m15Close.length < 6){
      ui.topMsg.textContent = "Waiting for data… (JSON is empty/insufficient)";
      setState({label:"WAITING", cls:"state-wait"}, 0);
      return;
    }

    // --- compute bands on last 40 daily points ---
    const W = 40;
    const p = dailyClose.slice(-W);
    const mid = ma(p, 3);
    const sigma = std(p);
    const up = mid.map(v=>v + 2*sigma);
    const lo = mid.map(v=>v - 2*sigma);

    // --- slope (daily window) in % ---
    const slopePct = ((p[p.length-1] - p[0]) / p[0]) * 100;

    // --- z distance from mid ---
    const last = p[p.length-1];
    const midLast = mid[mid.length-1];
    const zAbs = sigma > 0 ? Math.abs((last - midLast) / sigma) : 0;

    // --- risk ---
    const rSlope = slopeRisk(Math.abs(slopePct));
    const rBoost = positionBoost(zAbs);
    const risk = clamp(rSlope + rBoost, 0, 5);
    const state = riskToState(risk);

    // --- UI: numbers ---
    ui.latest15.textContent = fmt2(m15Close[m15Close.length-1]);
    ui.slopeDay.textContent = `${fmtSignedPct(slopePct)} /day`;

    // forecast (+1D) (simple demo): project by slope% of last daily price
    const forecast = last * (1 + slopePct/100);
    ui.forecast1d.textContent = fmt2(forecast);

    // day0 ref (use from json if provided)
    ui.day0ref.textContent = (m15.day0_ref_04th != null) ? fmt2(m15.day0_ref_04th) : "--";

    // Human Risk Index (demo): tie to risk (you can replace with your manual input later)
    setHumanRisk(risk);

    // Bars: D = risk, 2H/1H scaled demo
    setBar(ui.barD, ui.valD, risk);
    setBar(ui.bar2h, ui.val2h, clamp(risk*0.44,0,5));
    setBar(ui.bar1h, ui.val1h, clamp(risk*0.24,0,5));

    setState(state, risk);

    drawChart(p, mid, up, lo);

    ui.topMsg.textContent = `Loaded • slope=${slopePct.toFixed(2)}% • z=${zAbs.toFixed(2)}σ`;

  }catch(e){
    ui.topMsg.textContent = `Data load error (check /data/*.json)`;
    setState({label:"WAITING", cls:"state-wait"}, 0);
    // keep console for debugging
    console.error(e);
  }
}

// ---------- events ----------
function doLoad(){
  const id = resolveAssetId(ui.assetInput.value);
  loadAsset(id);
}

ui.loadBtn.addEventListener("click", doLoad);
ui.assetInput.addEventListener("keydown", (e)=>{ if(e.key==="Enter") doLoad(); });

// CTA buttons (optional: just scroll user attention; logic can be added later)
[ui.btnBuy, ui.btnBuy2].forEach(b=>b.addEventListener("click", ()=>ui.topMsg.textContent="BUY pressed"));
[ui.btnWatch, ui.btnWatch2].forEach(b=>b.addEventListener("click", ()=>ui.topMsg.textContent="WATCH pressed"));
[ui.btnHigh, ui.btnHigh2].forEach(b=>b.addEventListener("click", ()=>ui.topMsg.textContent="HIGH RISK pressed"));

// init
(async function init(){
  await loadAssets();
  ui.assetInput.value = "XAUUSD";
  loadAsset("xauusd");
})();
