export const meta = {
  name: 'kitty-build-wave1',
  description: 'Implement the audit plan wave 1: contracts, worker and web in parallel, each verified',
  phases: [
    { title: 'Build', detail: 'three implementers on disjoint directories' },
    { title: 'Review', detail: 'one adversarial reviewer per diff' },
  ],
}
const REPO = '/home/prashant/projects/kitty'
const COMMON = `You are an engineer on "Kitty" at ${REPO} (Foundry 1.7 / solc 0.8.30 via_ir; Node 22 + pnpm; worker in worker/src (tsx, ethers v6, @gluwa/usc-sdk); web in web/ (Vite, React, wagmi, viem, Tailwind v4)). Read README.md first. Other engineers are working concurrently in OTHER directories: stay strictly inside the directories listed for you, do not touch anything else, do NOT git commit or git stash. Never use 'pkill -f' (it kills the shell); stop anvils with 'pkill -x anvil' and use pids for other processes. Never leave anvils or servers running when you finish. Implement EVERY item below exactly as specified (the fixes were written after adversarial verification; if a line number drifted, find the code by its content). When you finish, run the listed verification commands and report: files changed, each item done/not-done with one line of evidence, and the verification output summary lines. If an item genuinely cannot be done as written, say precisely why and what you did instead.`
const spec = args.wave1

phase('Build')
const RESULT = { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, items: { type: 'array', items: { type: 'object', properties: { item: { type: 'integer' }, done: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['item', 'done', 'evidence'] } }, verification: { type: 'string' }, notesForOthers: { type: 'string', description: 'anything the web/worker/docs engineers must know: new function names, struct fields, env vars, script names' } }, required: ['files', 'items', 'verification', 'notesForOthers'] }
const jobs = [
  { key: 'contracts', dirs: 'src/, test/, script/, and the ABI export dirs web/src/abi + worker/abi (re-export with: for c in KittyLedger KittyVault KittyViewer KittyCreditLine KittyBadge KittyUSD FakeVault TestUSD; do forge inspect $c abi --json > web/src/abi/$c.json; cp web/src/abi/$c.json worker/abi/$c.json; done)', verify: 'forge build --sizes (every contract under 24576 B runtime) · forge test (all green; report the new total) · git status --short (only your dirs)' },
  { key: 'worker', dirs: 'worker/src/, worker/test/, scripts/*.sh (not scripts/media), package.json scripts block, .env.example, README.md ONLY the three lines item 6 names, and web/public/lab-recorded.json (generated output only). You are the only engineer allowed to start anvils in this wave.', verify: 'pnpm typecheck · pnpm test:agent · pnpm scenarios (all 8 PASS; takes ~6 min) · pnpm e2e:local (ends with "e2e done") · git status --short (only your dirs)' },
  { key: 'web', dirs: 'web/src/, web/index.html, web/vite.config.ts, web/package.json (you may add small deps with pnpm --dir web add). Do NOT start anvils or any local world — the worker engineer owns the anvil ports during this wave; the lead runs browser checks afterwards.', verify: 'cd web && pnpm build (must be clean; it runs tsc -b then vite) · git status --short (only your dirs)' },
]
const built = await parallel(jobs.map((j) => () =>
  agent(`${COMMON}\n\nYOUR DIRECTORIES: ${j.dirs}\n\nITEMS TO IMPLEMENT:\n${spec[j.key]}\n\nVERIFICATION TO RUN AT THE END: ${j.verify}`, { label: `build:${j.key}`, phase: 'Build', schema: RESULT, effort: 'high', agentType: 'general-purpose' })
))
const results = Object.fromEntries(jobs.map((j, i) => [j.key, built[i]]))
log(Object.entries(results).map(([k, r]) => `${k}: ${r ? r.items.filter((x) => x.done).length + '/' + r.items.length + ' done' : 'FAILED'}`).join(' · '))

phase('Review')
const REVIEW = { type: 'object', properties: { ok: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } }, fixedInPlace: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'problems', 'fixedInPlace'] }
const reviews = await parallel(jobs.map((j, i) => () => built[i] ? agent(`${COMMON}\n\nYou are the REVIEWER for the ${j.key} engineer. Their directories: ${j.dirs}. They were asked to implement:\n${spec[j.key]}\n\nThey report:\n${JSON.stringify(built[i], null, 1)}\n\nRun 'git diff --stat' and read the full diff of their directories. Verify each item was implemented as specified and is correct — read the code, do not trust the report. Re-run the cheap verification (forge test / pnpm typecheck / pnpm test:agent / cd web && pnpm build as relevant). If you find a defect that is small and unambiguous, FIX IT IN PLACE inside their directories and list it under fixedInPlace; anything larger goes under problems. Report ok=true only if every item is correctly done and verification passes.`, { label: `review:${j.key}`, phase: 'Review', schema: REVIEW, effort: 'high', agentType: 'general-purpose' }) : Promise.resolve(null)))
return { results, reviews: Object.fromEntries(jobs.map((j, i) => [j.key, reviews[i]])) }