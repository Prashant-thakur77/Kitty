/**
 * Kitty Steward · Layer 3 — cited reasoning.
 *
 * Claude turns the decision log into plain language for a member. It has no authority: it cannot
 * sign, spend, or change a number, and it may not state a figure that the decision log does not
 * contain. Every claim it makes is checked by agent/citations.ts against chain-derived values
 * before anything is shown.
 *
 * The layer is optional by design. With no API key the steward falls back to the deterministic
 * sentence from agent/policy.ts, and the system behaves identically — which is the point: the model
 * is a nicety, never a dependency.
 */
import Anthropic from '@anthropic-ai/sdk';
import { check, CITATION_RULE } from './citations.ts';
import { citableValues, read, type Decision } from './log.ts';

export interface Explanation {
  text: string;
  source: 'claude' | 'deterministic';
  verified: string[];
  stripped: { sentence: string; reason: string; value: string }[];
}

const SYSTEM = [
  'You explain the decisions of Kitty Steward, an agent that runs rotating savings circles.',
  'Money sits in an escrow vault on Ethereum; the rules live in a ledger on Creditcoin that only acts on transactions proven by the Attestcoin Protocol.',
  'The steward can do exactly one thing: submit proofs. It cannot move money, change a score, or close a round early.',
  'Write for a member of a savings circle, not an engineer. Two or three short sentences. No preamble, no markdown, no bullet points.',
  CITATION_RULE,
].join(' ');

/** Everything the model is allowed to know, rendered flat so a citation can be matched to a source. */
function facts(entries: Decision[]): string {
  return entries.slice(0, 12).map((d) => {
    const ev = Object.entries(d.evidence).map(([k, v]) => `${k}=${v}`).join(' ');
    const txs = (d.txs ?? []).map((t) => `${t.chain}Tx=${t.hash}`).join(' ');
    return `- ${d.at} ${d.kind}: ${d.summary} | ${ev} ${txs}`.trim();
  }).join('\n');
}

/**
 * Explain the latest decisions. `fallback` is the deterministic sentence to use when the model is
 * unavailable or when nothing it wrote survived the citation check.
 */
export async function explain(question: string, fallback: string, opts: { entries?: Decision[]; limit?: number } = {}): Promise<Explanation> {
  const entries = opts.entries ?? read(opts.limit ?? 12);
  const deterministic: Explanation = { text: fallback, source: 'deterministic', verified: [], stripped: [] };
  if (entries.length === 0) return deterministic;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return deterministic;

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      output_config: { effort: 'low' }, // a short rewrite of facts it is handed; nothing to reason hard about
      system: SYSTEM,
      messages: [{ role: 'user', content: `FACTS (the only values you may cite):\n${facts(entries)}\n\nQUESTION: ${question}` }],
    });
    const raw = response.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();
    const checked = check(raw, citableValues(entries));
    if (!checked.text) return { ...deterministic, stripped: checked.stripped };
    return { text: checked.text, source: 'claude', verified: checked.verified, stripped: checked.stripped };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.RateLimitError) return deterministic;
    if (e instanceof Anthropic.APIError) return deterministic;
    throw e;
  }
}
