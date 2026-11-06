/* TODO TABLETS (Neocities)
   - Saves to device via localStorage
   - Works offline via service worker (sw.js)
   - Two columns: timeSensitive true/false
*/

const STORAGE_KEY = "todo_tablets_v2_timesensitive";

const $ = (sel) => document.querySelector(sel);

const state = {
  tasks: [],
  ui: {
    search: "",
    showCompleted: false,
    sortSens: "old",
    sortNons: "old",
    randomSeedSens: Math.random(),
    randomSeedNons: Math.random(),
  },
  modal: { editingId: null }
};

function now(){ return Date.now(); }
function uid(){
  try{
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return "t_" + a[0].toString(16);
  }catch{
    return "t_" + Math.random().toString(16).slice(2);
  }
}

function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(()=> t.classList.add("hidden"), 1400);
}

function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(!parsed || !Array.isArray(parsed.tasks)) return;

    state.tasks = parsed.tasks;
    state.ui = { ...state.ui, ...(parsed.ui || {}) };

    if(!state.ui.sortSens) state.ui.sortSens = "old";
    if(!state.ui.sortNons) state.ui.sortNons = "old";
    if(typeof state.ui.randomSeedSens !== "number") state.ui.randomSeedSens = Math.random();
    if(typeof state.ui.randomSeedNons !== "number") state.ui.randomSeedNons = Math.random();
  }catch(e){
    console.warn("Load failed", e);
  }
}

function normalize(s){ return (s ?? "").toString().toLowerCase().trim(); }
function estNumber(v){
  const n = Number((v ?? "").toString().trim());
  if(!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function matchesSearch(task, q){
  if(!q) return true;
  const hay = [task.title, task.notes, task.estMinutes ? String(task.estMinutes) : ""]
    .map(normalize).join(" | ");
  return hay.includes(q);
}

function randWeightFor(taskId, seed){
  let h = 2166136261;
  const str = taskId + "|" + seed;
  for(let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h += (h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24);
  }
  return (h >>> 0) / 4294967295;
}

function sortTasks(list, mode, seed){
  const byTitle = (a,b) => normalize(a.title).localeCompare(normalize(b.title));
  const byTimeLow = (a,b) => (a.estMinutes ?? Infinity) - (b.estMinutes ?? Infinity);
  const byTimeHigh = (a,b) => (b.estMinutes ?? -Infinity) - (a.estMinutes ?? -Infinity);
  const byOld = (a,b) => a.createdAt - b.createdAt;
  const byNew = (a,b) => b.createdAt - a.createdAt;

  const arr = [...list];

  if(mode === "old") return arr.sort(byOld);
  if(mode === "new") return arr.sort(byNew);
  if(mode === "az") return arr.sort(byTitle);
  if(mode === "za") return arr.sort((a,b)=> byTitle(b,a));
  if(mode === "timeLow") return arr.sort(byTimeLow);
  if(mode === "timeHigh") return arr.sort(byTimeHigh);
  if(mode === "random") return arr.sort((a,b)=> randWeightFor(a.id, seed) - randWeightFor(b.id, seed));

  return arr.sort(byOld);
}

function splitColumns(){
  const q = normalize(state.ui.search);

  const visible = state.tasks
    .filter(t => matchesSearch(t, q))
    .filter(t => state.ui.showCompleted ? true : !t.completed);

  const sens = visible.filter(t => !!t.timeSensitive);
  const nons = visible.filter(t => !t.timeSensitive);

  return {
    sens: sortTasks(sens, state.ui.sortSens, state.ui.randomSeedSens),
    nons: sortTasks(nons, state.ui.sortNons, state.ui.randomSeedNons)
  };
}

function render(){
  const { sens, nons } = splitColumns();

  $("#count-sens").textContent = sens.length;
  $("#count-nons").textContent = nons.length;

  const sensList = $("#list-sens");
  const nonsList = $("#list-nons");
  sensList.innerHTML = "";
  nonsList.innerHTML = "";

  sens.forEach(t => sensList.appendChild(taskCard(t)));
  nons.forEach(t => nonsList.appendChild(taskCard(t)));

  save();
}

function taskCard(t){
  const card = document.createElement("div");
  card.className = "card" + (t.completed ? " completed" : "");

  const top = document.createElement("div");
  top.className = "card-top";

  const left = document.createElement("div");
  left.style.flex = "1";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = t.title || "Untitled Task";

  const meta = document.createElement("div");
  meta.className = "card-meta";

  const colTag = document.createElement("div");
  colTag.className = "tag " + (t.timeSensitive ? "gold" : "");
  colTag.textContent = t.timeSensitive ? "TIME-SENSITIVE" : "NOT-TIME-SENSITIVE";
  meta.appendChild(colTag);

  if(t.estMinutes){
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = t.estMinutes + " MIN";
    meta.appendChild(tag);
  }

  left.appendChild(title);
  left.appendChild(meta);

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.gap = "8px";
  right.style.alignItems = "flex-start";

  const btnDone = document.createElement("button");
  btnDone.className = "pill gold";
  btnDone.type = "button";
  btnDone.textContent = t.completed ? "UNDO" : "DONE";
  btnDone.onclick = () => {
    t.completed = !t.completed;
    toast(t.completed ? "MARKED DONE" : "RESTORED");
    render();
  };

  const btnEdit = document.createElement("button");
  btnEdit.className = "pill";
  btnEdit.type = "button";
  btnEdit.textContent = "EDIT";
  btnEdit.onclick = () => openModal(t.id);

  right.appendChild(btnDone);
  right.appendChild(btnEdit);

  top.appendChild(left);
  top.appendChild(right);

  card.appendChild(top);

  if(t.notes){
    const notes = document.createElement("div");
    notes.className = "card-notes";
    notes.textContent = t.notes;
    card.appendChild(notes);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const aLeft = document.createElement("div");
  aLeft.className = "actions-left";

  const created = document.createElement("div");
  created.className = "tag";
  created.textContent = "CREATED " + new Date(t.createdAt).toLocaleDateString();
  aLeft.appendChild(created);

  const aRight = document.createElement("div");
  aRight.className = "actions-right";

  const btnFlip = document.createElement("button");
  btnFlip.className = "pill";
  btnFlip.type = "button";
  btnFlip.textContent = t.timeSensitive ? "MAKE NOT-SENSITIVE" : "MAKE SENSITIVE";
  btnFlip.onclick = () => {
    t.timeSensitive = !t.timeSensitive;
    toast("MOVED");
    render();
  };

  const btnDel = document.createElement("button");
  btnDel.className = "pill red";
  btnDel.type = "button";
  btnDel.textContent = "DELETE";
  btnDel.onclick = () => {
    if(!confirm("DELETE THIS TASK?")) return;
    state.tasks = state.tasks.filter(x => x.id !== t.id);
    toast("DELETED");
    render();
  };

  aRight.appendChild(btnFlip);
  aRight.appendChild(btnDel);

  actions.appendChild(aLeft);
  actions.appendChild(aRight);
  card.appendChild(actions);

  return card;
}

/* Modal */
function setModalHint(msg){ $("#modal-hint").textContent = msg || ""; }

function openModal(editId = null){
  state.modal.editingId = editId;
  setModalHint("");

  const isEdit = !!editId;
  $("#modal-title").textContent = isEdit ? "EDIT INSCRIPTION" : "INSCRIBE A TASK";
  $("#btn-save").textContent = isEdit ? "UPDATE" : "SAVE";

  const t = isEdit ? state.tasks.find(x => x.id === editId) : null;

  $("#task-title").value = t?.title || "";
  $("#task-notes").value = t?.notes || "";

  $("#is-sensitive").checked = !!t?.timeSensitive;

  const hasEst = !!t?.estMinutes;
  $("#has-est").checked = hasEst;
  $("#est-wrap").style.display = hasEst ? "block" : "none";
  $("#task-est").value = t?.estMinutes ? String(t.estMinutes) : "";

  $("#modal").classList.remove("hidden");
  $("#task-title").focus();
}

function closeModal(){
  $("#modal").classList.add("hidden");
  state.modal.editingId = null;
  setModalHint("");
}

function upsertFromModal(){
  const title = $("#task-title").value.trim();
  const notes = $("#task-notes").value.trim();
  const timeSensitive = $("#is-sensitive").checked;

  if(!title){
    setModalHint("TASK NAME REQUIRED.");
    return;
  }

  const useEst = $("#has-est").checked;
  const est = useEst ? estNumber($("#task-est").value) : null;
  if(useEst && !est){
    setModalHint("ESTIMATE MUST BE A POSITIVE NUMBER.");
    return;
  }

  const editId = state.modal.editingId;

  if(editId){
    const t = state.tasks.find(x => x.id === editId);
    if(!t) return;
    t.title = title;
    t.notes = notes;
    t.estMinutes = est;
    t.timeSensitive = timeSensitive;
    toast("UPDATED");
  }else{
    state.tasks.unshift({
      id: uid(),
      title,
      notes,
      estMinutes: est,
      timeSensitive,
      createdAt: now(),
      completed: false
    });
    toast("SAVED");
  }

  closeModal();
  render();
}

/* Export / Import */
function exportJSON(){
  const blob = new Blob([JSON.stringify(state.tasks, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `todo-tablets-export-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
}

async function importJSON(file){
  const text = await file.text();
  const parsed = JSON.parse(text);
  if(!Array.isArray(parsed)) throw new Error("Invalid JSON format");

  const cleaned = parsed.map(x => ({
    id: x.id || uid(),
    title: (x.title || "Untitled").toString(),
    notes: (x.notes || "").toString(),
    estMinutes: x.estMinutes ? Number(x.estMinutes) : null,
    timeSensitive: !!x.timeSensitive,
    createdAt: x.createdAt ? Number(x.createdAt) : now(),
    completed: !!x.completed
  }));

  state.tasks = cleaned;
  toast("IMPORTED");
  render();
}

/* Service worker (offline) */
async function registerSW(){
  if(!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register("sw.js", { scope: "./" });
  }catch(e){
    console.warn("SW register failed", e);
  }
}

/* Wire UI */
function bind(){
  $("#btn-add").onclick = () => openModal(null);
  $("#btn-export").onclick = exportJSON;

  $("#btn-import").onclick = () => {
    $("#import-file").value = "";
    $("#import-file").click();
  };
  $("#import-file").onchange = async (e) => {
    const f = e.target.files?.[0];
    if(!f) return;
    try{ await importJSON(f); }
    catch(err){ alert("IMPORT FAILED: " + err.message); }
  };

  $("#btn-reset").onclick = () => {
    if(!confirm("RESET EVERYTHING ON THIS DEVICE?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state.tasks = [];
    state.ui.search = "";
    state.ui.showCompleted = false;
    state.ui.sortSens = "old";
    state.ui.sortNons = "old";
    state.ui.randomSeedSens = Math.random();
    state.ui.randomSeedNons = Math.random();
    toast("RESET");
    render();
  };

  $("#search").oninput = (e) => { state.ui.search = e.target.value || ""; render(); };
  $("#toggle-completed").onchange = (e) => { state.ui.showCompleted = !!e.target.checked; render(); };

  $("#sort-sens").onchange = (e) => {
    state.ui.sortSens = e.target.value;
    if(state.ui.sortSens === "random") state.ui.randomSeedSens = Math.random();
    render();
  };
  $("#sort-nons").onchange = (e) => {
    state.ui.sortNons = e.target.value;
    if(state.ui.sortNons === "random") state.ui.randomSeedNons = Math.random();
    render();
  };

  $("#shuffle-sens").onclick = () => {
    state.ui.randomSeedSens = Math.random();
    state.ui.sortSens = "random";
    $("#sort-sens").value = "random";
    render();
  };
  $("#shuffle-nons").onclick = () => {
    state.ui.randomSeedNons = Math.random();
    state.ui.sortNons = "random";
    $("#sort-nons").value = "random";
    render();
  };

  $("#has-est").onchange = (e) => {
    $("#est-wrap").style.display = e.target.checked ? "block" : "none";
    if(e.target.checked) $("#task-est").focus();
  };

  $("#btn-cancel").onclick = closeModal;
  $("#modal-close").onclick = closeModal;
  $("#modal-x").onclick = closeModal;
  $("#btn-save").onclick = upsertFromModal;

  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape") closeModal();
    const modalOpen = !$("#modal").classList.contains("hidden");
    if(modalOpen && e.key === "Enter" && (e.metaKey || e.ctrlKey)){
      upsertFromModal();
    }
  });
}

function init(){
  load();
  bind();

  $("#search").value = state.ui.search || "";
  $("#toggle-completed").checked = !!state.ui.showCompleted;
  $("#sort-sens").value = state.ui.sortSens || "old";
  $("#sort-nons").value = state.ui.sortNons || "old";

  registerSW();
  render();
}

document.addEventListener("DOMContentLoaded", init);