/**
 * Attack-lab scenarios: each one crafts a real source-chain situation, builds a genuine proof for
 * it and submits it to KittyLedger, expecting the ledger to reject it with a specific custom error
 * (or, for `late`, to accept it flagged `onTime=false`).
 *
 *   pnpm scenario <name>…     run and print PASS/FAIL          (also: pnpm scenario --all)
 *   worker/src/api.ts         streams the same runs over SSE for the /lab page
 */
import { pathToFileURL } from 'node:url';
import { ethers } from 'ethers';
import { cfg, contracts, sourceProvider, sourceWallet, loadState, log, logSinks } from './config.ts';
import { buildBatchProof, type BatchProof } from './proofs.ts';
import { submitRecordContributions, revertReason } from './chain.ts';
import { anvilAccount, memberWallets } from './members.ts';

export type ScenarioName = 'replay' | 'spoofEmitter' | 'wrongChain' | 'revertedTx' | 'late';

export interface ScenarioMeta {
  name: ScenarioName;
  title: string;
  /** Custom error name (or event outcome) the ledger must answer with. */
  expected: string;
  description: string;
}

export interface ScenarioResult {
  ok: boolean;
  expected: string;
  got: string;
  /** Set when the scenario could not run in this environment (nothing was submitted). */
  skipped?: boolean;
}

export const SCENARIOS: ScenarioMeta[] = [
  {
    name: 'replay',
    title: 'Replay a proven contribution',
    expected: 'QueryAlreadyProcessed',
    description: 'Re-submits the batch proof of a contribution the ledger already counted. Query id (chainKey ‖ height ‖ txIndex) is marked processed.',
  },
  {
    name: 'spoofEmitter',
    title: 'Spoofed emitter',
    expected: 'WrongEmitter',
    description: 'A look-alike contract on Sepolia emits a byte-identical Contributed event. The log address is bound to the registered vault.',
  },
  {
    name: 'wrongChain',
    title: 'Wrong chain key',
    expected: 'WrongChain',
    description: 'A valid proof submitted with chainKey 3 (Ethereum mainnet on CC3 testnet). The ledger is pinned to chainKey 1.',
  },
  {
    name: 'revertedTx',
    title: 'Reverted source transaction',
    expected: 'SourceTxFailed',
    description: 'A contribute() call that mined but reverted (no allowance). Inclusion is proven, receipt status 0 is rejected.',
  },
  {
    name: 'late',
    title: 'Late payment',
    expected: 'ContributionRecorded onTime=false',
    description: 'A member pays after the round deadline block. The proof is accepted, but the proven height marks it late in the credit record.',
  },
];

const FAKE_VAULT_ABI = ['function emitContributed(uint256 circleId, uint32 round, address member, uint256 amount)'];

interface Ctx {
  ledger: ethers.Contract;
  vault: ethers.Contract;
  token: ethers.Contract;
}

async function currentCircle(ledger: ethers.Contract) {
  const circleId = BigInt(process.env.SCENARIO_CIRCLE_ID ?? String(await ledger.circleCount()));
  if (circleId === 0n) throw new Error('no circle on the ledger yet — run `pnpm demo create`');
  const circle = await ledger.getCircle(circleId);
  const round = Number(circle.currentRound);
  const deadline = Number(await ledger.deadlineHeight(circleId, round));
  return { circleId, circle, round, deadline };
}

function firstRecordedTx(): string {
  const tx = Object.keys(loadState().recorded)[0];
  if (!tx) throw new Error('nothing recorded yet — run `pnpm worker --once` first');
  return tx;
}

/** Submit and require a specific custom error. */
async function expectRevert(ledger: ethers.Contract, proof: BatchProof, expected: string): Promise<ScenarioResult> {
  try {
    const rc = await submitRecordContributions(ledger, proof);
    const got = `ACCEPTED (cc tx ${rc.hash})`;
    log(`✗ ledger accepted the proof — this must never happen`);
    return { ok: false, expected, got };
  } catch (e) {
    const got = revertReason(e, ledger.interface);
    const ok = got.startsWith(expected);
    log(`${ok ? '✓' : '✗'} KittyLedger reverted: ${got}`);
    return { ok, expected, got };
  }
}

async function waitMined(txHash: string): Promise<ethers.TransactionReceipt> {
  // tx.wait() throws on status 0; the reverted-tx scenario needs the receipt either way.
  const rc = await sourceProvider.waitForTransaction(txHash);
  if (!rc) throw new Error(`tx ${txHash} was not mined`);
  return rc;
}

const scenarios: Record<ScenarioName, (ctx: Ctx, expected: string) => Promise<ScenarioResult>> = {
  async replay({ ledger }, expected) {
    const tx = firstRecordedTx();
    log(`replaying already-recorded contribution ${tx}`);
    const [proof] = await buildBatchProof([tx]);
    log(`proof: height ${proof.heights[0]} · ${proof.continuity.roots.length} continuity root(s) — identical query id`);
    return expectRevert(ledger, proof, expected);
  },

  async wrongChain({ ledger }, expected) {
    const tx = firstRecordedTx();
    const [proof] = await buildBatchProof([tx]);
    const forged = { ...proof, chainKey: 3 };
    log(`submitting proof of ${tx} with chainKey 3 instead of ${proof.chainKey}`);
    return expectRevert(ledger, forged, expected);
  },

  async spoofEmitter({ ledger }, expected) {
    const fakeAddr = process.env.FAKE_VAULT_ADDRESS;
    if (!fakeAddr) return { ok: false, skipped: true, expected, got: 'skipped: FAKE_VAULT_ADDRESS not set' };
    const { circleId, circle, round } = await currentCircle(ledger);
    const member: string = circle.members[0];
    const fake = new ethers.Contract(fakeAddr, FAKE_VAULT_ABI, sourceWallet);
    log(`FakeVault ${fakeAddr} emits Contributed(circle ${circleId}, round ${round}, ${member}, ${Number(circle.contribution) / 1e6} tUSD)`);
    const tx = await fake.emitContributed(circleId, round, member, circle.contribution);
    const rc = await waitMined(tx.hash);
    log(`mined in source block ${rc.blockNumber} · tx ${rc.hash} · building proof of the spoofed event…`);
    const [proof] = await buildBatchProof([rc.hash]);
    return expectRevert(ledger, proof, expected);
  },

  async revertedTx({ ledger, vault }, expected) {
    const { circleId, circle, round } = await currentCircle(ledger);
    let w: ethers.Wallet;
    if (cfg.mode === 'local') {
      w = anvilAccount(4);
    } else {
      w = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, sourceProvider);
      const fee = await sourceProvider.getFeeData();
      const price = fee.maxFeePerGas ?? fee.gasPrice ?? ethers.parseUnits('5', 'gwei');
      const value = 200_000n * price * 2n;
      log(`funding fresh wallet ${w.address} with ${ethers.formatEther(value)} ETH from ${sourceWallet.address}`);
      await (await sourceWallet.sendTransaction({ to: w.address, value })).wait();
    }
    log(`${w.address} (zero tUSD allowance) calls contribute(${circleId}, ${round}, ${Number(circle.contribution) / 1e6} tUSD) with gasLimit 200000`);
    const v = vault.connect(w) as ethers.Contract;
    const tx = await v.contribute(circleId, round, circle.contribution, { gasLimit: 200_000 });
    const rc = await waitMined(tx.hash);
    log(`mined in source block ${rc.blockNumber} with status ${rc.status} · tx ${rc.hash}`);
    if (rc.status !== 0) return { ok: false, expected, got: `source tx unexpectedly succeeded (status ${rc.status})` };
    const [proof] = await buildBatchProof([rc.hash]);
    log(`inclusion proof built for the reverted tx — submitting…`);
    return expectRevert(ledger, proof, expected);
  },

  async late({ ledger, vault, token }, expected) {
    const { circleId, circle, round, deadline } = await currentCircle(ledger);
    let head = await sourceProvider.getBlockNumber();
    log(`circle ${circleId} round ${round} · deadline block ${deadline} · source head ${head}`);
    if (head <= deadline) {
      if (cfg.mode !== 'local') {
        return { ok: false, skipped: true, expected, got: `skipped: deadline ${deadline} not passed yet on Sepolia (head ${head})` };
      }
      const n = deadline - head + 1;
      log(`mining ${n} block(s) on the source anvil to pass the deadline…`);
      await sourceProvider.send('anvil_mine', [ethers.toQuantity(n)]);
      head = await sourceProvider.getBlockNumber();
      log(`source head now ${head} (> deadline ${deadline})`);
    }
    const wallets = memberWallets(circle.members.length);
    let payer: ethers.Wallet | undefined;
    for (const m of circle.members as string[]) {
      const ct = await ledger.getContribution(circleId, round, m);
      if (ct.queryId !== ethers.ZeroHash) continue;
      payer = wallets.find((w) => w.address.toLowerCase() === m.toLowerCase());
      if (payer) break;
    }
    if (!payer) return { ok: false, expected, got: `no unpaid member with a known key in round ${round} — run \`pnpm worker --once\` to close it` };

    const vaultAddr = await vault.getAddress();
    const t = token.connect(payer) as ethers.Contract;
    if ((await t.allowance(payer.address, vaultAddr)) < circle.contribution) await (await t.approve(vaultAddr, ethers.MaxUint256)).wait();
    const tx = await (vault.connect(payer) as ethers.Contract).contribute(circleId, round, circle.contribution);
    const rc = await waitMined(tx.hash);
    log(`${payer.address} contributed at source block ${rc.blockNumber} (deadline ${deadline}) · tx ${rc.hash}`);
    const [proof] = await buildBatchProof([rc.hash]);
    try {
      const ccRc = await submitRecordContributions(ledger, proof);
      for (const l of ccRc.logs) {
        let parsed: ethers.LogDescription | null = null;
        try {
          parsed = ledger.interface.parseLog({ topics: [...l.topics], data: l.data });
        } catch {}
        if (parsed?.name !== 'ContributionRecorded') continue;
        const onTime = Boolean(parsed.args.onTime);
        const got = `ContributionRecorded onTime=${onTime} (height ${parsed.args.sourceHeight}, deadline ${deadline})`;
        log(`${onTime ? '✗' : '✓'} ${got}`);
        return { ok: !onTime, expected, got };
      }
      return { ok: false, expected, got: `accepted (cc tx ${ccRc.hash}) but no ContributionRecorded event found` };
    } catch (e) {
      const got = revertReason(e, ledger.interface);
      log(`✗ KittyLedger reverted: ${got}`);
      return { ok: false, expected, got };
    }
  },
};

export async function runScenario(name: string, emit: (line: string) => void): Promise<ScenarioResult> {
  const meta = SCENARIOS.find((s) => s.name === name);
  if (!meta) throw new Error(`unknown scenario "${name}" (${SCENARIOS.map((s) => s.name).join(', ')})`);
  const ctx = contracts();
  logSinks.add(emit);
  try {
    log(`── ${meta.title} · expecting ${meta.expected}`);
    const r = await scenarios[meta.name](ctx, meta.expected);
    log(`${r.ok ? 'PASS' : r.skipped ? 'SKIP' : 'FAIL'} ${meta.name} · expected ${r.expected} · got ${r.got}`);
    return r;
  } catch (e) {
    const got = `error: ${(e as Error).message}`;
    log(`FAIL ${meta.name} · ${got}`);
    return { ok: false, expected: meta.expected, got };
  } finally {
    logSinks.delete(emit);
  }
}

// ── CLI ──
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const names = args.includes('--all') ? SCENARIOS.map((s) => s.name) : args.filter((a) => !a.startsWith('--'));
  if (names.length === 0) {
    console.log('usage: pnpm scenario <name>… | --all\n' + SCENARIOS.map((s) => `  ${s.name.padEnd(13)} ${s.title} → ${s.expected}`).join('\n'));
    process.exit(1);
  }
  let failed = 0;
  for (const n of names) {
    const r = await runScenario(n, () => {}); // log() already prints to stdout
    if (!r.ok) failed++;
  }
  process.exit(failed ? 1 : 0);
}
