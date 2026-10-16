/* ==========================================================
   DigitalCarbon – script.js
   ----------------------------------------------------------
   1. CONFIG            -> ALL assumptions & emission factors (edit here!)
   2. Calculation engine -> energy (kWh) x grid factor = kg CO2e
   3. Validation, charts, dashboard, What-If, recommendations
   ========================================================== */

"use strict";

/* ==========================================================
   1. CONFIG – every number the calculator uses lives here.
   These are simplified, rounded ASSUMPTIONS for educational
   use. Published studies report wide ranges, so change any
   value below and the whole site (including the assumptions
   table in the Methodology section) updates automatically.
   ========================================================== */
const CONFIG = {
  // Time conversions
  daysPerWeek: 7,
  daysPerYear: 365,
  daysPerMonth: 365 / 12,

  // Electricity emission factors: kg CO2e emitted per kWh of electricity.
  // Approximate national/regional averages – update with the latest official data if needed.
  gridRegions: {
    india: { label: "India (grid average)",        factor: 0.71 },
    world: { label: "World average",               factor: 0.45 },
    usa:   { label: "United States (average)",     factor: 0.37 },
    eu:    { label: "European Union (average)",    factor: 0.25 },
    uk:    { label: "United Kingdom (average)",    factor: 0.20 },
    green: { label: "Mostly renewable electricity", factor: 0.05 }
  },
  defaultRegion: "india",

  // A) Video streaming – kWh per hour of viewing
  //    (device + home network + data-centre share, lumped together)
  streaming: {
    labels: { sd: "SD (480p)", hd: "HD (720p)", fhd: "Full HD (1080p)", uhd: "4K" },
    kwhPerHour: { sd: 0.07, hd: 0.08, fhd: 0.08, uhd: 0.09 }
  },

  // B) Gaming – kWh per hour of play on each device
  gaming: {
    labels: { phone: "Smartphone", laptop: "Laptop", desktop: "Desktop PC", console: "Gaming console" },
    kwhPerHour: { phone: 0.012, laptop: 0.06, desktop: 0.25, console: 0.15 }
  },

  // C) AI usage – kWh per interaction (mostly data-centre energy).
  //    Highly uncertain: depends on model size, hardware, output length and data-centre efficiency.
  ai: {
    labels: { light: "Light", standard: "Standard", heavy: "Heavy" },
    kwhPerInteraction: { light: 0.0001, standard: 0.00024, heavy: 0.0039 }
  },

  // D) Cloud storage – kWh used to keep 1 GB stored for a full year
  cloud: { kwhPerGBPerYear: 0.02 },

  // E) Video conferencing – kWh per hour for YOU, plus an allowance for each extra participant
  //    (server load grows with group size). Participants counted are capped for realism.
  videoCall: {
    video: { base: 0.10,  perExtraParticipant: 0.012 },
    audio: { base: 0.03,  perExtraParticipant: 0.003 },
    maxParticipantsCounted: 25,
    labels: { on: "Camera on (video)", off: "Camera off (audio-only)" }
  },

  // F) Everyday device usage – kWh per hour of use
  devices: {
    labels: { laptop: "Laptop", desktop: "Desktop PC (with monitor)" },
    kwhPerHour: { laptop: 0.04, desktop: 0.15, phone: 0.005 }
  },

  // Rough comparison: kg CO2e per km for an average petrol car
  carKgPerKm: 0.17,

  // Digital Eco Score (educational indicator, NOT an official rating)
  // score = 100 x (1 - monthly kg CO2e / maxMonthlyKg), limited to 0–100
  score: {
    maxMonthlyKg: 50,   // monthly footprint that scores 0
    lowFrom: 70,        // score >= 70  -> low estimated impact
    moderateFrom: 40,   // score 40–69  -> moderate; below 40 -> high
    ringColors: { low: "#16a34a", moderate: "#f59e0b", high: "#ef4444" }
  },

  // Recommendations: assumed cut used for the "possible saving" line on each card
  recommendationCut: 0.25
};

/* Display info for the six categories (names, icons, chart colours) */
const CATEGORIES = [
  { key: "streaming", short: "Streaming",   long: "Video Streaming",    icon: "🎬", color: "#10b981" },
  { key: "gaming",    short: "Gaming",      long: "Gaming",             icon: "🎮", color: "#3b82f6" },
  { key: "ai",        short: "AI",          long: "AI Usage",           icon: "🤖", color: "#8b5cf6" },
  { key: "cloud",     short: "Cloud",       long: "Cloud Storage",      icon: "☁️", color: "#f59e0b" },
  { key: "videoCall", short: "Video Calls", long: "Video Conferencing", icon: "📞", color: "#ec4899" },
  { key: "devices",   short: "Devices",     long: "Device Usage",       icon: "💻", color: "#64748b" }
];

/* Recommendation texts, one per category */
const RECOMMENDATIONS = {
  streaming: { icon: "🎬", title: "Reduce unnecessary streaming",
    text: "Lowering streaming time or video quality can reduce the estimated energy associated with your digital usage. On a phone or small screen, a lower resolution often looks almost the same." },
  gaming:    { icon: "🎮", title: "Optimize gaming time",
    text: "Consider reducing unnecessary gaming hours or using more energy-efficient hardware. Power-saving modes and turning consoles fully off (not standby) also help." },
  ai:        { icon: "🤖", title: "Use AI thoughtfully",
    text: "Combine several questions into one clear prompt, avoid repeated regeneration, and use a search or a calculator when a simple lookup is enough." },
  cloud:     { icon: "☁️", title: "Clean unused cloud data",
    text: "Remove unnecessary files and duplicate media where appropriate. Delete old backups, large downloads and photos you no longer need." },
  videoCall: { icon: "📞", title: "Optimize video calls",
    text: "Use audio-only mode when video is not necessary, and switch the camera off when you are only listening." },
  devices:   { icon: "💻", title: "Improve device efficiency",
    text: "Use power-saving settings and avoid leaving devices running when unnecessary. Lower screen brightness and enable sleep timers." }
};

/* ==========================================================
   2. CALCULATION ENGINE
   ----------------------------------------------------------
   Step 1: activity (hours, prompts, GB ...)  ->  energy in kWh per day
   Step 2: kWh per day x grid emission factor ->  kg CO2e per day
   Step 3: daily x days -> monthly and yearly estimates
   ========================================================== */

/** Energy (kWh/day) for each category from the user's inputs. */
function estimateEnergyPerDay(inp) {
  const c = CONFIG;
  const call = inp.vcCamera === "on" ? c.videoCall.video : c.videoCall.audio;
  const people = Math.min(inp.vcPeople, c.videoCall.maxParticipantsCounted);

  return {
    // hours/day x kWh per hour for chosen quality
    streaming: inp.streamHours * c.streaming.kwhPerHour[inp.streamQuality],

    // (hours/week / 7) x kWh per hour for chosen device
    gaming: (inp.gameHours / c.daysPerWeek) * c.gaming.kwhPerHour[inp.gameDevice],

    // prompts/day x kWh per interaction for chosen intensity
    ai: inp.aiPrompts * c.ai.kwhPerInteraction[inp.aiIntensity],

    // GB x kWh per GB-year x (months stored / 12), spread over 365 days
    cloud: (inp.cloudGB * c.cloud.kwhPerGBPerYear * (inp.cloudMonths / 12)) / c.daysPerYear,

    // (hours/week / 7) x (base energy + extra for each other participant)
    videoCall: (inp.vcHours / c.daysPerWeek) * (call.base + call.perExtraParticipant * (people - 1)),

    // laptop/PC hours x kWh/h + phone hours x kWh/h
    devices: inp.pcHours * c.devices.kwhPerHour[inp.pcType] + inp.phoneHours * c.devices.kwhPerHour.phone
  };
}

/** Full estimate: energy, kg CO2e per category, and daily/monthly/yearly totals. */
function calculateFootprint(inp, gridFactor) {
  const kwhDay = estimateEnergyPerDay(inp);
  const kgDay = {};
  let totalKwhDay = 0;
  let totalKgDay = 0;

  CATEGORIES.forEach(({ key }) => {
    kgDay[key] = kwhDay[key] * gridFactor;       // energy x emission factor = CO2e
    totalKwhDay += kwhDay[key];
    totalKgDay += kgDay[key];
  });

  const kgMonth = {};
  CATEGORIES.forEach(({ key }) => { kgMonth[key] = kgDay[key] * CONFIG.daysPerMonth; });

  return {
    kwhDay, kgDay, kgMonth,
    total: {
      kwhDay: totalKwhDay,
      kwhMonth: totalKwhDay * CONFIG.daysPerMonth,
      kgDay: totalKgDay,
      kgMonth: totalKgDay * CONFIG.daysPerMonth,
      kgYear: totalKgDay * CONFIG.daysPerYear
    }
  };
}

/** Digital Eco Score (0–100) and its band, from the monthly footprint. */
function calculateScore(kgMonth) {
  const s = CONFIG.score;
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - kgMonth / s.maxMonthlyKg))));
  let band = "high";
  if (score >= s.lowFrom) band = "low";
  else if (score >= s.moderateFrom) band = "moderate";
  return { score, band };
}

/* ==========================================================
   3. PAGE LOGIC
   ========================================================== */

const $ = (id) => document.getElementById(id);

/* Number inputs: ids and friendly names. Limits come from min/max in index.html. */
const FIELDS = [
  { id: "streamHours", name: "Streaming hours" },
  { id: "gameHours",   name: "Gaming hours" },
  { id: "aiPrompts",   name: "AI interactions" },
  { id: "cloudGB",     name: "Cloud storage" },
  { id: "cloudMonths", name: "Months stored", defaultValue: 12 },   // optional
  { id: "vcHours",     name: "Video call hours" },
  { id: "vcPeople",    name: "Participants" },
  { id: "pcHours",     name: "Laptop/PC hours" },
  { id: "phoneHours",  name: "Smartphone hours" }
];
const SELECTS = ["streamQuality", "gameDevice", "aiIntensity", "vcCamera", "pcType"];

/* What-If controls. 'factor' = how much the scenario starts reduced (0.5 = half). */
const WI_CONTROLS = [
  { key: "streamHours",   label: "Streaming",         unit: "hours/day",  step: 0.25, defMax: 8,   factor: 0.5 },
  { key: "streamQuality", label: "Streaming quality", type: "select", options: CONFIG.streaming.labels },
  { key: "gameHours",     label: "Gaming",            unit: "hours/week", step: 0.5,  defMax: 40,  factor: 0.5 },
  { key: "aiPrompts",     label: "AI interactions",   unit: "per day",    step: 1,    defMax: 60,  factor: 0.5 },
  { key: "vcHours",       label: "Video calls",       unit: "hours/week", step: 0.5,  defMax: 20,  factor: 0.6 },
  { key: "vcCamera",      label: "Video-call camera", type: "select", options: CONFIG.videoCall.labels },
  { key: "cloudGB",       label: "Cloud storage",     unit: "GB",         step: 5,    defMax: 500, factor: 1 },
  { key: "pcHours",       label: "Laptop / PC use",   unit: "hours/day",  step: 0.5,  defMax: 14,  factor: 1 },
  { key: "phoneHours",    label: "Smartphone use",    unit: "hours/day",  step: 0.5,  defMax: 14,  factor: 1 }
];

const DEMO_DATA = {
  streamHours: 3, streamQuality: "fhd",
  gameHours: 10, gameDevice: "laptop",
  aiPrompts: 20, aiIntensity: "standard",
  cloudGB: 150, cloudMonths: 12,
  vcHours: 5, vcPeople: 4, vcCamera: "on",
  pcHours: 6, pcType: "laptop",
  phoneHours: 4
};

/* App state */
const state = {
  inputs: null,      // validated user inputs (current habits)
  gridFactor: 0,
  regionKey: CONFIG.defaultRegion,
  current: null,     // footprint result for current habits
  scenario: null     // modified inputs for the What-If simulator
};
const charts = {};

/* ---------- small helpers ---------- */
function fmt(n) {
  if (n > 0 && n < 0.01) return "<0.01";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) { return String(+Number(n).toFixed(2)); }

let toastTimer;
function toast(msg, warn = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("warn", warn);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- navigation ---------- */
function initNav() {
  const toggle = $("navToggle");
  const links = $("navLinks");

  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  links.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", (e) => {
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      if (a.classList.contains("locked") && !state.current) {
        e.preventDefault();
        toast("Calculate your footprint first to unlock this section.", true);
        $("calculator").scrollIntoView({ behavior: "smooth" });
      }
    });
  });

  // lock result links until a footprint is calculated
  links.querySelectorAll("[data-needs-results]").forEach((a) => a.classList.add("locked"));

  // highlight the link of the section currently in view
  if ("IntersectionObserver" in window) {
    const map = { hotspot: "results" };
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const id = map[en.target.id] || en.target.id;
        links.querySelectorAll("a").forEach((a) =>
          a.classList.toggle("active", a.getAttribute("href") === "#" + id));
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    ["home", "calculator", "results", "hotspot", "whatif", "recommendations", "methodology"]
      .forEach((id) => { const el = $(id); if (el) obs.observe(el); });
  }
}

/* ---------- form setup ---------- */
function initGridSelect() {
  const sel = $("gridRegion");
  sel.innerHTML = "";
  Object.entries(CONFIG.gridRegions).forEach(([key, r]) => {
    const isDefault = key === CONFIG.defaultRegion;
    sel.add(new Option(`${r.label} – ${r.factor} kg CO₂e/kWh`, key, isDefault, isDefault));
  });
}

function clearErrors() {
  document.querySelectorAll(".error").forEach((e) => (e.textContent = ""));
  document.querySelectorAll("input.invalid").forEach((i) => i.classList.remove("invalid"));
}

/** Read and validate all inputs. Returns an inputs object, or null if something is invalid. */
function readAndValidate() {
  clearErrors();
  const values = {};
  let firstBad = null;

  FIELDS.forEach((f) => {
    const el = $(f.id);
    const errBox = document.querySelector(`.error[data-for="${f.id}"]`);
    const raw = el.value.trim();
    const num = Number(raw);
    const min = el.min !== "" ? Number(el.min) : 0;
    const max = Number(el.max);
    let msg = "";

    if (el.validity.badInput) {
      msg = "Please enter a valid number.";
    } else if (raw === "") {
      if (f.defaultValue !== undefined) { values[f.id] = f.defaultValue; return; }
      msg = "Please enter a value (type 0 if you don't use this).";
    } else if (!Number.isFinite(num)) {
      msg = "Please enter a valid number.";
    } else if (num < 0) {
      msg = "Negative values aren't allowed – please enter 0 or more.";
    } else if (num < min) {
      msg = `Please enter at least ${min}.`;
    } else if (num > max) {
      msg = `That looks too high – please enter ${max} or less.`;
    } else {
      values[f.id] = num;
      return;
    }

    errBox.textContent = msg;
    el.classList.add("invalid");
    if (!firstBad) firstBad = el;
  });

  if (firstBad) {
    firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
    firstBad.focus({ preventScroll: true });
    toast("Please fix the highlighted fields.", true);
    return null;
  }

  SELECTS.forEach((id) => { values[id] = $(id).value; });
  return values;
}

function fillDemo() {
  clearErrors();
  Object.entries(DEMO_DATA).forEach(([id, v]) => { $(id).value = v; });
  toast("Demo data loaded – now click “Calculate Footprint”.");
}

function resetAll() {
  $("calcForm").reset();
  $("gridRegion").value = CONFIG.defaultRegion;
  clearErrors();

  Object.keys(charts).forEach((k) => { charts[k].destroy(); delete charts[k]; });
  document.querySelectorAll(".result-section").forEach((s) => (s.hidden = true));
  document.querySelectorAll("[data-needs-results]").forEach((a) => a.classList.add("locked"));

  state.inputs = state.current = state.scenario = null;
  $("calculator").scrollIntoView({ behavior: "smooth" });
  toast("All values and charts cleared.");
}

/* ---------- main calculate action ---------- */
function onCalculate(e) {
  e.preventDefault();
  const inputs = readAndValidate();
  if (!inputs) return;

  state.regionKey = $("gridRegion").value;
  state.gridFactor = CONFIG.gridRegions[state.regionKey].factor;
  state.inputs = inputs;
  state.current = calculateFootprint(inputs, state.gridFactor);

  if (state.current.total.kgDay <= 0) {
    state.current = null;
    toast("Everything is zero – enter at least one activity above 0.", true);
    return;
  }

  // reveal result sections BEFORE drawing charts so they get correct sizes
  document.querySelectorAll(".result-section").forEach((s) => (s.hidden = false));
  document.querySelectorAll("[data-needs-results]").forEach((a) => a.classList.remove("locked"));

  renderDashboard();
  renderHotspot();
  renderScore();
  renderRecommendations();
  buildWhatIf();

  $("results").scrollIntoView({ behavior: "smooth" });
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  const t = state.current.total;
  $("totMonth").textContent = fmt(t.kgMonth);
  $("totYear").textContent = fmt(t.kgYear);
  $("totDay").textContent = fmt(t.kgDay);
  $("totKwh").textContent = fmt(t.kwhMonth);
  $("totKm").textContent = Math.round(t.kgYear / CONFIG.carKgPerKm).toLocaleString("en-US");

  // breakdown list (percentages computed from real results)
  $("breakdownList").innerHTML = CATEGORIES.map((c) => {
    const pct = (state.current.kgMonth[c.key] / t.kgMonth) * 100;
    return `<li><span class="dot" style="background:${c.color}"></span>${c.short}<span class="pct">${pct.toFixed(0)}%</span></li>`;
  }).join("");

  drawCharts();
}

function chartsAvailable() { return typeof Chart !== "undefined"; }

function drawCharts() {
  if (!chartsAvailable()) {
    document.querySelectorAll(".chart-box").forEach((b) => {
      b.innerHTML = '<p class="muted">Charts could not load. Please connect to the internet once so Chart.js can load, then refresh.</p>';
    });
    toast("Chart.js could not load – check your internet connection.", true);
    return;
  }

  Chart.defaults.font.family = '"Inter", system-ui, sans-serif';
  Chart.defaults.color = "#5b6f64";

  const labels = CATEGORIES.map((c) => c.short);
  const colors = CATEGORIES.map((c) => c.color);
  const monthly = CATEGORIES.map((c) => state.current.kgMonth[c.key]);
  const total = state.current.total.kgMonth;

  ["chartDoughnut", "chartBar"].forEach((k) => { if (charts[k]) charts[k].destroy(); });

  // Doughnut: share of each category
  charts.chartDoughnut = new Chart($("chartDoughnut"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: monthly, backgroundColor: colors, borderColor: "#fff", borderWidth: 3, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${fmt(ctx.parsed)} kg CO₂e/month (${((ctx.parsed / total) * 100).toFixed(1)}%)`
          }
        }
      }
    }
  });

  // Bar: kg per month per category
  charts.chartBar = new Chart($("chartBar"), {
    type: "bar",
    data: { labels, datasets: [{ label: "kg CO₂e / month", data: monthly, backgroundColor: colors, borderRadius: 8, maxBarThickness: 46 }] },
    options: {
      responsive: true, maintainAspectRatio: false, indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${fmt(ctx.parsed.x)} kg CO₂e/month` } }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: "#e8f1ea" }, title: { display: true, text: "kg CO₂e per month" } },
        y: { grid: { display: false } }
      }
    }
  });
}

/* ---------- hotspot ---------- */
function topCategories() {
  return CATEGORIES
    .map((c) => ({ ...c, kg: state.current.kgMonth[c.key] }))
    .sort((a, b) => b.kg - a.kg);
}

function renderHotspot() {
  const top = topCategories()[0];
  const pct = (top.kg / state.current.total.kgMonth) * 100;
  $("hotspotIcon").textContent = top.icon;
  $("hotspotName").textContent = top.long;
  $("hotspotText").textContent =
    `${top.long} contributes approximately ${pct.toFixed(0)}% of your estimated digital footprint.`;
  $("hotspotFill").style.width = "0";
  requestAnimationFrame(() => requestAnimationFrame(() => { $("hotspotFill").style.width = pct.toFixed(0) + "%"; }));
}

/* ---------- eco score ---------- */
function renderScore() {
  const { score, band } = calculateScore(state.current.total.kgMonth);
  const names = { low: "🟢 Low estimated impact", moderate: "🟡 Moderate estimated impact", high: "🔴 High estimated impact" };
  const cls = { low: "low", moderate: "mod", high: "high" };

  $("scoreNum").textContent = score;
  const ring = $("scoreRing");
  ring.style.setProperty("--pct", score);
  ring.style.setProperty("--c", CONFIG.score.ringColors[band]);
  const badge = $("scoreBadge");
  badge.textContent = names[band];
  badge.className = "badge " + cls[band];
}

/* ---------- recommendations ---------- */
function renderRecommendations() {
  const total = state.current.total.kgMonth;
  const top3 = topCategories().filter((c) => c.kg > 0).slice(0, 3);
  const cut = CONFIG.recommendationCut;

  const cards = top3.map((c, i) => {
    const r = RECOMMENDATIONS[c.key];
    const pct = (c.kg / total) * 100;
    const saving = c.kg * 12 * cut;
    return `
      <article class="rec">
        <div class="rank">Priority ${i + 1} · ${pct.toFixed(0)}% of your footprint</div>
        <h3>${r.icon} ${r.title}</h3>
        <p>${r.text}</p>
        <p class="saving">Cutting this category by ${Math.round(cut * 100)}% would save about ${fmt(saving)} kg CO₂e per year.</p>
      </article>`;
  });

  // Extra card when the chosen electricity grid is carbon-intensive
  if (state.gridFactor >= 0.4) {
    cards.push(`
      <article class="rec">
        <div class="rank">Bonus tip · electricity source</div>
        <h3>⚡ Prefer cleaner electricity</h3>
        <p>Your estimate uses a grid factor of ${state.gridFactor} kg CO₂e/kWh. Where possible, choose a green-power plan, use rooftop solar, or charge devices when renewable supply is high.</p>
        <p class="saving">With a mostly renewable supply (${CONFIG.gridRegions.green.factor} kg/kWh) the same habits would be roughly ${fmt(state.current.total.kwhMonth * 12 * CONFIG.gridRegions.green.factor)} kg CO₂e per year.</p>
      </article>`);
  }

  $("recGrid").innerHTML = cards.join("");
}

/* ---------- What-If simulator ---------- */
function defaultScenario(inputs) {
  const s = { ...inputs };
  WI_CONTROLS.forEach((c) => {
    if (c.type === "select") return;
    if (c.factor < 1) {
      const v = Math.round((inputs[c.key] * c.factor) / c.step) * c.step;
      s[c.key] = Math.max(0, Math.min(inputs[c.key], v));
    }
  });
  return s;
}

function buildWhatIf() {
  state.scenario = defaultScenario(state.inputs);
  renderWhatIfControls();
  drawCompareChart();
  updateScenario();
}

function renderWhatIfControls() {
  const cur = state.inputs;
  const sc = state.scenario;

  $("wiControls").innerHTML = WI_CONTROLS.map((c) => {
    if (c.type === "select") {
      const opts = Object.entries(c.options)
        .map(([v, l]) => `<option value="${v}" ${sc[c.key] === v ? "selected" : ""}>${l}</option>`).join("");
      return `
        <div class="wi-row">
          <div class="wi-head"><strong>${c.label}</strong><span class="wi-cur">Current: ${c.options[cur[c.key]]}</span></div>
          <select data-key="${c.key}" aria-label="${c.label}">${opts}</select>
        </div>`;
    }
    const max = Math.max(Math.ceil((cur[c.key] * 1.5) / c.step) * c.step, Math.ceil(c.defMax / 2 / c.step) * c.step, c.step);
    return `
      <div class="wi-row">
        <div class="wi-head"><strong>${c.label}</strong><span class="wi-cur">Current: ${fmtNum(cur[c.key])} ${c.unit}</span></div>
        <div class="wi-head"><span class="wi-new">Change to: <output>${fmtNum(sc[c.key])}</output> ${c.unit}</span></div>
        <input type="range" data-key="${c.key}" min="0" max="${max}" step="${c.step}" value="${sc[c.key]}" aria-label="${c.label} (${c.unit})" />
      </div>`;
  }).join("");
}

function onScenarioInput(e) {
  const t = e.target;
  const key = t.dataset && t.dataset.key;
  if (!key || !state.scenario) return;

  if (t.type === "range") {
    state.scenario[key] = Number(t.value);
    const out = t.closest(".wi-row").querySelector("output");
    if (out) out.textContent = fmtNum(t.value);
  } else {
    state.scenario[key] = t.value;
  }
  updateScenario();
}

/** Recalculate the scenario and refresh numbers + comparison chart. */
function updateScenario() {
  const sc = calculateFootprint(state.scenario, state.gridFactor);
  const curM = state.current.total.kgMonth;
  const newM = sc.total.kgMonth;
  const diff = curM - newM;
  const pct = curM > 0 ? (diff / curM) * 100 : 0;
  const worse = diff < 0;

  $("wiCur").textContent = fmt(curM);
  $("wiNew").textContent = fmt(newM);
  $("wiRedLabel").textContent = worse ? "INCREASE" : "REDUCTION";
  $("wiRed").textContent = fmt(Math.abs(diff));
  $("wiPct").textContent = `${Math.abs(pct).toFixed(1)}% ${worse ? "increase" : "reduction"}`;
  $("wiYear").textContent = `≈ ${fmt(Math.abs(diff) * 12)} kg CO₂e ${worse ? "more" : "saved"} per year`;
  $("wiRedCard").classList.toggle("worse", worse);

  state.scenarioResult = sc;

  if (charts.chartCompare) {
    charts.chartCompare.data.datasets[1].data = CATEGORIES.map((c) => sc.kgMonth[c.key]);
    charts.chartCompare.update();
  }
}

function drawCompareChart() {
  if (!chartsAvailable()) return;
  if (charts.chartCompare) charts.chartCompare.destroy();

  const sc = calculateFootprint(state.scenario, state.gridFactor);
  charts.chartCompare = new Chart($("chartCompare"), {
    type: "bar",
    data: {
      labels: CATEGORIES.map((c) => c.short),
      datasets: [
        { label: "Current",           data: CATEGORIES.map((c) => state.current.kgMonth[c.key]), backgroundColor: "#a9bfb0", borderRadius: 6 },
        { label: "What-If scenario",  data: CATEGORIES.map((c) => sc.kgMonth[c.key]),            backgroundColor: "#16a34a", borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)} kg CO₂e/month` } }
      },
      scales: {
        y: { beginAtZero: true, grid: { color: "#e8f1ea" }, title: { display: true, text: "kg CO₂e per month" } },
        x: { grid: { display: false } }
      }
    }
  });
}

/* ---------- methodology: assumptions table built from CONFIG ---------- */
function renderAssumptions() {
  const c = CONFIG;
  const rows = [];
  const add = (item, value, unit, note) => rows.push([item, value, unit, note || ""]);

  const gridNotes = {
    india: "FY 2024–25 grid average",
    world: "Provisional estimate; replace with a sourced annual factor",
    usa: "Approximate; year and methodology should be specified",
    eu: "Approximate; year and methodology should be specified",
    uk: "Approximate; year and methodology should be specified",
    green: "Illustrative low-carbon scenario"
  };
  Object.entries(c.gridRegions).forEach(([key, r]) =>
    add("Electricity – " + r.label, r.factor, "kg CO₂e / kWh", gridNotes[key]));
  const streamingNotes = {
    sd: "Illustrative scenario",
    hd: "IEA-based reference scenario",
    fhd: "Illustrative scenario",
    uhd: "Illustrative scenario"
  };
  Object.entries(c.streaming.kwhPerHour).forEach(([k, v]) =>
    add("Streaming – " + c.streaming.labels[k], v, "kWh / hour", streamingNotes[k]));
  Object.entries(c.gaming.kwhPerHour).forEach(([k, v]) =>
    add("Gaming – " + c.gaming.labels[k], v, "kWh / hour", "Average power while playing"));
  const aiNotes = {
    light: "Illustrative assumption",
    standard: "Based on Google's reported median for a Gemini Apps text prompt",
    heavy: "Illustrative high-compute scenario; not a universal average"
  };
  Object.entries(c.ai.kwhPerInteraction).forEach(([k, v]) =>
    add("AI – " + c.ai.labels[k] + " use", v, "kWh / interaction", aiNotes[k]));
  add("Cloud storage", c.cloud.kwhPerGBPerYear, "kWh / GB / year", "Scaled by months stored ÷ 12");
  add("Video call – camera on (you)", c.videoCall.video.base, "kWh / hour", "Plus extra per participant below");
  add("Video call – camera on, each extra participant", c.videoCall.video.perExtraParticipant, "kWh / hour", "Group-size allowance");
  add("Video call – audio-only (you)", c.videoCall.audio.base, "kWh / hour", "Plus extra per participant below");
  add("Video call – audio-only, each extra participant", c.videoCall.audio.perExtraParticipant, "kWh / hour", "Group-size allowance");
  add("Video call – participants counted (max)", c.videoCall.maxParticipantsCounted, "people", "Cap on group-size allowance");
  Object.entries(c.devices.kwhPerHour).forEach(([k, v]) =>
    add("Device – " + (c.devices.labels[k] || "Smartphone"), v, "kWh / hour", "Everyday use (browsing, work, study)"));
  add("Days per month / year", `${c.daysPerMonth.toFixed(2)} / ${c.daysPerYear}`, "days", "365 ÷ 12 for monthly estimates");
  add("Car comparison", c.carKgPerKm, "kg CO₂e / km", "Rough average petrol car");
  add("Eco Score reference", c.score.maxMonthlyKg, "kg CO₂e / month", "Footprint that scores 0 (score = 100 × (1 − footprint ÷ reference))");

  $("assumptionTable").innerHTML =
    "<thead><tr><th>Item</th><th>Value</th><th>Unit</th><th>Note</th></tr></thead><tbody>" +
    rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join("") +
    "</tbody>";
}

/* ---------- start-up ---------- */
function init() {
  initGridSelect();
  renderAssumptions();
  initNav();

  $("calcForm").addEventListener("submit", onCalculate);
  $("btnDemo").addEventListener("click", fillDemo);
  $("btnReset").addEventListener("click", resetAll);

  // clear a field's error as soon as the user edits it
  FIELDS.forEach((f) => {
    $(f.id).addEventListener("input", () => {
      $(f.id).classList.remove("invalid");
      const box = document.querySelector(`.error[data-for="${f.id}"]`);
      if (box) box.textContent = "";
    });
  });

  // What-If controls (event delegation)
  $("wiControls").addEventListener("input", onScenarioInput);
  $("wiControls").addEventListener("change", onScenarioInput);
  $("btnScenarioReset").addEventListener("click", () => {
    if (!state.inputs) return;
    state.scenario = { ...state.inputs };
    renderWhatIfControls();
    updateScenario();
    toast("Scenario reset to your current habits.");
  });
}

init();
