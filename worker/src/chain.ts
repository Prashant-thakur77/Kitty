import { ethers } from 'ethers';
import { utils as sdkUtils } from '@gluwa/usc-sdk';
import { cfg, ccProvider, ccWallet, log } from './config.ts';
import type { BatchProof } from './proofs.ts';

/** Gas estimation can fail on precompile paths; the SDK helper falls back to a size heuristic. */
async function gasFor(contract: ethers.Contract, data: string, continuityLen: number): Promise<bigint> {
  if (cfg.mode === 'local') return 6_000_000n;
  type P = Parameters<typeof sdkUtils.gas.computeGasLimit>;
  const g = await sdkUtils.gas.computeGasLimit(ccProvider as unknown as P[0], contract as unknown as P[1], data, ccWallet.address, Math.max(1, continuityLen));
  // The SDK's fallback (21k + 5k/root + 20k) is far below what recordContributions costs when
  // estimation through the precompile fails; never go below a floor that fits a 10-tx batch.
  return g < 1_500_000n ? 1_500_000n : g;
}

export async function submitRecordContributions(ledger: ethers.Contract, p: BatchProof): Promise<ethers.TransactionReceipt> {
  const args = [p.chainKey, p.heights, p.txBytes, p.merkleProofs, p.continuity];
  const data = ledger.interface.encodeFunctionData('recordContributions', args);
  await ledger.recordContributions.staticCall(...args); // surfaces the custom error before spending gas
  const gasLimit = await gasFor(ledger, data, p.continuity.roots.length);
  log(`→ KittyLedger.recordContributions(${p.heights.length} tx, heights ${Math.min(...p.heights)}–${Math.max(...p.heights)}) gas=${gasLimit}`);
  const tx = await ledger.recordContributions(...args, { gasLimit });
  const rc = await tx.wait();
  log(`   ✓ verified by 0x0FD2 in one call · cc tx ${rc.hash}`);
  return rc;
}

export async function submitConfirmPayout(ledger: ethers.Contract, p: BatchProof): Promise<ethers.TransactionReceipt> {
  const args = [p.chainKey, p.heights[0], p.txBytes[0], p.merkleProofs[0], p.continuity];
  const data = ledger.interface.encodeFunctionData('confirmPayout', args);
  await ledger.confirmPayout.staticCall(...args);
  const gasLimit = await gasFor(ledger, data, p.continuity.roots.length);
  log(`→ KittyLedger.confirmPayout(height ${p.heights[0]}) gas=${gasLimit}`);
  const tx = await ledger.confirmPayout(...args, { gasLimit });
  const rc = await tx.wait();
  log(`   ✓ payout proven · cc tx ${rc.hash}`);
  return rc;
}

export function revertReason(e: unknown, iface?: ethers.Interface): string {
  const err = e as { data?: string; error?: { data?: string }; shortMessage?: string; message?: string; revert?: { name: string; args: unknown[] } };
  if (err.revert) return `${err.revert.name}(${err.revert.args.map(String).join(', ')})`;
  const data = err.data ?? err.error?.data;
  if (iface && typeof data === 'string') {
    try {
      const d = iface.parseError(data);
      if (d) return `${d.name}(${d.args.map(String).join(', ')})`;
    } catch {}
  }
  return err.shortMessage ?? err.message ?? String(e);
}
