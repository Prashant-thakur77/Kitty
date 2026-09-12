// Pure-function tests for the Steward's decision layer. `pnpm test:agent`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBatch, explainBatch, MAX_BATCH, MAX_BATCH_RANGE, URGENT_BLOCKS, ATTESTATION_LAG_BLOCKS, slack, provable, type PendingPayment } from '../src/agent/policy.ts';

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

test('never pools payments more than 1000 blocks apart', () => {
  const now = Date.now();
  const ps = [pay({ n: 1, block: 100, closeHeight: 5000, seenAt: now }), ...Array.from({ length: 9 }, (_, i) => pay({ n: i + 2, block: 1500 + i, closeHeight: 5000, seenAt: now }))];
  let remaining = ps;
  let calls = 0;
  while (remaining.length) {
    const d = decideBatch(remaining, frontier(2000, 2000), { waitMs: 0, now, force: true });
    assert.equal(d.act, true);
    const blocks = d.batch.map((p) => p.block);
    assert.ok(Math.max(...blocks) - Math.min(...blocks) < MAX_BATCH_RANGE, `span ${Math.max(...blocks) - Math.min(...blocks)} must stay under ${MAX_BATCH_RANGE}`);
    if (calls === 0) assert.ok(Number(d.evidence.leftBehind) > 0, 'the first call leaves the far-apart payment behind');
    const taken = new Set(d.batch.map((p) => p.txHash));
    remaining = remaining.filter((p) => !taken.has(p.txHash));
    calls++;
  }
  assert.equal(calls, 2, 'two calls: the block-100 payment cannot share a continuity proof with the 1500s');
});

test('a full batch only counts rounds it fully contains', () => {
  const now = Date.now();
  const ps = [
    ...[1, 2, 3].map((n) => pay({ n, circle: 1, circleSize: 3, closeHeight: 5000, seenAt: now })),
    ...Array.from({ length: 8 }, (_, i) => pay({ n: 10 + i, circle: 2, circleSize: 8, closeHeight: 4000, seenAt: now })),
  ];
  const d = decideBatch(ps, frontier(1500, 1500), { waitMs: 0, now });
  assert.equal(d.reason, 'full');
  assert.equal(d.batch.length, MAX_BATCH);
  assert.equal(d.evidence.roundsCompleted, 1, 'circle 2 (8 of 8) is in the batch; circle 1 has only 2 of 3');
});

test('duplicate payments by one member do not complete a round', () => {
  const now = Date.now();
  const ps = [1, 2, 3].map((n) => pay({ n, member: '0xaa', seenAt: now }));
  const d = decideBatch(ps, frontier(1500, 1500), { waitMs: 999_999, now });
  assert.notEqual(d.reason, 'round-complete');
  assert.equal(d.evidence.roundsCompleted, 0);
});

test('fires once the batching window has elapsed', () => {
  const d = decideBatch([pay({ n: 1, seenAt: 0 })], frontier(910, 910), { waitMs: 45_000, now: 46_000 });
  assert.equal(d.act, true);
  assert.equal(d.reason, 'waited');
  assert.match(explainBatch(d), /waited 46s/);
});

test('a forced single pass fires whatever is provable', () => {
  const now = Date.now();
  const d = decideBatch([pay({ n: 1, seenAt: now })], frontier(910, 910), { waitMs: 999_999, now, force: true });
  assert.equal(d.act, true);
  assert.equal(d.reason, 'forced');
  assert.match(explainBatch(d), /single pass requested/);
});

test('equal slack: the larger group wins', () => {
  const now = Date.now();
  const ps = [
    pay({ n: 1, chainKey: 1, closeHeight: 2000, seenAt: now }),
    pay({ n: 2, chainKey: 3, closeHeight: 2000, seenAt: now }),
    pay({ n: 3, chainKey: 3, closeHeight: 2000, seenAt: now }),
  ];
  const d = decideBatch(ps, frontier(1500, 1500), { waitMs: 0, now });
  assert.equal(d.chainKey, 3);
  assert.equal(d.batch.length, 2);
});

// Round 0 on testnet settled as 1 + 2 because the 45 s timer fired while two roundmates' blocks were
// still unattested. The hold rule keeps the timer from splitting a round when there is slack to spare.
test('holds a provable payment while roundmates are unattested and slack is ample', () => {
  const now = Date.now();
  const ps = [1, 2, 3].map((n) => pay({ n, block: 98 + 2 * n, closeHeight: 400, seenAt: 0 }));
  const d = decideBatch(ps, frontier(101, 101), { waitMs: 0, now });
  assert.equal(d.act, false);
  assert.equal(d.reason, 'wait');
  assert.equal(d.evidence.queries, 1, 'only member 0 (block 100) is provable');
  assert.equal(d.evidence.heldForRoundmates, 2);
  assert.equal(d.evidence.holdUntilAttested, 104);
  assert.match(explainBatch(d), /2 roundmate payment\(s\) not yet attested \(need source block 104\)/);
  assert.match(explainBatch(d), /holding for one call/);
  // Once the frontier reaches the roundmates, the round fires as one call.
  const later = decideBatch(ps, frontier(104, 104), { waitMs: 0, now });
  assert.equal(later.act, true);
  assert.equal(later.reason, 'round-complete');
  assert.equal(later.batch.length, 3);
});

test('does not hold when slack is short', () => {
  const now = Date.now();
  // Inside the urgency window: deadline-risk fires regardless of unattested roundmates.
  const urgent = [1, 2, 3].map((n) => pay({ n, block: 98 + 2 * n, closeHeight: 101 + URGENT_BLOCKS, seenAt: 0 }));
  const d = decideBatch(urgent, frontier(101, 101), { waitMs: 0, now });
  assert.equal(d.act, true);
  assert.equal(d.reason, 'deadline-risk');
  assert.equal(d.evidence.heldForRoundmates, undefined);
  // Past urgency but inside the attestation-lag margin (closeHeight 150 → 49 blocks of slack): the
  // timer wins, so the provable payment goes alone rather than risk the roundmates' grace window.
  const tight = [1, 2, 3].map((n) => pay({ n, block: 98 + 2 * n, closeHeight: 150, seenAt: 0 }));
  const t = decideBatch(tight, frontier(101, 101), { waitMs: 0, now });
  assert.ok(Number(t.evidence.blocksOfSlack) <= URGENT_BLOCKS + ATTESTATION_LAG_BLOCKS);
  assert.equal(t.act, true);
  assert.equal(t.reason, 'waited');
  assert.equal(t.evidence.heldForRoundmates, undefined);
});

test('the hold never overrides round-complete, full or forced', () => {
  const now = Date.now();
  // Circle 1 is complete and provable; circle 2 has one provable payment and one unattested roundmate.
  const ps = [
    ...[1, 2, 3].map((n) => pay({ n, circle: 1, block: 100, closeHeight: 400, seenAt: 0 })),
    pay({ n: 4, circle: 2, block: 100, closeHeight: 400, seenAt: 0 }),
    pay({ n: 5, circle: 2, block: 120, closeHeight: 400, seenAt: 0 }),
  ];
  const d = decideBatch(ps, frontier(101, 101), { waitMs: 0, now });
  assert.equal(d.act, true);
  assert.equal(d.reason, 'round-complete');
  const f = decideBatch([pay({ n: 4, circle: 2, block: 100, closeHeight: 400, seenAt: 0 }), pay({ n: 5, circle: 2, block: 120, closeHeight: 400, seenAt: 0 })], frontier(101, 101), { waitMs: 0, now, force: true });
  assert.equal(f.reason, 'forced');
});
