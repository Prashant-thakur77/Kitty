/** Demo-only: replays the first recorded contribution proof; KittyLedger must reject it. */
import { contracts, loadState, log } from './config.ts';
import { buildBatchProof } from './proofs.ts';
import { submitRecordContributions, revertReason } from './chain.ts';

const { ledger } = contracts();
const state = loadState();
const tx = Object.keys(state.recorded)[0];
if (!tx) throw new Error('nothing recorded yet');
const proof = await buildBatchProof([tx]);
try {
  await submitRecordContributions(ledger, proof);
  log('!!! replay was accepted — this must never happen');
  process.exit(2);
} catch (e) {
  log(`✓ replay rejected by KittyLedger: ${revertReason(e, ledger.interface)}`);
}
