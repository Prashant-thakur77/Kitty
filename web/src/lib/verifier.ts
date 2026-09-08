/**
 * The Attestcoin block-prover precompile (0x0FD2), read-only, from the browser.
 *
 * `verify` is a view alongside the state-changing `verifyAndEmit`, so anyone can ask the precompile
 * whether a proof holds without sending a transaction. Kitty uses it twice: as a free preflight
 * before a member pays to submit a batch, and as the "re-verify this payment" receipt.
 */
import type { Abi } from 'viem'
import { VERIFIER_PRECOMPILE } from '../config'

const merkle = { name: 'merkleProof', type: 'tuple', components: [
  { name: 'root', type: 'bytes32' },
  { name: 'siblings', type: 'tuple[]', components: [{ name: 'hash', type: 'bytes32' }, { name: 'isLeft', type: 'bool' }] },
] } as const
const continuity = { name: 'continuityProof', type: 'tuple', components: [
  { name: 'lowerEndpointDigest', type: 'bytes32' }, { name: 'roots', type: 'bytes32[]' },
] } as const

export const verifierAbi = [
  { type: 'function', name: 'verify', stateMutability: 'view', outputs: [{ type: 'bool' }], inputs: [
    { name: 'chainKey', type: 'uint64' }, { name: 'height', type: 'uint64' }, { name: 'encodedTransaction', type: 'bytes' }, merkle, continuity ] },
  { type: 'function', name: 'verify', stateMutability: 'view', outputs: [{ type: 'bool' }], inputs: [
    { name: 'chainKey', type: 'uint64' }, { name: 'heights', type: 'uint64[]' }, { name: 'encodedTransactions', type: 'bytes[]' },
    { ...merkle, name: 'merkleProofs', type: 'tuple[]' }, { ...continuity, name: 'sharedContinuityProof' } ] },
  { type: 'function', name: 'calculateTxIndex', stateMutability: 'view', outputs: [{ type: 'uint64' }], inputs: [merkle] },
] as const satisfies Abi

export const VERIFIER = VERIFIER_PRECOMPILE

/** Strip ethers/viem noise so a revert reads as the precompile wrote it. */
export function precompileReason(e: unknown): string {
  const m = (e as { shortMessage?: string; message?: string })
  const raw = m.shortMessage ?? m.message ?? String(e)
  const quoted = /reverted with the following reason:\s*\n?(.+)/.exec(raw)?.[1]
  return (quoted ?? raw).split('\n')[0].replace(/^execution reverted:?\s*/i, '').trim()
}
