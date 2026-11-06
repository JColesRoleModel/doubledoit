/* TODO TABLETS — main app (Firebase-synced). */
import {
  watchAuth, signIn, logOut, watchTasks, createTask, patchTask, removeTask, bulkWrite, onDataError
} from "./firebase.js";
import {
  todayYMD, addDays, parseYMD, sectionOf, groupByDue, sortGeneral, matchesSearch, normalize,
  formatDue, lateLabel, bucketOf, cleanImported, importKey
} from "./tasks.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ---------- State ---------- */
const UI_KEY = "dd_ui_v1";
const defaultUI = {
  search: "", showCompleted: false, sortGeneral: "old", seedGeneral: Math.random(),
  tab: "due", quickWhen: "none"
};
const state = {
  user: null,
  tasks: [],
  loaded: false,
  unsubTasks: null,
  ui: { ...defaultUI, ...readUI() },
  modal: { editingId: null, section: "due" },
  quickDate: ""
};

function readUI(){
  try{ return JSON.parse(localStorage.getItem(UI_KEY)) || {}; }catch{ return {}; }
}
function saveUI(){
  try{ localStorage.setItem(UI_KEY, JSON.stringify(state.ui)); }catch{ /* private mode */ }
}

/* ---------- Tiny DOM helper ---------- */
function h(tag, props = {}, ...kids){
  const el = document.createElement(tag);
  for(const [k, v] of Object.entries(props)){
    if(v == null || v === false) continue;
    if(k === "class") el.className = v;
    else if(k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach(k => { if(k != null && k !== false) el.append(k); });
  return el;
}

/* ---------- Toast (with optional UNDO) ---------- */
function toast(msg, action){
  const t = $("#toast");
  t.replaceChildren(h("span", {}, msg));
  if(action){
    t.append(h("button", { class: "toast-btn", type: "button", onclick: () => {
      action.fn(); t.classList.add("hidden");
    } }, action.label));
  }
  t.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add("hidden"), action ? 4500 : 1500);
}

onDataError((e) => {
  console.error(e);
  const msg = e?.code === "permission-denied" ? "NOT ALLOWED — TRY SIGNING IN AGAIN" : "SYNC ERROR: " + (e?.code || e?.message || e);
  toast(msg);
});

/* ---------- Auth gate ---------- */
function showGate(text, { button = false, hint = "" } = {}){
  $("#gate").classList.remove("hidden");
  $$(".signed-in-only").forEach(el => el.classList.add("hidden"));
  $("#gate-text").textContent = text;
  $("#btn-signin").classList.toggle("hidden", !button);
  $("#gate-hint").textContent = hint;
}
function showApp(){
  $("#gate").classList.add("hidden");
  $$(".signed-in-only").forEach(el => el.classList.remove("hidden"));
}

watchAuth((user) => {
  state.unsubTasks?.();
  state.unsubTasks = null;
  state.user = user;
  state.tasks = [];
  state.loaded = false;

  if(!user){
    setSync("SIGNED OUT");
    showGate("SIGN IN TO SEE YOUR TASKS ON EVERY DEVICE.", { button: true });
    return;
  }

  $("#menu-user").textContent = user.email || user.displayName || "SIGNED IN";
  showApp();
  render();
  state.unsubTasks = watchTasks(user.uid, (tasks, meta) => {
    state.tasks = tasks;
    state.loaded = true;
    setSync(meta.pending ? "SAVING…" : meta.fromCache ? (navigator.onLine ? "SYNCING…" : "OFFLINE") : "SYNCED");
    render();
  });
});

function setSync(text){ $("#sync-status").textContent = text; }
window.addEventListener("offline", () => setSync("OFFLINE"));

/* ---------- Render ---------- */
function visibleTasks(){
  const q = normalize(state.ui.search);
  return state.tasks
    .filter(t => matchesSearch(t, q))
    .filter(t => state.ui.showCompleted || !t.completed);
}

function render(){
  if(!state.user) return;
  const vis = visibleTasks();
  const due = vis.filter(t => sectionOf(t) === "due");
  const gen = vis.filter(t => sectionOf(t) === "general");
  const openDue = due.filter(t => !t.completed).length;
  const openGen = gen.filter(t => !t.completed).length;

  $("#count-due").textContent = openDue;
  $("#count-general").textContent = openGen;
  $("#tab-count-due").textContent = openDue;
  $("#tab-count-general").textContent = openGen;

  // Due column: grouped by when.
  const listDue = $("#list-due");
  listDue.replaceChildren();
  const groups = groupByDue(due);
  groups.forEach(g => {
    listDue.append(h("div", { class: `group-head g-${g.key}` },
      h("span", {}, g.label), h("span", { class: "count" }, g.tasks.length)));
    g.tasks.forEach(t => listDue.append(taskCard(t)));
  });
  if(!groups.length) listDue.append(emptyState("due"));

  // General column: user-chosen sort.
  const listGen = $("#list-general");
  listGen.replaceChildren(...sortGeneral(gen, state.ui.sortGeneral, state.ui.seedGeneral).map(taskCard));
  if(!gen.length) listGen.append(emptyState("general"));

  // Mobile tabs
  $$(".tab").forEach(b => {
    const on = b.dataset.tab === state.ui.tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on);
  });
  $$(".col").forEach(c => c.classList.toggle("tab-hidden", c.dataset.col !== state.ui.tab));
}

function emptyState(section){
  if(!state.loaded) return h("div", { class: "empty" }, "LOADING…");
  if(state.ui.search) return h("div", { class: "empty" }, "NO MATCHES.");
  return h("div", { class: "empty" }, section === "due"
    ? "NOTHING DUE. PICK A DATE WHEN YOU ADD A TASK TO PUT IT HERE."
    : "NO GENERAL TASKS. ADD ONE ABOVE.");
}

function taskCard(t){
  const uid = state.user.uid;
  const section = sectionOf(t);
  const bucket = section === "due" ? bucketOf(t) : "";

  const meta = h("div", { class: "card-meta" });
  if(section === "due"){
    meta.append(h("div", { class: `tag due-tag b-${bucket}` }, formatDue(t)));
    const late = lateLabel(t);
    if(late) meta.append(h("div", { class: "tag red" }, late));
  }
  if(t.estMinutes) meta.append(h("div", { class: "tag" }, t.estMinutes + " MIN"));

  const toggleDone = () => {
    const completed = !t.completed;
    patchTask(uid, t.id, { completed, completedAt: completed ? Date.now() : null });
    toast(completed ? "MARKED DONE" : "RESTORED", completed
      ? { label: "UNDO", fn: () => patchTask(uid, t.id, { completed: false, completedAt: null }) }
      : null);
  };

  const move = () => {
    if(section === "general"){
      openModal(t.id, { section: "due" });
    }else{
      patchTask(uid, t.id, { section: "general", due: null, dueTime: null });
      toast("MOVED TO GENERAL");
    }
  };

  const del = () => {
    const { id, ...data } = t;
    removeTask(uid, id);
    toast("DELETED", { label: "UNDO", fn: () => createTask(uid, data) });
  };

  return h("div", { class: `card${t.completed ? " completed" : ""}${bucket === "overdue" ? " overdue" : ""}` },
    h("div", { class: "card-top" },
      h("button", {
        class: "check-btn", type: "button", "aria-label": t.completed ? "Mark not done" : "Mark done",
        onclick: toggleDone
      }, t.completed ? "✓" : ""),
      h("div", { class: "card-main", onclick: () => openModal(t.id) },
        h("div", { class: "card-title" }, t.title || "Untitled Task"),
        meta.childNodes.length ? meta : null
      )
    ),
    t.notes ? h("div", { class: "card-notes" }, t.notes) : null,
    h("div", { class: "card-actions" },
      h("div", { class: "actions-left" },
        h("div", { class: "tag faint" }, "ADDED " + new Date(t.createdAt || Date.now()).toLocaleDateString())),
      h("div", { class: "actions-right" },
        h("button", { class: "pill", type: "button", onclick: () => openModal(t.id) }, "EDIT"),
        h("button", { class: "pill", type: "button", onclick: move }, section === "due" ? "→ GENERAL" : "→ DUE"),
        h("button", { class: "pill red", type: "button", onclick: del }, "DELETE"))
    )
  );
}

/* ---------- Quick add ---------- */
function setQuickWhen(when){
  state.ui.quickWhen = when;
  $$(".chip-btn").forEach(b => {
    const on = b.dataset.when === when;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", on);
  });
  $("#quick-date-label").textContent = when === "pick" && state.quickDate
    ? "📅 " + parseYMD(state.quickDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()
    : "📅 DATE";
  saveUI();
}

function quickAdd(e){
  e.preventDefault();
  const title = $("#quick-title").value.trim();
  if(!title){ $("#quick-title").focus(); return; }
  const when = state.ui.quickWhen;
  let due = null;
  if(when === "today") due = todayYMD();
  if(when === "tomorrow") due = addDays(todayYMD(), 1);
  if(when === "pick") due = state.quickDate || null;

  createTask(state.user.uid, newTask({ title, section: due ? "due" : "general", due }));
  $("#quick-title").value = "";
  state.quickDate = "";
  $("#quick-date").value = "";
  setQuickWhen("none");
  state.ui.tab = due ? "due" : "general";
  toast(due ? "ADDED · " + formatDue({ due }) : "ADDED TO GENERAL");
  render();
}

function newTask(fields){
  const now = Date.now();
  return {
    title: "", notes: "", estMinutes: null, section: "general", due: null, dueTime: null,
    completed: false, completedAt: null, createdAt: now, updatedAt: now,
    ...fields
  };
}

/* ---------- Modal ---------- */
function setModalSection(section){
  state.modal.section = section;
  $$(".seg").forEach(b => {
    const on = b.dataset.section === section;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", on);
  });
  $("#due-wrap").classList.toggle("hidden", section !== "due");
  if(section === "due" && !$("#task-due").value) $("#task-due").value = todayYMD();
}

function openModal(editId = null, preset = {}){
  state.modal.editingId = editId;
  $("#modal-hint").textContent = "";
  const t = editId ? state.tasks.find(x => x.id === editId) : null;

  $("#modal-title").textContent = t ? "EDIT INSCRIPTION" : "INSCRIBE A TASK";
  $("#btn-save").textContent = t ? "UPDATE" : "SAVE";
  $("#task-title").value = t?.title || $("#quick-title").value.trim();
  $("#task-notes").value = t?.notes || "";
  $("#task-due").value = t?.due || "";
  $("#task-time").value = t?.dueTime || "";
  $("#has-est").checked = !!t?.estMinutes;
  $("#est-wrap").classList.toggle("hidden", !t?.estMinutes);
  $("#task-est").value = t?.estMinutes ? String(t.estMinutes) : "";

  const section = preset.section || (t ? sectionOf(t) : (state.ui.tab === "general" ? "general" : "due"));
  setModalSection(section);

  $("#modal").classList.remove("hidden");
  $("#menu").classList.add("hidden");
  if(preset.section === "due") $("#task-due").focus();
  else if(!t) $("#task-title").focus();
}

function closeModal(){
  $("#modal").classList.add("hidden");
  state.modal.editingId = null;
}

function saveModal(e){
  e.preventDefault();
  const hint = (m) => { $("#modal-hint").textContent = m; };
  const title = $("#task-title").value.trim();
  if(!title) return hint("TASK NAME REQUIRED.");

  const section = state.modal.section;
  const due = section === "due" ? ($("#task-due").value || null) : null;
  const dueTime = due ? ($("#task-time").value || null) : null;

  let estMinutes = null;
  if($("#has-est").checked){
    const n = Number($("#task-est").value.trim());
    if(!Number.isFinite(n) || n <= 0) return hint("ESTIMATE MUST BE A POSITIVE NUMBER.");
    estMinutes = Math.round(n);
  }

  const fields = { title, notes: $("#task-notes").value.trim(), section, due, dueTime, estMinutes };
  const uid = state.user.uid;

  if(state.modal.editingId){
    patchTask(uid, state.modal.editingId, fields);
    toast("UPDATED");
  }else{
    createTask(uid, newTask(fields));
    $("#quick-title").value = "";
    toast("SAVED");
  }
  state.ui.tab = section;
  closeModal();
  render();
}

/* ---------- Export / import / clear ---------- */
function exportJSON(){
  const data = state.tasks.map(({ id, ...rest }) => rest);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `todo-tablets-${todayYMD()}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importJSON(file){
  const parsed = JSON.parse(await file.text());
  const list = Array.isArray(parsed) ? parsed : parsed?.tasks;
  if(!Array.isArray(list)) throw new Error("That file doesn't look like a task export.");

  const existing = new Set(state.tasks.map(importKey));
  const fresh = list.map(cleanImported).filter(t => !existing.has(importKey(t)));
  const skipped = list.length - fresh.length;
  if(!fresh.length){ toast(skipped ? "ALL ALREADY IMPORTED" : "NOTHING TO IMPORT"); return; }
  if(!confirm(`IMPORT ${fresh.length} TASK${fresh.length > 1 ? "S" : ""}?` + (skipped ? ` (${skipped} DUPLICATES SKIPPED)` : ""))) return;
  await bulkWrite(state.user.uid, fresh);
  toast(`IMPORTED ${fresh.length}`);
}

function clearCompleted(){
  const done = state.tasks.filter(t => t.completed);
  if(!done.length){ toast("NO COMPLETED TASKS"); return; }
  if(!confirm(`PERMANENTLY DELETE ${done.length} COMPLETED TASK${done.length > 1 ? "S" : ""}?`)) return;
  bulkWrite(state.user.uid, [], done.map(t => t.id));
  toast("CLEARED");
}

/* ---------- Wire up ---------- */
function bind(){
  $("#btn-signin").onclick = async () => {
    $("#gate-hint").textContent = "";
    try{ await signIn(); }
    catch(e){ $("#gate-hint").textContent = "SIGN-IN FAILED: " + (e.code || e.message); }
  };

  $("#btn-add").onclick = () => openModal(null);

  const menu = $("#menu");
  $("#btn-menu").onclick = (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
    $("#btn-menu").setAttribute("aria-expanded", !menu.classList.contains("hidden"));
  };
  document.addEventListener("click", (e) => {
    if(!menu.contains(e.target)) menu.classList.add("hidden");
  });

  $("#btn-export").onclick = () => { menu.classList.add("hidden"); exportJSON(); };
  $("#btn-import").onclick = () => { menu.classList.add("hidden"); $("#import-file").value = ""; $("#import-file").click(); };
  $("#import-file").onchange = async (e) => {
    const f = e.target.files?.[0];
    if(!f) return;
    try{ await importJSON(f); }
    catch(err){ alert("IMPORT FAILED: " + err.message); }
  };
  $("#btn-clear-done").onclick = () => { menu.classList.add("hidden"); clearCompleted(); };
  $("#btn-signout").onclick = () => { menu.classList.add("hidden"); if(confirm("SIGN OUT ON THIS DEVICE?")) logOut(); };

  // Quick add
  $("#quick").addEventListener("submit", quickAdd);
  $$(".chip-btn").forEach(b => {
    if(b.dataset.when === "pick") return;
    b.onclick = () => { setQuickWhen(b.dataset.when); $("#quick-title").focus({ preventScroll: true }); };
  });
  const qd = $("#quick-date");
  $(".chip-date").addEventListener("click", (e) => {
    if(e.target === qd) return;
    e.preventDefault();
    try{ qd.showPicker(); }catch{ qd.focus(); }
  });
  qd.onchange = () => {
    state.quickDate = qd.value;
    setQuickWhen(qd.value ? "pick" : "none");
    $("#quick-title").focus({ preventScroll: true });
  };

  // Toolbar
  $("#search").oninput = (e) => { state.ui.search = e.target.value || ""; render(); };
  $("#toggle-completed").onchange = (e) => { state.ui.showCompleted = e.target.checked; saveUI(); render(); };
  $("#sort-general").onchange = (e) => {
    state.ui.sortGeneral = e.target.value;
    if(e.target.value === "random") state.ui.seedGeneral = Math.random();
    saveUI(); render();
  };
  $("#shuffle-general").onclick = () => {
    state.ui.seedGeneral = Math.random();
    state.ui.sortGeneral = "random";
    $("#sort-general").value = "random";
    saveUI(); render();
  };
  $$(".tab").forEach(b => b.onclick = () => { state.ui.tab = b.dataset.tab; saveUI(); render(); });

  // Modal
  $$(".seg").forEach(b => b.onclick = () => setModalSection(b.dataset.section));
  $("#has-est").onchange = (e) => {
    $("#est-wrap").classList.toggle("hidden", !e.target.checked);
    if(e.target.checked) $("#task-est").focus();
  };
  $("#modal-form").addEventListener("submit", saveModal);
  $("#btn-cancel").onclick = closeModal;
  $("#modal-close").onclick = closeModal;
  $("#modal-x").onclick = closeModal;

  document.addEventListener("keydown", (e) => {
    const modalOpen = !$("#modal").classList.contains("hidden");
    if(e.key === "Escape"){ closeModal(); menu.classList.add("hidden"); }
    if(modalOpen && e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveModal(e);
    // "n" opens the add form when not typing somewhere
    if(!modalOpen && e.key === "n" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && state.user){
      e.preventDefault(); $("#quick-title").focus();
    }
  });

  // Re-render each minute so "today"/"late" labels roll over on their own.
  setInterval(render, 60000);
  document.addEventListener("visibilitychange", () => { if(!document.hidden) render(); });
}

function init(){
  bind();
  $("#search").value = state.ui.search = "";
  $("#toggle-completed").checked = !!state.ui.showCompleted;
  $("#sort-general").value = state.ui.sortGeneral;
  setQuickWhen("none");

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW failed", e));
  }
}

init();
