// Pure-function tests for the Telegram bot's message formatting. `pnpm test:bot`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, esc, formatCircle, formatEvent, formatReminder, formatScore, formatSteward, formatStart, type CircleState, type Links } from '../src/format.ts';
import { pickRecipient } from '../src/chain.ts';

const testnet: Links = { ccExplorer: 'https://creditcoin-testnet.blockscout.com', sourceExplorer: 'https://sepolia.etherscan.io', webAppUrl: 'https://prashant-thakur77.github.io/Kitty/' };
const local: Links = { ccExplorer: '', sourceExplorer: '', webAppUrl: 'http://localhost:5173/' };
const A = '0x7099797a5c8f7e7b3f2f2f2f2f2f2f2f2f2f79C8';
const B = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const C = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const TX = '0x768a20caa304fbcee642cd319c15892c63d1922576d6b99324ece369678bbbad';
const QID = '0x1fbdce98aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('describe() matches the dashboard feed wording', () => {
  assert.equal(describe('ContributionRecorded', { member: A, amount: 100_000_000n, round: 0, sourceHeight: 39n, onTime: true }), 'Proven: 0x7099…79C8 paid 100 tUSD for round 1 at Sepolia block 39 (on time) (r0)');
  assert.equal(describe('ContributionRecorded', { member: A, amount: 100_000_000n, round: 1, sourceHeight: 39n, onTime: false }), 'Proven: 0x7099…79C8 paid 100 tUSD for round 2 at Sepolia block 39 (LATE) (r1)');
  assert.equal(describe('BatchVerified', { count: 3n, fromHeight: 39n, toHeight: 55n }), '0x0FD2 verified 3 tx in ONE call · Sepolia blocks 39–55');
  assert.equal(describe('ContributionMissed', { member: B, round: 1, deadlineHeight: 1229n, attestedHeight: 1293n, attestedHash: '0xabcdef0123456789' }), 'Missed: 0x3C44…93BC did not pay round 2 by attested block 1229 · proven by attestation @ 1293 0xabcdef01… (r1)');
  assert.equal(describe('ContributionMissed', { member: B, round: 1, deadlineHeight: 1229n, attestedHeight: 0n }), 'Missed: 0x3C44…93BC did not pay round 2 by attested block 1229 (r1)');
  assert.equal(describe('RoundClosed', { round: 0, recipient: A, pot: 300_000_000n, missedCount: 0, attestedHeight: 0n }), 'Round 1 closed → 0x7099…79C8 receives 300 tUSD (0 missed) (r0)');
  assert.equal(describe('RoundClosed', { round: 0, recipient: A, pot: 300_000_000n, missedCount: 1, attestedHeight: 693n }), 'Round 1 closed → 0x7099…79C8 receives 300 tUSD (1 missed) · attested @ 693 (r0)');
  assert.equal(describe('RoundOpened', { round: 1, deadlineHeight: 1229n }), 'Round 2 open · pay by Sepolia block 1229 (r1)');
  assert.equal(describe('PayoutConfirmed', { recipient: A, amount: 300_000_000n }), 'Payout proven: 0x7099…79C8 received 300 tUSD on Ethereum');
  assert.equal(describe('CircleCreated', { name: 'Lagos Susu #1', members: [A, B, C], contribution: 100_000_000n }), 'Circle "Lagos Susu #1" created · 3 members · 100 tUSD/round');
});

test('formatEvent carries the circle, the Creditcoin tx and the proof links', () => {
  const msg = formatEvent({ name: 'ContributionRecorded', args: { circleId: 1n, member: A, amount: 100_000_000n, round: 0, sourceHeight: 39n, onTime: true, queryId: QID }, tx: TX, block: 61 }, testnet, 'Lagos Susu #1');
  assert.match(msg, /^✅ <b>Proven: 0x7099…79C8 paid 100 tUSD/);
  assert.match(msg, /Circle 1 · Lagos Susu #1 · <a href="https:\/\/prashant-thakur77\.github\.io\/Kitty\/circle\/1">open<\/a>/);
  assert.match(msg, new RegExp(`<a href="https://creditcoin-testnet\\.blockscout\\.com/tx/${TX}">0x768a20ca…</a>`));
  assert.match(msg, /query id <code>0x1fbdce98…<\/code>/);
  assert.match(msg, /Sepolia block <a href="https:\/\/sepolia\.etherscan\.io\/block\/39">39<\/a>/);
});

test('formatEvent falls back to bare hashes without an explorer (local world)', () => {
  const msg = formatEvent({ name: 'BatchVerified', args: { chainKey: 1n, fromHeight: 39n, toHeight: 55n, count: 3n }, tx: TX, block: 61 }, local);
  assert.doesNotMatch(msg, /href="\/tx/);
  assert.match(msg, /Creditcoin tx <code>0x768a20ca…<\/code>/);
  assert.match(msg, /blocks <code>39<\/code>–<code>55<\/code>/);
  assert.doesNotMatch(msg, /Circle /); // BatchVerified has no circle
});

test('formatEvent escapes circle names for Telegram HTML', () => {
  const msg = formatEvent({ name: 'CircleCreated', args: { circleId: 9n, name: '<b>Evil & co</b>', members: [A], contribution: 1_000_000n }, tx: TX, block: 1 }, testnet, '<b>Evil & co</b>');
  assert.match(msg, /&lt;b&gt;Evil &amp; co&lt;\/b&gt;/);
  assert.doesNotMatch(msg, /<b>Evil/);
  assert.equal(esc('a<b>&'), 'a&lt;b&gt;&amp;');
});

const circle: CircleState = {
  id: '1', name: 'Lagos Susu #1', status: 0, currentRound: 1, rounds: 3, roundStatus: 0, contribution: 100_000_000n, pot: 100_000_000n,
  deadline: 1229, closeHeight: 1293, attested: 1200, rotation: 0,
  members: [
    { address: A, status: 'pending', score: 515, tier: 'C', received: true },
    { address: B, status: 'proven', height: 1100, score: 530, tier: 'C', received: false },
    { address: C, status: 'pending', score: 515, tier: 'C', received: false },
  ],
  nextRecipient: B, nextRecipientTentative: false,
};

test('formatCircle shows round, deadline vs attested frontier, per-member proof status and next recipient', () => {
  const msg = formatCircle(circle, testnet);
  assert.match(msg, /^🐱 <b>Circle 1 · Lagos Susu #1<\/b>/);
  assert.match(msg, /Round 2 of 3 · Open · 1\/3 proven · pot 100 tUSD · 100 tUSD each/);
  assert.match(msg, /Deadline Sepolia block <a href="https:\/\/sepolia\.etherscan\.io\/block\/1229">1,229<\/a> · attested frontier 1,200 · 29 blocks to go/);
  assert.match(msg, /⏳ .*0x7099…79C8.* · pending · score 515 C · received/);
  assert.match(msg, /✅ .*0x3C44…93BC.* · proven @ 1,100 \(on time\) · score 530 C/);
  assert.match(msg, /Next recipient: .*0x3C44…93BC.* · fixed order/);
  assert.match(msg, /href="https:\/\/prashant-thakur77\.github\.io\/Kitty\/circle\/1"/);
});

test('formatCircle: deadline already attested, closed round, completed circle', () => {
  const closed = formatCircle({ ...circle, attested: 1250, roundStatus: 1, recipient: B }, local);
  assert.match(closed, /deadline attested; closes once block 1,293 is attested/);
  assert.match(closed, /Closed/);
  assert.match(closed, /Recipient: <code>0x3C44…93BC<\/code> · payout pending/);
  const paid = formatCircle({ ...circle, roundStatus: 2, recipient: B, status: 1 }, local);
  assert.match(paid, /completed/);
  assert.match(paid, /payout proven back/);
  const tentative = formatCircle({ ...circle, nextRecipientTentative: true, nextRecipient: C }, local);
  assert.match(tentative, /Next recipient \(if they pay\): <code>0x90F7…b906<\/code>/);
  const undecided = formatCircle({ ...circle, nextRecipient: undefined, rotation: 1 }, local);
  assert.match(undecided, /Next recipient: decided at close · by proven score/);
});

test('pickRecipient mirrors KittyLedger._pickRecipient', () => {
  const rows = circle.members;
  // Fixed: members[(round + k) % n], skipping received and unproven → B (index 1 = round 1)
  assert.deepEqual(pickRecipient(rows, 1, 0), { nextRecipient: B, nextRecipientTentative: false });
  // Fixed, nobody proven yet: the first in line who has not received is tentative
  const nobody = rows.map((m) => ({ ...m, status: 'pending' as const }));
  assert.deepEqual(pickRecipient(nobody, 1, 0), { nextRecipient: B, nextRecipientTentative: true });
  assert.deepEqual(pickRecipient(nobody, 0, 0), { nextRecipient: B, nextRecipientTentative: true }); // A has received → skipped
  // ByScore: best score among proven, not yet received
  const scored = rows.map((m) => ({ ...m, status: 'proven' as const }));
  assert.deepEqual(pickRecipient(scored, 1, 1), { nextRecipient: B, nextRecipientTentative: false });
  assert.deepEqual(pickRecipient(nobody, 1, 1), { nextRecipient: undefined, nextRecipientTentative: false });
});

test('formatScore prints score, tier, counters, credit limit and circles', () => {
  const msg = formatScore({
    address: A, score: 530, tier: 'C', record: { onTime: 2, late: 0, missed: 0, received: 1, volume: 200_000_000n },
    credit: { limit: 40_000_000n, reason: 'tier C: 20% of 200 tUSD proven volume' },
    circles: [{ id: '1', name: 'Delhi Chit Circle', round: 1, status: 'proven' }],
  }, testnet);
  assert.match(msg, /🏅 <b>Kitty Score 530 · tier C<\/b>/);
  assert.match(msg, /2 on time · 0 late · 0 missed · 1 pots received · 200 tUSD proven volume/);
  assert.match(msg, /Credit limit 40 kUSD · tier C: 20% of 200 tUSD proven volume/);
  assert.match(msg, /✅ Circle 1 · Delhi Chit Circle · round 2 · proven/);
  assert.match(msg, /href="https:\/\/prashant-thakur77\.github\.io\/Kitty\/score\/0x7099/);
  const empty = formatScore({ address: A, score: 500, tier: 'D', record: { onTime: 0, late: 0, missed: 0, received: 0, volume: 0n }, circles: [] }, local);
  assert.match(empty, /No circles yet/);
  assert.doesNotMatch(empty, /Credit limit/);
});

test('formatSteward lists decisions newest first with the Creditcoin tx, or falls back to the source tx', () => {
  const msg = formatSteward([
    { at: '2026-09-12T05:48:14.022Z', kind: 'close', summary: 'closed circle 1 round 0 — every member proven', evidence: {}, txs: [{ chain: 'creditcoin', hash: TX }] },
    { at: '2026-09-12T05:48:10.000Z', kind: 'payout', summary: 'paid circle 1 round 0: 300 tUSD', evidence: {}, txs: [{ chain: 'source', hash: QID }] },
    { at: '2026-09-12T05:48:00.000Z', kind: 'wait', summary: 'waiting for a fuller batch', evidence: {} },
  ], testnet);
  const lines = msg.split('\n');
  assert.equal(lines[0], '🤖 <b>Kitty Steward · last decisions</b>');
  assert.match(lines[1], /^🔒 <code>2026-09-12 05:48:14<\/code> closed circle 1 round 0 — every member proven · <a href="https:\/\/creditcoin-testnet\.blockscout\.com\/tx\//);
  assert.match(lines[2], /^💸 .* · <a href="https:\/\/sepolia\.etherscan\.io\/tx\//);
  assert.match(lines[3], /^⏸ .*waiting for a fuller batch$/);
  assert.equal(formatSteward([], local), '🤖 No steward decisions logged yet.');
});

test('formatReminder names the member, round, deadline and the cost of missing it', () => {
  const msg = formatReminder({ member: B, circleId: '1', name: 'Lagos Susu #1', round: 1, deadline: 1229, attested: 1200, contribution: 100_000_000n }, testnet);
  assert.match(msg, /^⏰ <b>Reminder: 0x3C44…93BC has not paid round 2 of Lagos Susu #1<\/b>/);
  assert.match(msg, /100 tUSD due by Sepolia block .*1,229.* · attested frontier 1,200 · 29 blocks left/);
  assert.match(msg, /120 Kitty Score points/);
  const grace = formatReminder({ member: B, circleId: '1', name: 'x', round: 0, deadline: 1229, attested: 1240, contribution: 1n }, local);
  assert.match(grace, /deadline reached, 64-block grace running/);
});

test('formatStart is three lines of pitch plus the commands, with the dashboard link', () => {
  const msg = formatStart(testnet);
  const pitch = msg.split('\n\n')[0].split('\n');
  assert.equal(pitch.length, 3);
  assert.match(msg, /https:\/\/prashant-thakur77\.github\.io\/Kitty\//);
  assert.match(msg, /\/watch 0x… or \/watch circle 1/);
});
