/**
 * Direct access to the Attestcoin block-prover precompile (0x0FD2).
 *
 * The precompile exposes `verify` as a *view* alongside the state-changing `verifyAndEmit`. Kitty
 * uses the view as a free preflight: ask whether a proof will verify before paying to submit it.
 * A proof that fails here is a bug in our assembly or an attestation that moved, never a wasted fee.
 */
import { ethers } from 'ethers';
import { ccProvider } from './config.ts';
import type { BatchProof } from './proofs.ts';

export const BLOCK_PROVER = '0x0000000000000000000000000000000000000FD2';

const ABI = [
  'function verify(uint64 chainKey, uint64 height, bytes encodedTransaction, (bytes32 root, (bytes32 hash, bool isLeft)[] siblings) merkleProof, (bytes32 lowerEndpointDigest, bytes32[] roots) continuityProof) view returns (bool)',
  'function verify(uint64 chainKey, uint64[] heights, bytes[] encodedTransactions, (bytes32 root, (bytes32 hash, bool isLeft)[] siblings)[] merkleProofs, (bytes32 lowerEndpointDigest, bytes32[] roots) sharedContinuityProof) view returns (bool)',
  'function calculateTxIndex((bytes32 root, (bytes32 hash, bool isLeft)[] siblings) merkleProof) view returns (uint64)',
];

export const verifier = new ethers.Contract(BLOCK_PROVER, ABI, ccProvider);

export interface Preflight {
  ok: boolean;
  /** Revert reason when the precompile refused, e.g. "Merkle proof validation failed". */
  detail?: string;
}

/** Ask 0x0FD2 whether this batch would verify, without sending a transaction. */
export async function preflight(p: BatchProof): Promise<Preflight> {
  const sig = p.heights.length === 1
    ? 'verify(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))'
    : 'verify(uint64,uint64[],bytes[],(bytes32,(bytes32,bool)[])[],(bytes32,bytes32[]))';
  const args = p.heights.length === 1
    ? [p.chainKey, p.heights[0], p.txBytes[0], p.merkleProofs[0], p.continuity]
    : [p.chainKey, p.heights, p.txBytes, p.merkleProofs, p.continuity];
  try {
    const ok: boolean = await verifier.getFunction(sig).staticCall(...args);
    return { ok, detail: ok ? undefined : 'precompile returned false' };
  } catch (e) {
    const m = (e as { shortMessage?: string; message?: string });
    return { ok: false, detail: (m.shortMessage ?? m.message ?? String(e)).replace(/^execution reverted:?\s*/i, '') };
  }
}

/** The query id the ledger will derive for this proof, straight from the precompile. */
export async function txIndexOf(p: BatchProof, i = 0): Promise<number> {
  return Number(await verifier.calculateTxIndex(p.merkleProofs[i]));
}
