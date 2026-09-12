import ledgerJson from '../abi/KittyLedger.json'
import vaultJson from '../abi/KittyVault.json'
import usdJson from '../abi/TestUSD.json'
import type { Abi } from 'viem'

export const ledgerAbi = ledgerJson as Abi
export const vaultAbi = vaultJson as Abi
export const usdAbi = usdJson as Abi

export const chainInfoAbi = [
  {
    type: 'function',
    name: 'get_latest_attestation_height_and_hash',
    stateMutability: 'view',
    inputs: [{ name: 'chainKey', type: 'uint64' }],
    outputs: [
      {
        name: 'result',
        type: 'tuple',
        components: [
          { name: 'height', type: 'uint64' },
          { name: 'hash', type: 'bytes32' },
          { name: 'isAttestation', type: 'bool' },
          { name: 'exists', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'is_height_attested',
    stateMutability: 'view',
    inputs: [
      { name: 'chainKey', type: 'uint64' },
      { name: 'targetHeight', type: 'uint64' },
    ],
    outputs: [{ name: 'isAttested', type: 'bool' }],
  },
  {
    // The first attested height at or after targetHeight: *which* attestation makes a payment provable.
    // Field order copied from src/interfaces/IChainInfo.sol HeightHash; a future height returns exists=false.
    type: 'function',
    name: 'find_lowest_attested_after',
    stateMutability: 'view',
    inputs: [
      { name: 'chainKey', type: 'uint64' },
      { name: 'targetHeight', type: 'uint64' },
    ],
    outputs: [
      {
        name: 'result',
        type: 'tuple',
        components: [
          { name: 'height', type: 'uint64' },
          { name: 'hash', type: 'bytes32' },
          { name: 'isAttestation', type: 'bool' },
          { name: 'exists', type: 'bool' },
        ],
      },
    ],
  },
  {
    // Both attested bounds around targetHeight. Field order copied from IChainInfo.sol BoundsCheck;
    // a future height returns childHeight=0 / isAttested=false without reverting.
    type: 'function',
    name: 'get_attestation_bounds',
    stateMutability: 'view',
    inputs: [
      { name: 'chainKey', type: 'uint64' },
      { name: 'targetHeight', type: 'uint64' },
    ],
    outputs: [
      {
        name: 'result',
        type: 'tuple',
        components: [
          { name: 'parentHeight', type: 'uint64' },
          { name: 'parentHash', type: 'bytes32' },
          { name: 'parentIsAttestation', type: 'bool' },
          { name: 'childHeight', type: 'uint64' },
          { name: 'childHash', type: 'bytes32' },
          { name: 'childIsAttestation', type: 'bool' },
          { name: 'isAttested', type: 'bool' },
        ],
      },
    ],
  },
] as const satisfies Abi
