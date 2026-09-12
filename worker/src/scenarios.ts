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
import { cfg, contracts, sourceProvider, sourceWallet, loadState, log, logSinks , sourceSigner } from './config.ts';
import { buildBatchProof, type BatchProof } from './proofs.ts';
import { submitRecordContributions, revertReason } from './chain.ts';
import { anvilAccount, memberWallets } from './members.ts';
import { check } from './agent/citations.ts';
import { read as readLog, citableValues as citable } from './agent/log.ts';

export type ScenarioName = 'replay' | 'spoofEmitter' | 'wrongChain' | 'revertedTx' | 'late' | 'stealFromSteward' | 'fireTheAgent' | 'poisonReasoning';

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
    expected: 'WrongChain, or the precompile rejects the continuity proof',
    description: 'Each circle stores its own chain key, validated against get_chain_by_key. Under another key the live 0x0FD2 rejects the continuity proof itself; if a proof ever got past it, the ledger reverts WrongChain(got, want).',
  },
  {
    name: 'revertedTx',
    title: 'Reverted source transaction',
    expected: 'SourceTxFailed',
    description: 'A contribute() call that mined but reverted (no allowance). Inclusion is proven, receipt status 0 is rejected.',
  },
  {
    name: 'stealFromSteward',
    title: 'Steal the steward’s key',
    expected: 'every privileged call reverts',
    description: 'Takes a fresh key with the steward’s on-ledger powers and tries to move a pot, trust a vault, close a round early and bind a circle to its own vault. The steward has no ledger role, so its key is worth nothing.',
  },
  {
    name: 'fireTheAgent',
    title: 'Fire the agent',
    expected: 'a stranger’s proof is accepted',
    description: 'Submits a round’s proof from a wallet with no relationship to Kitty at all. The ledger checks the proof, never the caller, so the agent is a convenience and not a dependency.',
  },
  {
    name: 'poisonReasoning',
    title: 'Poison the reasoning',
    expected: 'fabricated sentences stripped',
    description: 'Feeds the explainer’s citation validator a paragraph mixing true cited facts with invented ones. Anything the decision log cannot back is removed before display.',
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
    const r = { ...(await expectRevert(ledger, forged, 'WrongChain')), expected };
    // Against the live precompile the forgery never reaches the ledger's own check: 0x0FD2 rejects the continuity
    // proof under the wrong chain's attestations first. Either rejection is the point of the scenario.
    if (!r.ok && r.got.startsWith('Error(Continuity proof does not match')) {
      log(`  the live 0x0FD2 rejected the forged chain key before KittyLedger's WrongChain check could run`);
      return { ...r, ok: true };
    }
    return r;
  },

  async spoofEmitter({ ledger }, expected) {
    const fakeAddr = process.env.FAKE_VAULT_ADDRESS;
    if (!fakeAddr) return { ok: false, skipped: true, expected, got: 'skipped: FAKE_VAULT_ADDRESS not set' };
    const { circleId, circle, round } = await currentCircle(ledger);
    const member: string = circle.members[0];
    const fake = new ethers.Contract(fakeAddr, FAKE_VAULT_ABI, sourceSigner);
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
      await (await sourceSigner.sendTransaction({ to: w.address, value })).wait();
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

  /**
   * The steward's authority is structural, not a policy: its key holds no role, no ownership and no
   * allowance. We prove it by taking a *fresh* key and attempting each privileged action in turn.
   */
  async stealFromSteward({ ledger, vault }, expected) {
    const { circleId, circle } = await currentCircle(ledger);
    const thief = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, sourceProvider);
    const ccThief = new ethers.Wallet(thief.privateKey, ledger.runner!.provider!);
    log(`stolen key ${thief.address} — funding it with gas on both chains so nothing fails for the wrong reason`);
    await (await sourceSigner.sendTransaction({ to: thief.address, value: ethers.parseEther('0.01') })).wait();
    const ccFunder = ledger.runner as ethers.Signer;
    await (await ccFunder.sendTransaction({ to: thief.address, value: ethers.parseEther('0.5') })).wait();

    const attempts: { what: string; iface: ethers.Interface; run: () => Promise<unknown> }[] = [
      { what: `KittyVault.payout — take circle ${circleId}'s pot`, iface: vault.interface,
        run: () => (vault.connect(thief) as ethers.Contract).payout(circleId, 0, thief.address, 1) },
      { what: 'KittyLedger.setTrustedVault — trust a vault of my own', iface: ledger.interface,
        run: () => (ledger.connect(ccThief) as ethers.Contract).getFunction('setTrustedVault(uint64,address,bool)')(cfg.chainKey, thief.address, true) },
      { what: `KittyLedger.closeRound(${circleId}) — close the round early`, iface: ledger.interface,
        run: () => (ledger.connect(ccThief) as ethers.Contract).closeRound(circleId) },
      { what: 'KittyLedger.createCircle — bind a circle to a vault of my own', iface: ledger.interface,
        run: () => (ledger.connect(ccThief) as ethers.Contract).getFunction('createCircle(string,address[],uint256,uint64,uint64,address)')(
          'stolen', [...(circle.members as string[])], circle.contribution, circle.roundBlocks, circle.startHeight, thief.address) },
    ];
    const got: string[] = [];
    let accepted = 0;
    for (const a of attempts) {
      try {
        await a.run();
        log(`✗ ${a.what} — SUCCEEDED, which must never happen`);
        got.push(`${a.what}: ACCEPTED`);
        accepted++;
      } catch (e) {
        const why = revertReason(e, a.iface);
        log(`✓ ${a.what} → ${why}`);
        got.push(why.split('(')[0]);
      }
    }
    const ok = accepted === 0;
    return { ok, expected, got: ok ? `all ${attempts.length} rejected on-chain: ${got.join(', ')}` : got.join(' | ') };
  },

  /**
   * Remove the agent entirely. Anyone holding a proof can carry the round: `recordContributions`
   * checks the proof, not the caller.
   */
  async fireTheAgent({ ledger }, expected) {
    const { circleId, circle, round } = await currentCircle(ledger);
    const unpaid: string[] = [];
    for (const m of circle.members as string[]) {
      const c = await ledger.getContribution(circleId, round, m);
      if (c.queryId === ethers.ZeroHash) unpaid.push(m);
    }
    if (unpaid.length === 0) return { ok: true, skipped: true, expected, got: `round ${round} is already fully proven — nothing left for a stranger to submit` };

    const member = memberWallets(circle.members.length).find((w) => w.address.toLowerCase() === unpaid[0].toLowerCase());
    if (!member) return { ok: true, skipped: true, expected, got: 'the unpaid member is not a demo wallet here' };
    const { token, vault } = contracts();
    const vaultAddr = await vault.getAddress();
    const t = token.connect(new ethers.NonceManager(member)) as ethers.Contract;
    if ((await t.allowance(member.address, vaultAddr)) < circle.contribution) await (await t.approve(vaultAddr, ethers.MaxUint256)).wait();
    log(`member ${member.address} pays round ${round} on the source chain`);
    const rc = await (await (vault.connect(new ethers.NonceManager(member)) as ethers.Contract).contribute(circleId, round, circle.contribution)).wait();
    log(`paid at source block ${rc.blockNumber} · ${rc.hash}`);

    const stranger = new ethers.Wallet(ethers.Wallet.createRandom().privateKey, ledger.runner!.provider!);
    log(`stranger ${stranger.address} — no role, no membership, never seen by Kitty — will submit the proof`);
    await (await (ledger.runner as ethers.Signer).sendTransaction({ to: stranger.address, value: ethers.parseEther('1') })).wait();
    const [proof] = await buildBatchProof([rc.hash]);
    const asStranger = ledger.connect(stranger) as ethers.Contract;
    const tx = await asStranger.recordContributions(proof.chainKey, proof.heights, proof.txBytes, proof.merkleProofs, proof.continuity, { gasLimit: 4_000_000 });
    const receipt = await tx.wait();
    const recorded = (await ledger.getContribution(circleId, round, member.address)).queryId !== ethers.ZeroHash;
    log(`${recorded ? '✓' : '✗'} ledger recorded the payment from a caller it has never heard of · cc tx ${receipt.hash}`);
    return { ok: recorded, expected, got: recorded ? `accepted from ${stranger.address}, a caller with no privileges` : 'the ledger refused a valid proof' };
  },

  /**
   * Layer 3 is a language model, so it is treated as hostile: every figure it states must be marked
   * and must appear in the decision log. Here we hand the validator a deliberately poisoned answer.
   */
  async poisonReasoning(_ctx, expected) {
    const entries = readLog(12);
    const allowed = citable(entries);
    if (allowed.size === 0) {
      log('no steward decisions logged yet — using a synthetic log so the validator can still be shown');
      allowed.add('3').add('11656295');
    }
    const cited = [...allowed][0];
    const poisoned = [
      `The steward proved [[${cited}]] against the ledger.`,
      'It also released [[500000]] tUSD to the organiser as a goodwill refund.',
      'Your score was raised to 850 by an administrator.',
      'The payout landed in [[0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef]].',
    ].join(' ');
    log('feeding the validator one true cited fact and three invented figures:');
    for (const line of poisoned.split('. ')) log(`   "${line.trim()}"`);
    const r = check(poisoned, allowed);
    for (const s of r.stripped) log(`✓ stripped (${s.reason}: ${s.value}) — "${s.sentence}"`);
    log(`survived: "${r.text}"`);
    const ok = r.stripped.length === 3 && !/500000|850|deadbeef/.test(r.text) && r.verified.length > 0;
    return { ok, expected, got: ok ? `${r.stripped.length} fabricated sentences stripped, ${r.verified.length} citation(s) verified` : `validator let something through: "${r.text}"` };
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
