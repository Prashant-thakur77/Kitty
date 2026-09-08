// Pure-function tests for the Steward's decision layer. `pnpm test:agent`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBatch, explainBatch, MAX_BATCH, URGENT_BLOCKS, slack, provable, type PendingPayment } from '../src/agent/policy.ts';

const pay = (o: Partial<PendingPayment> & { n?: number; circle?: number }): PendingPayment => ({
  txHash: '0x' + String(o.n ?? 1).padStart(64, '0'),
  member: '0x' + String(o.n ?? 1).padStart(40, 'a'),
  circleId: BigInt(o.circle ?? 1),
  round: 0,
  block: 900,
  deadlineHeight: 1000,
  closeHeight: 1064,
  chainKey: 1,
  circleSize: 3,
  seenAt: Date.now(),
  ...o,
});
const frontier = (attested: number, head = attested + 36) => ({ attestedHeight: attested, sourceHead: head });

test('waits while nothing is attested yet', () => {
  const d = decideBatch([pay({ n: 1, block: 950 })], frontier(900, 900), { waitMs: 45_000 });
  assert.equal(d.act, false);
  assert.equal(d.evidence.provable, 0);
  assert.match(explainBatch(d), /not yet attested/);
});

test('waits for a fuller batch when there is slack and the window has not elapsed', () => {
  const now = Date.now();
  const d = decideBatch([pay({ n: 1, block: 900, seenAt: now })], frontier(910, 910), { waitMs: 45_000, now });
  assert.equal(d.act, false);
  assert.equal(d.reason, 'wait');
});

test('fires immediately when a round is complete', () => {
  const now = Date.now();
  const ps = [1, 2, 3].map((n) => pay({ n, block: 900 + n, seenAt: now }));
  const d = decideBatch(ps, frontier(950, 950), { waitMs: 45_000, now });
  assert.equal(d.act, true);
  assert.equal(d.reason, 'round-complete');
  assert.equal(d.batch.length, 3);
});

test('fires on deadline risk even with an unfull batch', () => {
  const now = Date.now();
  const d = decideBatch([pay({ n: 1, block: 900, seenAt: now })], frontier(1050, 1050), { waitMs: 999_999, now });
  assert.equal(d.act, true);
  assert.equal(d.reason, 'deadline-risk');
  assert.ok(Number(d.evidence.blocksOfSlack) <= URGENT_BLOCKS);
});

test('caps at the protocol maximum of ten and takes the most urgent first', () => {
  const now = Date.now();
  const ps = Array.from({ length: 14 }, (_, i) => pay({ n: i + 1, circle: (i % 4) + 1, closeHeight: 2000 - i, seenAt: now }));
  const d = decideBatch(ps, frontier(1500, 1500), { waitMs: 0, now });
  assert.equal(d.act, true);
  assert.equal(d.batch.length, MAX_BATCH);
  const s = d.batch.map((p) => slack(p, frontier(1500, 1500)));
  assert.deepEqual(s, [...s].sort((a, b) => a - b), 'most urgent first');
});

test('batches across circles under one chain key', () => {
  const now = Date.now();
  const ps = [1, 2, 3].map((c) => pay({ n: c, circle: c, seenAt: now }));
  const d = decideBatch(ps, frontier(1500, 1500), { waitMs: 0, now });
  assert.equal(d.evidence.circles, 3, 'one call covers three circles');
  assert.match(explainBatch(d), /3 circle\(s\)/);
});

test('never mixes chain keys in one call, and serves the most urgent chain first', () => {
  const now = Date.now();
  const ps = [
    pay({ n: 1, chainKey: 1, closeHeight: 3000, seenAt: now }),
    pay({ n: 2, chainKey: 3, closeHeight: 1600, seenAt: now }),
    pay({ n: 3, chainKey: 3, closeHeight: 1700, seenAt: now }),
  ];
  const d = decideBatch(ps, frontier(1500, 1500), { waitMs: 0, now });
  assert.equal(d.chainKey, 3);
  assert.ok(d.batch.every((p) => p.chainKey === 3));
});

test('provable and slack read the attestation frontier, not the clock', () => {
  assert.equal(provable(pay({ block: 100 }), frontier(99, 99)), false);
  assert.equal(provable(pay({ block: 100 }), frontier(100, 100)), true);
  assert.equal(slack(pay({ closeHeight: 1064 }), frontier(1000, 1040)), 24);
});
