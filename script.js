const dashboard = document.getElementById("dashboard");

// =====================
// Utilities
// =====================
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// =====================
// Risk Engine (LIMES MS)
// =====================
function calcRisk(slope, volatility) {
  let score = 2.5 + slope * 0.1 + volatility * 0.5;
  return clamp(Number(score.toFixed(1)), 0, 5);
}

function riskClass(score) {
  if (score < 2.5) return "buy";
  if (score < 4.0) return "watch";
  return "high";
}

// =====================
// Demo / Placeholder Data Fetch
// (แทน API จริงตอนนี้)
// =====================
async function fetchPriceSeries(symbol, points) {
  let price = symbol === "XAUUSD" ? 2350 : 180;
  let arr = [];

  for (let i = 0; i < points; i++) {
    price += (Math.random() - 0.45) * (symbol === "XAUUSD" ? 6 : 2);
    arr.push(Number(price.toFixed(2)));
  }
  return arr;
}

// =====================
// Render Card
// =====================
async function renderSymbol(symbol) {
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `<h2>${symbol}</h2><canvas></canvas>`;
  dashboard.appendChild(card);

  const prices = await fetchPriceSeries(symbol, 40);

  // slope & volatility
  const slope = prices.at(-1) - prices.at(-5);
  const vol =
    prices.reduce((a, b) => a + Math.abs(b - prices[0]), 0) / prices.length / 10;

  const riskD = calcRisk(slope * 0.6, vol);
  const risk2H = calcRisk(slope * 0.8, vol);
  const risk1H = calcRisk(slope, vol);

  const maxRisk = Math.max(riskD, risk2H, risk1H);

  const state =
    maxRisk >= 4.5
      ? "HIGH RISK"
      : maxRisk < 2.5
      ? "BUY"
      : "WATCH";

  const badgeClass = riskClass(maxRisk);
  const blink = maxRisk >= 4.5 ? "blink" : "";

  const riskBox = document.createElement("div");
  riskBox.className = "risk";
  riskBox.innerHTML = `
    <div>D: ${riskD}</div>
    <div>2H: ${risk2H}</div>
    <div>1H: ${risk1H}</div>
    <div class="badge ${badgeClass} ${blink}">${state}</div>
  `;
  card.appendChild(riskBox);

  // Chart
  const ctx = card.querySelector("canvas");
  new Chart(ctx, {
    type: "line",
    data: {
      labels: prices.map((_, i) => i - prices.length + 1),
      datasets: [
        {
          data: prices,
          borderColor: "#f5c97a",
          tension: 0.3
        }
      ]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { x: { display: false } }
    }
  });
}

// =====================
// Init
// =====================
async function init() {
  const res = await fetch("./data/symbols.json");
  const json = await res.json();
  json.symbols.forEach(renderSymbol);
}

function addSymbol() {
  const v = document.getElementById("symbolInput").value.trim().toUpperCase();
  if (v) renderSymbol(v);
}

init();
