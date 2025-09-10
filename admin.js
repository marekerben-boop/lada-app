/* admin.js – vše v jednom (Firebase compat) */

/* ========= HELPERS ========= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const text = (el, t) => { if (el) el.textContent = t; };
const show = (el) => el && el.classList.remove('hidden');
const hide = (el) => el && el.classList.add('hidden');
const mono = (s='') => `<span class="mono">${s}</span>`;

function randCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}
function randPin() { return String(Math.floor(1000 + Math.random()*9000)); }

/** "pes = dog" / "kočka : cat" / "dům ; house" / "červený - red" => [{q,a}] */
function parseLinesToPairs(textareaValue) {
  const out = [];
  (textareaValue || '').split('\n').forEach(raw => {
    const line = (raw || '').trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split(/=|:|;|-/);
    if (parts.length < 2) return;
    const left = (parts[0] || '').trim();
    const right = (parts.slice(1).join('') || '').trim();
    if (left && right) out.push({ q: left, a: right });
  });
  return out;
}
function pairsToLines(pairs = []) {
  return (pairs || []).map(p => `${p.q} = ${p.a}`).join('\n');
}

/* ========= FIREBASE ========= */
if (!window.firebase || !firebase.apps?.length) {
  console.error('Firebase není inicializované. Ujisti se, že je načteno firebase-*-compat a firebase.initializeApp().');
}

const auth = firebase.auth();
const db   = firebase.firestore();

/* ========= STATE ========= */
const state = {
  teacher: null,
  students: new Map(),     // id -> doc
  packs: new Map(),        // id -> doc
  assignments: new Map()   // id -> doc
};

/* ========= ACTIVITY MAP =========
   Klíče (id) musí odpovídat složkám v /games/<id>/index.html
   KEY_ALIASES mapuje starší názvy ("matching", "typing") na kanonické id.
*/
const ACTIVITIES = {
  'flashcards':     { id: 'flashcards',     name: 'Kartičky',       path: 'games/flashcards/index.html' },
  'missing-letters':{ id: 'missing-letters',name: 'Doplň písmena',  path: 'games/missing-letters/index.html' },
  'word-match':     { id: 'word-match',     name: 'Spoj dvojice',   path: 'games/word-match/index.html' },
  'write-word':     { id: 'write-word',     name: 'Psaní',          path: 'games/write-word/index.html' },
};

// aliasy starších názvů → kanonické id
const KEY_ALIASES = {
  'matching': 'word-match',
  'typing':   'write-word',
};

function normalizeActivityKey(keyRaw) {
  const k = (keyRaw || '').trim().toLowerCase();
  return KEY_ALIASES[k] || k;
}

function activityFromKey(keyRaw) {
  const key = normalizeActivityKey(keyRaw);
  return ACTIVITIES[key] || null;
}

/* ========= UI EL ========= */
const el = {
  // login
  loginCard: $('#loginCard'),
  loginFields: $('#loginFields'),
  email: $('#email'),
  pass: $('#pass'),
  loginBtn: $('#loginBtn'),
  logoutBtn: $('#logoutBtn'),
  who: $('#who'),

  // sekce
  adminArea: $('#adminArea'),
  packsArea: $('#packsArea'),
  assignArea: $('#assignArea'),

  // studenti
  studentName: $('#studentName'),
  createStudent: $('#createStudent'),
  studentsTblBody: $('#studentsTbl tbody'),

  // balíčky
  packName: $('#packName'),
  packLines: $('#packLines'),
  csvFile: $('#csvFile'),
  savePackBtn: $('#createPack'),
  packsTblBody: $('#packsTbl tbody'),

  // přiřazení
  studentSelect: $('#studentSelect'),
  packSelect: $('#packSelect'),
  activitySelect: $('#activitySelect'),
  assignBtn: $('#assignBtn'),
  assignTblBody: $('#assignTbl tbody'),
};

/* ========= LOGIN ========= */
function renderLoginUI(user) {
  if (user) {
    text(el.who, `Přihlášen: ${user.email || user.uid}`);
    hide(el.loginFields);
    show(el.logoutBtn);
    show(el.adminArea);
    show(el.packsArea);
    show(el.assignArea);
  } else {
    text(el.who, 'Stav: nepřihlášen');
    show(el.loginFields);
    hide(el.logoutBtn);
    hide(el.adminArea);
    hide(el.packsArea);
    hide(el.assignArea);
  }
}

auth.onAuthStateChanged(u => {
  state.teacher = u;
  renderLoginUI(u);
  if (u) {
    startStudentsListener();
    startPacksListener();
    startAssignmentsListener();
    ensureActivitySelectOptions();
  }
});

el.loginBtn?.addEventListener('click', async () => {
  try {
    const email = el.email?.value?.trim();
    const pass  = el.pass?.value ?? '';
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (e) {
    console.error(e);
    alert('Přihlášení selhalo: ' + (e.message || e));
  }
});

el.logoutBtn?.addEventListener('click', async () => {
  await auth.signOut();
});

/* ========= STUDENTS ========= */
function renderStudentsTable() {
  if (!el.studentsTblBody) return;
  el.studentsTblBody.innerHTML = '';

  const items = [...state.students.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  for (const s of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.name || ''}</td>
      <td>${mono(s.code || '')}</td>
      <td>${mono(s.pin || '')}</td>
      <td class="small">
        <span class="muted">
          [<a href="#" data-act="edit" data-id="${s.id}">upravit</a> |
           <a href="#" data-act="del" data-id="${s.id}">smazat</a>]
        </span>
      </td>
    `;
    el.studentsTblBody.appendChild(tr);
  }

  // také refresh dropdownu v assignArea
  refreshStudentSelect();
}
function refreshStudentSelect() {
  if (!el.studentSelect) return;
  const arr = [...state.students.values()].sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  el.studentSelect.innerHTML = arr.map(s => `<option value="${s.id}">${s.name || s.id}</option>`).join('');
}

function startStudentsListener() {
  db.collection('students').onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        state.students.delete(id);
      } else {
        const d = { id, ...ch.doc.data() };
        state.students.set(id, d);
      }
    });
    renderStudentsTable();
  });
}

el.createStudent?.addEventListener('click', async () => {
  const name = (el.studentName?.value || '').trim();
  if (!name) return alert('Zadej jméno studenta.');
  const payload = {
    name,
    code: randCode(),
    pin: randPin(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection('students').add(payload);
  if (el.studentName) el.studentName.value = '';
});

el.studentsTblBody?.addEventListener('click', async (e) => {
  const a = e.target.closest('a[data-act]');
  if (!a) return;
  e.preventDefault();
  const id = a.dataset.id;
  const act = a.dataset.act;
  const doc = state.students.get(id);
  if (!doc) return;

  if (act === 'del') {
    const ok = confirm(`Smazat studenta "${doc.name}"?`);
    if (ok) await db.collection('students').doc(id).delete();
  }

  if (act === 'edit') {
    const newName = prompt('Jméno studenta:', doc.name || '');
    if (newName === null) return;
    const newPin  = prompt('PIN (4 čísla):', doc.pin || '');
    if (newPin === null) return;
    await db.collection('students').doc(id).update({ name: newName.trim(), pin: String(newPin).trim() });
  }
});

/* ========= PACKS (balíčky) ========= */
/* Vytváření i ÚPRAVY obsahu (název + pairs z textarea), CSV → textarea */

let editingPackId = null;

function renderPacksTable() {
  if (!el.packsTblBody) return;
  el.packsTblBody.innerHTML = '';
  const items = [...state.packs.values()].sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  for (const p of items) {
    const count = (typeof p.count === 'number') ? p.count : ((p.pairs?.length) || (p.items?.length) || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.name || ''}</td>
      <td>${count}</td>
      <td class="small">
        <span class="muted">
          [<a href="#" data-act="edit" data-id="${p.id}">upravit</a> |
           <a href="#" data-act="del" data-id="${p.id}">smazat</a>]
        </span>
      </td>
    `;
    el.packsTblBody.appendChild(tr);
  }
  refreshPackSelect();
}

function refreshPackSelect() {
  if (!el.packSelect) return;
  const arr = [...state.packs.values()].sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  el.packSelect.innerHTML = arr.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

function startPacksListener() {
  db.collection('packs').onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        state.packs.delete(id);
        if (editingPackId === id) resetPackEditor();
      } else {
        const d = ch.doc.data() || {};
        const pairs = d.pairs || d.items || [];
        const pack = {
          id,
          name: d.name || '(bez názvu)',
          pairs,
          items: pairs, // kompatibilita
          count: (typeof d.count === 'number') ? d.count : (pairs.length || 0),
          ...d
        };
        state.packs.set(id, pack);
      }
    });
    renderPacksTable();
  });
}

function resetPackEditor() {
  editingPackId = null;
  if (el.packName)  el.packName.value = '';
  if (el.packLines) el.packLines.value = '';
  if (el.savePackBtn) el.savePackBtn.textContent = 'Uložit balíček';
  const cancel = $('#cancelPackEdit');
  if (cancel) hide(cancel);
}

// vložím sekundární "Zrušit úpravy" vedle Uložit
(function ensureCancelBtn() {
  if (!el.savePackBtn) return;
  let cancel = $('#cancelPackEdit');
  if (!cancel) {
    cancel = document.createElement('button');
    cancel.id = 'cancelPackEdit';
    cancel.type = 'button';
    cancel.className = 'btn btn--secondary hidden';
    cancel.textContent = 'Zrušit úpravy';
    el.savePackBtn.parentElement?.appendChild(cancel);
    cancel.addEventListener('click', resetPackEditor);
  }
})();

el.packsTblBody?.addEventListener('click', async (e) => {
  const a = e.target.closest('a[data-act]');
  if (!a) return;
  e.preventDefault();

  const id = a.dataset.id;
  const act = a.dataset.act;
  const pack = state.packs.get(id);
  if (!pack) return;

  if (act === 'edit') {
    editingPackId = id;
    if (el.packName)  el.packName.value = pack.name || '';
    if (el.packLines) el.packLines.value = pairsToLines(pack.pairs || pack.items || []);
    if (el.savePackBtn) el.savePackBtn.textContent = 'Uložit změny';
    show($('#cancelPackEdit'));
    el.packName?.focus();
  }

  if (act === 'del') {
    const ok = confirm(`Smazat balíček "${pack.name}"?`);
    if (!ok) return;
    await db.collection('packs').doc(id).delete();
  }
});

el.csvFile?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split('\n').map(l => {
    const [q,a] = l.split(',').map(s => (s||'').trim());
    if (!q || !a) return '';
    return `${q} = ${a}`;
  }).filter(Boolean).join('\n');
  if (el.packLines) el.packLines.value = lines;
  e.target.value = '';
});

el.savePackBtn?.addEventListener('click', async () => {
  const name  = (el.packName?.value || '').trim();
  const pairs = parseLinesToPairs(el.packLines?.value || '');

  if (!name) return alert('Zadej název balíčku.');
  if (!pairs.length) {
    const ok = confirm('Balíček je prázdný. Uložit i tak?');
    if (!ok) return;
  }

  const payload = {
    name,
    pairs,
    items: pairs, // kompatibilita
    count: pairs.length,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (editingPackId) {
    await db.collection('packs').doc(editingPackId).update(payload);
  } else {
    await db.collection('packs').add({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  resetPackEditor();
});

/* ========= ASSIGNMENTS (přiřazení) ========= */

function ensureActivitySelectOptions() {
  if (!el.activitySelect) return;

  // Zajistíme, že select obsahuje každou aktivitu jen jednou, vždy s kanonickým id
  const seen = new Set();

  // Normalizujeme existující <option> a odstraníme duplicitní aliasy
  $$('#activitySelect option').forEach(opt => {
    const act = activityFromKey(opt.value);
    if (!act) return; // neznámá hodnota

    // pokud už jsme kanonické id viděli, odstraníme aliasovou položku
    if (seen.has(act.id)) {
      opt.remove();
      return;
    }

    // přepíšeme hodnotu i text na kanonické údaje
    opt.value = act.id;
    opt.textContent = act.name;
    seen.add(act.id);
  });

  // Doplníme chybějící aktivity (aliasy ignorujeme)
  for (const key of Object.keys(ACTIVITIES)) {
    const act = ACTIVITIES[key];
    if (seen.has(act.id)) continue;

    const opt = document.createElement('option');
    opt.value = act.id;
    opt.textContent = act.name;
    el.activitySelect.appendChild(opt);
    seen.add(act.id);
  }
}

function renderAssignmentsTable() {
  if (!el.assignTblBody) return;
  el.assignTblBody.innerHTML = '';

  // Pěkné seřazení: nejnovější navrch
  const items = [...state.assignments.values()].sort((a,b) => {
    const ta = a.createdAt? a.createdAt.seconds || 0 : 0;
    const tb = b.createdAt? b.createdAt.seconds || 0 : 0;
    return tb - ta;
  });

  for (const asg of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${asg.studentName || asg.studentId}</td>
      <td>${asg.packName || asg.packId}</td>
      <td>${asg.activityName || asg.activityId || '-'}</td>
      <td class="small">
        <span class="muted">
          [<a href="#" data-act="edit" data-id="${asg.id}">upravit</a> |
           <a href="#" data-act="del" data-id="${asg.id}">smazat</a>]
        </span>
      </td>
    `;
    el.assignTblBody.appendChild(tr);
  }
}

function startAssignmentsListener() {
  db.collection('assignments').onSnapshot(snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        state.assignments.delete(id);
      } else {
        const d = { id, ...ch.doc.data() };
        state.assignments.set(id, d);
      }
    });
    renderAssignmentsTable();
  });
}

el.assignBtn?.addEventListener('click', async () => {
  const studentId = el.studentSelect?.value || '';
  const packId    = el.packSelect?.value || '';
  const activityKeyRaw = el.activitySelect?.value || '';

  if (!studentId || !packId || !activityKeyRaw) return alert('Vyber studenta, balíček i aktivitu.');

  const student = state.students.get(studentId);
  const pack    = state.packs.get(packId);

  // normalizace aktivity (aliasy)
  const act = activityFromKey(activityKeyRaw);
  if (!act) return alert(`Neznámá aktivita: ${activityKeyRaw}`);

  const payload = {
    studentId,
    studentName: student?.name || studentId,
    packId,
    packName: pack?.name || packId,
    activityId: act.id,
    activityName: act.name,
    activityPath: act.path,
    status: 'assigned',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  await db.collection('assignments').add(payload);
});

el.assignTblBody?.addEventListener('click', async (e) => {
  const a = e.target.closest('a[data-act]');
  if (!a) return;
  e.preventDefault();
  const id = a.dataset.id;
  const act = a.dataset.act;
  const asg = state.assignments.get(id);
  if (!asg) return;

  if (act === 'del') {
    const ok = confirm(`Smazat úkol studenta "${asg.studentName}" – ${asg.packName}?`);
    if (!ok) return;
    await db.collection('assignments').doc(id).delete();
  }

  if (act === 'edit') {
    // jednoduchý textový editor – změna aktivity a/nebo statusu
    const currentKey = asg.activityId || '';
    const list = Object.keys(ACTIVITIES).join(', ');
    const newKey = prompt(`Zadej klíč aktivity (${list})`, currentKey);
    if (newKey === null) return;

    const m = activityFromKey(newKey);
    if (!m) { alert('Neplatná aktivita.'); return; }

    const newStatus = prompt('Status (assigned / done / in-progress)', asg.status || 'assigned');
    if (newStatus === null) return;

    await db.collection('assignments').doc(id).update({
      activityId: m.id,
      activityName: m.name,
      activityPath: m.path,
      status: (newStatus || 'assigned').trim()
    });
  }
});

/* ========= INIT ========= */
document.addEventListener('DOMContentLoaded', () => {
  // jen kosmetika: pokud je login karta ve stejné stránce, už je vše navázané výše
  ensureActivitySelectOptions();
});
