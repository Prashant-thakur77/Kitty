export const meta = {
  name: 'kitty-audit-round',
  description: 'Audit Kitty from eight angles, adversarially verify every finding, rank into a build plan',
  phases: [
    { title: 'Audit', detail: 'eight independent reviewers over the repo' },
    { title: 'Verify', detail: 'three refuters per finding, majority must fail to refute' },
    { title: 'Rank', detail: 'one synthesizer produces the ordered plan' },
  ],
}

const REPO = '/home/prashant/projects/kitty'
const CONTEXT = `You are reviewing "Kitty", a hackathon entry for BUIDL CTC 2026 Fall (Creditcoin, sponsor tech = Attestcoin Protocol). Repo: ${REPO}. Read README.md first (it is accurate and current), then docs/ATTESTCOIN_INTEGRATION.md and docs/AGENT_PLAN.md. The hackathon rules: must integrate Attestcoin as a core feature; "depth of Attestcoin Protocol utilization" is a core scoring criterion; must be deployed on a testnet (the Creditcoin side is NOT yet deployed because the deployer wallet has no tCTC — that is out of scope, do not report it); needs a README, a deck (docs/Kitty-deck.pdf) and a demo video (docs/kitty-demo.mp4, 5:23). Prizes are overall, top 3 of ~64 entries. Judges are Creditcoin/Credit Labs engineers and investors (CEIP fast-track).
Ground every finding in a real file and line you actually read. Do not report things the README already lists as known limits unless you have a concrete fix. Do NOT modify any files. Use Bash freely (forge test, pnpm typecheck, grep, cast against local anvils if you start them with scripts/local-world.sh — kill anvils with 'pkill -x anvil' when done, never pkill -f).`

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          area: { type: 'string', enum: ['contracts', 'worker', 'web', 'docs', 'media', 'tests', 'ci', 'pitch'] },
          file: { type: 'string' },
          problem: { type: 'string', description: 'what is wrong or missing, concretely, with evidence' },
          fix: { type: 'string', description: 'the concrete change to make, specific enough for another engineer to implement without asking' },
          value: { type: 'integer', minimum: 1, maximum: 5, description: '5 = judges would notice; 1 = cosmetic' },
          effort: { type: 'integer', minimum: 1, maximum: 5, description: '1 = under 30 min; 5 = a day' },
          risk: { type: 'string', description: 'what could break if the fix is done badly' },
        },
        required: ['title', 'area', 'file', 'problem', 'fix', 'value', 'effort', 'risk'],
      },
    },
  },
  required: ['findings'],
}

const DIMENSIONS = [
  { key: 'judge', prompt: `Act as a BUIDL CTC judge scoring this entry against the published criteria (Attestcoin depth, working integration, technical docs, originality, real-world relevance, demo quality). Read README.md, docs/ATTESTCOIN_INTEGRATION.md, docs/SUBMISSION.md, skim the deck text in web/src/pages/Presentation.tsx, and open the dashboard source. Score each criterion 1-10 and, for every point you would deduct, produce a finding with the concrete change that would recover it. Be harsh and specific. Also flag any claim in README/docs that the code does not actually support.` },
  { key: 'contracts', prompt: `Security and correctness review of src/asc/*.sol, src/source/*.sol, src/interfaces/*.sol. A prior review already fixed: trusted-vault allowlist, membership consent, grace window, eligible recipients, ByScore rotation, pro-rata LP withdrawals, contributor-only payouts. Focus on what changed since: per-circle chainKey and the per-chain allowlist (KittyMultiChain), confirmPayouts batch, _rejectEmitter diagnostics, rotation ByScore edge cases (ties, all-received, nobody-paid), KittyCreditLine accounting under partial repay and re-borrow, KittyBadge tokenURI size and gas, KittyViewer loops. Run forge test. Write throwaway tests under test/ to confirm suspicions and DELETE them afterwards (git status must be clean when you finish). Report only what you confirmed.` },
  { key: 'worker', prompt: `Robustness review of worker/src/**. Assume the REAL Creditcoin testnet: Sepolia RPC that caps eth_getLogs ranges and rate-limits, a Proof Builder that returns 5xx or a batch shape missing some tx, attestation lag of 8-15 minutes, gas estimation through the precompile failing, worker restarts mid-round, two circles with different chain keys, a member paying twice, an operator payout that reverts. Trace each scenario through worker.ts, proofs.ts, chain.ts, agent/policy.ts, agent/log.ts, scenarios.ts, api.ts. Run pnpm typecheck and pnpm test:agent. Report concrete failure modes with the line that causes them and the fix.` },
  { key: 'web', prompt: `Frontend correctness and UX review of web/src/**. Build it (cd web && pnpm build). Check: every page's empty/loading/error state; what happens with no wallet, wrong network, a wallet that is not a member; the contribute flow (approve then contribute, waiting for receipts); the ProvePanel and ReverifyModal against a real proof shape; the Borrow page with zero limit; the Score page for an address with no history; the presentation print CSS; mobile at 390px (start scripts/local-world.sh and use the Playwright install at /tmp/claude-1000/-home-prashant-projects/3b50f59b-ab57-437c-8c55-4bbd4d928618/scratchpad/shots/node_modules/playwright/index.mjs to screenshot if useful). Report defects a judge clicking around for five minutes would hit, with the fix.` },
  { key: 'depth', prompt: `Attestcoin-depth review. Read node_modules/@gluwa/usc-sdk/src/chain-info/chain_info.json, node_modules/@gluwa/asc-contracts/contracts/**, the Proof Builder client in node_modules/@gluwa/usc-sdk/dist/proof-provider/service/index.js, and https://docs.attestcoin.org/llms.txt (WebFetch the pages under it that matter: dapp-design-patterns-readability, offchain-readability-workers, gas-costs, attestcoin-writability). Then read src/asc/KittyLedger.sol, src/interfaces/IChainInfo.sol, worker/src/proofs.ts, worker/src/verifier.ts. List every protocol capability Kitty does NOT yet use and, for each, whether using it would be meaningful (not decorative) for a savings circle, with the concrete integration. Also verify that what README claims about the protocol (8 of 11 ChainInfo functions, batch limit 10, query-id derivation identical to ASCBase, chain keys 1 and 3) is exactly true against the package sources.` },
  { key: 'docs', prompt: `Documentation accuracy review. Cross-check every factual claim in README.md, docs/ATTESTCOIN_INTEGRATION.md and docs/SUBMISSION.md against the code: function names, counts (tests, scenarios, functions used), addresses, gas numbers, error names, file paths, commands (run each pnpm/forge command mentioned in the quick start and confirm it exists and works — pnpm judge, pnpm scenarios, pnpm receipts, pnpm verify:live with no network is fine to just check the script exists). Report every mismatch, stale statement, broken link, missing asset, and any place where a judge would be confused about how to run or verify something. Also assess docs/SUBMISSION.md as the literal text to paste into the DoraHacks form: is it tight, complete, and does the integration summary fit in a typical form field?` },
  { key: 'competition', prompt: `Competitive positioning. The visible field (from the hackathon page) includes: Kirogi (purpose-bound remittance), ThirdCheck (proof-of-wrong-thing guard), credence (credit scoring + undercollateralized lending on Attestcoin), AttestGO (identity/RWA/AI), AttestFlow (supply-chain finance), IPlink (creator income proofs), VeriAgent (AI agent on verified data), Kasuwa Credit OS (merchant credit), CreditPulse AI (credit-risk oracle), Farebox (prepaid compute credits), Ledgerline (DePIN operator lending), RWAs by Attest, CarryProof, Deadswitch (self-liquidating cross-chain lending), ConvenantX (covenant enforcement), AttestOps, VaultBridge, AEOS, Collateral Eligibility Ledger, loomcredit (bounded AI + deterministic policy), ProofPay. Several are credit-scoring plays (credence, Kasuwa, CreditPulse, loomcredit). Read README.md and docs/SUBMISSION.md. Identify: (1) where Kitty's pitch overlaps with these and could be mistaken for one of them, (2) the two or three differentiators that NONE of them can claim and that should lead every pitch surface (README top, deck slide 1-2, video first 20s, DoraHacks description), (3) any claim in our pitch that a rival could refute. Produce findings whose fix is specific wording/structure changes to README, docs/SUBMISSION.md and web/src/pages/Presentation.tsx.` },
  { key: 'tests', prompt: `Test-coverage review. Run forge coverage --report summary (if it fails under via_ir, use forge test -vvv and reason from the test files). Read test/*.t.sol and worker/test/*.ts. Identify meaningful untested paths: in contracts (revert paths, the batch confirmPayouts partial failure, invites edge cases, viewer with completed circles, credit line withdraw when liquidity < entitlement, badge tokenURI after a miss, multi-chain closeRound), in the worker (proofs.ts fallback/merge path, policy edge cases like equal slack, citations with unicode/commas), and in the web (none exist — propose 3-5 cheap vitest tests for pure helpers like describe(), chainName, precompileReason). For each gap, the exact test to add.` },
]

phase('Audit')
const audits = await parallel(DIMENSIONS.map((d) => () =>
  agent(`${CONTEXT}\n\nYOUR DIMENSION: ${d.key}\n${d.prompt}\n\nReturn 4-12 findings. Quality over quantity; every finding must be actionable.`, { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS, effort: 'high' })
))
const all = audits.filter(Boolean).flatMap((r, i) => r.findings.map((f) => ({ ...f, source: DIMENSIONS[i].key })))
log(`${all.length} raw findings from ${audits.filter(Boolean).length} reviewers`)

// dedupe by normalised title+file before paying for verification
const seen = new Set()
const unique = all.filter((f) => { const k = (f.file + '|' + f.title).toLowerCase().replace(/[^a-z0-9|]/g, ''); if (seen.has(k)) return false; seen.add(k); return true })
log(`${unique.length} unique findings to verify`)

const VERDICT = { type: 'object', properties: { refuted: { type: 'boolean' }, reason: { type: 'string' }, adjustedValue: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['refuted', 'reason', 'adjustedValue'] }
const LENSES = [
  'correctness: is the stated problem actually present in the code at that file? Read it. If the problem does not exist or is already handled, refute.',
  'value-to-judges: would fixing this measurably improve how a hackathon judge scores the entry against Attestcoin depth, working integration, docs, originality, or demo? If it is cosmetic or invisible, refute.',
  'risk-and-scope: can the fix be done safely in the stated effort without destabilising the 100 passing tests, the worker, the live site, or the recorded demo? If the fix is vague, likely to break things, or is really several days of work, refute.',
]

phase('Verify')
const verified = await pipeline(unique,
  (f) => parallel(LENSES.map((lens) => () =>
    agent(`${CONTEXT}\n\nA reviewer (${f.source}) claims:\nTITLE: ${f.title}\nFILE: ${f.file}\nPROBLEM: ${f.problem}\nFIX: ${f.fix}\nVALUE ${f.value}/5 EFFORT ${f.effort}/5 RISK ${f.risk}\n\nYour lens — ${lens}\nDefault to refuted=true if you are uncertain. Give adjustedValue as your own 1-5 estimate of judge-visible value.`, { label: `verify:${f.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT, effort: 'high' })
  )).then((votes) => {
    const v = votes.filter(Boolean)
    const keep = v.filter((x) => !x.refuted).length >= 2
    const value = v.length ? Math.round(v.reduce((a, x) => a + x.adjustedValue, 0) / v.length) : f.value
    return keep ? { ...f, value, verdicts: v.map((x) => x.reason) } : null
  })
)
const kept = verified.filter(Boolean)
log(`${kept.length} of ${unique.length} findings survived adversarial verification`)

phase('Rank')
const PLAN = { type: 'object', properties: { plan: { type: 'array', items: { type: 'object', properties: { order: { type: 'integer' }, title: { type: 'string' }, area: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, fix: { type: 'string' }, why: { type: 'string' }, value: { type: 'integer' }, effort: { type: 'integer' }, dependsOn: { type: 'array', items: { type: 'integer' } } }, required: ['order', 'title', 'area', 'files', 'fix', 'why', 'value', 'effort', 'dependsOn'] } }, dropped: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['plan', 'dropped', 'summary'] }
const ranked = await agent(`${CONTEXT}\n\nHere are ${kept.length} verified improvement findings for Kitty (JSON):\n${JSON.stringify(kept, null, 1)}\n\nProduce a build plan for the next work session: keep items with value >= 3, merge duplicates, order by value/effort with dependencies respected, and group so that four engineers can work in parallel on disjoint directories (contracts+tests, worker, web, docs/media). Cap at 14 items. For each item, list the exact files to touch and a fix description precise enough to implement without asking questions. List what you dropped and why in one line each. End with a three-sentence summary of what this round will change for a judge.`, { label: 'rank', phase: 'Rank', schema: PLAN, effort: 'max' })
return { raw: all.length, unique: unique.length, kept: kept.length, plan: ranked.plan, dropped: ranked.dropped, summary: ranked.summary }