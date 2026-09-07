/**
 * pnpm verify:live <sepoliaTxHash>
 * Fetches the Attestcoin proof for a real Sepolia transaction from the Proof Builder, decodes the
 * prover bytes the way KittyLedger does, and asks the LIVE block-prover precompile (0x0FD2) on
 * Creditcoin CC3 Testnet to verify it — plus two negative checks (tampered bytes, wrong chain key).
 * A view call: needs no funds, no deployment. Judges can run this against any Sepolia tx.
 */
import { ethers } from 'ethers';
import { cfg, ccProvider, sourceProvider, log } from './config.ts';

const hashes = process.argv.slice(2);
if (hashes.length === 0 || hashes.some((h) => !/^0x[0-9a-fA-F]{64}$/.test(h))) { console.error('usage: pnpm verify:live <sepoliaTxHash> [more hashes → batch mode, ≤10]'); process.exit(1); }
if (hashes.length > 1) { await batchMode(hashes); process.exit(0); }
const tx = hashes[0];

const rc = await sourceProvider.getTransactionReceipt(tx);
if (!rc) throw new Error('tx not found on the source chain');
const ah = await (await fetch(`${cfg.proofBuilderUrl}/api/v1/attested-height/${cfg.chainKey}`)).json();
log(`tx in Sepolia block ${rc.blockNumber} · proof builder attested height ${ah.attestedHeight}`);
if (Number(ah.attestedHeight) < rc.blockNumber) { log(`block not attested yet (${rc.blockNumber - Number(ah.attestedHeight)} blocks to go) — try again in a few minutes`); process.exit(2); }

const res = await fetch(`${cfg.proofBuilderUrl}/api/v1/proof-by-tx/${cfg.chainKey}/${tx}`);
if (!res.ok) throw new Error(`proof builder ${res.status}: ${(await res.text()).slice(0, 200)}`);
const p = await res.json();
const coder = ethers.AbiCoder.defaultAbiCoder();
const [txType, chunks] = coder.decode(['uint8', 'bytes[]'], p.txBytes);
const common = coder.decode(['uint64', 'uint64', 'address', 'bool', 'address', 'uint256', 'bytes'], chunks[0]);
const receipt = coder.decode(['uint8', 'uint64', 'tuple(address,bytes32[],bytes)[]', 'bytes'], chunks[chunks.length - 1]);
log(`decoded: type ${txType} · from ${common[2]} · to ${common[3] ? '(contract creation)' : common[4]} · status ${receipt[0]} · ${receipt[2].length} log(s)`);
log(`proof: txIndex ${p.txIndex} · ${p.merkleProof.siblings.length} merkle siblings · ${p.continuityProof.roots.length} continuity roots`);

const pre = new ethers.Contract('0x0000000000000000000000000000000000000FD2', [
  'function verify(uint64 chainKey, uint64 height, bytes encodedTransaction, (bytes32 root, (bytes32 hash, bool isLeft)[] siblings) merkleProof, (bytes32 lowerEndpointDigest, bytes32[] roots) continuityProof) view returns (bool)',
  'function calculateTxIndex((bytes32 root, (bytes32 hash, bool isLeft)[] siblings) merkleProof) view returns (uint64)',
], ccProvider);
const mp = { root: p.merkleProof.root, siblings: p.merkleProof.siblings };
const cp = { lowerEndpointDigest: p.continuityProof.lowerEndpointDigest, roots: p.continuityProof.roots };
const reason = (e: unknown) => 'reverted: ' + ((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message);
log(`0x0FD2.calculateTxIndex = ${await pre.calculateTxIndex(mp)}`);
log(`0x0FD2.verify(chainKey ${p.chainKey}, height ${p.headerNumber}) = ${await pre.verify(p.chainKey, p.headerNumber, p.txBytes, mp, cp)}`);
const bad = p.txBytes.slice(0, -2) + (p.txBytes.endsWith('00') ? '01' : '00');
log(`0x0FD2.verify(tampered txBytes)  = ${await pre.verify(p.chainKey, p.headerNumber, bad, mp, cp).catch(reason)}`);
log(`0x0FD2.verify(wrong chainKey 3)  = ${await pre.verify(3, p.headerNumber, p.txBytes, mp, cp).catch(reason)}`);

/** Batch mode: one Proof Builder call, one continuity proof, one precompile call for up to 10 txs — exactly what KittyLedger.recordContributions does. */
async function batchMode(hs: string[]) {
  const res = await fetch(`${cfg.proofBuilderUrl}/api/v1/proof-batch-by-tx/${cfg.chainKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(hs) });
  if (!res.ok) throw new Error(`proof builder ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  const entries: { height: number; idx: number; txHash: string; txBytes: string; mp: { root: string; siblings: { hash: string; isLeft: boolean }[] } }[] = [];
  for (const [h, perIdx] of Object.entries(d.merkleProofs as Record<string, Record<string, { txHash: string; txBytes: string; merkleProof: { root: string; siblings: { hash: string; isLeft: boolean }[] } }>>))
    for (const [i, e] of Object.entries(perIdx)) entries.push({ height: Number(h), idx: Number(i), txHash: e.txHash, txBytes: e.txBytes, mp: e.merkleProof });
  const ordered = hs.map((h) => { const e = entries.find((x) => x.txHash.toLowerCase() === h.toLowerCase()); if (!e) throw new Error(`no proof for ${h}`); return e; });
  log(`batch proof: ${ordered.length} tx over blocks ${d.fromHeader}–${d.toHeader} · ONE continuity proof (${d.continuityProof.roots.length} roots)`);
  for (const e of ordered) log(`  ${e.txHash.slice(0, 12)}… @ ${e.height}#${e.idx} · ${e.mp.siblings.length} siblings`);
  const pre = new ethers.Contract('0x0000000000000000000000000000000000000FD2', [
    'function verify(uint64 chainKey, uint64[] heights, bytes[] encodedTransactions, (bytes32 root, (bytes32 hash, bool isLeft)[] siblings)[] merkleProofs, (bytes32 lowerEndpointDigest, bytes32[] roots) sharedContinuityProof) view returns (bool)',
  ], ccProvider);
  const ok = await pre.verify(d.chainKey, ordered.map((e) => e.height), ordered.map((e) => e.txBytes), ordered.map((e) => ({ root: e.mp.root, siblings: e.mp.siblings })), { lowerEndpointDigest: d.continuityProof.lowerEndpointDigest, roots: d.continuityProof.roots });
  log(`0x0FD2.verify(BATCH of ${ordered.length}, one shared continuity proof) = ${ok}`);
}
