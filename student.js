/* eslint-disable no-console */
// ====== tiny DOM helpers ======
const $ = (s, r = document) => r.querySelector(s);
const log = (...a) => console.log('[student]', ...a);
const warn = (...a) => console.warn('[student]', ...a);
const err = (...a) => console.error('[student]', ...a);

// ====== Firebase ======
const auth = firebase.auth();
const db   = firebase.firestore();

// ====== UI refs ======
const loginCard   = $('#loginCard');
const whoEl       = $('#who');
const loginBtn    = $('#studentLoginBtn');
const logoutBtn   = $('#studentLogoutBtn');
const codeInp     = $('#studentCode');
const pinInp      = $('#studentPin');

const studentArea = $('#studentArea');
const tblBody     = $('#assignTblStudent tbody');

// ====== State ======
let currentStudent = null;
let unsubAssignments = null;

let activitiesMap = null; // {id:{id,name,path}}
let nameToIdMap   = null; // {lowerNameOrSlug: id}

// ====== Fallback aktivity ======
const DEFAULT_ACTIVITIES = {
  'flashcards':      { id: 'flashcards',      name: 'Kartičky',                 path: 'flashcards/index.html' },
  'missing-letters': { id: 'missing-letters', name: 'Doplň písmena',            path: 'missing-letters/index.html' },
  'word-match':      { id: 'word-match',      name: 'Párování',                  path: 'word-match/index.html' },
  'write-word':      { id: 'write-word',      name: 'Psaní slova',               path: 'write-word/index.html' },
};

// Angl. aliasy/stará jména → standardní klíč
const KEY_ALIASES = {
  'typing': 'write-word',
  'write': 'write-word',
  'writing': 'write-word',
  'matching': 'word-match',
  'match': 'word-match',
  'pairs': 'word-match',
  'missingletters': 'missing-letters',
  'missing_letters': 'missing-letters',
  'missing': 'missing-letters',
  'cards': 'flashcards',
  'flashcard': 'flashcards',
};

// CZ názvy/aliasy (bez diakritiky, mezer a velikosti) → klíč
const NAME_ALIASES_CS = {
  'dopln-pismena': 'missing-letters',
  'dopln-chybejici-pismena': 'missing-letters',
  'parovani': 'word-match',
  'spoj-dvojice': 'word-match',
  'psani': 'write-word',
  'psani-slova': 'write-word',
  'karticky': 'flashcards',
  'karty': 'flashcards',
};

// ====== helpers: normalizace ======
function slugify(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // odstraň diakritiku
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')                      // vše kromě a-z0-9 → pomlčky
    .replace(/^-+|-+$/g, '');
}
function normalizeActivityKey(raw) {
  if (!raw) return '';
  const s = String(raw).trim().toLowerCase().replace(/\s+/g,'-').replace(/_/g,'-');
  return KEY_ALIASES[s] || s;
}
function isKnownKey(key) {
  const map = activitiesMap || DEFAULT_ACTIVITIES;
  return !!map[key];
}

// ====== manifest aktivit (volitelný) ======
async function loadActivitiesManifest() {
  if (activitiesMap) return activitiesMap;
  try {
    const res = await fetch('/games/manifest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const map = {};
    for (const a of (data.activities || [])) {
      if (a?.id && a?.path) map[a.id] = { id: a.id, name: a.name || a.id, path: a.path };
    }
    activitiesMap = Object.keys(map).length ? map : DEFAULT_ACTIVITIES;
  } catch (e) {
    warn('Manifest aktivit nenalezen/poškozen – používám fallback.', e);
    activitiesMap = DEFAULT_ACTIVITIES;
  }
  // index pro rychlé dohledání podle názvu/slug
  nameToIdMap = {};
  Object.values(activitiesMap).forEach(a => {
    const nm = (a.name || a.id);
    nameToIdMap[nm.toLowerCase()] = a.id;
    nameToIdMap[slugify(nm)] = a.id;
    nameToIdMap[a.id.toLowerCase()] = a.id;
    nameToIdMap[slugify(a.id)] = a.id;
  });
  // přidej české aliasy
  Object.entries(NAME_ALIASES_CS).forEach(([k,v]) => { nameToIdMap[k] = v; });
  return activitiesMap;
}

function resolveActivityName(key, fallbackName) {
  const map = activitiesMap || DEFAULT_ACTIVITIES;
  if (!key) return fallbackName || '—';
  return map[key]?.name || fallbackName || key;
}
function resolveActivityPath(key) {
  const map = activitiesMap || DEFAULT_ACTIVITIES;
  let raw = map[key]?.path;
  if (!raw) return undefined;
  raw = raw.replace(/^\.?\/+, '');          // remove leading ./ or /
  if (raw.startsWith('games/')) raw = raw.slice(6); // drop existing games/
  return `/games/${raw}`;
}

// ====== Auth ======
async function ensureAnon() {
  if (auth.currentUser) return auth.currentUser;
  const cred = await auth.signInAnonymously();
  log('Anon signed in:', cred.user?.uid);
  return cred.user;
}

async function loginStudentByCodePin() {
  await ensureAnon();
  await loadActivitiesManifest();

  const code = (codeInp?.value || '').trim().toUpperCase();
  const pin  = (pinInp?.value || '').trim();
  if (!code || !pin) return alert('Zadej kód i PIN.');

  try {
    const qs = await db.collection('students').where('code', '==', code).limit(1).get();
    if (qs.empty) return alert('Student s tímto kódem neexistuje.');
    const doc = qs.docs[0], data = doc.data();
    if ((data.pin || '') !== pin) return alert('Nesprávný PIN.');

    currentStudent = { id: doc.id, ...data };
    whoEl.textContent = `Přihlášen: ${currentStudent.name || currentStudent.code}`;
    loginCard?.classList?.add('hidden');
    logoutBtn?.classList?.remove('hidden');
    studentArea?.classList?.remove('hidden');
    try {
      localStorage.setItem('studentId', currentStudent.id);
      localStorage.setItem('studentName', currentStudent.name || '');
    } catch {}
    startAssignmentsListener(currentStudent.id);
  } catch (e) {
    err('Login error:', e);
    alert('Přihlášení se nezdařilo.');
  }
}

function logoutStudent() {
  currentStudent = null;
  try { localStorage.removeItem('studentId'); localStorage.removeItem('studentName'); } catch {}
  whoEl.textContent = 'Nepřihlášen';
  loginCard?.classList?.remove('hidden');
  logoutBtn?.classList?.add('hidden');
  studentArea?.classList?.add('hidden');
  tblBody.innerHTML = '';
  try { unsubAssignments?.(); } catch {}
  unsubAssignments = null;
}

// ====== Assignments ======
function deriveActivityKeyFromAsg(asg) {
  // 1) machine pole
  let key = normalizeActivityKey(asg.activityId || asg.activity || asg.activityKey || asg.game || '');
  if (isKnownKey(key)) return key;

  // 2) podle názvu (case/diakritika ignor)
  const rawName = asg.activityName || asg.gameName || '';
  const probe   = rawName ? (nameToIdMap?.[rawName.toLowerCase()] || nameToIdMap?.[slugify(rawName)]) : '';
  if (probe && isKnownKey(probe)) return probe;

  // 3) aliasy (CZ i EN)
  const aliasKey = NAME_ALIASES_CS[slugify(rawName)] || KEY_ALIASES[slugify(rawName)];
  if (aliasKey && isKnownKey(aliasKey)) return aliasKey;

  // 4) heuristika: „missing“ v názvu → missing-letters, „párování/match“ → word-match…
  const slug = slugify(rawName);
  if (/-?missing-?/.test(slug) || /dopln/.test(slug)) return isKnownKey('missing-letters') ? 'missing-letters' : '';
  if (/parovani|match/.test(slug)) return isKnownKey('word-match') ? 'word-match' : '';
  if (/psani|write/.test(slug))    return isKnownKey('write-word') ? 'write-word' : '';
  if (/karty|karticky|cards/.test(slug)) return isKnownKey('flashcards') ? 'flashcards' : '';

  return '';
}

function startAssignmentsListener(studentId) {
  try { unsubAssignments?.(); } catch {}
  unsubAssignments = null;
  if (!studentId) return;

  unsubAssignments = db.collection('assignments')
    .where('studentId', '==', studentId)
    .onSnapshot(
      async (qs) => {
        await loadActivitiesManifest();
        const items = qs.docs.map(d => ({ id: d.id, ...d.data() }));
        log('Assignments:', items);
        renderAssignments(items);
      },
      (e) => {
        err('Chyba listeneru assignments:', e);
        alert('Nepodařilo se načíst úkoly.');
      }
    );
}

function renderAssignments(items) {
  tblBody.innerHTML = '';
  if (!Array.isArray(items) || !items.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" style="text-align:center;color:var(--muted,#666)">Žádné úkoly.</td>`;
    tblBody.appendChild(tr);
    return;
  }

  for (const asg of items) {
    const keyRaw = deriveActivityKeyFromAsg(asg);
    const key    = normalizeActivityKey(keyRaw);
    const name   = asg.activityName || resolveActivityName(key, '—');
    const status = asg.status || 'assigned';
    const packId = asg.packId || '';
    const dir    = asg.direction || 'cz-en';
    const limit  = asg.limit || 20;

    const gamePath = key ? resolveActivityPath(key) : undefined;
    const canOpen  = !!(gamePath && packId);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${asg.packName || '—'}</td>
      <td>${name}</td>
      <td>${status}</td>
      <td>
        ${canOpen ? `<a href="#" data-act="open" data-id="${asg.id}">spustit</a>` : `<span class="muted">—</span>`}
        &nbsp;|&nbsp;
        <a href="#" data-act="done" data-id="${asg.id}">hotovo</a>
      </td>
    `;
    tr.dataset.asg = JSON.stringify({
      id: asg.id,
      packId,
      activity: key,
      direction: dir,
      limit,
    });
    tblBody.appendChild(tr);
  }
}

// ====== Actions ======
document.addEventListener('click', async (ev) => {
  const a = ev.target.closest('a[data-act]');
  if (!a) return;
  ev.preventDefault();
  const act = a.dataset.act;
  const tr  = a.closest('tr');
  if (!tr) return;

  let meta = {};
  try { meta = JSON.parse(tr.dataset.asg || '{}'); } catch {}

  if (act === 'open') return openActivity(meta);
  if (act === 'done') return markDone(meta.id);
});

async function openActivity(meta) {
  await loadActivitiesManifest();

  const key    = normalizeActivityKey(meta.activity || '');
  const packId = meta.packId;
  const asgId  = meta.id;
  const uid    = auth.currentUser?.uid || '';
  const dir    = meta.direction || 'cz-en';
  const limit  = meta.limit || 20;

  const gamePath = key ? resolveActivityPath(key) : undefined;
  log('openActivity()', { key, gamePath, asg: meta });

  if (!key || !gamePath) return alert('Neznámá aktivita – popros učitele o opravu zadání.');
  if (!packId)           return alert('Zadání nemá přiřazený balíček.');

  const url = `${gamePath}?a=${encodeURIComponent(asgId)}&pack=${encodeURIComponent(packId)}&uid=${encodeURIComponent(uid)}&dir=${encodeURIComponent(dir)}&limit=${encodeURIComponent(limit)}`;
  window.location.href = url;
}

async function markDone(assignmentId) {
  if (!assignmentId) return;
  try {
    await db.collection('assignments').doc(assignmentId).update({
      status: 'done',
      completedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    err('Mark done error:', e);
    alert('Nepodařilo se uložit stav.');
  }
}

// ====== Boot ======
logoutBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  logoutStudent();
});
loginBtn?.addEventListener('click', async (e) => {
  e.preventDefault();
  try { await loginStudentByCodePin(); } catch {}
});

auth.onAuthStateChanged(async (u) => {
  const savedId = (() => { try { return localStorage.getItem('studentId'); } catch { return null; } })();
  const savedName = (() => { try { return localStorage.getItem('studentName'); } catch { return null; } })();

  if (u && savedId && !currentStudent) {
    currentStudent = { id: savedId, name: savedName || '' };
    whoEl.textContent = `Přihlášen: ${currentStudent.name || currentStudent.code || ''}`;
    loginCard?.classList?.add('hidden');
    logoutBtn?.classList?.remove('hidden');
    studentArea?.classList?.remove('hidden');

    await loadActivitiesManifest();
    startAssignmentsListener(savedId);
  }
});
