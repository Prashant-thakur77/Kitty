/**
 * Proof acquisition for KittyLedger.
 *
 *  testnet: ask the hosted Attestcoin Proof Builder for ONE batch proof covering every
 *           contribution tx of a round (≤10, one shared continuity proof), after waiting for the
 *           highest block to be attested on Creditcoin.
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

export async function buildBatchProof(txHashes: string[]): Promise<BatchProof> {
  if (txHashes.length === 0 || txHashes.length > 10) throw new Error('batch must be 1..10 txs');
  return cfg.mode === 'local' ? localBatch(txHashes) : testnetBatch(txHashes);
}

export async function buildSingleProof(txHash: string): Promise<BatchProof> {
  return buildBatchProof([txHash]);
}

async function testnetBatch(txHashes: string[]): Promise<BatchProof> {
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

  const res = await pb.getBatchProof(txHashes);
  if (!res.success || !res.data) throw new Error(`proof builder failed: ${res.error}`);
  const d = res.data;

  // Flatten Map<height, Map<txIndex, entry>> back into the caller's order.
  const byHash = new Map<string, { height: number; txBytes: string; merkleProof: MerkleProof }>();
  for (const [height, perIdx] of d.merkleProofs.entries()) {
    for (const [, e] of perIdx.entries()) {
      byHash.set(e.txHash.toLowerCase(), {
        height: Number(height),
        txBytes: e.txBytes,
        merkleProof: { root: e.merkleProof.root, siblings: e.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })) },
      });
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
