/* ==============================
   Screen Time Widget Prototype
   ==============================
   - Simulated timer for "today"
   - Threshold triggers: t_minus, t_zero, t_plus
   - Overlays with tone + emotional hook
   - Simple learning, persisted in localStorage

   Storage keys:
   - stw_state
   - stw_learning
*/

const els = {
  todayValue: document.getElementById("todayValue"),
  todaySub: document.getElementById("todaySub"),
  yesterdayValue: document.getElementById("yesterdayValue"),
  yesterdaySub: document.getElementById("yesterdaySub"),
  progressBar: document.getElementById("progressBar"),
  progressPct: document.getElementById("progressPct"),
  deltaToYesterday: document.getElementById("deltaToYesterday"),
  avg7Label: document.getElementById("avg7Label"),

  playPauseBtn: document.getElementById("playPauseBtn"),
  add5Btn: document.getElementById("add5Btn"),
  detailsBtn: document.getElementById("detailsBtn"),

  yesterdayInput: document.getElementById("yesterdayInput"),
  todayInput: document.getElementById("todayInput"),
  avg7Input: document.getElementById("avg7Input"),
  tMinusInput: document.getElementById("tMinusInput"),
  tPlusInput: document.getElementById("tPlusInput"),
  todInput: document.getElementById("todInput"),
  activity: document.getElementById("activity"),

  overlay: document.getElementById("overlay"),
  overlayKicker: document.getElementById("overlayKicker"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayBody: document.getElementById("overlayBody"),
  ctaPause: document.getElementById("ctaPause"),
  ctaLater: document.getElementById("ctaLater"),

  openSettingsBtn: document.getElementById("openSettingsBtn"),
  settingsDrawer: document.getElementById("settingsDrawer"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  saveSettings: document.getElementById("saveSettings"),
  cancelSettings: document.getElementById("cancelSettings"),
  goalInput: document.getElementById("goalInput"),
  tonePref: document.getElementById("tonePref"),
  langPref: document.getElementById("langPref"),

  resetLearning: document.getElementById("resetLearning"),
};

const initialState = {
  yesterday: 230,
  today: 0,
  avg7: 245,
  thresholds: { t_minus: 15, t_zero: 0, t_plus: 15 },
  timeOfDay: "evening",
  activity: "shortform",
  goal: 200,
  tonePref: "auto", // or motivational, mixed, confrontational
  lang: "en",

  // one-shot flags to avoid firing multiple times per session
  fired: { t_minus: false, t_zero: false, t_plus: false },
};

// Learning memory
const initialLearning = {
  // tone per trigger, starts at standard ladder
  toneByTrigger: {
    t_minus: "motivational",
    t_zero: "mixed",
    t_plus: "confrontational",
  },
  // hook scores, higher is more likely to be chosen
  // sleep, focus, social, regret, reward
  hookScores: {
    sleep: 0.6,
    focus: 0.4,
    social: 0.3,
    regret: 0.7,
    reward: 0.5,
  }
};

let state = load("stw_state", initialState);
let learning = load("stw_learning", initialLearning);
let tickHandle = null;

// ---------- Utils ----------
function load(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? {...fallback, ...JSON.parse(raw)} : structuredClone(fallback);
  }catch(e){
    return structuredClone(fallback);
  }
}
function save(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function minToHM(min){
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
function fmtPercent(x){ return `${Math.round(x * 100)}%`; }

// ---------- Copy bank ----------
const COPY = {
  en: {
    kicker: (tone, hook) => `${cap(tone)} • ${cap(hook)}`,
    // Titles and bodies receive vars: {left, over, minsTo, avg7Delta, goalDelta}
    lines: {
      sleep: {
        motivational: ({minsTo}) => [
          `You are ${minsTo} min under yesterday`,
          `Pause now and tomorrow will feel lighter.`,
        ],
        mixed: ({}) => [
          `You just matched yesterday`,
          `A short break now helps you fall asleep faster tonight.`,
        ],
        confrontational: ({}) => [
          `You are over`,
          `Stop now to protect your sleep.`,
        ]
      },
      focus: {
        motivational: ({minsTo}) => [
          `Close to yesterday, ${minsTo} min left`,
          `Five minutes off now resets your focus.`,
        ],
        mixed: ({}) => [
          `Matched`,
          `A quick pause now can prevent the post-scroll fog.`,
        ],
        confrontational: ({}) => [
          `Already over`,
          `Stop to cut the slump and save attention for what matters.`,
        ]
      },
      social: {
        motivational: ({}) => [
          `Nearly there`,
          `Pause now and trade 10 minutes of scroll for 10 minutes with someone you care about.`,
        ],
        mixed: ({}) => [
          `Matched`,
          `Call a friend now, not later.`,
        ],
        confrontational: ({}) => [
          `Over now`,
          `Step away and make room for real moments.`,
        ]
      },
      regret: {
        motivational: ({minsTo}) => [
          `You are ${minsTo} min away from yesterday`,
          `Stop now and skip the “lost time” feeling.`,
        ],
        mixed: ({}) => [
          `Matched`,
          `End here to avoid that “lost time” aftertaste.`,
        ],
        confrontational: ({}) => [
          `Over`,
          `Cut it now before it turns into another hour you wish you had back.`,
        ]
      },
      reward: {
        motivational: ({}) => [
          `Nice pace`,
          `Pause now and you beat your 7-day average.`,
        ],
        mixed: ({}) => [
          `Matched`,
          `Stopping now still keeps you ahead of your week trend.`,
        ],
        confrontational: ({}) => [
          `Over`,
          `Stopping here still rescues today’s score.`,
        ]
      }
    }
  },
  nl: {
    kicker: (tone, hook) => `${cap(tone)} • ${cap(hook)}`,
    lines: {
      sleep: {
        motivational: ({minsTo}) => [
          `Je zit ${minsTo} min onder gisteren`,
          `Stop nu en morgen voelt lichter.`,
        ],
        mixed: ({}) => [
          `Je hebt gisteren aangetikt`,
          `Een korte pauze helpt je vanavond sneller in slaap te vallen.`,
        ],
        confrontational: ({}) => [
          `Je zit eroverheen`,
          `Stop nu om je slaap te beschermen.`,
        ]
      },
      focus: {
        motivational: ({minsTo}) => [
          `Bijna bij gisteren, nog ${minsTo} min`,
          `Vijf minuten pauze reset je focus.`,
        ],
        mixed: ({}) => [
          `Gelijk aan gisteren`,
          `Een korte pauze voorkomt de na-scroll waas.`,
        ],
        confrontational: ({}) => [
          `Je bent al eroverheen`,
          `Stop om de dip te beperken en aandacht te bewaren.`,
        ]
      },
      social: {
        motivational: ({}) => [
          `Bijna daar`,
          `Ruil nu 10 minuten scrollen in voor 10 minuten met iemand die je belangrijk vindt.`,
        ],
        mixed: ({}) => [
          `Gelijk aan gisteren`,
          `Bel nu iemand, niet later.`,
        ],
        confrontational: ({}) => [
          `Er overheen`,
          `Leg weg en maak ruimte voor echte momenten.`,
        ]
      },
      regret: {
        motivational: ({minsTo}) => [
          `Je bent ${minsTo} min van gisteren`,
          `Stop nu en skip dat ‘tijd kwijt’ gevoel.`,
        ],
        mixed: ({}) => [
          `Gelijk aan gisteren`,
          `Stop hier om die nasmaak van ‘verloren tijd’ te voorkomen.`,
        ],
        confrontational: ({}) => [
          `Je zit eroverheen`,
          `Kap nu, voordat dit weer een uur wordt dat je terug wilt.`,
        ]
      },
      reward: {
        motivational: ({}) => [
          `Lekker tempo`,
          `Stop nu en je verslaat je 7-daags gemiddelde.`,
        ],
        mixed: ({}) => [
          `Gelijk aan gisteren`,
          `Stoppen nu houdt je nog voor op je weektrend.`,
        ],
        confrontational: ({}) => [
          `Je zit eroverheen`,
          `Stoppen hier redt je score van vandaag nog.`,
        ]
      }
    }
  }
};

function cap(s){ return s.slice(0,1).toUpperCase() + s.slice(1); }

// ---------- Learning helpers ----------
function pickHook(context){
  // Weight base on learning scores, then nudge with context
  const scores = {...learning.hookScores};

  // Context nudges
  if(state.activity === "shortform"){ scores.regret += 0.2; scores.focus += 0.1; }
  if(state.activity === "streaming" || state.activity === "gaming"){ scores.social += 0.1; scores.sleep += (state.timeOfDay === "evening" ? 0.2 : 0.05); }
  if(state.timeOfDay === "evening"){ scores.sleep += 0.15; }

  // Find max
  let best = "regret", bestVal = -Infinity;
  Object.entries(scores).forEach(([k,v]) => { if(v > bestVal){ best = k; bestVal = v; }});
  return best;
}

function nextTone(trigger, result){
  if(state.tonePref !== "auto") return state.tonePref;

  const order = ["motivational", "mixed", "confrontational"];
  let current = learning.toneByTrigger[trigger] || "mixed";
  let idx = order.indexOf(current);

  if(result === "acted" && idx > 0) idx -= 1;                // become softer
  if((result === "ignored" || result === "dismissed") && idx < order.length - 1) idx += 1; // become sharper

  const next = order[idx];
  learning.toneByTrigger[trigger] = next;
  save("stw_learning", learning);
  return next;
}

function reinforceHook(hook, result){
  const delta = result === "acted" ? +0.05 : -0.02;
  learning.hookScores[hook] = Math.max(0, Math.min(1.5, (learning.hookScores[hook] || 0.5) + delta));
  save("stw_learning", learning);
}

// ---------- Overlay logic ----------
function buildOverlay(trigger){
  const lang = state.lang;
  const tone = (state.tonePref === "auto") ? (learning.toneByTrigger[trigger] || "mixed") : state.tonePref;
  const hook = pickHook({trigger});

  const minsTo = Math.max(0, state.yesterday - state.today);
  const vars = {
    minsTo,
    left: minsTo,
    over: Math.max(0, state.today - state.yesterday),
    avg7Delta: state.avg7 - state.today,
    goalDelta: state.goal - state.today,
  };

  const L = COPY[lang].lines[hook][tone](vars);
  els.overlayKicker.textContent = COPY[lang].kicker(tone, hook);
  els.overlayTitle.textContent = L[0];
  els.overlayBody.textContent  = L[1];

  // Accent border per tone
  const card = els.overlay.querySelector(".overlay-card");
  card.style.borderColor = tone === "motivational" ? "rgba(66,200,138,0.7)" :
                           tone === "mixed" ? "rgba(246,198,99,0.7)" :
                           "rgba(239,107,107,0.7)";

  // Show
  els.overlay.setAttribute("aria-hidden", "false");

  // Wire actions
  const onAct = () => {
    els.overlay.setAttribute("aria-hidden", "true");
    markResult(trigger, "acted", hook);
  };
  const onLater = () => {
    els.overlay.setAttribute("aria-hidden", "true");
    markResult(trigger, "dismissed", hook);
  };

  els.ctaPause.onclick = onAct;
  els.ctaLater.onclick = onLater;
}

// Record outcome and adapt learning
function markResult(trigger, result, hook){
  const next = nextTone(trigger, result);
  reinforceHook(hook, result);
  // optional: simulate pausing by stopping timer on "acted"
  if(result === "acted"){ stopTick(); }
  // mark fired to avoid duplicates
  state.fired[trigger] = true;
  save("stw_state", state);
}

// ---------- Threshold checks ----------
function maybeTrigger(){
  const { t_minus, t_zero, t_plus } = state.thresholds;
  const diff = state.yesterday - state.today; // positive if under yesterday
  const over = state.today - state.yesterday;

  // t_minus window: within t_minus minutes of yesterday, but not reached yet
  if(!state.fired.t_minus && diff <= t_minus && diff > 0){
    state.fired.t_minus = true; save("stw_state", state);
    buildOverlay("t_minus");
    return;
  }

  // t_zero: exactly or first time crossing equal-or-over
  if(!state.fired.t_zero && diff <= 0 && over <= t_plus){
    state.fired.t_zero = true; save("stw_state", state);
    buildOverlay("t_zero");
    return;
  }

  // t_plus: more than t_plus beyond yesterday
  if(!state.fired.t_plus && over >= t_plus){
    state.fired.t_plus = true; save("stw_state", state);
    buildOverlay("t_plus");
    return;
  }
}

// ---------- Rendering ----------
function render(){
  // Clamp
  state.today = Math.max(0, state.today);
  state.yesterday = Math.max(0, state.yesterday);
  state.avg7 = Math.max(0, state.avg7);

  els.todayValue.textContent = minToHM(state.today);
  els.todaySub.textContent = `${state.today} min`;
  els.yesterdayValue.textContent = minToHM(state.yesterday);
  els.yesterdaySub.textContent = `${state.yesterday} min`;

  const pct = clamp01(state.today / Math.max(1, state.yesterday));
  els.progressBar.style.width = fmtPercent(pct);
  els.progressPct.textContent = fmtPercent(pct);

  const delta = state.yesterday - state.today;
  els.deltaToYesterday.textContent = delta >= 0 ? `${delta} min left` : `${Math.abs(delta)} min over`;

  els.avg7Label.textContent = `${state.lang === "nl" ? "7-daags gem." : "7-day avg"}: ${minToHM(state.avg7)}`;

  // panel inputs keep in sync
  els.todayInput.value = state.today;
  els.yesterdayInput.value = state.yesterday;
  els.avg7Input.value = state.avg7;
  els.tMinusInput.value = state.thresholds.t_minus;
  els.tPlusInput.value = state.thresholds.t_plus;
  els.todInput.value = state.timeOfDay;
  els.activity.value = state.activity;
}

function resetFired(){
  state.fired = { t_minus: false, t_zero: false, t_plus: false };
}

// ---------- Timer ----------
function tick(){
  state.today += 1; // 1 minute per tick
  save("stw_state", state);
  render();
  maybeTrigger();
}
function startTick(){
  if(tickHandle) return;
  els.playPauseBtn.textContent = "Pause";
  // 600ms per simulated minute keeps it lively, adjust as needed
  tickHandle = setInterval(tick, 600);
}
function stopTick(){
  if(!tickHandle) return;
  clearInterval(tickHandle);
  tickHandle = null;
  els.playPauseBtn.textContent = "Play";
}

// ---------- Events ----------
els.playPauseBtn.addEventListener("click", () => {
  if(tickHandle) stopTick(); else startTick();
});
els.add5Btn.addEventListener("click", () => {
  state.today += 5;
  save("stw_state", state);
  render();
  maybeTrigger();
});
els.detailsBtn.addEventListener("click", () => {
  alert(`Today: ${state.today} min\nYesterday: ${state.yesterday} min\n7-day avg: ${state.avg7} min\nActivity: ${state.activity}\nTime: ${state.timeOfDay}`);
});

els.yesterdayInput.addEventListener("input", e => {
  state.yesterday = parseInt(e.target.value || "0", 10);
  resetFired(); save("stw_state", state); render();
});
els.todayInput.addEventListener("input", e => {
  state.today = parseInt(e.target.value || "0", 10);
  save("stw_state", state); render();
});
els.avg7Input.addEventListener("input", e => {
  state.avg7 = parseInt(e.target.value || "0", 10);
  save("stw_state", state); render();
});
els.tMinusInput.addEventListener("input", e => {
  state.thresholds.t_minus = parseInt(e.target.value || "15", 10);
  resetFired(); save("stw_state", state); render();
});
els.tPlusInput.addEventListener("input", e => {
  state.thresholds.t_plus = parseInt(e.target.value || "15", 10);
  resetFired(); save("stw_state", state); render();
});
els.todInput.addEventListener("input", e => {
  state.timeOfDay = e.target.value;
  save("stw_state", state); render();
});
els.activity.addEventListener("input", e => {
  state.activity = e.target.value;
  save("stw_state", state); render();
});

// Overlay outside click to ignore
els.overlay.addEventListener("click", (e) => {
  if(e.target === els.overlay){
    els.overlay.setAttribute("aria-hidden","true");
    // Consider that as ignored
    // Do not change tone immediately to avoid accidental taps
  }
});
// As a safeguard, mark "ignored" if overlay stays open for long
let overlayTimer = null;
const observer = new MutationObserver(() => {
  if(els.overlay.getAttribute("aria-hidden") === "false"){
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
      els.overlay.setAttribute("aria-hidden","true");
      // Soft adapt: treat as ignored on t_zero default
      // We cannot know which trigger fired here without tracking
      // so we skip learning on timeout for simplicity.
    }, 12000);
  }else{
    clearTimeout(overlayTimer);
  }
});
observer.observe(els.overlay, { attributes: true, attributeFilter: ["aria-hidden"] });

// Settings drawer
els.openSettingsBtn.addEventListener("click", () => {
  // inject current values
  els.goalInput.value = state.goal;
  els.tonePref.value = state.tonePref;
  els.langPref.value = state.lang;
  els.settingsDrawer.setAttribute("aria-hidden", "false");
});
function closeDrawer(){ els.settingsDrawer.setAttribute("aria-hidden", "true"); }
els.closeSettingsBtn.addEventListener("click", closeDrawer);
els.cancelSettings.addEventListener("click", closeDrawer);
els.saveSettings.addEventListener("click", () => {
  state.goal = parseInt(els.goalInput.value || "0", 10);
  state.tonePref = els.tonePref.value;
  state.lang = els.langPref.value;
  save("stw_state", state);
  render();
  closeDrawer();
});

els.resetLearning.addEventListener("click", () => {
  if(confirm("Reset learning to defaults?")){
    learning = structuredClone(initialLearning);
    save("stw_learning", learning);
    alert("Learning reset.");
  }
});

// ---------- Boot ----------
function boot(){
  render();
  // If you want an initial auto-run for demos, uncomment next line
  // startTick();
}
boot();
