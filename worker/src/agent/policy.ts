/**
 * Kitty Steward · Layer 2 — deterministic decisions.
 *
 * The real choices in Kitty are economic and temporal, and they have right answers, so no model is
 * involved here. Everything in this file is a pure function of observed state: what is pending, how
 * far the attestation frontier has moved, and how close each payment is to the grace window that
 * decides whether its owner is recorded as paid or as missing.
 *
 * Layer 3 (the explainer) reads these decisions and their inputs; it never makes them.
 */

/** One payment waiting to be proven. */
export interface PendingPayment {
  txHash: string;
  member: string;
  circleId: bigint;
  round: number;
  /** Source-chain block that contained the payment. */
  block: number;
  /** Source-chain block after which this member is recorded as missing (deadline + grace). */
  closeHeight: number;
  /** Source-chain block at or before which the payment still counts as on time. */
  deadlineHeight: number;
  /** Attestcoin chain key of the circle this payment belongs to. */
  chainKey: number;
  /** Members in the circle, used to know when a round is complete. */
  circleSize: number;
  seenAt: number;
}

export interface Frontier {
  /** Highest source-chain block attested on Creditcoin. */
  attestedHeight: number;
  /** Head of the source chain. */
  sourceHead: number;
}

export type BatchReason =
  | 'full'            // ten queries, the protocol maximum for one continuity proof
  | 'round-complete'  // every member of a circle has paid; proving now closes the round
  | 'deadline-risk'   // a payment is close to its grace window; waiting could cost 120 score points
  | 'waited'          // the batching window elapsed
  | 'forced';         // caller asked for a single pass

export interface BatchDecision {
  act: boolean;
  chainKey: number;
  /** Payments chosen for this call, most urgent first, never more than MAX_BATCH. */
  batch: PendingPayment[];
  reason: BatchReason | 'wait';
  /** Human-facing, and the input Layer 3 must cite rather than invent. */
  evidence: Record<string, number | string | boolean>;
}

/** Attestcoin verifies at most ten queries under one shared continuity proof. */
export const MAX_BATCH = 10;
/**
 * The Proof Builder batch endpoint rejects spans of 1000+ blocks with BatchSpanTooLarge (verified
 * against prover.cc3-testnet); leftovers go in a later call.
 */
export const MAX_BATCH_RANGE = 1000;
/** Prove this many source blocks before the grace window closes rather than wait for a fuller batch. */
export const URGENT_BLOCKS = 24;

/** Payments that cannot be proven yet, because their block is not attested. */
export const provable = (p: PendingPayment, f: Frontier) => p.block <= f.attestedHeight;

/** Blocks of slack before this payment's owner is recorded as missing. */
export const slack = (p: PendingPayment, f: Frontier) => p.closeHeight - Math.max(f.attestedHeight, f.sourceHead);

/**
 * Choose what to prove next.
 *
 * Batching is worth real money: one continuity proof covers up to ten payments, which measured 24%
 * cheaper than three single proofs on the live precompile. But a payment that misses its grace
 * window costs its owner 120 score points, which is worth far more than the gas. So urgency wins
 * over thrift, and thrift wins over impatience.
 */
export function decideBatch(pending: PendingPayment[], frontier: Frontier, opts: { waitMs: number; now?: number; force?: boolean }): BatchDecision {
  const now = opts.now ?? Date.now();
  const ready = pending.filter((p) => provable(p, frontier));
  if (ready.length === 0) {
    return {
      act: false, chainKey: 0, batch: [], reason: 'wait',
      evidence: { pending: pending.length, provable: 0, attestedHeight: frontier.attestedHeight, waitingOnAttestation: pending.length },
    };
  }

  // One call carries one chain key: group, then serve the group with the most urgent payment.
  const groups = new Map<number, PendingPayment[]>();
  for (const p of ready) groups.set(p.chainKey, [...(groups.get(p.chainKey) ?? []), p]);
  let chainKey = 0;
  let best: PendingPayment[] = [];
  let bestSlack = Number.POSITIVE_INFINITY;
  for (const [key, group] of groups) {
    const s = Math.min(...group.map((p) => slack(p, frontier)));
    if (s < bestSlack || (s === bestSlack && group.length > best.length)) { chainKey = key; best = group; bestSlack = s; }
  }

  // Most urgent first, then oldest, so a full batch always carries the payments that matter most.
  const sorted = [...best].sort((a, b) => slack(a, frontier) - slack(b, frontier) || a.block - b.block);
  // Greedy fill: at most ten queries, and never a span the Proof Builder would refuse. Whatever is
  // left behind is still pending and goes in a later call.
  const batch: PendingPayment[] = [];
  for (const p of sorted) {
    if (batch.length >= MAX_BATCH) break;
    if (batch.length) {
      const lo = Math.min(p.block, ...batch.map((b) => b.block));
      const hi = Math.max(p.block, ...batch.map((b) => b.block));
      if (hi - lo >= MAX_BATCH_RANGE) continue;
    }
    batch.push(p);
  }

  // A round counts as completed only if this batch carries a payment from every member of it:
  // the number goes into the citable decision log, so it must describe this call, not the backlog.
  const completes = [...new Set(batch.map((p) => `${p.circleId}:${p.round}`))].filter((key) => {
    const [cid, r] = key.split(':');
    const inRound = batch.filter((p) => String(p.circleId) === cid && p.round === Number(r));
    return new Set(inRound.map((p) => p.member.toLowerCase())).size >= inRound[0].circleSize;
  });
  const circles = new Set(batch.map((p) => String(p.circleId))).size;
  const oldestWaitMs = now - Math.min(...batch.map((p) => p.seenAt));

  let reason: BatchReason | 'wait' = 'wait';
  if (opts.force) reason = 'forced';
  else if (batch.length >= MAX_BATCH) reason = 'full';
  else if (completes.length > 0) reason = 'round-complete';
  else if (bestSlack <= URGENT_BLOCKS) reason = 'deadline-risk';
  else if (oldestWaitMs >= opts.waitMs) reason = 'waited';

  return {
    act: reason !== 'wait',
    chainKey,
    batch,
    reason,
    evidence: {
      chainKey,
      queries: batch.length,
      circles,
      attestedHeight: frontier.attestedHeight,
      sourceHead: frontier.sourceHead,
      blocksOfSlack: Number.isFinite(bestSlack) ? bestSlack : -1,
      roundsCompleted: completes.length,
      blockSpan: Math.max(...batch.map((p) => p.block)) - Math.min(...batch.map((p) => p.block)),
      leftBehind: sorted.length - batch.length,
      waitedSeconds: Math.round(oldestWaitMs / 1000),
      stillWaitingForAttestation: pending.length - ready.length,
    },
  };
}

/** One-line rationale. Layer 3 may rephrase this, but every number here comes from chain state. */
export function explainBatch(d: BatchDecision): string {
  const e = d.evidence;
  if (!d.act) {
    return e.provable === 0
      ? `waiting: ${e.pending} payment(s) not yet attested (frontier at source block ${e.attestedHeight})`
      : `waiting: ${e.queries} query(ies) ready, ${e.blocksOfSlack} blocks of slack, batching for a fuller proof`;
  }
  const why = {
    full: 'the batch is full at the protocol maximum of ten queries',
    'round-complete': `${e.roundsCompleted} round(s) complete, so proving now lets them close`,
    'deadline-risk': `only ${e.blocksOfSlack} blocks before the grace window closes`,
    waited: `waited ${e.waitedSeconds}s for a fuller batch`,
    forced: 'single pass requested',
  }[d.reason as BatchReason];
  return `proving ${e.queries} payment(s) from ${e.circles} circle(s) on chain key ${e.chainKey} in one call: ${why}`;
}
