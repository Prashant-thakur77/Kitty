/** pnpm explain ["your question"] — narrate the steward's recent decisions, with every claim checked. */
import { explain } from './explain.ts';
import { read } from './log.ts';

const question = process.argv.slice(2).join(' ') || 'What have you done recently, and why?';
const entries = read(12);
if (entries.length === 0) {
  console.log('No decisions logged yet. Run `pnpm worker` (or `pnpm e2e:local`) first.');
  process.exit(0);
}
const fallback = entries[0].summary;
const r = await explain(question, fallback, { entries });
console.log(`\n${r.text}\n`);
console.log(`— source: ${r.source}${r.source === 'deterministic' ? ' (no ANTHROPIC_API_KEY, or nothing survived the citation check)' : ''}`);
if (r.verified.length) console.log(`— verified citations: ${r.verified.join(', ')}`);
for (const s of r.stripped) console.log(`— stripped (${s.reason}: ${s.value}): ${s.sentence}`);
