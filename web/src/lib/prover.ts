/**
 * Browser-side Attestcoin proving. The hosted Proof Builder serves CORS `*`, so a member can prove a
 * round without any operator: fetch one batch proof, submit `recordContributions` from their own wallet.
 * Endpoints mirror @gluwa/usc-sdk's ProofBuilder (proof-provider/service).
 */
import { cfg } from '../config'

const BASE = (import.meta.env.VITE_PROOF_BUILDER_URL ?? 'https://prover.cc3-testnet.creditcoin.network') as string

export type MerkleProof = { root: `0x${string}`; siblings: { hash: `0x${string}`; isLeft: boolean }[] }
export type ContinuityProof = { lowerEndpointDigest: `0x${string}`; roots: `0x${string}`[] }
export type BatchArgs = { chainKey: bigint; heights: bigint[]; txBytes: `0x${string}`[]; merkleProofs: MerkleProof[]; continuity: ContinuityProof; txHashes: `0x${string}`[] }

export async function attestedHeight(): Promise<number> {
  const r = await fetch(`${BASE}/api/v1/attested-height/${cfg.sourceChainKey}`)
  if (!r.ok) throw new Error(`proof builder ${r.status}`)
  const j = await r.json()
  return Number(j.attestedHeight)
}

export async function batchProof(txHashes: `0x${string}`[]): Promise<BatchArgs> {
  if (txHashes.length === 0 || txHashes.length > 10) throw new Error('1..10 transactions per batch')
  const r = await fetch(`${BASE}/api/v1/proof-batch-by-tx/${cfg.sourceChainKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(txHashes) })
  if (!r.ok) throw new Error(`proof builder ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const d = await r.json() as { chainKey: number; continuityProof: ContinuityProof; merkleProofs: Record<string, Record<string, { txHash: string; txBytes: `0x${string}`; merkleProof: MerkleProof }>> }
  const byHash = new Map<string, { height: bigint; txBytes: `0x${string}`; merkleProof: MerkleProof }>()
  for (const [h, perIdx] of Object.entries(d.merkleProofs)) for (const e of Object.values(perIdx)) byHash.set(e.txHash.toLowerCase(), { height: BigInt(h), txBytes: e.txBytes, merkleProof: e.merkleProof })
  const ordered = txHashes.map((h) => { const e = byHash.get(h.toLowerCase()); if (!e) throw new Error(`proof missing for ${h}`); return e })
  return { chainKey: BigInt(d.chainKey), heights: ordered.map((e) => e.height), txBytes: ordered.map((e) => e.txBytes), merkleProofs: ordered.map((e) => e.merkleProof), continuity: d.continuityProof, txHashes }
}

export async function singleProof(txHash: `0x${string}`): Promise<BatchArgs> {
  const r = await fetch(`${BASE}/api/v1/proof-by-tx/${cfg.sourceChainKey}/${txHash}`)
  if (!r.ok) throw new Error(`proof builder ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const d = await r.json() as { chainKey: number; headerNumber: number; txBytes: `0x${string}`; continuityProof: ContinuityProof; merkleProof: MerkleProof }
  return { chainKey: BigInt(d.chainKey), heights: [BigInt(d.headerNumber)], txBytes: [d.txBytes], merkleProofs: [d.merkleProof], continuity: d.continuityProof, txHashes: [txHash] }
}
