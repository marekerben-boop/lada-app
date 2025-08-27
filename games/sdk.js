// Robustní GameSDK pro hry
window.GameSDK = (() => {
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const log  = (...a) => console.log('[GameSDK]', ...a);
  const err  = (...a) => console.error('[GameSDK]', ...a);

  async function ensureAnon() {
    if (auth.currentUser) return auth.currentUser;
    const cred = await auth.signInAnonymously();
    return cred.user;
  }

  // ---- načtení assignmentu, packu a párů ----
  async function loadAssignment(assignmentId) {
    if (!assignmentId) return null;
    const snap = await db.collection('assignments').doc(assignmentId).get();
    return snap.exists ? ({ id: snap.id, ...snap.data() }) : null;
  }

  function parsePairsFromPack(data = {}) {
    // 1) pole objektů
    if (Array.isArray(data.pairs)) {
      return data.pairs.map(p => {
        const q = p.q ?? p.question ?? p.front ?? p.cz ?? p.czech ?? p.left ?? '';
        const a = p.a ?? p.answer   ?? p.back  ?? p.en ?? p.english ?? p.right ?? '';
        return { question: String(q).trim(), answer: String(a).trim() };
      }).filter(x => x.question && x.answer);
    }
    // 2) multiline string
    if (typeof data.lines === 'string') {
      return data.lines.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.split(/[=:\-;]\s*/);
        return { question: m[0] || '', answer: m[1] || '' };
      }).filter(x => x.question && x.answer);
    }
    // 3) pole stringů
    if (Array.isArray(data.items)) {
      return data.items.map(String).map(l => {
        const m = l.split(/[=:\-;]\s*/);
        return { question: m[0] || '', answer: m[1] || '' };
      }).filter(x => x.question && x.answer);
    }
    return [];
  }

  async function loadPack(packId) {
    if (!packId) throw new Error('Chybí packId.');
    let snap = await db.collection('packs').doc(packId).get();
    if (!snap.exists) snap = await db.collection('packages').doc(packId).get(); // fallback
    if (!snap.exists) throw new Error(`Balíček nenalezen (${packId}).`);
    const pairs = parsePairsFromPack(snap.data());
    return pairs;
  }

  function orient(pairs, dir) {
    return (dir === 'en-cz')
      ? pairs.map(p => ({ question: p.answer, answer: p.question }))
      : pairs;
  }

  // ---- veřejné API ----
  async function init() {
    await ensureAnon();

    const params       = new URLSearchParams(location.search);
    const assignmentId = params.get('a') || params.get('assignment') || '';
    let   packId       = params.get('pack') || '';
    const direction    = (params.get('dir') || 'cz-en').toLowerCase();
    const limit        = Math.max(1, parseInt(params.get('limit') || '20', 10) || 20);

    // pokud v URL není ?pack=, zkus ho vytáhnout z assignmentu
    let asg = null;
    if (!packId && assignmentId) {
      asg = await loadAssignment(assignmentId);
      packId = asg?.packId || asg?.pack || '';
    }
    if (!packId) throw new Error('Chybí packId (ani v URL ?pack=, ani v assignmentu).');

    const allPairs = await loadPack(packId);
    const usePairs = orient(allPairs, direction).slice(0, limit);

    log('init()', { assignmentId, packId, direction, total: allPairs.length, used: usePairs.length });

    if (!usePairs.length) {
      throw new Error('V balíčku nejsou data (pairs).');
    }

    return { assignmentId, packId, direction, pairs: usePairs };
  }

  async function reportResult({ assignmentId, score, total, extra }) {
    try {
      if (!assignmentId) return;
      await db.collection('assignments').doc(assignmentId).update({
        status: 'done',
        score: Number(score) || 0,
        total: Number(total) || 0,
        resultAt: firebase.firestore.FieldValue.serverTimestamp(),
        ...(extra ? { extra } : {})
      });
    } catch (e) {
      err('reportResult failed', e);
    }
  }

  return { init, reportResult };
})();
