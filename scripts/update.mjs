// Κατεβάζει τα CSV του football-data.co.uk και γράφει το public/data.json.
// Τρέχει αυτόματα στο GitHub Actions (Παρασκευή & Σάββατο) ή χειροκίνητα: `node scripts/update.mjs`.
// Δεν εφευρίσκει τίποτα: αν μια λήψη αποτύχει, κρατάει τα προηγούμενα δεδομένα και τα σημειώνει ως παλιά.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const LEAGUES = [
  { code: 'SP1', name: 'La Liga', flag: '🇪🇸' },
  { code: 'I1', name: 'Serie A', flag: '🇮🇹' },
  { code: 'E0', name: 'Premier League', flag: '🏴' },
  { code: 'F1', name: 'Ligue 1', flag: '🇫🇷' },
  { code: 'G1', name: 'Super League 1', flag: '🇬🇷' },
];

const BASE = process.env.FD_BASE || 'https://www.football-data.co.uk';

export function seasonCode(d = new Date()) {
  // Η σεζόν ξεκινά τον Ιούλιο: Νοέμβριος 2026 -> "2627"
  const y = d.getUTCFullYear();
  const start = d.getUTCMonth() >= 6 ? y : y - 1;
  return String(start % 100).padStart(2, '0') + String((start + 1) % 100).padStart(2, '0');
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x.trim() !== '')) rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().replace(/^﻿/, ''));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v) => { const n = parseFloat(v); return isFinite(n) && n > 1 ? n : null; };
const int = (v) => (v === '' || v == null || !/^\d+$/.test(v) ? null : parseInt(v, 10));

/** Ώρα του football-data.co.uk = ώρα Ηνωμένου Βασιλείου. Μετατροπή σε ISO UTC. */
export function ukToIso(dateStr, timeStr) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(dateStr || '');
  if (!m) return null;
  let [, dd, mm, yy] = m;
  let year = parseInt(yy, 10); if (year < 100) year += 2000;
  const t = /^(\d{1,2}):(\d{2})$/.exec(timeStr || '');
  const hh = t ? +t[1] : 12, mi = t ? +t[2] : 0;
  const guess = Date.UTC(year, +mm - 1, +dd, hh, mi);
  const off = londonOffsetMin(new Date(guess));
  return { iso: new Date(guess - off * 60000).toISOString(), hasTime: !!t };
}

function londonOffsetMin(d) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = (t) => +parts.find((p) => p.type === t).value;
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return Math.round((asUtc - d.getTime()) / 60000);
}

/** Διαλέγει αποδόσεις: μέσος όρος αγοράς, αλλιώς Bet365, αλλιώς Pinnacle. */
export function pickOdds(r) {
  const sets = [
    ['Μέσος όρος αγοράς', 'AvgH', 'AvgD', 'AvgA', 'Avg>2.5', 'Avg<2.5'],
    ['Bet365', 'B365H', 'B365D', 'B365A', 'B365>2.5', 'B365<2.5'],
    ['Pinnacle', 'PSH', 'PSD', 'PSA', 'P>2.5', 'P<2.5'],
  ];
  let x = null, ou = null;
  for (const [src, h, d, a] of sets) {
    if (num(r[h]) && num(r[d]) && num(r[a])) { x = { h: num(r[h]), d: num(r[d]), a: num(r[a]), src }; break; }
  }
  for (const [src, , , , o, u] of sets) {
    if (num(r[o]) && num(r[u])) { ou = { over: num(r[o]), under: num(r[u]), src }; break; }
  }
  return {
    h: x?.h ?? null, d: x?.d ?? null, a: x?.a ?? null,
    over: ou?.over ?? null, under: ou?.under ?? null,
    src1x2: x?.src ?? null, srcOU: ou?.src ?? null,
  };
}

export function toResults(rows) {
  return rows
    .filter((r) => r.HomeTeam && r.AwayTeam && int(r.FTHG) != null && int(r.FTAG) != null)
    .map((r) => {
      const k = ukToIso(r.Date, r.Time);
      return { kickoff: k?.iso ?? null, home: r.HomeTeam, away: r.AwayTeam, hg: int(r.FTHG), ag: int(r.FTAG) };
    });
}

export function toFixtures(rows, code) {
  return rows
    .filter((r) => (r.Div || '').trim() === code && r.HomeTeam && r.AwayTeam)
    .map((r) => {
      const k = ukToIso(r.Date, r.Time);
      return { kickoff: k?.iso ?? null, hasTime: k?.hasTime ?? false, home: r.HomeTeam, away: r.AwayTeam, odds: pickOdds(r) };
    });
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'draw-signals-updater' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} για ${url}`);
  return res.text();
}

export async function build({ now = new Date(), previous = null, fetcher = fetchText } = {}) {
  const season = seasonCode(now);
  let fixtureRows = null, fixturesError = null;
  try {
    const txt = await fetcher(`${BASE}/fixtures.csv`);
    fixtureRows = parseCsv(txt);
    const divs = {};
    for (const r of fixtureRows) divs[r.Div] = (divs[r.Div] || 0) + 1;
    if (process.env.DS_DEBUG !== '0') console.log(`fixtures.csv: ${txt.length} bytes, ${fixtureRows.length} γραμμές, στήλες: ${Object.keys(fixtureRows[0] || {}).slice(0, 8).join(',')}, ανά Div: ${JSON.stringify(divs)}`);
  }
  catch (e) { fixturesError = String(e.message || e); }

  const leagues = [];
  for (const L of LEAGUES) {
    const prev = previous?.leagues?.find((x) => x.code === L.code);
    const out = { ...L, results: [], fixtures: [], resultsStatus: 'ok', fixturesStatus: 'ok', errors: [] };
    try {
      out.results = toResults(parseCsv(await fetcher(`${BASE}/mmz4281/${season}/${L.code}.csv`)));
      out.resultsUpdatedAt = now.toISOString();
    } catch (e) {
      out.errors.push(`Αποτελέσματα: ${e.message || e}`);
      out.resultsStatus = prev?.results?.length ? 'stale' : 'missing';
      out.results = prev?.results ?? [];
      out.resultsUpdatedAt = prev?.resultsUpdatedAt ?? null;
    }
    if (fixtureRows) {
      out.fixtures = toFixtures(fixtureRows, L.code);
      out.fixturesUpdatedAt = now.toISOString();
    } else {
      out.errors.push(`Πρόγραμμα/αποδόσεις: ${fixturesError}`);
      out.fixturesStatus = prev?.fixtures?.length ? 'stale' : 'missing';
      out.fixtures = prev?.fixtures ?? [];
      out.fixturesUpdatedAt = prev?.fixturesUpdatedAt ?? null;
    }
    leagues.push(out);
  }
  return { generatedAt: now.toISOString(), season, source: 'football-data.co.uk', leagues };
}

// Εκτέλεση από γραμμή εντολών
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data.json');
  let previous = null;
  try { previous = JSON.parse(await readFile(file, 'utf8')); } catch {}
  const data = await build({ previous });
  await writeFile(file, JSON.stringify(data));
  for (const l of data.leagues) {
    console.log(`${l.name}: ${l.results.length} αποτελέσματα (${l.resultsStatus}), ${l.fixtures.length} επόμενοι αγώνες (${l.fixturesStatus})${l.errors.length ? ' | ' + l.errors.join('; ') : ''}`);
  }
  const allMissing = data.leagues.every((l) => l.resultsStatus !== 'ok' && l.fixturesStatus !== 'ok');
  if (allMissing) { console.error('Καμία λήψη δεν πέτυχε.'); process.exit(1); }
}
