/**
 * Demo member keys, shared by the demo driver and the attack-lab scenarios.
 *   local:   anvil's default mnemonic, accounts 1..N (account 0 is the deployer/operator).
 *   testnet: random keys persisted in worker/demo-members.local.json (gitignored).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { cfg, ROOT, sourceProvider } from './config.ts';

export const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';
const membersFile = path.join(ROOT, 'worker', 'demo-members.local.json');

/** Anvil default account `index` (0 = deployer), connected to the source chain. */
export function anvilAccount(index: number): ethers.Wallet {
  const hd = ethers.HDNodeWallet.fromPhrase(ANVIL_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
  return new ethers.Wallet(hd.privateKey, sourceProvider);
}

export function memberWallets(n: number): ethers.Wallet[] {
  if (cfg.mode === 'local') return Array.from({ length: n }, (_, i) => anvilAccount(i + 1));
  let keys: string[] = [];
  if (fs.existsSync(membersFile)) keys = JSON.parse(fs.readFileSync(membersFile, 'utf8'));
  while (keys.length < n) keys.push(ethers.Wallet.createRandom().privateKey);
  fs.writeFileSync(membersFile, JSON.stringify(keys, null, 2));
  return keys.slice(0, n).map((k) => new ethers.Wallet(k, sourceProvider));
}
