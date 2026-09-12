/**
 * Append a testnet transaction to docs/TESTNET_LOG.md with its explorer link and gas used.
 *   pnpm txlog <sepolia|creditcoin> <txhash> "<action>"
 */
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { ROOT, sourceProvider, ccProvider } from './config.ts';

const [chain, txHash, action] = process.argv.slice(2);
const chains = {
  sepolia: { label: 'Sepolia', provider: sourceProvider, explorer: 'https://sepolia.etherscan.io/tx/' },
  creditcoin: { label: 'Creditcoin CC3 Testnet', provider: ccProvider, explorer: 'https://creditcoin-testnet.blockscout.com/tx/' },
} as const;

if (!(chain in chains) || !txHash || !ethers.isHexString(txHash, 32) || !action) {
  console.error('usage: pnpm txlog <sepolia|creditcoin> <0xtxhash> "<action>"');
  process.exit(1);
}
const c = chains[chain as keyof typeof chains];
const rc = await c.provider.getTransactionReceipt(txHash);
if (!rc) {
  console.error(`receipt for ${txHash} not found on ${c.label}`);
  process.exit(1);
}

const file = path.join(ROOT, 'docs', 'TESTNET_LOG.md');
const header = '| date | chain | action | tx | gas used |\n|---|---|---|---|---|\n';
let md = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : `# Testnet transaction log\n\n${header}`;
if (!md.includes('| date | chain |')) md += `\n${header}`;
if (!md.endsWith('\n')) md += '\n';
const short = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`;
const status = rc.status === 1 ? '' : ' (reverted)';
const row = `| ${new Date().toISOString().slice(0, 10)} | ${c.label} | ${action.replace(/\|/g, '\\|')}${status} | [${short}](${c.explorer}${txHash}) | ${rc.gasUsed} |\n`;
// Insert at the end of the main five-column table (the first blank line after its header), never at EOF: later
// sections hold three-column tables and GFM would drop the link and gas cells of a row appended there.
const at = md.indexOf('|---|---|---|---|---|\n');
let end = md.indexOf('\n\n', at);
if (end === -1) end = md.length - 1;
md = md.slice(0, end + 1) + row + md.slice(end + 1);
fs.writeFileSync(file, md);
console.log(`added to docs/TESTNET_LOG.md:\n${row.trim()}`);
