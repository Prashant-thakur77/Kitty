/**
 * Proof acquisition for KittyLedger.
 *
 *  testnet: ask the hosted Attestcoin Proof Builder for ONE batch proof covering every
 *           contribution tx of a round (≤10, one shared continuity proof), after waiting for the
 *           highest block to be attested on Creditcoin. If the batch endpoint fails, fall back to
 *           one `getProof` per tx and try to merge their continuity proofs with the SDK; if that is
 *           not possible, hand back several BatchProofs that the caller submits one by one.
 *  local:   two anvils, precompiles mocked. We still run the *real* SDK encoder
 *           (`encoding.abiEncode`) so KittyLedger's EvmV1Decoder path is exercised on genuine
 *           tx/receipt bytes; only the merkle/continuity parts are placeholders.
 */
import { ethers } from 'ethers';
import { proofProvider, encoding } from '@gluwa/usc-sdk';
import { cfg, sourceProvider, log } from './config.ts';

// usc-sdk is compiled against ethers' CommonJS typings; the worker uses the ESM build. Same runtime
// objects, different nominal types — cast once at the boundary.
type SdkProvider = Parameters<typeof encoding.getTransactionWithRaw>[0];
type SdkReceipt = Parameters<typeof encoding.abiEncode>[1];
const sdkSource = sourceProvider as unknown as SdkProvider;

export interface MerkleProof {
  root: string;
  siblings: { hash: string; isLeft: boolean }[];
}
export interface ContinuityProof {
  lowerEndpointDigest: string;
  roots: string[];
}
export interface BatchProof {
  chainKey: number;
  heights: number[];
  txBytes: string[];
  merkleProofs: MerkleProof[];
  continuity: ContinuityProof;
  txHashes: string[];
}

const debug = process.env.WORKER_DEBUG === '1';
let rawLogged = false;

/**
 * Proofs for up to 10 txs. Returns ONE BatchProof in the normal case; the testnet single-proof
 * fallback may return several when their continuity proofs cannot be merged.
 */
export async function buildBatchProof(txHashes: string[]): Promise<BatchProof[]> {
  if (txHashes.length === 0 || txHashes.length > 10) throw new Error('batch must be 1..10 txs');
  return cfg.mode === 'local' ? [await localBatch(txHashes)] : testnetBatch(txHashes);
}

export async function buildSingleProof(txHash: string): Promise<BatchProof> {
  const [p] = await buildBatchProof([txHash]);
  return p;
}

type SdkBatchData = NonNullable<Awaited<ReturnType<proofProvider.service.ProofBuilder['getBatchProof']>>['data']>;
type SdkSingleData = NonNullable<Awaited<ReturnType<proofProvider.service.ProofBuilder['getProof']>>['data']>;

async function testnetBatch(txHashes: string[]): Promise<BatchProof[]> {
  const receipts = await Promise.all(txHashes.map((h) => sourceProvider.getTransactionReceipt(h)));
  const heights = receipts.map((r, i) => {
    if (!r) throw new Error(`tx ${txHashes[i]} not found on source chain`);
    return r.blockNumber;
  });
  const maxHeight = Math.max(...heights);
  const pb = new proofProvider.service.ProofBuilder(cfg.chainKey, cfg.proofBuilderUrl);
  log(`waiting for Sepolia block ${maxHeight} to be attested on Creditcoin…`);
  await pb.waitUntilHeightAttested(cfg.chainKey, maxHeight, 15_000, 20 * 60_000);
  log(`attested. requesting batch proof for ${txHashes.length} tx(s)…`);

  let failure: string | undefined;
  try {
    const res = await pb.getBatchProof(txHashes);
    if (debug && !rawLogged) {
      rawLogged = true;
      log('raw batch response:', JSON.stringify(res, mapReplacer));
    }
    if (res.success && res.data) return [flattenBatch(res.data, txHashes)];
    failure = res.error ?? 'success=false';
  } catch (e) {
    failure = (e as Error).message;
  }
  log(`batch proof unavailable (${failure}) — falling back to ${txHashes.length} single proof(s)`);
  return singleProofs(pb, txHashes);
}

/** Flatten Map<height, Map<txIndex, entry>> back into the caller's order. */
function flattenBatch(d: SdkBatchData, txHashes: string[]): BatchProof {
  const byHash = new Map<string, { height: number; txBytes: string; merkleProof: MerkleProof }>();
  for (const [height, perIdx] of d.merkleProofs.entries()) {
    for (const [, e] of perIdx.entries()) {
      byHash.set(e.txHash.toLowerCase(), { height: Number(height), txBytes: e.txBytes, merkleProof: plainMerkle(e.merkleProof) });
    }
  }
  const ordered = txHashes.map((h) => {
    const e = byHash.get(h.toLowerCase());
    if (!e) throw new Error(`proof builder response missing tx ${h}`);
    return e;
  });
  return {
    chainKey: d.chainKey,
    heights: ordered.map((e) => e.height),
    txBytes: ordered.map((e) => e.txBytes),
    merkleProofs: ordered.map((e) => e.merkleProof),
    continuity: { lowerEndpointDigest: d.continuityProof.lowerEndpointDigest, roots: d.continuityProof.roots },
    txHashes,
  };
}

/**
 * Fallback: one getProof per tx. Txs in the same block share a continuity proof, so they are
 * grouped by height first (which also makes the heights strictly increasing). Then the SDK's
 * mergeProofs is tried; the merge is trusted only if it covers every tx's merkle root.
 */
async function singleProofs(pb: proofProvider.service.ProofBuilder, txHashes: string[]): Promise<BatchProof[]> {
  const singles: SdkSingleData[] = [];
  for (const h of txHashes) {
    const r = await pb.getProof(h);
    if (!r.success || !r.data) throw new Error(`getProof(${h}) failed: ${r.error}`);
    singles.push(r.data);
  }
  const byHeight = new Map<number, SdkSingleData[]>();
  for (const s of singles) byHeight.set(s.headerNumber, [...(byHeight.get(s.headerNumber) ?? []), s]);
  const parts: BatchProof[] = [...byHeight.entries()]
    .sort(([a], [b]) => a - b)
    .map(([height, group]) => ({
      chainKey: group[0].chainKey,
      heights: group.map(() => height),
      txBytes: group.map((s) => s.txBytes),
      merkleProofs: group.map((s) => plainMerkle(s.merkleProof)),
      continuity: { lowerEndpointDigest: group[0].continuityProof.lowerEndpointDigest, roots: [...group[0].continuityProof.roots] },
      txHashes: group.map((s) => s.txHash),
    }));
  if (parts.length === 1) return parts;

  try {
    const merged = proofProvider.mergeProofs(parts.map((p) => [p.heights[0], p.continuity]));
    const covered = parts.every((p) => p.merkleProofs.every((m) => merged.roots.includes(m.root)));
    if (!covered) throw new Error('merged continuity proof does not contain every tx merkle root');
    log(`merged ${parts.length} continuity proofs into one (${merged.roots.length} roots)`);
    const flat = <T>(pick: (p: BatchProof) => T[]) => parts.flatMap(pick);
    return [
      {
        chainKey: parts[0].chainKey,
        heights: flat((p) => p.heights),
        txBytes: flat((p) => p.txBytes),
        merkleProofs: flat((p) => p.merkleProofs),
        continuity: merged,
        txHashes: flat((p) => p.txHashes),
      },
    ];
  } catch (e) {
    log(`cannot merge continuity proofs (${(e as Error).message}) — submitting ${parts.length} separate batches`);
    return parts;
  }
}

function plainMerkle(m: { root: string; siblings: { hash: string; isLeft: boolean }[] }): MerkleProof {
  return { root: m.root, siblings: m.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })) };
}

function mapReplacer(_k: string, v: unknown) {
  return v instanceof Map ? Object.fromEntries(v) : v;
}

async function localBatch(txHashes: string[]): Promise<BatchProof> {
  const heights: number[] = [];
  const txBytes: string[] = [];
  const merkleProofs: MerkleProof[] = [];
  for (const h of txHashes) {
    const [txRaw, rx] = await Promise.all([encoding.getTransactionWithRaw(sdkSource, h), sourceProvider.getTransactionReceipt(h)]);
    if (!txRaw || !rx) throw new Error(`tx ${h} not found locally`);
    const { abi } = encoding.abiEncode(txRaw, rx as unknown as SdkReceipt);
    heights.push(rx.blockNumber);
    txBytes.push(abi);
    // MockVerifier derives txIndex from root, so a per-tx root keeps query ids distinct.
    merkleProofs.push({ root: ethers.keccak256(h), siblings: [] });
  }
  return {
    chainKey: cfg.chainKey,
    heights,
    txBytes,
    merkleProofs,
    continuity: { lowerEndpointDigest: ethers.ZeroHash, roots: [ethers.keccak256(ethers.toUtf8Bytes('local'))] },
    txHashes,
  };
}
