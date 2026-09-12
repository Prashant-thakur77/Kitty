/**
 * Kitty off-chain worker (Attestcoin "readability worker" pattern).
 *
 * Loop:
 *  1. Watch KittyVault.Contributed on Sepolia; group by (circle, round).
 *  2. When a round is complete — or the oldest pending payment is older than WORKER_BATCH_WAIT_MS —
 *     fetch ONE batch proof and call KittyLedger.recordContributions (≤10 per call).
 *  3. Close rounds that are full, or whose deadline height the ChainInfo precompile reports attested.
 *  4. For closed rounds: operator pays out on Sepolia, then proves that PaidOut tx back to Creditcoin.
 *
 * Nothing here is trusted by the ledger: every effect above is re-verified on-chain.
 */
import { ethers } from 'ethers';
import { cfg, contracts, chainInfo, sourceProvider, ccProvider, ccWallet, ccSigner, sourceSigner, loadState, saveState, log } from './config.ts';
import { buildBatchProof, buildSingleProof } from './proofs.ts';
import { submitRecordContributions, submitConfirmPayout, revertReason } from './chain.ts';
import { preflight } from './verifier.ts';
import { decideBatch, explainBatch, type PendingPayment } from './agent/policy.ts';
import { record } from './agent/log.ts';

const once = process.argv.includes('--once');
const { vault, ledger } = contracts();
const state = loadState();
const MAX_LOG_RANGE = 50; // hosted Sepolia RPCs cap eth_getLogs ranges

interface Pending {
  txHash: string;
  member: string;
  amount: bigint;
  block: number;
  seenAt: number;
}
const pending = new Map<string, Pending[]>(); // `${circleId}:${round}` → txs

async function scanSource() {
  const head = await sourceProvider.getBlockNumber();
  if (!state.lastSourceBlock) state.lastSourceBlock = cfg.fromBlock !== undefined ? cfg.fromBlock - 1 : Math.max(0, head - 200);
  let from = state.lastSourceBlock + 1;
  while (from <= head) {
    const to = Math.min(from + MAX_LOG_RANGE - 1, head);
    const evs = await vault.queryFilter(vault.filters.Contributed(), from, to);
    for (const ev of evs) {
      if (!('args' in ev)) continue;
      const [circleId, round, member, amount] = ev.args as unknown as [bigint, bigint, string, bigint];
      if (state.recorded[ev.transactionHash]) continue;
      const key = `${circleId}:${round}`;
      const list = pending.get(key) ?? [];
      if (!list.some((p) => p.txHash === ev.transactionHash)) {
        list.push({ txHash: ev.transactionHash, member, amount, block: ev.blockNumber, seenAt: Date.now() });
        pending.set(key, list);
        log(`Contributed · circle ${circleId} round ${round} · ${member} · ${Number(amount) / 1e6} tUSD · sepolia block ${ev.blockNumber}`);
      }
    }
    from = to + 1;
  }
  // Never advance past a payment that is still pending: a restart must rescan it.
  const oldest = Math.min(...[...pending.values()].flat().map((p) => p.block));
  state.lastSourceBlock = Number.isFinite(oldest) ? Math.min(head, oldest - 1) : head;
}

/**
 * Assemble and prove. Payments are pooled across every open circle, not one circle at a time: the
 * Attestcoin batch overload verifies up to ten queries under a single continuity proof, so a batch
 * that spans circles costs one call instead of several. What goes in, and when to fire, is decided
 * by the deterministic policy in agent/policy.ts.
 */
async function flushBatches() {
  // 1. Validate everything pending against the ledger: right round, real member, not already proven,
  //    one payment per member. A stray payment would make the ledger revert the whole batch.
  const candidates: PendingPayment[] = [];
  const byHash = new Map<string, Pending>();
  const attestedHeight = Number(await chainInfo.get_latest_attestation_height_and_hash(cfg.chainKey).then((r: { height: bigint }) => r.height).catch(() => 0n));
  const sourceHead = await sourceProvider.getBlockNumber();

  for (const [key, list] of pending) {
    if (list.length === 0) { pending.delete(key); continue; }
    const [circleIdS, roundS] = key.split(':');
    const circleId = BigInt(circleIdS);
    const round = Number(roundS);
    // Anyone can call KittyVault.contribute with any circle id, so a payment to a circle the ledger
    // has never heard of must be quarantined here, not retried forever: the throw would end tick()
    // before closeRounds/payouts and pin lastSourceBlock behind the stray payment.
    let circle;
    try {
      circle = await ledger.getCircle(circleId);
    } catch (e) {
      const why = revertReason(e, ledger.interface);
      if (why.startsWith('UnknownCircle')) {
        for (const p of list) state.recorded[p.txHash] = true;
        pending.delete(key);
        log(`ignoring ${list.length} payment(s) to unknown circle ${circleId}`);
        continue;
      }
      throw e;
    }
    if (Number(circle.status) !== 0 || round < Number(circle.currentRound)) {
      // The ledger can never accept these (circle completed, or the round already closed): quarantine.
      for (const p of list) state.recorded[p.txHash] = true;
      log(`skip ${key}: ledger is on round ${circle.currentRound}${Number(circle.status) !== 0 ? ' (circle completed)' : ''} — ${list.length} payment(s) can never be recorded`);
      pending.delete(key);
      continue;
    }
    if (round > Number(circle.currentRound) || circle.open) {
      // A future round, or invites still open: the payment may become recordable later, so keep it
      // unmarked and let the next scan pick it up again.
      log(`skip ${key}: ledger is on round ${circle.currentRound}${circle.open ? ' (invites still open)' : ''}`);
      pending.delete(key);
      continue;
    }
    const members = new Set((circle.members as string[]).map((m) => m.toLowerCase()));
    const chainKey = circle.chainKey !== undefined ? Number(circle.chainKey) : cfg.chainKey;
    const deadlineHeight = Number(await ledger.deadlineHeight(circleId, round));
    const closeHeight = Number(await ledger.closeHeight(circleId, round));
    const seen = new Set<string>();
    const keep: Pending[] = [];
    const startHeight = Number(circle.startHeight);
    for (const p of [...list].sort((a, b) => a.block - b.block)) {
      const k = p.member.toLowerCase();
      // Mirrors the ledger's BeforeCircleStart rule: a payment mined before the circle's start height can never be
      // credited to it (typically one an earlier ledger instance sharing the vault already counted). Checked before the
      // duplicate rule so the member's later, valid payment is not the one that gets dropped.
      if (p.block < startHeight) { state.recorded[p.txHash] = true; log(`ignoring payment by ${p.member} at source block ${p.block}, before the circle's start ${startHeight} (${p.txHash.slice(0, 12)}…)`); continue; }
      if (!members.has(k)) { state.recorded[p.txHash] = true; log(`ignoring payment from non-member ${p.member} (${p.txHash.slice(0, 12)}…)`); continue; }
      // Before the duplicate check: otherwise a member's corrected payment would be dropped as a
      // 'duplicate' of the wrong-amount one, and the batch would revert with WrongAmount every tick.
      if (p.amount !== circle.contribution) {
        state.recorded[p.txHash] = true;
        log(`ignoring wrong-amount payment by ${p.member}: ${Number(p.amount) / 1e6} tUSD, installment is ${Number(circle.contribution) / 1e6} (${p.txHash.slice(0, 12)}…)`);
        continue;
      }
      if (seen.has(k)) { state.recorded[p.txHash] = true; log(`ignoring duplicate payment by ${p.member} (${p.txHash.slice(0, 12)}…)`); continue; }
      const already = await ledger.getContribution(circleId, round, p.member);
      if (already.queryId !== ethers.ZeroHash) { state.recorded[p.txHash] = true; continue; }
      seen.add(k);
      keep.push(p);
      byHash.set(p.txHash, p);
      candidates.push({
        txHash: p.txHash, member: p.member, circleId, round, block: p.block,
        deadlineHeight, closeHeight, chainKey, circleSize: circle.members.length, seenAt: p.seenAt,
      });
    }
    if (keep.length === 0) pending.delete(key); else pending.set(key, keep);
  }
  if (candidates.length === 0) return;

  // 2. Decide.
  const decision = decideBatch(candidates, { attestedHeight, sourceHead }, { waitMs: cfg.batchWaitMs, force: once });
  const summary = explainBatch(decision);
  log(`steward · ${summary}`);
  if (!decision.act) { record({ kind: 'wait', summary, evidence: decision.evidence }); return; }

  // 3. Prove. One proof normally; the testnet fallback may split by height group.
  try {
    const proofs = await buildBatchProof(decision.batch.map((p) => p.txHash));
    for (const proof of proofs) {
      // Free preflight against the precompile's view overload: never pay to submit a proof that
      // the verifier would reject anyway.
      const pre = await preflight(proof);
      if (!pre.ok) {
        log(`✗ preflight rejected by 0x0FD2 (${pre.detail}) — not submitting, will retry after the next attestation`);
        record({ kind: 'skip', summary: `0x0FD2 preflight rejected the batch: ${pre.detail}`, evidence: { ...decision.evidence, preflight: 'rejected' } });
        continue;
      }
      log(`   preflight ok · 0x0FD2.verify says this batch of ${proof.heights.length} would verify`);
      const rc = await submitRecordContributions(ledger, proof);
      for (const h of proof.txHashes) state.recorded[h] = true;
      record({
        kind: 'prove', summary,
        evidence: { ...decision.evidence, preflight: 'passed', queriesInCall: proof.heights.length, fromHeight: Math.min(...proof.heights), toHeight: Math.max(...proof.heights), continuityRoots: proof.continuity.roots.length },
        txs: [{ chain: 'creditcoin', hash: rc.hash }, ...proof.txHashes.map((h) => ({ chain: 'source' as const, hash: h }))],
      });
    }
  } catch (e) {
    ccSigner.reset(); // a failed send must not leave a nonce gap
    const why = revertReason(e, ledger.interface);
    log(`✗ batch failed: ${why}`);
    record({ kind: 'error', summary: `batch failed: ${why}`, evidence: { ...decision.evidence, revert: why } });
  }

  // 4. Drop everything the ledger now knows.
  for (const [key, list] of pending) {
    const keep = list.filter((p) => !state.recorded[p.txHash]);
    if (keep.length === 0) pending.delete(key); else pending.set(key, keep);
  }
}

async function closeRounds() {
  const n = Number(await ledger.circleCount());
  for (let id = 1; id <= n; id++) {
    const c = await ledger.getCircle(id);
    if (Number(c.status) !== 0) continue;
    const round = Number(c.currentRound);
    const rd = await ledger.getRound(id, round);
    if (Number(rd.status) !== 0) continue;
    const full = Number(rd.contributions) >= c.members.length;
    if (c.open) continue; // invites still open: nothing to close yet
    const closeAt = await ledger.closeHeight(id, round); // deadline + grace window
    const attested: boolean = await chainInfo.is_height_attested(cfg.chainKey, closeAt);
    if (!full && !attested) continue;
    try {
      log(`→ KittyLedger.closeRound(${id}) — ${full ? 'everyone paid' : `deadline + grace (block ${closeAt}) attested`}`);
      const rc = await (await ledger.closeRound(id)).wait();
      log(`   ✓ round ${round} closed · cc tx ${rc.hash}`);
      record({
        kind: 'close',
        summary: `closed circle ${id} round ${round} — ${full ? 'every member proven' : `close height ${closeAt} attested`}`,
        evidence: { circleId: String(id), round, closeHeight: String(closeAt), proven: Number(rd.contributions), members: c.members.length, everyoneProven: full },
        txs: [{ chain: 'creditcoin', hash: rc.hash }],
      });
    } catch (e) {
      ccSigner.reset();
      log(`✗ closeRound(${id}) failed: ${revertReason(e, ledger.interface)}`);
    }
  }
}

async function payouts() {
  const n = Number(await ledger.circleCount());
  for (let id = 1; id <= n; id++) {
    const c = await ledger.getCircle(id);
    const last = Number(c.currentRound) + (Number(c.status) === 1 ? 0 : -1);
    for (let r = 0; r <= last; r++) {
      const rd = await ledger.getRound(id, r);
      if (Number(rd.status) !== 1) continue; // Closed, not yet Paid
      if (rd.recipient === ethers.ZeroAddress) continue; // nobody eligible this round; pot carried over
      const key = `${id}:${r}`;
      let payoutTx = state.paid[key];
      if (!payoutTx) {
        if (rd.pot === 0n) {
          log(`round ${key} closed with empty pot — nothing to pay`);
          continue;
        }
        const alreadyPaid: boolean = await vault.paidOut(id, r);
        if (alreadyPaid) {
          log(`round ${key} already paid on source but tx unknown — set worker/state paid[${key}] manually`);
          continue;
        }
        try {
          log(`→ KittyVault.payout(circle ${id}, round ${r}, ${rd.recipient}, ${Number(rd.pot) / 1e6} tUSD) on Sepolia`);
          const tx = await vault.payout(id, r, rd.recipient, rd.pot);
          const rc = await tx.wait();
          payoutTx = rc.hash;
          state.paid[key] = payoutTx;
          saveState(state);
          log(`   ✓ paid · sepolia tx ${payoutTx}`);
          record({ kind: 'payout', summary: `paid circle ${id} round ${r}: ${Number(rd.pot) / 1e6} tUSD to ${rd.recipient}`,
            evidence: { circleId: String(id), round: r, recipient: rd.recipient, amount_tUSD: Number(rd.pot) / 1e6 },
            txs: [{ chain: 'source', hash: payoutTx }] });
        } catch (e) {
          sourceSigner.reset();
          log(`✗ payout ${key} failed: ${revertReason(e, vault.interface)}`);
          continue;
        }
      }
      if (state.confirmed[payoutTx]) continue;
      try {
        const proof = await buildSingleProof(payoutTx);
        const pre = await preflight(proof);
        if (!pre.ok) { log(`✗ payout preflight rejected by 0x0FD2 (${pre.detail}) — retrying later`); continue; }
        const crc = await submitConfirmPayout(ledger, proof);
        state.confirmed[payoutTx] = true;
        record({ kind: 'confirm', summary: `payout for circle ${id} round ${r} proven back to Creditcoin`,
          evidence: { circleId: String(id), round: r, sourceHeight: proof.heights[0] },
          txs: [{ chain: 'creditcoin', hash: crc.hash }, { chain: 'source', hash: payoutTx }] });
      } catch (e) {
        ccSigner.reset();
        log(`✗ confirmPayout ${key} failed: ${revertReason(e, ledger.interface)}`);
      }
    }
  }
}

async function tick() {
  // The operator key may also be used outside this process (seeding scripts, a redeploy); a cached nonce
  // would then collide, so every tick starts from the node's view of both nonces.
  ccSigner.reset(); sourceSigner.reset();
  await scanSource();
  await flushBatches();
  await closeRounds();
  await payouts();
  saveState(state);
}

async function main() {
  const [src, cc] = await Promise.all([sourceProvider.getNetwork(), ccProvider.getNetwork()]);
  log(`kitty worker · mode=${cfg.mode} · source chainId ${src.chainId} (chainKey ${cfg.chainKey}) → creditcoin chainId ${cc.chainId}`);
  log(`vault ${cfg.vault} · ledger ${cfg.ledger} · operator ${ccWallet.address}`);
  let stop = false;
  process.on('SIGINT', () => {
    if (stop) process.exit(130);
    stop = true;
    log('stopping after this tick (Ctrl-C again to abort now)');
  });
  do {
    try {
      await tick();
    } catch (e) {
      log('tick error:', (e as Error).message);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  } while (!stop);
  if (once) {
    // Give the ledger a chance to close/pay within the same pass when everything is already attested.
    await tick();
  }
  log('worker stopped');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
