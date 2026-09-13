/**
 * Re-verify every transaction in docs/TESTNET_LOG.md against the live chains.
 *   pnpm verify:log                 # prints one line per row and a summary, exits 1 on any failure
 *   pnpm verify:log --json <file>   # also writes the verified rows (block, to, status) for the dashboard
 *
 * A row passes when its receipt exists on the chain the row names, its status is 1 (rows marked
 * "(reverted)" in the log are expected to be 0 and pass on 0) and, for Creditcoin rows, the
 * transaction went to one of Kitty's contracts or created one. Nothing here trusts the log's
 * own text: gas used is re-read from the receipt and compared as well.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { ROOT, sourceProvider, ccProvider } from './config.ts';

const file = path.join(ROOT, 'docs', 'TESTNET_LOG.md');
const jsonAt = process.argv.indexOf('--json');
const jsonOut = jsonAt > 0 ? path.resolve(ROOT, process.argv[jsonAt + 1]) : '';

interface Row { date: string; chain: 'sepolia' | 'creditcoin'; action: string; hash: string; gas: string; reverted: boolean }
interface Verified extends Row { block: number; to: string | null; created: string | null; status: number; gasUsed: string; ok: boolean; why?: string }

const rows: Row[] = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  const m = line.match(/^\| (\d{4}-\d{2}-\d{2}) \| ([^|]+) \| (.+) \| \[[^\]]+\]\([^)]*\/tx\/(0x[0-9a-fA-F]{64})\) \| (\d+) \|$/);
  if (!m) continue;
  const chain = m[2].trim().startsWith('Sepolia') ? 'sepolia' : 'creditcoin';
  rows.push({ date: m[1], chain, action: m[3].trim(), hash: m[4].toLowerCase(), gas: m[5], reverted: / \(reverted\)$/.test(m[3].trim()) });
}
if (!rows.length) { console.error('no rows found in docs/TESTNET_LOG.md'); process.exit(1); }

// Every Creditcoin address Kitty has deployed on CC3 Testnet (four ledgers, viewer, tokens, credit line, badge)
// plus the addresses of the demo members: a transfer to a member is still Kitty's transaction (funding).
const known = new Set<string>();
for (const line of fs.readFileSync(file, 'utf8').split('\n')) for (const a of line.match(/0x[0-9a-fA-F]{40}/g) ?? []) known.add(a.toLowerCase());
try {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments.json'), 'utf8'));
  const walk = (v: unknown) => { if (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v)) known.add(v.toLowerCase()); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(d);
} catch { /* deployments.json is optional for the check */ }

// Public Sepolia endpoints are load-balanced over nodes that do not all hold every receipt, so a null
// answer is retried on a second and third public node before a row is called missing.
const fallbacks = (process.env.SEPOLIA_FALLBACK_RPC_URLS ?? 'https://sepolia.gateway.tenderly.co,https://1rpc.io/sepolia').split(',').filter(Boolean)
  .map((u) => new ethers.JsonRpcProvider(u.trim(), 11155111, { staticNetwork: true }));
const providers = { sepolia: [sourceProvider, ...fallbacks], creditcoin: [ccProvider] };
async function receipt(chain: Row['chain'], hash: string) {
  for (const p of providers[chain]) {
    const rc = await p.getTransactionReceipt(hash).catch(() => null);
    if (rc) return rc;
  }
  return null;
}
const out: Verified[] = [];
let failed = 0;
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));

async function check(r: Row): Promise<Verified> {
  const rc = await receipt(r.chain, r.hash);
  if (!rc) return { ...r, block: 0, to: null, created: null, status: -1, gasUsed: '0', ok: false, why: 'no receipt' };
  const v: Verified = { ...r, block: rc.blockNumber, to: rc.to, created: rc.contractAddress, status: rc.status ?? -1, gasUsed: rc.gasUsed.toString(), ok: true };
  if ((rc.status === 1) === r.reverted) { v.ok = false; v.why = `status ${rc.status}`; }
  else if (v.gasUsed !== r.gas) { v.ok = false; v.why = `gas ${v.gasUsed} != logged ${r.gas}`; }
  else if (r.chain === 'creditcoin' && !rc.contractAddress && rc.to && !known.has(rc.to.toLowerCase())) { v.ok = false; v.why = `sent to unknown ${rc.to}`; }
  if (rc.contractAddress) known.add(rc.contractAddress.toLowerCase());
  return v;
}

// Sequential per chain (public RPCs rate-limit bursts), the two chains in parallel.
async function run(chain: Row['chain']) {
  for (const r of rows.filter((x) => x.chain === chain)) {
    let v: Verified | undefined;
    for (let attempt = 0; attempt < 3 && !v; attempt++) {
      try { v = await check(r); } catch (e) { if (attempt === 2) v = { ...r, block: 0, to: null, created: null, status: -1, gasUsed: '0', ok: false, why: (e as Error).message.slice(0, 80) }; else await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); }
    }
    out.push(v!);
    if (!v!.ok) failed++;
    console.log(`${v!.ok ? 'ok  ' : 'FAIL'} ${r.chain.padEnd(10)} ${r.date} ${pad(r.action, 64)} ${r.hash.slice(0, 10)}… ${v!.ok ? `block ${v!.block}` : v!.why}`);
  }
}
await Promise.all([run('sepolia'), run('creditcoin')]);

out.sort((a, b) => rows.findIndex((r) => r.hash === a.hash) - rows.findIndex((r) => r.hash === b.hash));
const bySide = (c: Row['chain']) => out.filter((r) => r.chain === c).length;
console.log(`\n${out.length - failed}/${out.length} rows verified (${bySide('sepolia')} Sepolia, ${bySide('creditcoin')} Creditcoin CC3 Testnet)${failed ? ` · ${failed} FAILED` : ''}`);
if (jsonOut) {
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, JSON.stringify({ verifiedAt: new Date().toISOString(), total: out.length, passed: out.length - failed, rows: out }, null, 1));
  console.log(`wrote ${path.relative(ROOT, jsonOut)}`);
}
process.exit(failed ? 1 : 0);
