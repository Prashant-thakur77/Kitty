import path from 'node:path';
import fs from 'node:fs';
import { format } from 'node:util';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import ledgerAbi from '../abi/KittyLedger.json' with { type: 'json' };
import vaultAbi from '../abi/KittyVault.json' with { type: 'json' };
import usdAbi from '../abi/TestUSD.json' with { type: 'json' };

export const ROOT = path.resolve(import.meta.dirname, '../..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
if (process.env.KITTY_ENV_FILE) dotenv.config({ path: path.resolve(ROOT, process.env.KITTY_ENV_FILE), override: true, quiet: true });

export type Mode = 'testnet' | 'local';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name} (see .env.example)`);
  return v;
}

export const cfg = {
  mode: (process.env.KITTY_MODE ?? 'testnet') as Mode,
  chainKey: Number(process.env.SOURCE_CHAIN_KEY ?? 1),
  sepoliaRpc: need('SEPOLIA_RPC_URL'),
  creditcoinRpc: need('CREDITCOIN_RPC_URL'),
  proofBuilderUrl: process.env.PROOF_BUILDER_URL ?? 'https://prover.cc3-testnet.creditcoin.network',
  privateKey: need('PRIVATE_KEY'),
  vault: process.env.KITTY_VAULT_ADDRESS ?? '',
  ledger: process.env.KITTY_LEDGER_ADDRESS ?? '',
  token: process.env.TEST_USD_ADDRESS ?? '',
  pollMs: Number(process.env.WORKER_POLL_MS ?? 10_000),
  batchWaitMs: Number(process.env.WORKER_BATCH_WAIT_MS ?? 45_000),
  fromBlock: process.env.WORKER_FROM_BLOCK ? Number(process.env.WORKER_FROM_BLOCK) : undefined,
  stateFile: path.join(ROOT, 'worker', process.env.WORKER_STATE_FILE ?? 'state.local.json'),
};

export const sourceProvider = new ethers.JsonRpcProvider(cfg.sepoliaRpc);
export const ccProvider = new ethers.JsonRpcProvider(cfg.creditcoinRpc);
export const sourceWallet = new ethers.Wallet(cfg.privateKey, sourceProvider);
export const ccWallet = new ethers.Wallet(cfg.privateKey, ccProvider);

export function contracts() {
  if (!cfg.vault || !cfg.ledger || !cfg.token) throw new Error('Set KITTY_VAULT_ADDRESS, KITTY_LEDGER_ADDRESS, TEST_USD_ADDRESS in .env (run scripts/deploy.sh)');
  return {
    vault: new ethers.Contract(cfg.vault, vaultAbi, sourceWallet),
    ledger: new ethers.Contract(cfg.ledger, ledgerAbi, ccWallet),
    token: new ethers.Contract(cfg.token, usdAbi, sourceWallet),
  };
}

export const CHAIN_INFO_PRECOMPILE = '0x0000000000000000000000000000000000000fD3';
export const chainInfoAbi = [
  'function is_height_attested(uint64 chainKey, uint64 targetHeight) view returns (bool)',
  'function get_latest_attestation_height_and_hash(uint64 chainKey) view returns (tuple(uint64 height, bytes32 hash, bool isAttestation, bool exists))',
];
export const chainInfo = new ethers.Contract(CHAIN_INFO_PRECOMPILE, chainInfoAbi, ccProvider);

export interface WorkerState {
  lastSourceBlock: number;
  recorded: Record<string, true>; // txHash → recorded on Creditcoin
  paid: Record<string, string>; // `${circleId}:${round}` → payout tx hash
  confirmed: Record<string, true>; // payout tx hash → confirmed
}
export function loadState(): WorkerState {
  try {
    return JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'));
  } catch {
    return { lastSourceBlock: 0, recorded: {}, paid: {}, confirmed: {} };
  }
}
export function saveState(s: WorkerState) {
  fs.writeFileSync(cfg.stateFile, JSON.stringify(s, null, 2));
}

/** Extra consumers of worker log lines (the lab API streams them over SSE). */
export const logSinks = new Set<(line: string) => void>();
export const log = (...a: unknown[]) => {
  const line = `${new Date().toISOString().slice(11, 19)} ${format(...a)}`;
  console.log(line);
  for (const sink of logSinks) sink(line);
};
