import { BaseError, ContractFunctionRevertedError, encodePacked, keccak256, type PublicClient } from 'viem'
import { cfg } from '../config'
import { ledgerAbi } from './abi'

/** The ledger's custom error as `Name(arg, arg)`, or the first line of the wallet/RPC message. */
export function revertReason(e: unknown): string {
  const rev = (e as BaseError).walk?.((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined
  if (rev?.data?.errorName) return `${rev.data.errorName}(${(rev.data.args ?? []).map(String).join(', ')})`
  const short = (e as { shortMessage?: string }).shortMessage
  return (short ?? (e as Error).message ?? String(e)).split('\n')[0]
}

/** Dry-run a ledger call so a revert surfaces as its decoded custom error before the wallet is asked to sign. */
export async function simulateLedger(client: PublicClient, account: `0x${string}`, functionName: string, args: readonly unknown[]) {
  await client.simulateContract({ address: cfg.ledger, abi: ledgerAbi, functionName, args: args as unknown[], account })
}

/** keccak256(abi.encodePacked(ledger, chainid, circleId, invitee, nonce)) — the bytes an organiser's wallet personal_signs.
 *  KittyLedger.inviteDigest already applies the EIP-191 prefix, so the wallet must sign this inner hash, never the digest. */
export function inviteMessage(circleId: bigint, invitee: `0x${string}`, nonce: bigint): `0x${string}` {
  return keccak256(encodePacked(['address', 'uint256', 'uint256', 'address', 'uint256'], [cfg.ledger, BigInt(cfg.creditcoinChainId), circleId, invitee, nonce]))
}

/** A random uint256 nonce for an invite (replay protection is per circle and nonce). */
export function randomNonce(): bigint {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return BigInt('0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''))
}

/** Approximate wall-clock for a span of source-chain blocks (12 s Ethereum blocks). */
export function blocksToHuman(blocks: number): string {
  if (!Number.isFinite(blocks) || blocks <= 0) return '—'
  const h = (blocks * 12) / 3600
  if (h < 1) return `≈ ${Math.round(h * 60)} min`
  if (h < 48) return `≈ ${h.toLocaleString(undefined, { maximumFractionDigits: 1 })} h`
  return `≈ ${(h / 24).toLocaleString(undefined, { maximumFractionDigits: 1 })} days`
}
