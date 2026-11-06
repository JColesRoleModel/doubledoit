/* Dashboard: read-only, big text, live-updating, keeps the screen awake. */
import { watchAuth, signIn, watchTasks, onDataError } from "./firebase.js";
import { sectionOf, groupByDue, sortGeneral, formatDue, lateLabel, formatTime } from "./tasks.js";

const $ = (s) => document.querySelector(s);
let tasks = [];
let unsub = null;

function h(tag, cls, ...kids){
  const el = document.createElement(tag);
  if(cls) el.className = cls;
  kids.flat().forEach(k => { if(k != null && k !== false) el.append(k); });
  return el;
}

onDataError((e) => console.error(e));

/* ---------- Clock ---------- */
function tick(){
  const now = new Date();
  $("#clock").textContent = formatTime(`${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`);
  $("#date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
}

/* ---------- Render ---------- */
function render(){
  const open = tasks.filter(t => !t.completed);
  const due = open.filter(t => sectionOf(t) === "due");
  const gen = open.filter(t => sectionOf(t) === "general");
  const groups = groupByDue(due);

  const n = (k) => groups.find(g => g.key === k)?.tasks.length || 0;
  const stats = $("#stats");
  stats.replaceChildren(
    stat(n("overdue"), "OVERDUE", "red"),
    stat(n("today"), "TODAY", "gold"),
    stat(n("tomorrow") + n("week"), "THIS WEEK", ""),
    stat(gen.length, "GENERAL", "cyan")
  );

  const dueEl = $("#dash-due");
  dueEl.replaceChildren();
  groups.forEach(g => {
    dueEl.append(h("div", `group-head g-${g.key}`, h("span", "", g.label), h("span", "count", String(g.tasks.length))));
    g.tasks.forEach(t => {
      const late = lateLabel(t);
      dueEl.append(h("div", `dash-item b-${g.key}`,
        h("div", "dash-item-title", t.title),
        h("div", "dash-item-meta", formatDue(t), late ? ` · ${late}` : "", t.estMinutes ? ` · ${t.estMinutes} MIN` : "")
      ));
    });
  });
  if(!groups.length) dueEl.append(h("div", "empty", "NOTHING DUE. ✦"));

  $("#gen-count").textContent = gen.length ? `(${gen.length})` : "";
  const genEl = $("#dash-gen");
  genEl.replaceChildren(...sortGeneral(gen, "old").map(t =>
    h("div", "dash-item", h("div", "dash-item-title", t.title),
      t.estMinutes ? h("div", "dash-item-meta", `${t.estMinutes} MIN`) : null)
  ));
  if(!gen.length) genEl.append(h("div", "empty", "ALL CLEAR. ✦"));
}

function stat(num, label, color){
  return h("div", `dash-stat ${color}${num ? "" : " zero"}`, h("div", "dash-stat-num", String(num)), h("div", "dash-stat-label", label));
}

/* ---------- Auth ---------- */
watchAuth((user) => {
  unsub?.(); unsub = null; tasks = [];
  if(!user){
    $("#grid").classList.add("hidden");
    $("#gate").classList.remove("hidden");
    $("#gate-text").textContent = "SIGN IN ONCE ON THIS SCREEN. IT STAYS SIGNED IN.";
    $("#btn-signin").classList.remove("hidden");
    return;
  }
  $("#gate").classList.add("hidden");
  $("#grid").classList.remove("hidden");
  unsub = watchTasks(user.uid, (list) => { tasks = list; render(); });
});

$("#btn-signin").onclick = async () => {
  try{ await signIn(); }
  catch(e){ $("#gate-hint").textContent = "SIGN-IN FAILED: " + (e.code || e.message); }
};

/* ---------- Keep the screen awake ---------- */
let wakeLock = null;
async function keepAwake(){
  try{
    if("wakeLock" in navigator && document.visibilityState === "visible"){
      wakeLock = await navigator.wakeLock.request("screen");
    }
  }catch{ /* not supported or denied; harmless */ }
}
document.addEventListener("visibilitychange", () => {
  if(document.visibilityState === "visible"){ keepAwake(); tick(); render(); }
});

/* ---------- Fullscreen + hide idle cursor ---------- */
$("#btn-fs").onclick = () => {
  if(document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
  keepAwake();
};
let idle;
document.addEventListener("mousemove", () => {
  document.body.classList.remove("idle");
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add("idle"), 3000);
});

tick();
setInterval(tick, 1000 * 10);
setInterval(render, 60 * 1000); // roll "today/late" over without a reload
keepAwake();
document.addEventListener("click", keepAwake, { once: true });

if("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
