/* Pure task logic: dates, grouping, sorting, import cleanup. No DOM, no Firebase. */

const pad = (n) => String(n).padStart(2, "0");
export const DAY_MS = 86400000;

export function ymd(d){ return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function todayYMD(){ return ymd(new Date()); }
export function parseYMD(s){ const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n){ const d = parseYMD(s); d.setDate(d.getDate() + n); return ymd(d); }
export function daysUntil(due){ return Math.round((parseYMD(due) - parseYMD(todayYMD())) / DAY_MS); }

export function normalize(s){ return (s ?? "").toString().toLowerCase().trim(); }

/* ---------- Sections ---------- */
export function sectionOf(t){
  if(t.section === "due" || t.section === "general") return t.section;
  return t.due ? "due" : "general";
}

/* ---------- Due dates ---------- */
export function isLate(t, now = new Date()){
  if(!t.due || t.completed) return false;
  const n = daysUntil(t.due);
  if(n < 0) return true;
  if(n === 0 && t.dueTime){
    const [h, m] = t.dueTime.split(":").map(Number);
    return now.getHours() * 60 + now.getMinutes() > h * 60 + m;
  }
  return false;
}

export const BUCKETS = [
  { key: "overdue",  label: "OVERDUE" },
  { key: "today",    label: "TODAY" },
  { key: "tomorrow", label: "TOMORROW" },
  { key: "week",     label: "THIS WEEK" },
  { key: "later",    label: "LATER" },
  { key: "nodate",   label: "NEEDS A DATE" },
  { key: "done",     label: "DONE" }
];

export function bucketOf(t){
  if(t.completed) return "done";
  if(!t.due) return "nodate";
  if(isLate(t)) return "overdue";
  const n = daysUntil(t.due);
  if(n === 0) return "today";
  if(n === 1) return "tomorrow";
  if(n <= 7) return "week";
  return "later";
}

const dueKey = (t) => `${t.due || "9999-99-99"} ${t.dueTime || "99:99"}`;
export function byDue(a, b){
  return dueKey(a).localeCompare(dueKey(b)) || (a.createdAt || 0) - (b.createdAt || 0);
}

/** Returns [{ key, label, tasks }] for non-empty buckets, in display order. */
export function groupByDue(tasks){
  const map = new Map(BUCKETS.map(b => [b.key, []]));
  tasks.forEach(t => map.get(bucketOf(t)).push(t));
  return BUCKETS
    .map(b => ({ ...b, tasks: map.get(b.key).sort(b.key === "done" ? byCompletedDesc : byDue) }))
    .filter(g => g.tasks.length);
}
const byCompletedDesc = (a, b) => (b.completedAt || 0) - (a.completedAt || 0);

export function formatTime(hhmm){
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toUpperCase();
}

export function formatDue(t){
  if(!t.due) return "NO DATE";
  const n = daysUntil(t.due);
  let s;
  if(n === 0) s = "TODAY";
  else if(n === 1) s = "TOMORROW";
  else if(n === -1) s = "YESTERDAY";
  else{
    const d = parseYMD(t.due);
    const opts = { weekday: "short", month: "short", day: "numeric" };
    if(d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    s = d.toLocaleDateString(undefined, opts).toUpperCase();
  }
  if(t.dueTime) s += " · " + formatTime(t.dueTime);
  return s;
}

export function lateLabel(t){
  if(!isLate(t)) return "";
  const n = -daysUntil(t.due);
  return n > 0 ? `${n} DAY${n > 1 ? "S" : ""} LATE` : "LATE";
}

/* ---------- General sorting ---------- */
function randWeight(id, seed){
  let h = 2166136261;
  const str = id + "|" + seed;
  for(let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0) / 4294967295;
}

export function sortGeneral(list, mode, seed){
  const byTitle = (a, b) => normalize(a.title).localeCompare(normalize(b.title));
  const sorters = {
    old: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
    new: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    az: byTitle,
    za: (a, b) => byTitle(b, a),
    timeLow: (a, b) => (a.estMinutes ?? Infinity) - (b.estMinutes ?? Infinity),
    timeHigh: (a, b) => (b.estMinutes ?? -Infinity) - (a.estMinutes ?? -Infinity),
    random: (a, b) => randWeight(a.id, seed) - randWeight(b.id, seed)
  };
  const sorter = sorters[mode] || sorters.old;
  // Completed tasks always sink to the bottom.
  return [...list].sort((a, b) => (Number(!!a.completed) - Number(!!b.completed)) || sorter(a, b));
}

/* ---------- Search ---------- */
export function matchesSearch(t, q){
  if(!q) return true;
  return [t.title, t.notes, t.estMinutes ? String(t.estMinutes) : ""]
    .map(normalize).join(" | ").includes(q);
}

/* ---------- Import (old Neocities export or new export) ---------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

export function cleanImported(x){
  const due = typeof x.due === "string" && DATE_RE.test(x.due) ? x.due : null;
  const dueTime = due && typeof x.dueTime === "string" && TIME_RE.test(x.dueTime) ? x.dueTime : null;
  const section = (x.section === "due" || x.section === "general")
    ? x.section
    : (due || x.timeSensitive ? "due" : "general");
  const est = Number(x.estMinutes);
  const completed = !!x.completed;
  return {
    title: (String(x.title || "").trim() || "Untitled").slice(0, 300),
    notes: String(x.notes || "").slice(0, 5000),
    estMinutes: est > 0 ? Math.round(est) : null,
    section,
    due: section === "due" ? due : null,
    dueTime: section === "due" ? dueTime : null,
    completed,
    completedAt: completed ? (Number(x.completedAt) || Date.now()) : null,
    createdAt: Number(x.createdAt) || Date.now(),
    updatedAt: Date.now()
  };
}

/** Same-ish task already exists? Used to skip duplicates on re-import. */
export function importKey(t){
  return `${normalize(t.title)}|${t.createdAt || ""}`;
}
