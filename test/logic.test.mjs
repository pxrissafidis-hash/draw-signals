import test from 'node:test';
import assert from 'node:assert/strict';
import { noVig1x2, noVigUnder, teamDrawProfile, evaluateMatch, formatProfile } from '../public/logic.js';
import { parseCsv, build, ukToIso, seasonCode, pickOdds } from '../scripts/update.mjs';

const R = (home, away, hg, ag) => ({ home, away, hg, ag, kickoff: '2026-10-01T15:00:00Z' });

test('no-vig 1X2 όπως στο prompt', () => {
  const m = noVig1x2(2.6, 3.2, 2.9);
  const s = 1 / 2.6 + 1 / 3.2 + 1 / 2.9;
  assert.ok(Math.abs(m.px - (1 / 3.2) / s) < 1e-12);
  assert.ok(Math.abs(m.p1 + m.px + m.p2 - 1) < 1e-12);
  assert.equal(noVig1x2(2.6, null, 2.9), null);
});

test('no-vig Under 2.5', () => {
  const u = noVigUnder(2.1, 1.75);
  assert.ok(Math.abs(u.under - (1 / 1.75) / (1 / 2.1 + 1 / 1.75)) < 1e-12);
  assert.equal(noVigUnder(null, 1.75), null);
});

test('1 Χ ανά N αγώνες: 3 Χ σε 9 = 1 ανά 3', () => {
  const res = [];
  for (let i = 0; i < 9; i++) res.push(R('A', 'Z' + i, i < 3 ? 1 : 2, 1));
  const p = teamDrawProfile('A', res);
  assert.equal(p.played, 9); assert.equal(p.draws, 3); assert.equal(p.n, 3);
  assert.equal(formatProfile(p), '3 Χ σε 9 αγώνες = 1 Χ ανά 3 αγώνες');
});

test('λίγοι αγώνες ή καθόλου = άγνωστη / ουδέτερη τάση', () => {
  assert.equal(teamDrawProfile('Q', []).known, false);
  assert.match(formatProfile(teamDrawProfile('Q', [])), /άγνωστη \/ ουδέτερη τάση/);
});

test('χωρίς αποδόσεις: NO SIGNAL και «εκκρεμεί», όχι εφευρεμένες τιμές', () => {
  const e = evaluateMatch({ home: 'A', away: 'B', odds: {} }, []);
  assert.equal(e.signal, 'NONE');
  assert.equal(e.crit.px.value, null);
  assert.equal(e.crit.ev.value, null);
  assert.ok(e.pending.some((t) => t.includes('εκκρεμούν')));
});

test('έντονο φαβορί = NO SIGNAL', () => {
  const e = evaluateMatch({ home: 'A', away: 'B', odds: { h: 1.3, d: 5.5, a: 10, over: 1.6, under: 2.3 } }, []);
  assert.equal(e.signal, 'NONE');
  assert.equal(e.crit.closeness.level, 'fail');
});

test('FULL όταν περνούν όλα', () => {
  const res = [];
  for (const t of ['A', 'B']) for (let i = 0; i < 10; i++) res.push(R(t, 'Z' + i, i < 5 ? 0 : 1, 0)); // 1 Χ ανά 2
  const e = evaluateMatch({ home: 'A', away: 'B', odds: { h: 2.9, d: 3.1, a: 2.8, over: 2.3, under: 1.62 } }, res);
  assert.equal(e.crit.propensity.level, 'pass');
  assert.ok(e.crit.ev.value > 0.03, 'EV ' + e.crit.ev.value);
  assert.equal(e.signal, 'FULL');
});

test('STRONG όταν το προφίλ Χ είναι άγνωστο αλλά το ζευγάρι κλειστό με Under', () => {
  const e = evaluateMatch({ home: 'A', away: 'B', odds: { h: 2.75, d: 3.0, a: 2.75, over: 2.25, under: 1.65 } }, []);
  assert.equal(e.crit.propensity.level, 'unknown');
  assert.equal(e.signal, 'STRONG');
});

test('CSV parser, ώρα UK -> UTC, σεζόν', () => {
  const rows = parseCsv('﻿Div,Date,Time,HomeTeam,AwayTeam\r\nSP1,28/11/2026,20:00,"Real, Madrid",Getafe\r\n');
  assert.equal(rows[0].Div, 'SP1'); assert.equal(rows[0].HomeTeam, 'Real, Madrid');
  assert.equal(ukToIso('28/11/2026', '20:00').iso, '2026-11-28T20:00:00.000Z'); // χειμώνας: UK = UTC
  assert.equal(ukToIso('15/08/26', '15:00').iso, '2026-08-15T14:00:00.000Z');   // καλοκαίρι: BST
  assert.equal(seasonCode(new Date('2026-11-26')), '2627');
  assert.equal(seasonCode(new Date('2027-03-01')), '2627');
});

test('επιλογή αποδόσεων: μέσος όρος, αλλιώς Bet365, κενά -> null', () => {
  assert.deepEqual(pickOdds({ B365H: '2.5', B365D: '3.1', B365A: '2.9' }).src1x2, 'Bet365');
  const o = pickOdds({ AvgH: '2.4', AvgD: '3.2', AvgA: '3', 'Avg>2.5': '', 'Avg<2.5': '' });
  assert.equal(o.src1x2, 'Μέσος όρος αγοράς'); assert.equal(o.over, null); assert.equal(o.under, null);
});

test('build: αποτυχία λήψης κρατά τα παλιά και τα σημειώνει', async () => {
  const fx = 'Div,Date,Time,HomeTeam,AwayTeam,AvgH,AvgD,AvgA,Avg>2.5,Avg<2.5\nG1,29/11/2026,17:00,AEK,PAOK,2.6,3.1,2.8,2.2,1.7\n';
  const res = 'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG\nG1,01/11/2026,17:00,AEK,PAOK,1,1\n';
  const ok = await build({ now: new Date('2026-11-26T10:00:00Z'), fetcher: async (u) => (u.endsWith('fixtures.csv') ? fx : res) });
  const g1 = ok.leagues.find((l) => l.code === 'G1');
  assert.equal(g1.fixtures.length, 1); assert.equal(g1.results.length, 1);
  assert.equal(g1.fixtures[0].odds.d, 3.1);
  const fail = await build({ now: new Date('2026-11-27T10:00:00Z'), previous: ok, fetcher: async () => { throw new Error('blocked'); } });
  const g2 = fail.leagues.find((l) => l.code === 'G1');
  assert.equal(g2.resultsStatus, 'stale'); assert.equal(g2.fixturesStatus, 'stale');
  assert.equal(g2.fixtures.length, 1);
});
