import { DEFAULT_SETTINGS, evaluateMatch, formatProfile, fmtPct, fmtNum, fmtSigned, SIGNAL_LABEL } from './logic.js';

// Σύνδεσμος για χειροκίνητη λήψη νέων δεδομένων στο GitHub (μόνο για τον ιδιοκτήτη). Συμπληρώνεται στο deploy.
const UPDATE_URL = '';
const TZ = 'Europe/Athens';
const AUTO_REFRESH_MIN = 30;
const STALE_DAYS = 8;
const SIGNAL_ORDER = { FULL: 0, STRONG: 1, NONE: 2 };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  data: null,
  lastFetch: 0,
  offline: false,
  settings: { ...DEFAULT_SETTINGS, ...store.get('ds.settings', {}) },
  league: store.get('ds.league', 'ALL'),
  range: store.get('ds.range', 'weekend'),
  onlySignals: store.get('ds.onlySignals', false),
  theme: store.get('ds.theme', 'auto'),
};

// ---------- Ημερομηνίες (ώρα Ελλάδας) ----------
function athensParts(d) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t).value;
  return { key: `${g('year')}-${g('month')}-${g('day')}`, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')) };
}
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dayKey = (iso) => (iso ? athensParts(new Date(iso)).key : null);

function currentWindow(now = new Date()) {
  const { key, wd } = athensParts(now);
  if (state.range === 'week') return { from: key, to: addDays(key, 7), label: `Επόμενες 7 ημέρες (${fmtDay(key)} – ${fmtDay(addDays(key, 7))})` };
  // Παρασκευή έως Δευτέρα. Τρίτη–Πέμπτη δείχνει το επόμενο Σαββατοκύριακο.
  const back = { 5: 0, 6: 1, 0: 2, 1: 3 }[wd];
  const fri = back != null ? addDays(key, -back) : addDays(key, (5 - wd + 7) % 7);
  return { from: fri, to: addDays(fri, 3), label: `Σαββατοκύριακο ${fmtDay(fri)} – ${fmtDay(addDays(fri, 3))}` };
}
function fmtDay(key) { const [y, m, d] = key.split('-'); return `${d}/${m}`; }
function fmtKick(iso, hasTime = true) {
  if (!iso) return 'ώρα εκκρεμεί';
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('el-GR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' }).format(d);
  if (!hasTime) return `${day} · ώρα εκκρεμεί`;
  const t = new Intl.DateTimeFormat('el-GR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${day} · ${t}`;
}
function fmtStamp(iso) {
  if (!iso) return 'άγνωστο';
  return new Intl.DateTimeFormat('el-GR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

// ---------- Δεδομένα ----------
async function loadData({ manual = false } = {}) {
  const btn = $('#btn-refresh');
  btn.disabled = true; btn.textContent = '↻ Φόρτωση…';
  try {
    const res = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.offline = false;
    state.lastFetch = Date.now();
  } catch (e) {
    state.offline = true;
    if (!state.data) {
      try { const c = await caches.match('data.json'); if (c) state.data = await c.json(); } catch {}
    }
  } finally {
    btn.disabled = false; btn.textContent = manual ? '✓ Ενημερώθηκε' : '↻ Ανανέωση';
    if (manual) setTimeout(() => (btn.textContent = '↻ Ανανέωση'), 1800);
  }
  render();
}

// ---------- Render ----------
function render() {
  const win = currentWindow();
  $('#window-label').textContent = win.label;
  renderChips();
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.range === state.range));
  $('#only-signals').checked = state.onlySignals;

  const d = state.data;
  renderStatus(d);
  if (!d || !d.leagues?.length) {
    $('#summary').innerHTML = '<div class="empty">Δεν υπάρχουν ακόμα δεδομένα. Πάτησε «Ανανέωση» όταν έχεις σύνδεση.</div>';
    $('#leagues').innerHTML = ''; $('#finished').innerHTML = '';
    return;
  }
  const now = Date.now();
  const all = [], finished = [];
  for (const L of d.leagues) {
    if (state.league !== 'ALL' && state.league !== L.code) continue;
    const played = new Set(L.results.map((r) => `${r.home}|${r.away}|${dayKey(r.kickoff)}`));
    for (const r of L.results) {
      const k = dayKey(r.kickoff);
      if (k && k >= win.from && k <= win.to) finished.push({ ...r, league: L });
    }
    for (const f of L.fixtures) {
      const k = dayKey(f.kickoff);
      if (!k || k < win.from || k > win.to) continue;
      if (played.has(`${f.home}|${f.away}|${k}`)) continue; // ήδη ολοκληρωμένος
      const prior = L.results.filter((r) => !f.kickoff || !r.kickoff || r.kickoff < f.kickoff);
      const ev = evaluateMatch(f, prior, state.settings);
      all.push({ f, ev, league: L, started: f.kickoff && new Date(f.kickoff).getTime() < now, id: `m-${L.code}-${slug(f.home)}-${slug(f.away)}` });
    }
  }
  renderSummary(all);
  renderLeagues(all);
  renderFinished(finished);
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');

function renderStatus(d) {
  const msgs = [];
  if (state.offline) msgs.push(d ? `Χωρίς σύνδεση. Βλέπεις τα αποθηκευμένα δεδομένα της ${fmtStamp(d.generatedAt)}.` : 'Χωρίς σύνδεση και χωρίς αποθηκευμένα δεδομένα.');
  if (d) {
    const ageDays = (Date.now() - new Date(d.generatedAt).getTime()) / 864e5;
    if (ageDays > STALE_DAYS) msgs.push(`Τα δεδομένα είναι ${Math.floor(ageDays)} ημερών. Η αυτόματη ενημέρωση ίσως δεν έτρεξε.`);
    for (const L of d.leagues) {
      if (L.resultsStatus === 'missing') msgs.push(`${L.name}: τα αποτελέσματα σεζόν δεν βρέθηκαν, άρα το προφίλ Χ είναι άγνωστο.`);
      else if (L.resultsStatus === 'stale') msgs.push(`${L.name}: αποτελέσματα από προηγούμενη λήψη (${fmtStamp(L.resultsUpdatedAt)}).`);
      if (L.fixturesStatus === 'missing') msgs.push(`${L.name}: πρόγραμμα και αποδόσεις εκκρεμούν.`);
      else if (L.fixturesStatus === 'stale') msgs.push(`${L.name}: αποδόσεις από προηγούμενη λήψη (${fmtStamp(L.fixturesUpdatedAt)}).`);
    }
  }
  $('#status').innerHTML = msgs.map((m) => `<p>${esc(m)}</p>`).join('');
}

function renderChips() {
  const leagues = state.data?.leagues ?? [];
  const items = [{ code: 'ALL', name: 'Όλα' }, ...leagues];
  $('#league-chips').innerHTML = items.map((l) => `<button class="chip ${state.league === l.code ? 'on' : ''}" data-league="${esc(l.code)}">${l.flag ? esc(l.flag) + ' ' : ''}${esc(l.name)}</button>`).join('');
}

function renderSummary(all) {
  const full = all.filter((x) => x.ev.signal === 'FULL');
  const strong = all.filter((x) => x.ev.signal === 'STRONG');
  const none = all.length - full.length - strong.length;
  const line = (x) => `<li><a href="#${x.id}"><span class="badge ${x.ev.signal}">${SIGNAL_LABEL[x.ev.signal]}</span><span class="teams">${esc(x.f.home)} – ${esc(x.f.away)}</span><span class="muted small">${esc(x.league.name)} · ${esc(fmtKick(x.f.kickoff, x.f.hasTime))}</span></a></li>`;
  const sorted = [...full, ...strong].sort((a, b) => SIGNAL_ORDER[a.ev.signal] - SIGNAL_ORDER[b.ev.signal] || String(a.f.kickoff).localeCompare(String(b.f.kickoff)));
  $('#summary').innerHTML = `
    <h2>Σύνοψη</h2>
    <div class="counts">
      <span class="badge FULL">FULL: ${full.length}</span>
      <span class="badge STRONG">STRONG: ${strong.length}</span>
      <span class="badge NONE">NO SIGNAL: ${none}</span>
    </div>
    ${sorted.length ? `<ul>${sorted.map(line).join('')}</ul>` : `<p class="muted small">${all.length ? 'Κανένα FULL ή STRONG σήμα σε αυτή την περίοδο.' : 'Δεν υπάρχουν αγώνες με πρόγραμμα σε αυτή την περίοδο.'}</p>`}
    <p class="muted small">Ενημέρωση δεδομένων: ${esc(fmtStamp(state.data.generatedAt))}</p>`;
}

function renderLeagues(all) {
  const groups = new Map();
  for (const x of all) {
    if (state.onlySignals && x.ev.signal === 'NONE') continue;
    if (!groups.has(x.league.code)) groups.set(x.league.code, { league: x.league, items: [] });
    groups.get(x.league.code).items.push(x);
  }
  const order = (state.data.leagues || []).map((l) => l.code).filter((c) => state.league === 'ALL' || c === state.league);
  const html = order.map((code) => {
    const L = state.data.leagues.find((l) => l.code === code);
    const g = groups.get(code);
    const items = g ? g.items.sort((a, b) => String(a.f.kickoff).localeCompare(String(b.f.kickoff))) : [];
    const body = items.length ? items.map(card).join('') : `<div class="empty">${state.onlySignals ? 'Κανένα σήμα.' : L.fixtures.length ? 'Κανένας αγώνας σε αυτή την περίοδο.' : 'Το πρόγραμμα εκκρεμεί.'}</div>`;
    return `<section class="league"><div class="league-head"><h2>${esc(L.flag)} ${esc(L.name)}</h2><span class="muted small">${items.length} αγώνες</span></div>${body}</section>`;
  }).join('');
  $('#leagues').innerHTML = html;
}

function card(x) {
  const { f, ev } = x, o = f.odds || {}, c = ev.crit;
  const kpi = (label, val, lv) => `<div class="kpi"><b class="lv-${lv}">${esc(val)}</b><span>${esc(label)}</span></div>`;
  const list = (cls, title, arr) => (arr.length ? `<h3>${title}</h3><ul class="${cls}">${arr.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '');
  const ph = c.propensity.home, pa = c.propensity.away;
  return `<details class="card" id="${x.id}" data-signal="${ev.signal}">
    <summary>
      <div class="card-top">
        <div><div class="teams">${esc(f.home)} – ${esc(f.away)}</div><div class="when">${esc(fmtKick(f.kickoff, f.hasTime))}${x.started ? ' · ξεκίνησε, αναμένεται αποτέλεσμα' : ''}</div></div>
        <span class="badge ${ev.signal}">${SIGNAL_LABEL[ev.signal]}</span>
      </div>
      <div class="kpis">
        ${kpi('Απόδοση Χ', o.d ? fmtNum(o.d) : 'εκκρεμεί', c.px.level)}
        ${kpi('No-vig P(X)', fmtPct(c.px.value), c.px.level)}
        ${kpi('Under 2.5', fmtPct(c.under.value), c.under.level)}
        ${kpi('EV', fmtSigned(c.ev.value), c.ev.level)}
      </div>
      <div class="more">Ανάλυση</div>
    </summary>
    <div class="detail">
      ${list('ok', 'Τι περνάει', ev.passes)}
      ${list('cut', 'Τι κόβεται', ev.cuts)}
      ${list('pend', 'Εκκρεμεί', ev.pending)}
      <h3>Προφίλ Χ</h3>
      <ul class="pend" style="list-style:none">
        <li style="padding-left:0">${esc(f.home)}: ${esc(formatProfile(ph))}</li>
        <li style="padding-left:0">${esc(f.away)}: ${esc(formatProfile(pa))}</li>
      </ul>
      <h3>Υπολογισμοί</h3>
      <ul style="list-style:none">
        <li style="padding-left:0">1-X-2: ${esc(fmtNum(o.h))} / ${esc(fmtNum(o.d))} / ${esc(fmtNum(o.a))}${o.src1x2 ? ` (${esc(o.src1x2)})` : ''}</li>
        <li style="padding-left:0">S = ${ev.noVig ? esc(fmtNum(ev.noVig.overround, 4)) : 'εκκρεμεί'} · γκανιότα ${ev.noVig ? esc(fmtPct(ev.noVig.overround - 1)) : 'εκκρεμεί'}</li>
        <li style="padding-left:0">Over / Under 2.5: ${esc(fmtNum(o.over))} / ${esc(fmtNum(o.under))}${o.srcOU ? ` (${esc(o.srcOU)})` : ''}</li>
        <li style="padding-left:0">P_est(X) = ${esc(fmtPct(c.ev.pEst))}${c.ev.note ? ` · ${esc(c.ev.note)}` : ''}</li>
        <li style="padding-left:0">Break-even 1/O<sub>X</sub> = ${esc(fmtPct(c.ev.breakEven))}</li>
      </ul>
    </div>
  </details>`;
}

function renderFinished(rows) {
  if (!rows.length) { $('#finished').innerHTML = ''; return; }
  rows.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  $('#finished').innerHTML = `<section class="league finished"><div class="league-head"><h2>Ολοκληρωμένοι αγώνες της περιόδου</h2></div>
    <table>${rows.map((r) => `<tr><td>${esc(r.league.flag)} ${esc(r.home)}</td><td class="sc">${r.hg} – ${r.ag}</td><td>${esc(r.away)}</td></tr>`).join('')}</table></section>`;
}

// ---------- Ρυθμίσεις ----------
const FIELDS = [
  ['wMarket', 'Βάρος αγοράς στο P_est(X)', 'Το υπόλοιπο πάει στο προφίλ Χ των ομάδων (0–1)', 0.05],
  ['minGames', 'Ελάχιστοι αγώνες για γνωστό προφίλ Χ', 'Λιγότεροι = «άγνωστη / ουδέτερη τάση»', 1],
  ['nGood', 'Συχνό Χ: 1 Χ ανά N ≤', '', 0.1],
  ['nBad', 'Σπάνιο Χ: 1 Χ ανά N >', '', 0.1],
  ['pxGood', 'No-vig P(X) περνάει από', '', 0.01],
  ['pxMin', 'No-vig P(X) κόβεται κάτω από', '', 0.01],
  ['closeGood', 'Ισορροπημένο: |P1 − P2| ≤', '', 0.01],
  ['closeMax', 'Έντονο φαβορί: |P1 − P2| >', '', 0.01],
  ['underGood', 'Under 2.5 περνάει από', '', 0.01],
  ['underMin', 'Under 2.5 κόβεται κάτω από', '', 0.01],
  ['evGood', 'EV θετικό από', '', 0.01],
  ['evMin', 'EV κόβεται κάτω από', '', 0.01],
];
function renderSettings() {
  $('#settings-fields').innerHTML = FIELDS.map(([k, label, hint, step]) => `
    <div class="field"><label for="f-${k}">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}<small>Προεπιλογή: ${DEFAULT_SETTINGS[k]}</small></label>
    <input id="f-${k}" data-key="${k}" type="number" inputmode="decimal" step="${step}" value="${state.settings[k]}"></div>`).join('');
  document.querySelectorAll('input[name=theme]').forEach((r) => (r.checked = r.value === state.theme));
  $('#update-hint').innerHTML = UPDATE_URL
    ? `Τα δεδομένα ανανεώνονται αυτόματα κάθε Παρασκευή και Σάββατο. Για άμεση νέα λήψη: <a href="${esc(UPDATE_URL)}" target="_blank" rel="noopener">GitHub → Run workflow</a>.`
    : 'Τα δεδομένα ανανεώνονται αυτόματα κάθε Παρασκευή και Σάββατο.';
}
function applyTheme() {
  if (state.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', state.theme);
}

// ---------- Events ----------
$('#btn-refresh').addEventListener('click', () => loadData({ manual: true }));
$('#btn-settings').addEventListener('click', () => { renderSettings(); $('#settings').showModal(); });
$('#league-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-league]'); if (!b) return;
  state.league = b.dataset.league; store.set('ds.league', state.league); render();
});
document.querySelector('.seg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-range]'); if (!b) return;
  state.range = b.dataset.range; store.set('ds.range', state.range); render();
});
$('#only-signals').addEventListener('change', (e) => { state.onlySignals = e.target.checked; store.set('ds.onlySignals', state.onlySignals); render(); });
$('#settings-fields').addEventListener('change', (e) => {
  const k = e.target.dataset.key; if (!k) return;
  const v = parseFloat(e.target.value);
  if (!isFinite(v)) { e.target.value = state.settings[k]; return; }
  state.settings[k] = v; store.set('ds.settings', state.settings); render();
});
document.querySelector('.theme-pick').addEventListener('change', (e) => { state.theme = e.target.value; store.set('ds.theme', state.theme); applyTheme(); });
// Επαναφορά σε δύο βήματα, ώστε να μη χαθούν οι ρυθμίσεις από τυχαίο πάτημα
let resetArmed = null;
$('#btn-reset').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!resetArmed) {
    b.textContent = 'Πάτα ξανά για επιβεβαίωση'; b.classList.add('danger');
    resetArmed = setTimeout(() => { resetArmed = null; b.textContent = 'Επαναφορά προεπιλογών'; b.classList.remove('danger'); }, 3000);
    return;
  }
  clearTimeout(resetArmed); resetArmed = null;
  state.settings = { ...DEFAULT_SETTINGS }; store.set('ds.settings', state.settings);
  b.textContent = 'Επαναφορά προεπιλογών'; b.classList.remove('danger');
  renderSettings(); render();
});
// Άνοιγμα κάρτας όταν πατάς σήμα στη σύνοψη
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#m-"]'); if (!a) return;
  const el = document.getElementById(a.getAttribute('href').slice(1)); if (el) el.open = true;
});
// Αυτόματη ανανέωση όταν ανοίγεις ξανά το app
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.lastFetch > AUTO_REFRESH_MIN * 60000) loadData();
});

applyTheme();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
loadData();
