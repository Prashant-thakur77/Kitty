/**
 * Runs every attack-lab scenario against the current world and writes web/public/lab-recorded.json,
 * so the hosted /lab page can replay the real runs (log lines and verdicts) without a lab API.
 *
 *   WORLD_ROUND1=0 scripts/local-world.sh
 *   KITTY_ENV_FILE=worker/.env.world pnpm -s lab:record
 *
 * Against the real testnets (KITTY_MODE unset, funded PRIVATE_KEY, the steward stopped so it does not race the
 * scenarios for the same payments) the attestor network is the clock; the run takes an attestation lag per
 * proof. Write to a separate file so the hosted page can show the testnet record with explorer links:
 *
 *   LAB_RECORD_OUT=web/public/lab-testnet.json WORKER_STATE_FILE=state.testnet.json pnpm -s lab:record
 *
 * Exits 1 if any scenario does not pass, so a stale or broken recording never ships.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ethers } from 'ethers';
import { cfg, ccSigner, sourceProvider, CHAIN_INFO_PRECOMPILE, ROOT } from './config.ts';
import { SCENARIOS, runScenario, type ScenarioName, type ScenarioResult } from './scenarios.ts';

const ORDER: ScenarioName[] = ['replay', 'wrongChain', 'revertedTx', 'late', 'spoofEmitter', 'stealFromSteward', 'fireTheAgent', 'poisonReasoning'];
const OUT = path.resolve(ROOT, process.env.LAB_RECORD_OUT ?? path.join('web', 'public', 'lab-recorded.json'));

interface Recorded extends ScenarioResult {
  name: ScenarioName;
  title: string;
  description: string;
  lines: string[];
}

// The mocked ChainInfo precompile on the local Creditcoin anvil; the attestor network would move
// this frontier by itself, so each scenario sees the source-chain head attested before it runs.
const mockChainInfo = new ethers.Contract(CHAIN_INFO_PRECOMPILE, ['function setAttestedHeight(uint64,uint64)'], ccSigner);

const results: Recorded[] = [];
for (const name of ORDER) {
  const meta = SCENARIOS.find((s) => s.name === name)!;
  if (cfg.mode === 'local') await (await mockChainInfo.setAttestedHeight(cfg.chainKey, await sourceProvider.getBlockNumber())).wait();
  const lines: string[] = [];
  const r = await runScenario(name, (l) => lines.push(l));
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${name}`);
  results.push({ name, title: meta.title, expected: meta.expected, description: meta.description, lines, ok: r.ok, got: r.got, ...(r.skipped ? { skipped: true } : {}) });
}

const commit = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
fs.writeFileSync(OUT, JSON.stringify({ commit, date: new Date().toISOString(), mode: cfg.mode, chainId: cfg.mode === 'local' ? undefined : 102031, results }, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`wrote ${path.relative(ROOT, OUT)} · ${results.length} scenarios, ${failed} failed · commit ${commit.slice(0, 10)}`);
process.exit(failed ? 1 : 0);
