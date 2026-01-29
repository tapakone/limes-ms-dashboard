/* LIMES MS — Multi-Asset + Autocomplete
   Requires:
     /data/assets.json
     /data/<asset>_15m.json
     /data/<asset>_daily.json
*/

const TZ = "Asia/Bangkok";
const DATA_DIR = "./data";

// default asset (id)
const DEFAULT_ASSET = "xauusd";

// ---------- helpers ----------
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function fmt2(n){ return (Number.isFinite(n) ? n.toFixed(2) : "--"); }

function riskColor(score){
  if(score >= 4.5) return "risk";
  if(score >= 3.5) return "watch";
  return "buy";
}
function riskLabel(score){
  if(score >= 4.5) return "HIGH RISK";
  if(score >= 3.5) return "CAUTION";
  return "BUY";
}
function arrowFromSlope(s){
  if(!Number.isFinite(s)) return "→";
  if(s > 0.02) return "↗";
  if(s < -0.02) return "↘";
  return "→";
}
function slugify(s){
  return (s || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
}

function getParam(name){
  return new URLSearchParams(window.location.search).get(name);
}
function setParamAndReload(name, value){
  const url = new URL(window.location.href);
  url.searchParams.set(name, value);
  window.location.href = url.toString();
}

async function loadJSON(url){
  const r = await fetch(url, {cache:"no-store"});
  if(!r.ok) throw new Error("Fetch failed: " + url + " (" + r.status + ")");
  return await r.json();
}

// rolling mean + std (simple)
function ma(arr, win){
  const out = new Array(arr.length).fill(null);
  for(let i=0;i<arr.length;i++){
    if(i < win-1) continue;
    let s=0;
    for(let j=i-win+1;j<=i;j++) s += arr[j];
    out[i] = s / win;
  }
  return out;
}
function rollingStd(arr, win){
  const out = new Array(arr.length).fill(null);
  for(let i=0;i<arr.length;i++){
    if(i < win-1) continue;
    let s=0;
    for(let j=i-win+1;j<=i;j++) s += arr[j];
    const m = s / win;
    let v=0;
    for(let j=i-win+1;j<=i;j++) v += (arr[j]-m)**2;
    out[i] = Math.sqrt(v / win);
  }
  return out;
}

// linear slope (per step)
function slopeLast(arr, k){
  if(arr.length < k) return NaN;
  const y = arr.slice(arr.length-k);
  const x = [...Array(k)].map((_,i)=>i);
  const xm = (k-1)/2;
  const ym = y.reduce((a,b)=>a+b,0)/k;
  let num=0, den=0;
  for(let i=0;i<k;i++){
    num += (x[i]-xm)*(y[i]-ym);
    den += (x[i]-xm)**2;
  }
  return den===0 ? NaN : num/den;
}

// map |z| to 0..5 risk
function scoreFromZ(z){
  if(!Number.isFinite(z)) return 0;
  const s = 0.5 + 1.1*Math.abs(z) + 0.25*(Math.abs(z)**1.3);
  return clamp(s, 0, 5);
}

// ---------- asset list + autocomplete ----------
let ASSETS = []; // from assets.json
let assetId = (getParam("asset") || DEFAULT_ASSET).toLowerCase();
let assetLabel = assetId.toUpperCase();

function setBrandTitle(){
  const brand = document.getElementById("brandTitle");
  if(brand) brand.textContent = `LIMES MS — ${assetLabel}`;
}

async function loadAssetsList(){
  try{
    const j = await loadJSON(`${DATA_DIR}/assets.json?ts=${Date.now()}`);
    ASSETS = j.assets || [];
    return ASSETS;
  }catch(e){
    // assets.json ยังไม่มี → ยังใช้ได้แบบ default asset เดียว
    ASSETS = [];
    return [];
  }
}

function setupAutocomplete(){
  const input = document.getElementById("assetInput");
  const list  = document.getElementById("assetList");
  const hint  = document.getElementById("assetHint");
  if(!input || !list) return;

  // fill datalist
  list.innerHTML = "";
  for(const a of ASSETS){
    const opt = document.createElement("option");
    opt.value = a.label; // พิมพ์ GOOGL แล้วเลือกได้
    list.appendChild(opt);
  }

  // current label
  const hit = ASSETS.find(x => x.id === assetId);
  if(hit){
    assetLabel = hit.label;
    input.value = hit.label;
    if(hint) hint.textContent = `Loaded: ${hit.label}`;
  }else{
    input.value = assetId.toUpperCase();
    if(hint) hint.textContent = `Loaded: ${assetId.toUpperCase()}`;
  }
  setBrandTitle();

  input.addEventListener("change", ()=>{
    const val = (input.value || "").trim().toUpperCase();
    const byLabel = ASSETS.find(x => x.label === val);
    const nextId = byLabel ? byLabel.id : slugify(val);
    setParamAndReload("asset", nextId);
  });
}

// ---------- main ----------
let chart;

function setWaiting(msg){
  const stamp = document.getElementById("stamp");
  stamp.textContent = msg;

  ["day0","latest","pred","slope","humanRisk"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.textContent = "--";
  });

  const stateBadge = document.getElementById("stateBadge");
  if(stateBadge){
    stateBadge.classList.remove("buy","watch","risk","flash");
    stateBadge.classList.add("watch");
    stateBadge.textContent = "WAITING";
  }

  const dayState = document.getElementById("dayState");
  if(dayState) dayState.textContent = "WAITING";

  const dayPill = document.getElementById("dayRiskPill");
  if(dayPill) dayPill.textContent = "▲ DAY RISK --/5";

  const cta = document.getElementById("cta");
  const cta2 = document.getElementById("cta2");
  if(cta) cta.textContent = "WATCH";
  if(cta2) cta2.style.display = "none";

  if(chart){ chart.destroy(); chart = null; }
}

async function run(){
  // dynamic filenames based on selected assetId
  const p15url = `${DATA_DIR}/${assetId}_15m.json?ts=${Date.now()}`;
  const pDurl  = `${DATA_DIR}/${assetId}_daily.json?ts=${Date.now()}`;

  let d15, dd;
  try{
    d15 = await loadJSON(p15url);
    dd  = await loadJSON(pDurl);
  }catch(e){
    console.error(e);
    setWaiting(`No data yet for "${assetLabel}" — add it in Python ASSETS & let Actions run`);
    return;
  }

  const t15 = (d15.timestamps || []).map(s=>new Date(s));
  const p15 = (d15.close || []).map(Number);
  const td  = (dd.timestamps || []).map(s=>new Date(s));
  const pd  = (dd.close || []).map(Number);

  if(p15.length < 10 || pd.length < 20){
    setWaiting("Waiting for data... (JSON is empty/insufficient)");
    return;
  }

  // plot last 40 daily points
  const N = 40;
  const start = Math.max(0, pd.length - N);
  const close = pd.slice(start);
  const dateLabels = close.map((_,i)=> String(i-(close.length-1))); // -39..0

  // indicators
  const mid = ma(close, 3);
  const std = rollingStd(close, 20);
  const upper = mid.map((m,i)=> (m==null||std[i]==null) ? null : m + 2*std[i]);
  const lower = mid.map((m,i)=> (m==null||std[i]==null) ? null : m - 2*std[i]);

  const lastMid = mid[mid.length-1] ?? close[close.length-1];
  const s = slopeLast(mid.filter(x=>x!=null), 5); // per day
  const pred = lastMid + (Number.isFinite(s) ? s : 0);

  // references
  const day0Ref = d15.day0_ref_04th ?? null;  // optional (คุณค่อยเพิ่มจากฝั่ง python ก็ได้)
  const latest = p15[p15.length-1];
  const latestTs = t15[t15.length-1];

  // risk 1h/2h from 15m series (4 points = 1h, 8 points = 2h)
  const s1 = slopeLast(p15, 4);
  const s2 = slopeLast(p15, 8);

  const ret = [];
  for(let i=1;i<p15.length;i++) ret.push(p15[i]-p15[i-1]);
  const rStd = (()=> {
    const win=64;
    if(ret.length < win) return Math.sqrt(ret.reduce((a,b)=>a+b*b,0)/Math.max(1,ret.length));
    const slice = ret.slice(ret.length-win);
    const m = slice.reduce((a,b)=>a+b,0)/win;
    const v = slice.reduce((a,b)=>a+(b-m)*(b-m),0)/win;
    return Math.sqrt(v);
  })();
  const z1 = (Number.isFinite(s1) && rStd>0) ? (s1/rStd) : NaN;
  const z2 = (Number.isFinite(s2) && rStd>0) ? (s2/rStd) : NaN;

  const dRet = [];
  for(let i=1;i<close.length;i++) dRet.push(close[i]-close[i-1]);
  const dStd = Math.sqrt(dRet.reduce((a,b)=>a+b*b,0)/Math.max(1,dRet.length));
  const dSlope = slopeLast(close, 7);
  const zD = (Number.isFinite(dSlope) && dStd>0) ? (dSlope/dStd) : NaN;

  const scoreD  = scoreFromZ(zD);
  const score2h = scoreFromZ(z2);
  const score1h = scoreFromZ(z1);

  const agree = (Math.sign(dSlope||0) === Math.sign(s1||0)) ? 0.2 : 0;
  const human = clamp(Math.max(scoreD, score2h, score1h) + agree, 0, 5);

  // UI stamp
  const stamp = document.getElementById("stamp");
  if(latestTs instanceof Date && !isNaN(latestTs)){
    stamp.textContent = latestTs.toLocaleString("th-TH", {
      timeZone: TZ, year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit"
    }) + " (UTC+7)";
  } else {
    stamp.textContent = "Loaded (no timestamp)";
  }

  document.getElementById("day0").textContent = day0Ref ? fmt2(day0Ref) : "--";
  document.getElementById("latest").textContent = fmt2(latest);
  document.getElementById("pred").textContent = fmt2(pred);
  document.getElementById("slope").textContent = (Number.isFinite(s) ? (s>=0?"+":"") + fmt2(s) + " /day" : "--");
  document.getElementById("humanRisk").textContent = fmt2(human);

  const setBar = (idFill, idScore, idArrow, score, slopeVal)=>{
    const fill = document.getElementById(idFill);
    const scoreEl = document.getElementById(idScore);
    const arrowEl = document.getElementById(idArrow);
    fill.style.width = (score/5*100).toFixed(1)+"%";
    scoreEl.textContent = fmt2(score) + " / 5";
    arrowEl.textContent = arrowFromSlope(slopeVal);
  };
  setBar("dFill","dScore","dArrow", scoreD, dSlope);
  setBar("h2Fill","h2Score","h2Arrow", score2h, s2);
  setBar("h1Fill","h1Score","h1Arrow", score1h, s1);

  const humanFill = document.querySelector("#humanBar .fill");
  humanFill.style.width = (human/5*100).toFixed(1)+"%";

  const overall = riskColor(human);
  const label = riskLabel(human);

  const stateBadge = document.getElementById("stateBadge");
  stateBadge.classList.remove("buy","watch","risk","flash");
  stateBadge.classList.add(overall);
  stateBadge.textContent = label;

  const dayState = document.getElementById("dayState");
  dayState.textContent = label;

  const cta = document.getElementById("cta");
  const cta2 = document.getElementById("cta2");
  cta.textContent = (overall==="buy" ? "BUY" : "WATCH");
  cta2.style.display = (overall==="risk" ? "block":"none");

  const dayPill = document.getElementById("dayRiskPill");
  dayPill.textContent = `▲ DAY RISK ${fmt2(scoreD)}/5`;

  const btnBuy = document.getElementById("btnBuy");
  const btnWatch = document.getElementById("btnWatch");
  const btnRisk = document.getElementById("btnRisk");
  btnBuy.style.opacity = overall==="buy" ? "1" : ".35";
  btnWatch.style.opacity = overall==="watch" ? "1" : ".35";
  btnRisk.style.opacity = overall==="risk" ? "1" : ".35";

  if(Math.max(scoreD, score2h, score1h, human) >= 4.5){
    stateBadge.classList.add("flash");
    btnRisk.classList.add("flash");
  } else {
    btnRisk.classList.remove("flash");
  }

  drawChart(dateLabels, close, mid, upper, lower, pred);
}

function drawChart(labels, price, mid, upper, lower, pred){
  if(!labels?.length || !price?.length) return;

  const ctx = document.getElementById("chart");
  const predLabel = "+1";
  const labels2 = [...labels, predLabel];

  const price2 = [...price, null];
  const mid2   = [...mid, null];
  const upper2 = [...upper, null];
  const lower2 = [...lower, null];

  const predArr = new Array(labels2.length).fill(null);
  predArr[predArr.length-2] = mid2[mid2.length-2] ?? price[price.length-1];
  predArr[predArr.length-1] = pred;

  if(chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels2,
      datasets: [
        { label:"Upper", data: upper2, borderColor:"rgba(110,198,255,.55)", borderWidth:1, pointRadius:0, tension:.25 },
        { label:"Lower", data: lower2, borderColor:"rgba(110,198,255,.55)", borderWidth:1, pointRadius:0, tension:.25 },
        { label:"Price", data: price2, borderColor:"rgba(242,195,107,1)", backgroundColor:"rgba(242,195,107,.15)", borderWidth:2, pointRadius:2, tension:.25 },
        { label:"MA3", data: mid2, borderColor:"rgba(110,198,255,1)", borderDash:[4,4], borderWidth:2, pointRadius:0, tension:.25 },
        { label:"Forecast", data: predArr, borderColor:"rgba(240,166,43,1)", borderDash:[6,6], borderWidth:2, pointRadius:0, tension:0 },
        { label:"Today", data: (()=>{ const a=new Array(labels2.length).fill(null); a[labels2.length-2]=price[price.length-1]; return a; })(),
          borderColor:"rgba(240,166,43,1)", pointBackgroundColor:"rgba(240,166,43,1)", pointBorderColor:"#000", pointRadius:6, showLine:false },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          mode:"index", intersect:false,
          backgroundColor:"rgba(0,0,0,.85)",
          borderColor:"rgba(255,255,255,.12)",
          borderWidth:1
        }
      },
      interaction:{mode:"index", intersect:false},
      scales:{
        x:{ grid:{color:"rgba(255,255,255,.06)"}, ticks:{color:"rgba(233,226,212,.55)", maxTicksLimit:10} },
        y:{ grid:{color:"rgba(255,255,255,.06)"}, ticks:{color:"rgba(233,226,212,.55)"} }
      }
    }
  });
}

// ---------- boot ----------
(async ()=>{
  await loadAssetsList();
  setupAutocomplete();
  run().catch(err=>{
    console.error(err);
    setWaiting("Data load error (check /data/*.json)");
  });
  setInterval(()=>run().catch(()=>{}), 15*60*1000);
})();
