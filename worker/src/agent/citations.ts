/**
 * Kitty Steward · Layer 3 guard — the citation validator.
 *
 * Layer 3 is a language model, and a language model can be wrong or be talked into being wrong.
 * So it is not allowed to state a fact unless it cites one, and every citation is checked against
 * the decision log — which is itself derived from chain state — before a word reaches the screen.
 *
 * The contract with the model is a marker: every number, address or hash it states must be wrapped
 * as [[value]]. This module then does three things:
 *   1. every [[value]] must appear in the allowed set, or the sentence carrying it is removed;
 *   2. any sentence with an *uncited* figure is removed too, so nothing sneaks past unmarked;
 *   3. what survives is rendered with the markers stripped.
 *
 * Pure and synchronous, so it is unit-tested without a network or an API key.
 */

export interface Checked {
  /** Text safe to show: only sentences whose every figure was cited and verified. */
  text: string;
  /** Citations that matched the allowed set. */
  verified: string[];
  /** Sentences removed, with the reason, so the failure is visible rather than silent. */
  stripped: { sentence: string; reason: 'unverifiable citation' | 'uncited figure'; value: string }[];
}

const CITATION = /\[\[([^\]]+)\]\]/g;
/** A "figure": any hex blob (address, hash, query id) or any number. State a figure, cite it. */
const FIGURE = /0x[0-9a-fA-F]{6,}|\d[\d,_.]*/g;

const norm = (v: string) => v.trim().toLowerCase().replace(/[,_\s]/g, '');

/** A citation matches if the allowed set holds it exactly, or holds a hash it is a prefix of. */
function matches(value: string, allowed: Set<string>): boolean {
  const v = norm(value);
  if (!v) return false;
  if (allowed.has(v)) return true;
  // Hex is matched only as a hash prefix, and never falls through to the numeric rule below:
  // stripping non-digits from 0xdeadbeef… leaves "0", which almost any log contains.
  if (/^0x[0-9a-f]*$/.test(v)) {
    if (v.length < 10) return false;
    for (const a of allowed) if (a.startsWith(v)) return true;
    return false;
  }
  // "11,656,295 tUSD" style: the number carries a unit the log stores without one.
  const bare = v.replace(/[^\d.]/g, '');
  return bare.length > 0 && bare === v.replace(/[a-z%$ ]/g, '') && allowed.has(bare);
}

/** Split on sentence ends without eating decimals or hex. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(“"']|\[\[)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Keep only what the chain can back.
 * @param text     the model's answer, with claims marked as [[value]]
 * @param allowed  every value the decision log actually contains (see agent/log.ts citableValues)
 */
export function check(text: string, allowed: Set<string>): Checked {
  const verified: string[] = [];
  const stripped: Checked['stripped'] = [];
  const kept: string[] = [];

  for (const sentence of sentences(text)) {
    const cites = [...sentence.matchAll(CITATION)].map((m) => m[1]);
    const bad = cites.find((c) => !matches(c, allowed));
    if (bad !== undefined) {
      stripped.push({ sentence, reason: 'unverifiable citation', value: bad });
      continue;
    }
    // Any figure outside a [[…]] marker is an unbacked claim, even if it happens to be true.
    const outside = sentence.replace(CITATION, ' ');
    const loose = outside.match(FIGURE);
    if (loose) {
      stripped.push({ sentence, reason: 'uncited figure', value: loose[0] });
      continue;
    }
    verified.push(...cites);
    kept.push(sentence.replace(CITATION, (_, v: string) => v.trim()));
  }

  return { text: kept.join(' '), verified, stripped };
}

/** The instruction the model is held to. Kept here so the rule and its enforcement live together. */
export const CITATION_RULE = [
  'Every number, address, block height, transaction hash and query id you state MUST be wrapped in double square brackets, like [[11656295]] or [[0xabc123…]].',
  'You may only cite values that appear in the FACTS below. Never state a figure that is not in FACTS, cited or otherwise.',
  'If you cannot support a sentence with a cited fact, leave the sentence out.',
].join(' ');
