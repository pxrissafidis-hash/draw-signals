// Draw Signals: όλη η λογική αξιολόγησης σε ένα σημείο.
// Χρησιμοποιείται και από το app (στο κινητό) και από το script ενημέρωσης / τα tests.
// Κανόνας: ποτέ δεν εφευρίσκουμε τιμές. Ό,τι λείπει γίνεται null και εμφανίζεται ως «εκκρεμεί».

export const DEFAULT_SETTINGS = {
  // Βάρη για το P_est(X): w * no-vig P(X) + (1 - w) * μέσος όρος ποσοστού Χ των δύο ομάδων
  wMarket: 0.6,
  // Ελάχιστοι αγώνες για να θεωρηθεί γνωστό το προφίλ Χ μιας ομάδας
  minGames: 4,
  // Προφίλ Χ: «συχνό Χ» όταν N <= nGood (π.χ. 1 Χ ανά 3.5 αγώνες), «σπάνιο» όταν N > nBad ή 0 Χ
  nGood: 3.5,
  nBad: 5,
  // No-vig P(X)
  pxGood: 0.28,
  pxMin: 0.25,
  // Closeness: |P(1) - P(2)| no-vig
  closeGood: 0.15,
  closeMax: 0.25,
  // Under 2.5 no-vig
  underGood: 0.52,
  underMin: 0.45,
  // EV
  evGood: 0.03,
  evMin: -0.02,
};

export const SIGNAL = { FULL: 'FULL', STRONG: 'STRONG', NONE: 'NONE' };
export const PASS = 'pass', PARTIAL = 'partial', FAIL = 'fail', UNKNOWN = 'unknown';

const isOdd = (o) => typeof o === 'number' && isFinite(o) && o > 1;

/** No-vig πιθανότητες από 1-X-2. Επιστρέφει null αν λείπει έστω και μία απόδοση. */
export function noVig1x2(o1, ox, o2) {
  if (!isOdd(o1) || !isOdd(ox) || !isOdd(o2)) return null;
  const s = 1 / o1 + 1 / ox + 1 / o2;
  return { p1: 1 / o1 / s, px: 1 / ox / s, p2: 1 / o2 / s, overround: s };
}

/** No-vig πιθανότητα Under 2.5. */
export function noVigUnder(oOver, oUnder) {
  if (!isOdd(oOver) || !isOdd(oUnder)) return null;
  const s = 1 / oOver + 1 / oUnder;
  return { under: 1 / oUnder / s, over: 1 / oOver / s, overround: s };
}

/** Προφίλ Χ ομάδας από αποτελέσματα σεζόν. */
export function teamDrawProfile(team, results, settings = DEFAULT_SETTINGS) {
  let played = 0, draws = 0;
  for (const r of results) {
    if (r.home !== team && r.away !== team) continue;
    if (typeof r.hg !== 'number' || typeof r.ag !== 'number') continue;
    played++;
    if (r.hg === r.ag) draws++;
  }
  const known = played >= settings.minGames;
  const n = draws > 0 ? played / draws : null; // null = καμία ισοπαλία
  let level = UNKNOWN;
  if (known) {
    if (draws === 0 || n > settings.nBad) level = FAIL;
    else if (n <= settings.nGood) level = PASS;
    else level = PARTIAL;
  }
  return { team, played, draws, rate: played ? draws / played : null, n, known, level };
}

export function formatProfile(p) {
  if (!p || !p.known) {
    const extra = p && p.played ? ` (μόνο ${p.played} αγώνες)` : '';
    return `άγνωστη / ουδέτερη τάση${extra}`;
  }
  if (p.draws === 0) return `0 Χ σε ${p.played} αγώνες (καμία ισοπαλία)`;
  return `${p.draws} Χ σε ${p.played} αγώνες = 1 Χ ανά ${fmtNum(p.n, 1)} αγώνες`;
}

export const fmtPct = (x) => (x == null ? 'εκκρεμεί' : `${(x * 100).toFixed(1)}%`);
export const fmtNum = (x, d = 2) => (x == null ? 'εκκρεμεί' : Number(x).toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1'));
export const fmtSigned = (x) => (x == null ? 'εκκρεμεί' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);

/** Αξιολόγηση ενός αγώνα. fixture: {home, away, odds:{h,d,a,over,under}} */
export function evaluateMatch(fixture, results, settings = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const o = fixture.odds || {};
  const m = noVig1x2(o.h, o.d, o.a);
  const u = noVigUnder(o.over, o.under);
  const ph = teamDrawProfile(fixture.home, results, s);
  const pa = teamDrawProfile(fixture.away, results, s);

  const crit = {};
  const passes = [], partials = [], cuts = [], pending = [];

  // 1. Προφίλ Χ
  {
    let level;
    if (!ph.known || !pa.known) level = UNKNOWN;
    else if (ph.level === PASS && pa.level === PASS) level = PASS;
    else if (ph.level === FAIL && pa.level === FAIL) level = FAIL;
    else if (ph.level === FAIL || pa.level === FAIL) level = ph.level === PASS || pa.level === PASS ? PARTIAL : FAIL;
    else level = PARTIAL;
    crit.propensity = { level, home: ph, away: pa };
    const txt = `Προφίλ Χ: ${fixture.home} ${formatProfile(ph)} · ${fixture.away} ${formatProfile(pa)}`;
    if (level === PASS) passes.push(txt + ' (και οι δύο με συχνό Χ)');
    else if (level === FAIL) cuts.push(txt + ' (σπάνιο Χ)');
    else if (level === PARTIAL) partials.push(txt + ' (μικτό / μέτριο προφίλ)');
    else pending.push(txt);
  }

  // 2. No-vig P(X)
  if (!m) {
    crit.px = { level: UNKNOWN, value: null };
    pending.push('Αποδόσεις 1-X-2: εκκρεμούν / δεν επιβεβαιώνονται');
  } else {
    const level = m.px >= s.pxGood ? PASS : m.px >= s.pxMin ? PARTIAL : FAIL;
    crit.px = { level, value: m.px, overround: m.overround };
    const txt = `No-vig P(X) ${fmtPct(m.px)}`;
    (level === PASS ? passes : level === PARTIAL ? partials : cuts).push(txt + (level === PASS ? '' : level === PARTIAL ? ' (οριακή)' : ' (χαμηλή)'));
  }

  // 3. Closeness
  if (!m) crit.closeness = { level: UNKNOWN, value: null };
  else {
    const d = Math.abs(m.p1 - m.p2);
    const level = d <= s.closeGood ? PASS : d <= s.closeMax ? PARTIAL : FAIL;
    crit.closeness = { level, value: d, p1: m.p1, p2: m.p2 };
    const txt = `Ισορροπία: 1 ${fmtPct(m.p1)} vs 2 ${fmtPct(m.p2)} (διαφορά ${fmtPct(d)})`;
    if (level === PASS) passes.push(txt + ', ισορροπημένο ζευγάρι');
    else (level === PARTIAL ? partials : cuts).push(txt + (level === PARTIAL ? ', ελαφρύ φαβορί' : ', έντονο φαβορί'));
  }

  // 4. Under 2.5
  if (!u) {
    crit.under = { level: UNKNOWN, value: null };
    pending.push('Αποδόσεις Under/Over 2.5: εκκρεμούν / δεν επιβεβαιώνονται');
  } else {
    const level = u.under >= s.underGood ? PASS : u.under >= s.underMin ? PARTIAL : FAIL;
    crit.under = { level, value: u.under };
    const txt = `No-vig Under 2.5 ${fmtPct(u.under)}`;
    if (level === PASS) passes.push(txt + ', κλειστό ματς χαμηλού σκορ');
    else (level === PARTIAL ? partials : cuts).push(txt + (level === PARTIAL ? ', ουδέτερο προφίλ γκολ' : ', ανοιχτό ματς με γκολ'));
  }

  // 5. P_est & EV
  let pEst = null, ev = null, breakEven = null, pEstNote = '';
  if (m) {
    breakEven = 1 / o.d;
    if (ph.known && pa.known) {
      const teamRate = (ph.rate + pa.rate) / 2;
      pEst = s.wMarket * m.px + (1 - s.wMarket) * teamRate;
      pEstNote = `${Math.round(s.wMarket * 100)}% αγορά + ${Math.round((1 - s.wMarket) * 100)}% προφίλ Χ ομάδων (${fmtPct(teamRate)})`;
    } else {
      pEst = m.px;
      pEstNote = 'μόνο αγορά (το προφίλ Χ είναι άγνωστο, οπότε EV ≈ −γκανιότα)';
    }
    ev = pEst * o.d - 1;
    const txt = `EV ${fmtSigned(ev)} (P_est ${fmtPct(pEst)} × ${fmtNum(o.d)}, break-even ${fmtPct(breakEven)})`;
    if (!(ph.known && pa.known)) {
      // Χωρίς προφίλ Χ το EV είναι απλώς η γκανιότα: δεν κρίνεται, μένει εκκρεμές.
      crit.ev = { level: UNKNOWN, value: ev, pEst, breakEven, note: pEstNote };
      pending.push(txt + ', δεν αξιολογείται χωρίς γνωστό προφίλ Χ');
    } else {
      const level = ev >= s.evGood ? PASS : ev >= s.evMin ? PARTIAL : FAIL;
      crit.ev = { level, value: ev, pEst, breakEven, note: pEstNote };
      (level === PASS ? passes : level === PARTIAL ? partials : cuts).push(txt + (level === PASS ? ', θετικό' : level === PARTIAL ? ', οριακό' : ', αρνητικό'));
    }
  } else crit.ev = { level: UNKNOWN, value: null };

  return { signal: classify(crit), crit, passes, partials, cuts, pending, noVig: m, underNoVig: u };
}

/** Τριβάθμια κλίμακα. */
export function classify(c) {
  const lv = (k) => c[k].level;
  // Χωρίς 1-X-2 δεν στηρίζεται σήμα
  if (lv('px') === UNKNOWN) return SIGNAL.NONE;
  const all = ['propensity', 'px', 'closeness', 'under', 'ev'];
  if (all.every((k) => lv(k) === PASS)) return SIGNAL.FULL;
  // Βασικές αποκλειστικές συνθήκες
  if ([lv('closeness'), lv('px'), lv('ev'), lv('under')].includes(FAIL)) return SIGNAL.NONE;
  // Δομικά στοιχεία: ισορροπία + (χαμηλό σκορ ή συχνό Χ)
  const structural = lv('closeness') !== FAIL && (lv('under') === PASS || lv('propensity') === PASS);
  if (structural && lv('propensity') !== FAIL) return SIGNAL.STRONG;
  return SIGNAL.NONE;
}

export const SIGNAL_LABEL = {
  FULL: 'FULL DRAW SIGNAL',
  STRONG: 'STRONG / QUALIFIED',
  NONE: 'NO SIGNAL',
};
