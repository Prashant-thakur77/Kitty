/** Demo-only: replays the first recorded contribution proof; KittyLedger must reject it. */
import { runScenario } from './scenarios.ts';

const r = await runScenario('replay', () => {});
process.exit(r.ok ? 0 : 2);
