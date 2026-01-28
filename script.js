// ===== mock price data (-30 → 0) =====
function generatePrices() {
  let p = 5200;
  return Array.from({ length: 31 }, () => {
    p += (Math.random() - 0.45) * 25;
    return Number(p.toFixed(2));
  });
}

// ===== slope =====
function slope(arr) {
  return arr[arr.length - 1] - arr[arr.length - 2];
}

// ===== risk mapping =====
function calcRisk(s) {
  return Math.min(5, Math.abs(s) / 5);
}

function riskColor(r) {
  if (r < 2) return "#2ecc71";
  if (r < 4.5) return "#f1c40f";
  return "#e74c3c";
}

// ===== main =====
const prices = generatePrices();
const s = slope(prices);
const last = prices[prices.length - 1];
const forecast = last + s;

// ===== chart =====
new Chart(document.getElementById("priceChart"), {
  type: "line",
  data: {
    labels: prices.map((_, i) => i - 30),
    datasets: [
      {
        data: prices,
        borderColor: "#f5c97a",
        tension: 0.35
      },
      {
        data: [...prices.slice(0, -1), null, forecast],
        borderColor: "#00ff99",
        borderDash: [6,6]
      }
    ]
  },
  options: {
    plugins:{ legend:{ display:false }},
    scales:{
      x:{ title:{ display:true, text:"Days (-30 → 0 → +1)" }}
    }
  }
});

// ===== risk scores =====
const riskD  = calcRisk(s * 1);
const risk2  = calcRisk(s * 0.7);
const risk1  = calcRisk(s * 0.4);

document.getElementById("score-d").textContent  = riskD.toFixed(1);
document.getElementById("score-2h").textContent = risk2.toFixed(1);
document.getElementById("score-1h").textContent = risk1.toFixed(1);

// ===== status =====
const maxRisk = Math.max(riskD, risk2, risk1);
const status = document.getElementById("statusBox");

if (maxRisk < 2) {
  status.textContent = "BUY";
  status.style.background = "#2ecc71";
} else if (maxRisk < 4.5) {
  status.textContent = "WATCH";
  status.style.background = "#f1c40f";
} else {
  status.textContent = "HIGH RISK";
  status.style.background = "#e74c3c";
  status.classList.add("blink");
}
