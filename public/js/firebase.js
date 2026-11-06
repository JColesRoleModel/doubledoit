/* Firebase setup + data helpers shared by the app and the dashboard. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Not a secret: Firebase web config is meant to ship in client code.
// Access is protected by Google sign-in + firestore.rules.
const firebaseConfig = {
  apiKey: "AIzaSyCfGuFtclGfKFJQ_LaAgNOUMEztoMji9E0",
  authDomain: "doubledoit.firebaseapp.com",
  projectId: "doubledoit",
  storageBucket: "doubledoit.firebasestorage.app",
  messagingSenderId: "25159886896",
  appId: "1:25159886896:web:33f971b65bd08b3ccca5f5"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Offline cache: tasks load instantly and edits made offline sync later.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

/* ---------- Errors ---------- */
let errorHandler = (e) => console.error(e);
export function onDataError(fn){ errorHandler = fn; }
const report = (e) => errorHandler(e);

/* ---------- Auth ---------- */
export function watchAuth(cb){ return onAuthStateChanged(auth, cb); }

getRedirectResult(auth).catch(report);

export async function signIn(){
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try{
    await signInWithPopup(auth, provider);
  }catch(e){
    const fallback = [
      "auth/popup-blocked",
      "auth/operation-not-supported-in-this-environment",
      "auth/web-storage-unsupported"
    ];
    if(fallback.includes(e.code)) return signInWithRedirect(auth, provider);
    if(e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
    throw e;
  }
}

export function logOut(){ return signOut(auth); }

/* ---------- Tasks ---------- */
const tasksCol = (uid) => collection(db, "users", uid, "tasks");
const taskDoc = (uid, id) => doc(db, "users", uid, "tasks", id);

/** Live-subscribe to every task. cb(tasks, { fromCache, pending }) */
export function watchTasks(uid, cb){
  return onSnapshot(tasksCol(uid), { includeMetadataChanges: true }, (snap) => {
    const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(tasks, { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
  }, report);
}

// Writes are not awaited: with the offline cache they apply locally at once
// and only resolve when the server confirms (which never happens offline).
export function createTask(uid, data){
  const ref = doc(tasksCol(uid));
  setDoc(ref, data).catch(report);
  return ref.id;
}
export function patchTask(uid, id, patch){
  updateDoc(taskDoc(uid, id), { ...patch, updatedAt: Date.now() }).catch(report);
}
export function removeTask(uid, id){
  deleteDoc(taskDoc(uid, id)).catch(report);
}
export async function bulkWrite(uid, creates = [], deletes = []){
  const ops = [
    ...creates.map(data => (b) => b.set(doc(tasksCol(uid)), data)),
    ...deletes.map(id => (b) => b.delete(taskDoc(uid, id)))
  ];
  for(let i = 0; i < ops.length; i += 400){
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => op(batch));
    batch.commit().catch(report);
  }
}
