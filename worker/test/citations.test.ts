import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/agent/citations.ts';

const allowed = new Set(['11656295', '3', '48', '0xe3ef81c8196c46c66c0279318d3475075dbb111e7f51865823931e636b757b8d', '199375']);

test('keeps a sentence whose every figure is cited and verifiable', () => {
  const r = check('Proved [[3]] payments at source block [[11656295]] in one call.', allowed);
  assert.equal(r.text, 'Proved 3 payments at source block 11656295 in one call.');
  assert.deepEqual(r.verified, ['3', '11656295']);
  assert.equal(r.stripped.length, 0);
});

test('strips a sentence citing a value the chain does not have', () => {
  const r = check('Proved [[3]] payments. The pot is [[9999]] tUSD.', allowed);
  assert.equal(r.text, 'Proved 3 payments.');
  assert.equal(r.stripped.length, 1);
  assert.equal(r.stripped[0].reason, 'unverifiable citation');
  assert.equal(r.stripped[0].value, '9999');
});

test('strips a sentence with an uncited figure even when the figure is true', () => {
  const r = check('Proved [[3]] payments. The batch used 48 continuity roots.', allowed);
  assert.equal(r.text, 'Proved 3 payments.');
  assert.equal(r.stripped[0].reason, 'uncited figure');
  assert.equal(r.stripped[0].value, '48');
});

test('accepts a truncated hash prefix against the full hash', () => {
  const r = check('Submitted in [[0xe3ef81c8196c46]].', allowed);
  assert.match(r.text, /^Submitted in 0xe3ef81c8196c46\.$/);
  assert.equal(r.stripped.length, 0);
});

test('rejects a hash that merely looks plausible', () => {
  const r = check('Submitted in [[0xdeadbeefdeadbeef]].', allowed);
  assert.equal(r.text, '');
  assert.equal(r.stripped[0].reason, 'unverifiable citation');
});

test('tolerates separators and units around a cited number', () => {
  const r = check('Gas came to [[199,375]] units.', allowed);
  assert.equal(r.text, 'Gas came to 199,375 units.');
});

test('prose with no figures at all passes through untouched', () => {
  const r = check('Your payment is waiting for the attestor network.', allowed);
  assert.equal(r.text, 'Your payment is waiting for the attestor network.');
  assert.equal(r.verified.length, 0);
});

test('a fabricated paragraph is removed entirely', () => {
  const r = check('The treasurer approved a refund of [[500]] tUSD on block [[123456]].', allowed);
  assert.equal(r.text, '');
  assert.equal(r.stripped.length, 1);
});

// The explainer must degrade to the deterministic sentence rather than invent one.
import { explain } from '../src/agent/explain.ts';
import type { Decision } from '../src/agent/log.ts';

const entries: Decision[] = [{
  at: '2026-09-08T20:00:00.000Z',
  kind: 'prove',
  summary: 'proving 3 payment(s) from 2 circle(s) on chain key 1 in one call: the batch is full',
  evidence: { queries: 3, circles: 2, chainKey: 1, fromHeight: 11656253, toHeight: 11656295, continuityRoots: 48 },
  txs: [{ chain: 'creditcoin', hash: '0xe3ef81c8196c46c66c0279318d3475075dbb111e7f51865823931e636b757b8d' }],
}];

test('falls back to the deterministic sentence with no API key', async () => {
  const saved = { k: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const r = await explain('what did you do?', entries[0].summary, { entries });
    assert.equal(r.source, 'deterministic');
    assert.equal(r.text, entries[0].summary);
  } finally {
    if (saved.k) process.env.ANTHROPIC_API_KEY = saved.k;
    if (saved.t) process.env.ANTHROPIC_AUTH_TOKEN = saved.t;
  }
});

test('an empty log never reaches the model', async () => {
  const r = await explain('what did you do?', 'nothing yet', { entries: [] });
  assert.equal(r.source, 'deterministic');
});

test('a fake address is not rescued by the numeric fallback (regression: 0x… stripped to "0")', () => {
  // The decision log almost always contains a plain "0" (round 0, missed 0). Stripping non-digits
  // from a hex string must not let that stand in for the hash.
  const withZero = new Set([...allowed, '0']);
  const r = check('The payout landed in [[0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef]].', withZero);
  assert.equal(r.text, '');
  assert.equal(r.stripped[0].reason, 'unverifiable citation');
});

test('a short hex citation is never accepted as a prefix', () => {
  const r = check('See [[0xe3ef]].', allowed);
  assert.equal(r.text, '');
});
