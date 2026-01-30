const $ = (id) => document.getElementById(id);

function slugify(sym){
  return sym.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
function fmt(n,d=2){
  if(n===null || n===undefined || Number.isNaN(n)) return '--';
  return Number(n).toFixed(d);
}
function clamp(x,a,b){return Math.max(a, Math.min(b,x));}

function showModal(msg, title="tapakone.github.io บอกว่า"){
  $("modalTitle").textContent = title;
  $("modalMsg").textContent = msg;
  $("modal").classList.remove("hidden");
}
$("modalOk").addEventListener("click", ()=> $("modal").classList.add("hidden"));

function thaiNowString(){
  const dt = new Date();
  const opt = { timeZone: "Asia/Bangkok", year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" };
  const parts = new Intl.DateTimeFormat("th-TH", opt).formatToParts(dt);
  const get = (t) => parts.find(p=>p.type===t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")} (UTC+7)`;
}
function setThaiTime(){ $("thaiTime").textContent = thaiNowString(); }
setThaiTime(); setInterval(setThaiTime, 15000);

let chart;
function buildChart(labels, price, mid, upper, lower){
  const ctx = $("priceChart").getContext("2d");
  if(chart) chart.destroy();
  chart = new Chart(ctx, {
    type:"line",
    data:{
      labels,
      datasets:[
        {label:"Price", data:price, borderWidth:2, pointRadius:2, tension:0.25},
        {label:"Mid (MA3)", data:mid, borderDash:[4,4], borderWidth:2, pointRadius:0, tension:0.25},
        {label:"Upper", data:upper, borderWidth:2, pointRadius:0, tension:0.25},
        {label:"Lower", data:lower, borderWidth:2, pointRadius:0, tension:0.25},
      ]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:{mode:"index", intersect:false}},
      interaction:{mode:"index", intersect:false},
      scales:{
        x:{grid:{color:"rgba(255,255,255,.06)"}, ticks:{color:"rgba(215,226,239,.75)", maxRotation:0, autoSkip:true, maxTicksLimit:10}},
        y:{grid:{color:"rgba(255,255,255,.06)"}, ticks:{color:"rgba(215,226,239,.75)"}}
      }
    }
  });
  const css = getComputedStyle(document.documentElement);
  const ds = chart.data.datasets;
  ds[0].borderColor = css.getPropertyValue("--gold").trim(); ds[0].pointBackgroundColor = ds[0].borderColor;
  ds[1].borderColor = css.getPropertyValue("--mid").trim();
  ds[2].borderColor = css.getPropertyValue("--band").trim();
  ds[3].borderColor = css.getPropertyValue("--band").trim();
  chart.update();
}

function riskFromSlopeZ(slopeRatioPerDay, z){
  const a = Math.abs(slopeRatioPerDay);
  let slopeScore = a<=0.0005?0.5 : a<=0.0015?1.5 : a<=0.003?3.0 : 4.5; // 0.05%/d,0.15%/d,0.3%/d
  const az = Math.abs(z);
  let zScore = az<=0.5?0.5 : az<=1.0?1.5 : az<=1.8?3.0 : 4.5;
  return clamp((slopeScore+zScore)/2, 0, 5);
}
function classifyState(r){ return r>=4.0?"HIGH RISK": (r>=2.0?"WATCH":"BUY"); }
function setBadge(state){
  const el=$("stateBadge");
  el.textContent=state;
  el.classList.remove("buy","watch","high");
  if(state==="BUY") el.classList.add("buy");
  else if(state==="WATCH") el.classList.add("watch");
  else el.classList.add("high");
}
function setRiskUI(r){ $("riskScoreText").textContent = `${fmt(r,2)}/5`; $("riskFill").style.width=`${clamp(r/5*100,0,100)}%`; }
function setAdviceBadge(a){
  const el=$("adviceBadge");
  el.textContent=a;
  el.classList.remove("buy","hold","sell");
  if(a==="BUY") el.classList.add("buy"); else if(a==="SELL") el.classList.add("sell"); else el.classList.add("hold");
}
function adviceFromZSlope(z, slopeRatioPerDay){
  if(z<=-0.25 && slopeRatioPerDay>-0.003) return ["BUY","ต่ำกว่ากลางช่วงพอสมควร เหมาะทยอยสะสมแบบคุมขนาด"];
  if(z>=0.85 || slopeRatioPerDay>=0.003) return ["SELL","เริ่มตึง/เร่งขึ้นแรง แนะนำลดความเสี่ยงหรือแบ่งขายบางส่วน"];
  return ["HOLD","สัญญาณยังผสมกัน รอดูให้ชัดก่อนค่อยเพิ่มน้ำหนัก"];
}

function pctChange(a,b){ if(a===0||a==null||b==null) return null; return (b-a)/a*100; }
function buildMonitorRows(series15){
  const windows=[15,30,60,90,120];
  const last=series15.at(-1);
  return windows.map(w=>{
    const idx=series15.length-1-Math.round(w/15);
    if(idx<0) return {w, dp:null, flag:"--"};
    const dp=pctChange(series15[idx], last);
    const a=Math.abs(dp??0);
    const flag = a>=1.0?"HIGH": (a>=0.5?"WATCH":"OK");
    return {w, dp, flag};
  });
}
function renderMonitor(rows){
  const tb=$("monitorBody"); tb.innerHTML="";
  for(const r of rows){
    const tr=document.createElement("tr");
    tr.innerHTML = `<td>${r.w}m</td><td>${r.dp==null?"--":fmt(r.dp,2)+"%"}</td><td class="${r.flag==="OK"?"flag-ok":r.flag==="WATCH"?"flag-warn":r.flag==="HIGH"?"flag-bad":""}">${r.flag}</td>`;
    tb.appendChild(tr);
  }
}
function monitorForcesHighRisk(rows){ return rows.some(r=>r.flag==="HIGH"); }

async function loadJSON(path){
  const res = await fetch(path, {cache:"no-store"});
  if(!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return await res.json();
}

function safeLabel(dateStr){
  const d=new Date(dateStr);
  const opt={timeZone:"Asia/Bangkok", day:"2-digit", month:"2-digit"};
  return new Intl.DateTimeFormat("th-TH", opt).format(d);
}

async function loadSymbol(symbol){
  const sym=symbol.trim();
  if(!sym) return;
  $("assetTitle").textContent = sym.toUpperCase();
  const slug=slugify(sym);
  const dailyPath=`data/${slug}_daily.json`;
  const m15Path=`data/${slug}_15m.json`;

  let daily,m15;
  try{ [daily,m15] = await Promise.all([loadJSON(dailyPath), loadJSON(m15Path)]); }
  catch(e){
    showModal(`หาไฟล์ข้อมูลไม่เจอสำหรับ ${sym}\nต้องมี:\n- ${dailyPath}\n- ${m15Path}\n\n(หน้าเว็บพร้อมแล้ว แต่ backend ต้องสร้าง JSON ให้ symbol นี้ก่อน)`);
    return;
  }
  if(!daily?.rows?.length || !m15?.rows?.length){
    showModal(`ข้อมูลไม่พอสำหรับ ${sym} (JSON ยังว่าง/สั้นเกินไป)`);
    return;
  }

  const closes=daily.rows.map(r=>Number(r.close));
  const labels=daily.rows.map(r=>safeLabel(r.time));

  const ma3=closes.map((_,i)=>{
    const a=closes.slice(Math.max(0,i-2), i+1);
    return a.reduce((x,y)=>x+y,0)/a.length;
  });

  const window=40;
  const upper=closes.map((_,i)=>{
    const s=closes.slice(Math.max(0,i-window+1), i+1);
    const mean=s.reduce((x,y)=>x+y,0)/s.length;
    const sd=Math.sqrt(s.reduce((x,y)=>x+(y-mean)**2,0)/s.length);
    return mean+2*sd;
  });
  const lower=closes.map((_,i)=>{
    const s=closes.slice(Math.max(0,i-window+1), i+1);
    const mean=s.reduce((x,y)=>x+y,0)/s.length;
    const sd=Math.sqrt(s.reduce((x,y)=>x+(y-mean)**2,0)/s.length);
    return mean-2*sd;
  });

  buildChart(labels, closes, ma3, upper, lower);

  const n=closes.length;
  const look=Math.min(10, n-1);
  const p0=closes[n-1-look];
  const p1=closes[n-1];
  const slopeRatioPerDay=(p1-p0)/p0/look; // ratio/day

  const midLast=ma3[n-1];
  const sdApprox=(upper[n-1]-midLast)/2 || 1e-9;
  const z=(closes[n-1]-midLast)/sdApprox;

  const c15=m15.rows.map(r=>Number(r.close));
  const latest15=c15.at(-1);
  const rows=buildMonitorRows(c15);
  renderMonitor(rows);

  let risk=riskFromSlopeZ(slopeRatioPerDay, z);
  if(monitorForcesHighRisk(rows)) risk=Math.max(risk,4.2);

  const state=classifyState(risk);
  setBadge(state);
  setRiskUI(risk);

  const forecast = closes[n-1]*(1+slopeRatioPerDay);

  $("refTime").textContent = daily.ref_th ?? "--";
  $("latest15").textContent = fmt(latest15,2);
  $("forecast1d").textContent = fmt(forecast,2);
  $("slope").textContent = fmt(slopeRatioPerDay*100,2)+"%/day";
  $("zscore").textContent = fmt(z,2);
  $("zPill").textContent = "Z="+fmt(z,2);

  const [adv, txt] = adviceFromZSlope(z, slopeRatioPerDay);
  setAdviceBadge(adv);
  $("adviceText").textContent = txt;
}

let tickerIndex=[];
async function initTickers(){
  try{ const t=await loadJSON("tickers.json"); tickerIndex=(t?.tickers??[]).map(x=>({sym:x.symbol,name:x.name||""})); }
  catch(_){ }
}
initTickers();

function renderSuggestions(q){
  const box=$("suggestions");
  if(!q){ box.classList.add("hidden"); box.innerHTML=""; return; }
  const qq=q.toLowerCase().trim();
  const hits=tickerIndex.filter(x=>x.sym.toLowerCase().includes(qq)||x.name.toLowerCase().includes(qq)).slice(0,8);
  if(!hits.length){ box.classList.add("hidden"); box.innerHTML=""; return; }
  box.innerHTML="";
  for(const h of hits){
    const div=document.createElement("div");
    div.className="item";
    div.innerHTML=`<span class="sym">${h.sym}</span><span class="name">${h.name}</span>`;
    div.addEventListener("click",()=>{ $("symbolInput").value=h.sym; box.classList.add("hidden"); loadSymbol(h.sym); });
    box.appendChild(div);
  }
  box.classList.remove("hidden");
}

$("symbolInput").addEventListener("input", e=>renderSuggestions(e.target.value));
$("symbolInput").addEventListener("keydown", e=>{ if(e.key==="Enter"){ $("suggestions").classList.add("hidden"); loadSymbol($("symbolInput").value); } });
document.addEventListener("click", e=>{ if(!e.target.closest(".searchBox")) $("suggestions").classList.add("hidden"); });
$("loadBtn").addEventListener("click", ()=>loadSymbol($("symbolInput").value));

loadSymbol("XAUUSD");
