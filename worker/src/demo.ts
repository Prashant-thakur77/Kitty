/**
 * Demo driver.
 *   pnpm demo create [--name "Lagos Susu"] [--members 3] [--amount 100] [--round-blocks 40]
 *   pnpm demo contribute [--skip <memberIndex>]      members pay the current round on Sepolia
 *   pnpm demo status                                 print circle/round/member state from Creditcoin
 *   pnpm demo fund                                   (testnet) send demo members ETH + tUSD from deployer
 * Member keys: local mode uses anvil's default accounts 1..N; testnet mode generates and stores
 * worker/demo-members.local.json (gitignored).
 */
import { ethers } from 'ethers';
import { cfg, contracts, sourceProvider, ccProvider, sourceWallet, chainInfo, log } from './config.ts';
import { memberWallets } from './members.ts';

const args = process.argv.slice(2);
const cmd = args[0] ?? 'status';
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

async function create() {
  const { ledger, vault } = contracts();
  const n = Number(opt('members', '3'));
  const name = opt('name', 'Lagos Susu #1')!;
  const amount = ethers.parseUnits(opt('amount', '100')!, 6);
  const roundBlocks = Number(opt('round-blocks', cfg.mode === 'local' ? '40' : '60'));
  const members = memberWallets(n).map((w) => w.address);
  const startHeight = (await sourceProvider.getBlockNumber()) + 1;
  log(`creating circle "${name}" · ${n} members · ${opt('amount', '100')} tUSD/round · ${roundBlocks} Sepolia blocks/round · start ${startHeight}`);
  const tx = await ledger.createCircle(name, members, amount, roundBlocks, startHeight, await vault.getAddress());
  const rc = await tx.wait();
  const id = await ledger.circleCount();
  log(`✓ circle ${id} created on Creditcoin · tx ${rc.hash}`);
  log(`members:\n  ${members.join('\n  ')}`);
  log(`round 0 deadline: Sepolia block ${await ledger.deadlineHeight(id, 0)}`);
}

async function fund() {
  const { token } = contracts();
  const n = Number(opt('members', '3'));
  const eth = ethers.parseEther(opt('eth', cfg.mode === 'local' ? '0' : '0.004')!);
  for (const w of memberWallets(n)) {
    if (eth > 0n) {
      const t = await sourceWallet.sendTransaction({ to: w.address, value: eth });
      await t.wait();
    }
    const m = await token.mint(w.address, ethers.parseUnits('1000', 6));
    await m.wait();
    log(`funded ${w.address} · ${ethers.formatEther(await sourceProvider.getBalance(w.address))} ETH · ${Number(await token.balanceOf(w.address)) / 1e6} tUSD`);
  }
}

async function contribute() {
  const { ledger, vault, token } = contracts();
  const circleId = BigInt(opt('circle', String(await ledger.circleCount()))!);
  const c = await ledger.getCircle(circleId);
  const round = Number(c.currentRound);
  const skip = new Set((opt('skip', '') ?? '').split(',').filter(Boolean).map(Number));
  const wallets = memberWallets(c.members.length);
  const vaultAddr = await vault.getAddress();
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    if (skip.has(i)) {
      log(`member ${i} ${w.address} skips round ${round} (will be recorded as MISSED)`);
      continue;
    }
    const t = token.connect(w) as ethers.Contract;
    const allowance: bigint = await t.allowance(w.address, vaultAddr);
    if (allowance < c.contribution) await (await t.approve(vaultAddr, ethers.MaxUint256)).wait();
    const v = vault.connect(w) as ethers.Contract;
    const tx = await v.contribute(circleId, round, c.contribution);
    const rc = await tx.wait();
    log(`member ${i} ${w.address} contributed ${Number(c.contribution) / 1e6} tUSD for round ${round} · sepolia tx ${rc.hash} · block ${rc.blockNumber}`);
  }
}

async function status() {
  const { ledger } = contracts();
  const n = Number(await ledger.circleCount());
  const latest = await chainInfo.get_latest_attestation_height_and_hash(cfg.chainKey).catch(() => null);
  const head = await sourceProvider.getBlockNumber();
  log(`source head ${head} · latest attested on Creditcoin ${latest ? latest.height : 'n/a'} · circles ${n}`);
  for (let id = 1; id <= n; id++) {
    const c = await ledger.getCircle(id);
    const cur = Number(c.currentRound);
    console.log(`\n#${id} "${c.name}" · ${c.members.length} members · ${Number(c.contribution) / 1e6} tUSD · round ${cur} · ${['Active', 'Completed'][Number(c.status)]}`);
    const last = Number(c.status) === 1 ? c.members.length - 1 : cur;
    for (let r = 0; r <= last; r++) {
      const rd = await ledger.getRound(id, r);
      const dl = await ledger.deadlineHeight(id, r);
      console.log(`  round ${r}: ${['Open', 'Closed', 'Paid'][Number(rd.status)]} · ${rd.contributions}/${c.members.length} proven · pot ${Number(rd.pot) / 1e6} · deadline block ${dl}${rd.recipient !== ethers.ZeroAddress ? ` · recipient ${rd.recipient}` : ''}`);
      for (const m of c.members) {
        const ct = await ledger.getContribution(id, r, m);
        const st = ct.queryId === ethers.ZeroHash ? (Number(rd.status) === 0 ? 'pending' : 'MISSED') : ct.onTime ? `on time @${ct.height}` : `LATE @${ct.height}`;
        console.log(`     ${m} ${st}`);
      }
    }
    for (const m of c.members) {
      const [score, tier] = await ledger.creditScore(m);
      const rec = await ledger.getRecord(m);
      console.log(`  score ${m}: ${score} (${tier}) · on-time ${rec.onTime} · late ${rec.late} · missed ${rec.missed} · received ${rec.received}`);
    }
  }
  void ccProvider;
}

const run: Record<string, () => Promise<void>> = { create, fund, contribute, status };
if (!run[cmd]) {
  console.error(`unknown command ${cmd}; use create|fund|contribute|status`);
  process.exit(1);
}
run[cmd]().catch((e) => {
  console.error(e);
  process.exit(1);
});
