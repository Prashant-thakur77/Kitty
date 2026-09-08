/**
 * Kitty Steward · decision log.
 *
 * Every decision the steward makes is written here with the state it saw and what it did about it.
 * The log is the audit trail: Layer 3's explanations must cite entries from it, and a reader can
 * check any entry against the chain because each one carries block heights and transaction hashes.
 */
import fs from 'node:fs';
import path from 'node:path';

// Deliberately does not import ../config.ts: the steward's decision layers must load without any
// chain configuration, so their unit tests run anywhere (and so a missing RPC URL can never take
// the log down with it).
const ROOT = path.resolve(import.meta.dirname, '../../..');

export interface Decision {
  at: string;
  kind: 'prove' | 'wait' | 'close' | 'payout' | 'confirm' | 'skip' | 'error';
  summary: string;
  /** Only numbers and hashes that came from chain state. Layer 3 may not cite anything else. */
  evidence: Record<string, unknown>;
  /** Transactions this decision produced, so the claim can be checked. */
  txs?: { chain: 'source' | 'creditcoin'; hash: string }[];
}

const FILE = path.join(ROOT, 'worker', process.env.STEWARD_LOG_FILE ?? 'steward.local.json');
const MAX = 500;

export function record(d: Omit<Decision, 'at'>): Decision {
  const entry: Decision = { at: new Date().toISOString(), ...d };
  let all: Decision[] = [];
  try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { all = []; }
  all.push(entry);
  fs.writeFileSync(FILE, JSON.stringify(all.slice(-MAX), null, 1));
  return entry;
}

export function read(limit = 50): Decision[] {
  try { return (JSON.parse(fs.readFileSync(FILE, 'utf8')) as Decision[]).slice(-limit).reverse(); } catch { return []; }
}

/** Every value a citation may legally reference, flattened for the validator. */
export function citableValues(entries: Decision[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    for (const v of Object.values(e.evidence)) if (v !== undefined && v !== null) out.add(String(v).toLowerCase());
    for (const t of e.txs ?? []) out.add(t.hash.toLowerCase());
  }
  return out;
}
