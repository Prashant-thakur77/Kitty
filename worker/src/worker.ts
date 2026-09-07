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
import { cfg, contracts, chainInfo, sourceProvider, ccProvider, ccWallet, loadState, saveState, log } from './config.ts';
import { buildBatchProof, buildSingleProof } from './proofs.ts';
import { submitRecordContributions, submitConfirmPayout, revertReason } from './chain.ts';

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
  if (!state.lastSourceBlock) state.lastSourceBlock = cfg.fromBlock ?? Math.max(0, head - 200);
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
  state.lastSourceBlock = head;
}

async function flushBatches() {
  for (const [key, list] of pending) {
    if (list.length === 0) continue;
    const [circleIdS, roundS] = key.split(':');
    const circleId = BigInt(circleIdS);
    const round = Number(roundS);
    const circle = await ledger.getCircle(circleId);
    if (Number(circle.currentRound) !== round) {
      log(`skip ${key}: ledger is on round ${circle.currentRound}`);
      pending.delete(key);
      continue;
    }
    // Drop anything the ledger already knows (e.g. worker restart).
    const fresh: Pending[] = [];
    for (const p of list) {
      const c = await ledger.getContribution(circleId, round, p.member);
      if (c.queryId !== ethers.ZeroHash) state.recorded[p.txHash] = true;
      else fresh.push(p);
    }
    if (fresh.length === 0) {
      pending.delete(key);
      continue;
    }
    const full = fresh.length >= circle.members.length;
    const oldest = Math.min(...fresh.map((p) => p.seenAt));
    if (!full && Date.now() - oldest < cfg.batchWaitMs && !once) continue;

    const batch = fresh.slice(0, 10);
    try {
      // Normally one proof; the testnet fallback may return several (one per unmergeable height group).
      const proofs = await buildBatchProof(batch.map((p) => p.txHash));
      for (const proof of proofs) {
        await submitRecordContributions(ledger, proof);
        for (const h of proof.txHashes) state.recorded[h] = true;
      }
    } catch (e) {
      log(`✗ batch for ${key} failed: ${revertReason(e, ledger.interface)}`);
    }
    pending.set(key, fresh.filter((p) => !state.recorded[p.txHash]));
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
    const deadline = await ledger.deadlineHeight(id, round);
    const attested: boolean = await chainInfo.is_height_attested(cfg.chainKey, deadline);
    if (!full && !attested) continue;
    try {
      log(`→ KittyLedger.closeRound(${id}) — ${full ? 'everyone paid' : `deadline block ${deadline} attested`}`);
      let rc;
      try {
        rc = await (await ledger.closeRound(id)).wait();
      } catch (e) {
        if (!String((e as Error).message).includes('nonce')) throw e;
        // fast local chains occasionally hand ethers a stale nonce right after a mined tx; retry once
        await new Promise((r) => setTimeout(r, 2500));
        rc = await (await ledger.closeRound(id, { nonce: await ccProvider.getTransactionCount(ccWallet.address, 'pending') })).wait();
      }
      log(`   ✓ round ${round} closed · cc tx ${rc.hash}`);
    } catch (e) {
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
        } catch (e) {
          log(`✗ payout ${key} failed: ${revertReason(e, vault.interface)}`);
          continue;
        }
      }
      if (state.confirmed[payoutTx]) continue;
      try {
        const proof = await buildSingleProof(payoutTx);
        await submitConfirmPayout(ledger, proof);
        state.confirmed[payoutTx] = true;
      } catch (e) {
        log(`✗ confirmPayout ${key} failed: ${revertReason(e, ledger.interface)}`);
      }
    }
  }
}

async function tick() {
  await scanSource();
  await flushBatches();
  await closeRounds();
  await payouts();
  saveState(state);
}

async function main() {
  const [src, cc] = await Promise.all([sourceProvider.getNetwork(), ccProvider.getNetwork()]);
  log(`kitty worker · mode=${cfg.mode} · source chainId ${src.chainId} (chainKey ${cfg.chainKey}) → creditcoin chainId ${cc.chainId}`);
  log(`vault ${cfg.vault} · ledger ${cfg.ledger} · operator ${(await ledger.runner as ethers.Wallet).address}`);
  let stop = false;
  process.on('SIGINT', () => (stop = true));
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
