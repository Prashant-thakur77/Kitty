/**
 * pnpm verify:live <sepoliaTxHash>
 * Fetches the Attestcoin proof for a real Sepolia transaction from the Proof Builder, decodes the
 * prover bytes the way KittyLedger does, and asks the LIVE block-prover precompile (0x0FD2) on
 * Creditcoin CC3 Testnet to verify it — plus two negative checks (tampered bytes, wrong chain key).
 * A view call: needs no funds, no deployment. Judges can run this against any Sepolia tx.
 */
import { ethers } from 'ethers';
import { cfg, ccProvider, sourceProvider, log } from './config.ts';

const tx = process.argv[2];
if (!tx || !/^0x[0-9a-fA-F]{64}$/.test(tx)) { console.error('usage: pnpm verify:live <sepoliaTxHash>'); process.exit(1); }

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
