/**
 * Test and scenario counts printed by the deck (Presentation) and the landing page.
 * One place to update; the README badge (`foundry_tests-N_passing`) and docs quote the same figures.
 *   forge     — `forge test` in the repo root
 *   agent     — `pnpm test` in worker/
 *   scenarios — attack-lab scenarios in worker/src/scenarios.ts
 */
export const COUNTS = { forge: 162, agent: 29, scenarios: 8 } as const
