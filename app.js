/* ==============================
   Screen Time Widget Prototype
   (overlay pauzeert tijd; no time-of-day control)
============================== */

// ------- DOM refs -------
const els = {
  // widget
  todayValue: document.getElementById("todayValue"),
  todaySub: document.getElementById("todaySub"),
  yesterdayValue: document.getElementById("yesterdayValue"),
  yesterdaySub: document.getElementById("yesterdaySub"),
  progressBar: document.getElementById("progressBar"),
  progressPct: document.getElementById("progressPct"),
  deltaToYesterday: document.getElementById("deltaToYesterday"),
  avg7Label: document.getElementById("avg7Label"),

  // controls
  playPauseBtn: document.getElementById("playPauseBtn"),
  add5Btn: document.getElementById("add5Btn"),
  detailsBtn: document.getElementById("detailsBtn"),

  // right panel
  yesterdayInput: document.getElementById("yesterdayInput"),
  todayInput: document.getElementById("todayInput"),
  avg7Input: document.getElementById("avg7Input"),
  tMinusInput: document.getElementById("tMinusInput"),
  tPlusInput: document.getElementById("tPlusInput"),
  // todInput is niet meer zichtbaar; optioneel aanwezig
  todInput: document.getElementById("todInput"),
  activity: document.getElementById("activity"),
  carryCheckbox: document.getElementById("carryCheckbox"),
  nextDayBtn: document.getElementById("nextDayBtn"),
  resetLearning: document.getElementById("resetLearning"),

  // header/panel day labels
  dayChipValue: document.getElementById("dayChipValue"),
  dayLabelSide: document.getElementById("dayLabelSide"),

  // overlay
  overlay: document.getElementById("overlay"),
  overlayKicker: document.getElementById("overlayKicker"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayBody: document.getElementById("overlayBody"),
  ctaPause: document.getElementById("ctaPause"),
  ctaLater: document.getElementById("ctaLater"),
};

// ------- State -------
const initialState = {
  day: 1,
  yesterday: 230,
  today: 0,
  avg7: 245,
  thresholds: { t_minus: 15, t_zero: 0, t_plus: 15 },
  timeOfDay: "evening", // intern, geen UI
  activity: "shortform",
  goal: 200,
  tonePref: "auto",
  lang: "en",
  fired: { t_minus: false, t_zero: false, t_plus: false },

  // voor day-to-day context
  lastOutcome: null,            // "acted" | "dismissed" | null
  lastOutcomeStage: null,       // "t_minus" | "t_zero" | "t_plus" | null
};

const initialLearning = {
  toneByTrigger: { t_minus: "motivational", t_zero: "mixed", t_plus: "confrontational" },
  hookScores:    { sleep: 0.6, focus: 0.4, social: 0.3, regret: 0.7, reward: 0.5 },
};

let state    = load("stw_state", initialState);
let learning = load("stw_learning", initialLearning);
if (typeof state.day !== "number") state.day = 1;

let tickHandle = null;
let wasRunningBeforeOverlay = false; // pauze/herstart overlay

// ------- Utils -------
function load(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : structuredClone(fallback);
  }catch(e){ return structuredClone(fallback); }
}
function save(key, value){ localStorage.setItem(key, JSON.stringify(value)); }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function minToHM(min){ const h = Math.floor(min/60); const m = min%60; return `${h}h ${String(m).padStart(2,"0")}m`; }
function fmtPercent(x){ return `${Math.round(x*100)}%`; }
function cap(s){ return s.slice(0,1).toUpperCase()+s.slice(1); }

// Fake stats helpers
function seedRand(seedStr){
  let h=0; for(let i=0;i<seedStr.length;i++){ h = Math.imul(31,h) + seedStr.charCodeAt(i) | 0; }
  return () => { h = Math.imul(1664525,h+1013904223) | 0; return ((h>>>0)%1000)/1000; };
}

/**
 * Returns cohort insight for given "today" minutes.
 * betterThan = percentage of cohort you are beating (you have less screen time than X% of peers).
 */
function fakeStats({day, activity, timeOfDay, stage, todayMin, avg7}){
  const rnd = seedRand(`${day}-${activity}-${timeOfDay}-${stage}-${todayMin}-${avg7}`);
  const betterThan = Math.floor(40 + rnd()*50); // 40–90
  const weekDelta  = avg7 - todayMin;           // positive means under avg
  const cohortAvg  = Math.max(0, Math.round(todayMin + (rnd()*40 - 20)));
  const labels = {
    shortform: "short-form scrollers",
    streaming: "streamers",
    gaming:    "gamers",
    social:    "social users",
    other:     "users",
  };
  return { betterThan, weekDelta, cohortAvg, cohortLabel: labels[activity] || "users" };
}

// ------- Copy: titles zonder em-dash -------
const TITLE_VARIANTS = {
  motivational: ["Yes! Early win", "Crushing it", "Nice pace", "On top of your time"],
  mixed:        ["Careful, tipping point", "On the edge", "Borderline scroll", "Right on the line"],
  confrontational: ["Over the limit", "Time sink alert", "Snap out of it", "Break the loop"],
};

// ------- Learning -------
function pickHook(){
  // hook is niet zichtbaar, maar blijft intern voor learning
  const s = { ...learning.hookScores };
  if (state.activity === "shortform"){ s.regret += 0.2; s.focus += 0.1; }
  if (state.activity === "streaming" || state.activity === "gaming"){
    s.social += 0.1; s.sleep += (state.timeOfDay === "evening" ? 0.2 : 0.05);
  }
  if (state.timeOfDay === "evening"){ s.sleep += 0.15; }

  let best="regret", bestVal=-Infinity;
  Object.entries(s).forEach(([k,v])=>{ if(v>bestVal){best=k;bestVal=v;}});
  return best;
}
function nextTone(trigger, result){
  if (state.tonePref !== "auto") return state.tonePref;
  const order = ["motivational", "mixed", "confrontational"];
  let cur = learning.toneByTrigger[trigger] || "mixed";
  let i = order.indexOf(cur);
  if (result === "acted" && i>0) i -= 1;                           // zachter bij goed gedrag
  if ((result==="ignored"||result==="dismissed") && i<order.length-1) i += 1; // scherper bij negeren
  learning.toneByTrigger[trigger] = order[i];
  save("stw_learning", learning);
  return order[i];
}
function reinforceHook(hook, result){
  const d = result === "acted" ? +0.05 : -0.02;
  learning.hookScores[hook] = Math.max(0, Math.min(1.5, (learning.hookScores[hook]||0.5) + d));
  save("stw_learning", learning);
}

// ------- Helpers voor boodschap-opbouw -------
function yesterdayLine(){
  if (state.day <= 1) return "";
  const stg = state.lastOutcomeStage;
  const out = state.lastOutcome;
  if (!stg) return "";

  if (out === "acted"){
    if (stg === "t_minus") return "Yesterday you stopped early. Bank another early win today.";
    if (stg === "t_zero")  return "Yesterday you stopped right at the line. Try to stop a little earlier today.";
    if (stg === "t_plus")  return "Yesterday you stopped after you were over yesterday's time. Aim to cut sooner today.";
  } else if (out === "dismissed"){
    if (stg === "t_plus")  return "Yesterday you kept going after the late nudge. Let's cap the spill earlier today.";
    if (stg === "t_zero")  return "Yesterday you pushed past the match point. Consider stopping a bit sooner today.";
    if (stg === "t_minus") return "Yesterday you skipped the early nudge. Give yourself an early win today.";
  }
  return "";
}

/**
 * Bouw een duidelijke, specifieke body die stop-nu > doorgaan communiceert.
 * Nieuwe regels:
 * - Motivational: GEEN projectiezin. Alleen stop-nu + trend.
 * - Mixed: projectiezin is ALTIJD negatief geformuleerd (doorgaan maakt je slechter today).
 * - Confrontational: nu-stand is negatief, projectie is ook negatief.
 * - Alle zinnen benoemen expliciet "today".
 */
function buildBody(tone, stage){
  // extra minuten om te projecteren per moment (gebruikt voor mixed/confrontational)
  const extra = stage === "early" ? 10 : stage === "match" ? 10 : 30;

  const now  = fakeStats({
    day: state.day, activity: state.activity, timeOfDay: state.timeOfDay,
    stage, todayMin: state.today, avg7: state.avg7
  });

  const proj = fakeStats({
    day: state.day, activity: state.activity, timeOfDay: state.timeOfDay,
    stage, todayMin: state.today + extra, avg7: state.avg7
  });

  // Richting forceren: projectie is ongunstiger dan nu
  let betterNow  = now.betterThan;    // % dat jij vandaag verslaat (minder dan jij)
  let betterProj = proj.betterThan;

  // Maak projectie altijd <= nu, met marge
  if (betterProj > betterNow) {
    betterProj = Math.max(0, betterNow - Math.max(3, Math.round(extra / 4)));
  }

  // Voor confrontational gebruiken we "worse than"
  const worseNow  = 100 - betterNow;
  let worseProj   = 100 - betterProj;

  // Zorg dat worseProj >= worseNow (doorgaan is slechter)
  if (worseProj < worseNow) {
    worseProj = Math.min(100, worseNow + Math.max(3, Math.round(extra / 4)));
    betterProj = 100 - worseProj; // consistent
  }

  const cohort = now.cohortLabel;
  const yLine = yesterdayLine();

  const trendLineNow = now.weekDelta >= 0
    ? `You are ${minToHM(now.weekDelta)} under your 7-day average today.`
    : `You are ${minToHM(Math.abs(now.weekDelta))} over your 7-day average today.`;

  // Stop-nu zin
  const stopNowLine =
    tone === "confrontational"
      ? `Right now you have more screen time than about ${worseNow}% of ${cohort} today.`
      : `If you stop now, you will have less screen time than about ${betterNow}% of ${cohort} today.`;

  // Projectiezin per tone (alleen als het iets negatiefs benadrukt)
  let continueLine = "";
  if (tone === "mixed") {
    continueLine = `If you keep scrolling for ${extra} more minutes, you will have more screen time than about ${worseProj}% of ${cohort} today.`;
  } else if (tone === "confrontational") {
    continueLine = `Every extra ${extra} minutes puts you behind about ${worseProj}% of ${cohort} today.`;
  }
  // Motivational bevat GEEN continueLine

  const closer =
    tone === "motivational" ? "Lock this in with a short pause."
      : tone === "mixed"    ? "Small decision, big effect. Take a short pause."
      : "Cut it now and cap the loss.";

  // Combineer, zonder em-dashes en zonder ‘positieve’ projecties
  return [yLine, stopNowLine, trendLineNow, continueLine, closer]
    .filter(Boolean)
    .join(" ");
}

// ------- Overlay (pauzeer timer tot klik) -------
function buildOverlay(trigger){
  const stage = trigger === "t_minus" ? "early" : (trigger === "t_zero" ? "match" : "over");

  // baseline tone per trigger, tenzij user-pref
  let tone  = (state.tonePref === "auto")
    ? (learning.toneByTrigger[trigger] || (stage==="early"?"motivational":stage==="match"?"mixed":"confrontational"))
    : state.tonePref;

  // starttoon kleuren o.b.v. gisteren wanneer dag net begint
  if (state.today === 0 && !state.fired.t_minus && state.lastOutcomeStage){
    if (state.lastOutcome === "acted"){
      if (state.lastOutcomeStage === "t_minus") tone = "motivational";
      if (state.lastOutcomeStage === "t_zero")  tone = "mixed";
      if (state.lastOutcomeStage === "t_plus")  tone = "mixed";
    } else if (state.lastOutcome === "dismissed"){
      if (state.lastOutcomeStage === "t_plus")  tone = "confrontational";
      if (state.lastOutcomeStage === "t_zero")  tone = "mixed";
      if (state.lastOutcomeStage === "t_minus") tone = "mixed";
    }
  }

  const titles   = TITLE_VARIANTS[tone];
  const title    = titles[(state.day + titles.length) % titles.length];
  const body     = buildBody(tone, stage);

  // Kicker: alleen toon
  els.overlayKicker.textContent = cap(tone);
  els.overlayTitle.textContent  = title;
  els.overlayBody.textContent   = body;

  // Tone accent
  els.overlay.querySelector(".overlay-card").style.borderColor =
    tone==="motivational" ? "rgba(66,200,138,0.7)" :
    tone==="mixed"        ? "rgba(246,198,99,0.7)" :
                            "rgba(239,107,107,0.7)";

  // Pauzeer tot klik
  wasRunningBeforeOverlay = !!tickHandle;
  stopTick();
  els.overlay.setAttribute("aria-hidden", "false");

  const closeOverlay = (result) => {
    els.overlay.setAttribute("aria-hidden","true");
    if (result) {
      state.lastOutcome = result;
      state.lastOutcomeStage = trigger;
      // learning updates
      const hook = pickHook(); // intern
      nextTone(trigger, result);
      reinforceHook(hook, result);
      if (result === "acted") stopTick();
      save("stw_state", state);
    }
    // hervat alleen als hij liep en user NIET "acted" deed
    if (wasRunningBeforeOverlay && result !== "acted") startTick();
  };

  els.ctaPause.onclick = () => closeOverlay("acted");
  els.ctaLater.onclick = () => closeOverlay("dismissed");
  // Klik buiten de kaart: sluiten (geen learning)
  els.overlay.onclick = (e) => { if (e.target === els.overlay) closeOverlay(null); };
}

// ------- Threshold checks -------
function maybeTrigger(){
  const { t_minus, t_zero, t_plus } = state.thresholds;
  const diff = state.yesterday - state.today;
  const over = state.today - state.yesterday;

  if (!state.fired.t_minus && diff <= t_minus && diff > 0){
    state.fired.t_minus = true; save("stw_state", state); buildOverlay("t_minus"); return;
  }
  if (!state.fired.t_zero && diff <= 0 && over <= t_plus){
    state.fired.t_zero = true; save("stw_state", state); buildOverlay("t_zero"); return;
  }
  if (!state.fired.t_plus && over >= t_plus){
    state.fired.t_plus = true; save("stw_state", state); buildOverlay("t_plus"); return;
  }
}

// ------- Render -------
function render(){
  state.today     = Math.max(0, state.today);
  state.yesterday = Math.max(0, state.yesterday);
  state.avg7      = Math.max(0, state.avg7);

  els.todayValue.textContent     = minToHM(state.today);
  els.todaySub.textContent       = `${state.today} min`;
  els.yesterdayValue.textContent = minToHM(state.yesterday);
  els.yesterdaySub.textContent   = `${state.yesterday} min`;

  const pct = clamp01(state.today / Math.max(1, state.yesterday));
  els.progressBar.style.width = fmtPercent(pct);
  els.progressPct.textContent = fmtPercent(pct);

  const delta = state.yesterday - state.today;
  els.deltaToYesterday.textContent = delta >= 0 ? `${delta} min left` : `${Math.abs(delta)} min over`;

  els.avg7Label.textContent = `${state.lang === "nl" ? "7-daags gem." : "7-day avg"}: ${minToHM(state.avg7)}`;

  // panel sync
  els.todayInput.value     = state.today;
  els.yesterdayInput.value = state.yesterday;
  els.avg7Input.value      = state.avg7;
  els.tMinusInput.value    = state.thresholds.t_minus;
  els.tPlusInput.value     = state.thresholds.t_plus;

  // day chips
  if (els.dayChipValue) els.dayChipValue.textContent = String(state.day);
  if (els.dayLabelSide) els.dayLabelSide.textContent = `Day ${state.day}`;
}

function resetFired(){ state.fired = { t_minus:false, t_zero:false, t_plus:false }; }

// ------- Day flow -------
function nextDay(){
  const carry = !!els.carryCheckbox?.checked;
  if (carry) state.yesterday = state.today;

  state.today = 0;
  state.day   = (state.day||1) + 1;
  resetFired();

  // simpele moving average
  state.avg7 = Math.round((state.avg7*6 + state.yesterday)/7);

  save("stw_state", state);
  render();
}

// ------- Timer -------
function tick(){
  state.today += 1; // +1 minute
  save("stw_state", state);
  render();
  maybeTrigger();
}
function startTick(){
  if (tickHandle) return;
  els.playPauseBtn.textContent = "Pause";
  tickHandle = setInterval(tick, 600);
}
function stopTick(){
  if (!tickHandle) return;
  clearInterval(tickHandle);
  tickHandle = null;
  els.playPauseBtn.textContent = "Play";
}

// ------- Events -------
els.playPauseBtn.addEventListener("click", () => { tickHandle ? stopTick() : startTick(); });
els.add5Btn.addEventListener("click", () => { state.today += 5; save("stw_state", state); render(); maybeTrigger(); });
els.detailsBtn.addEventListener("click", () => {
  alert(`Day ${state.day}
Today: ${state.today} min
Yesterday: ${state.yesterday} min
7-day avg: ${state.avg7} min
Activity: ${state.activity}`);
});

els.yesterdayInput.addEventListener("input", e => { state.yesterday = parseInt(e.target.value||"0",10); resetFired(); save("stw_state", state); render(); });
els.todayInput.addEventListener("input",     e => { state.today     = parseInt(e.target.value||"0",10); save("stw_state", state); render(); });
els.avg7Input.addEventListener("input",      e => { state.avg7      = parseInt(e.target.value||"0",10); save("stw_state", state); render(); });
els.tMinusInput.addEventListener("input",    e => { state.thresholds.t_minus = parseInt(e.target.value||"15",10); resetFired(); save("stw_state", state); render(); });
els.tPlusInput.addEventListener("input",     e => { state.thresholds.t_plus  = parseInt(e.target.value||"15",10); resetFired(); save("stw_state", state); render(); });
els.activity.addEventListener("input",       e => { state.activity  = e.target.value; save("stw_state", state); render(); });

els.nextDayBtn.addEventListener("click", nextDay);

// Reset learning + day
els.resetLearning.addEventListener("click", () => {
  if (confirm("Reset learning to defaults and go back to Day 1?")){
    learning = structuredClone(initialLearning);
    save("stw_learning", learning);
    state = { ...structuredClone(initialState) };
    save("stw_state", state);
    alert("Learning and Day reset.");
    render();
  }
});

// ------- Boot -------
function boot(){
  // Verwijder de "Time of day" rij uit het paneel (indien nog aanwezig in HTML)
  const todRow = els.todInput?.closest(".row");
  if (todRow) todRow.remove();

  render();
  // startTick(); // optioneel
}
boot();
