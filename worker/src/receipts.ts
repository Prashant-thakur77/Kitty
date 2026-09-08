/**
 * pnpm receipts <memberAddress> [outFile]
 *
 * Exports a member's proof bundle: every payment KittyLedger has recorded for them, with the source
 * transaction, the block it was proven at, the Attestcoin query id, and the Creditcoin transaction
 * that carried the proof. The bundle is self-verifying — a lender can re-check every line with
 * `pnpm verify:live <sourceTx>` or in the browser, without trusting Kitty, this file, or its author.
 */
import fs from 'node:fs';
import { ethers } from 'ethers';
import { cfg, contracts, ccProvider, log } from './config.ts';

const member = process.argv[2];
if (!member || !ethers.isAddress(member)) { console.error('usage: pnpm receipts <memberAddress> [outFile]'); process.exit(1); }
const out = process.argv[3] ?? `kitty-receipts-${member.slice(0, 10)}.json`;
const { ledger } = contracts();

const head = await ccProvider.getBlockNumber();
const from = Number(process.env.LEDGER_DEPLOY_BLOCK ?? 0) || Math.max(0, head - 50_000);
log(`scanning KittyLedger events on Creditcoin, blocks ${from}–${head}…`);

type Row = Record<string, unknown>;
const rows: Row[] = [];
const want = member.toLowerCase();
for (const name of ['ContributionRecorded', 'ContributionMissed', 'RoundClosed', 'PayoutConfirmed'] as const) {
  const logs = await ledger.queryFilter(ledger.filters[name](), from, head);
  for (const l of logs) {
    if (!('args' in l)) continue;
    const a = l.args as unknown as Record<string, unknown>;
    const who = String(a.member ?? a.recipient ?? '').toLowerCase();
    if (who !== want) continue;
    rows.push({
      event: name,
      circleId: String(a.circleId),
      round: Number(a.round),
      amount: a.amount !== undefined ? `${Number(a.amount as bigint) / 1e6} tUSD` : undefined,
      sourceHeight: a.sourceHeight !== undefined ? Number(a.sourceHeight) : undefined,
      onTime: a.onTime,
      deadlineHeight: a.deadlineHeight !== undefined ? Number(a.deadlineHeight) : undefined,
      queryId: a.queryId,
      creditcoinTx: l.transactionHash,
      creditcoinBlock: l.blockNumber,
    });
  }
}
rows.sort((x, y) => Number(x.creditcoinBlock) - Number(y.creditcoinBlock));

// Attach the source-chain transaction behind each proven payment, so the bundle is verifiable end to end.
const { vault } = contracts();
const payments = await vault.queryFilter(vault.filters.Contributed(), 0, await vault.runner!.provider!.getBlockNumber());
for (const r of rows) {
  if (r.event !== 'ContributionRecorded') continue;
  const hit = payments.find((p) => 'args' in p && String((p.args as unknown as Record<string, unknown>).member).toLowerCase() === want
    && String((p.args as unknown as Record<string, unknown>).circleId) === r.circleId
    && Number((p.args as unknown as Record<string, unknown>).round) === r.round);
  if (hit) { r.sourceTx = hit.transactionHash; r.sourceBlock = hit.blockNumber; }
}

const [score, tier] = await ledger.creditScore(member);
const rec = await ledger.getRecord(member);
const bundle = {
  member,
  issuedAt: new Date().toISOString(),
  score: Number(score),
  tier,
  record: { onTime: Number(rec.onTime), late: Number(rec.late), missed: Number(rec.missed), received: Number(rec.received), volume_tUSD: Number(rec.volume) / 1e6 },
  ledger: { address: cfg.ledger, chainId: (await ccProvider.getNetwork()).chainId.toString(), rpc: cfg.creditcoinRpc },
  sourceChain: { chainKey: cfg.chainKey, vault: cfg.vault, rpc: cfg.sepoliaRpc },
  attestcoin: { blockProver: '0x0000000000000000000000000000000000000FD2', chainInfo: '0x0000000000000000000000000000000000000fD3', proofBuilder: cfg.proofBuilderUrl },
  howToVerify: [
    'Every ContributionRecorded row names the source transaction it was proven from.',
    'Re-fetch its proof and re-check it against the live block-prover precompile: pnpm verify:live <sourceTx>',
    'Or read the ledger directly: creditScore(member) and getContribution(circleId, round, member) on the address above.',
    'Nothing here has to be trusted: the numbers are derived only from proven transactions and attested deadlines.',
  ],
  entries: rows,
};
fs.writeFileSync(out, JSON.stringify(bundle, null, 2));
log(`wrote ${out} · score ${score} (${tier}) · ${rows.length} proof-backed entries`);
