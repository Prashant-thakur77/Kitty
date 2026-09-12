/** Read-only chain access: circle state, scores, and the ledger event scan. */
import { ethers } from 'ethers';
import { botCfg, ccProvider, chainInfo, credit, ledger, ledgerInterface, viewer } from './config.ts';
import { WATCHED_EVENTS, type CircleState, type LedgerEvent, type MemberRow, type ScoreState } from './format.ts';

const ZERO32 = ethers.ZeroHash;
type MemberStatus = MemberRow['status'];

export async function attestedFrontier(): Promise<{ height: number; hash: string } | undefined> {
  try {
    const r = await chainInfo.get_latest_attestation_height_and_hash(botCfg.chainKey);
    return r.exists ? { height: Number(r.height), hash: String(r.hash) } : undefined;
  } catch {
    return undefined;
  }
}

export async function readCircle(id: bigint): Promise<CircleState> {
  const c = await ledger.getCircle(id);
  const round = Number(c.currentRound);
  const members = c.members as string[];
  const [rd, deadline, closeHeight, frontier, contribs, scores, received] = await Promise.all([
    ledger.getRound(id, round),
    ledger.deadlineHeight(id, round),
    ledger.closeHeight(id, round),
    attestedFrontier(),
    Promise.all(members.map((m) => ledger.getContribution(id, round, m))),
    Promise.all(members.map((m) => ledger.creditScore(m))),
    Promise.all(members.map((m) => ledger.receivedPot(id, m))),
  ]);
  const roundStatus = Number(rd.status);
  const rows: MemberRow[] = members.map((address, i) => {
    const cb = contribs[i];
    const status: MemberStatus = cb.queryId !== ZERO32 ? (cb.onTime ? 'proven' : 'late') : roundStatus === 0 ? 'pending' : 'missed';
    return { address, status, height: cb.queryId !== ZERO32 ? Number(cb.height) : undefined, score: Number(scores[i][0]), tier: String(scores[i][1]), received: Boolean(received[i]) };
  });
  return {
    id: String(id), name: String(c.name), status: Number(c.status), currentRound: round, rounds: members.length, roundStatus,
    contribution: BigInt(c.contribution), pot: BigInt(rd.pot), deadline: Number(deadline), closeHeight: Number(closeHeight),
    attested: frontier?.height, attestedHash: frontier?.hash, rotation: Number(c.rotation), members: rows,
    recipient: rd.recipient !== ethers.ZeroAddress ? String(rd.recipient) : undefined,
    ...pickRecipient(rows, round, Number(c.rotation)),
  };
}

/** Mirrors KittyLedger._pickRecipient on what is proven so far; tentative when nobody has paid yet. */
export function pickRecipient(rows: MemberRow[], round: number, rotation: number): { nextRecipient: string | undefined; nextRecipientTentative: boolean } {
  const n = rows.length;
  const proven = (m: MemberRow) => m.status === 'proven' || m.status === 'late';
  if (rotation === 0) {
    for (let k = 0; k < n; k++) {
      const m = rows[(round + k) % n];
      if (!m.received && proven(m)) return { nextRecipient: m.address, nextRecipientTentative: false };
    }
    for (let k = 0; k < n; k++) {
      const m = rows[(round + k) % n];
      if (!m.received && m.status === 'pending') return { nextRecipient: m.address, nextRecipientTentative: true };
    }
    return { nextRecipient: undefined, nextRecipientTentative: false };
  }
  let best: MemberRow | undefined;
  for (const m of rows) if (!m.received && proven(m) && (!best || m.score > best.score)) best = m;
  return { nextRecipient: best?.address, nextRecipientTentative: false };
}

export async function readScore(address: string): Promise<ScoreState> {
  const [[score, tier], rec] = await Promise.all([ledger.creditScore(address), ledger.getRecord(address)]);
  const out: ScoreState = {
    address, score: Number(score), tier: String(tier),
    record: { onTime: Number(rec.onTime), late: Number(rec.late), missed: Number(rec.missed), received: Number(rec.received), volume: BigInt(rec.volume) },
    circles: [],
  };
  if (credit) {
    try {
      const u = await credit.underwrite(address);
      out.credit = { limit: BigInt(u.limit), reason: String(u.reason) };
    } catch { /* credit line not deployed in this world */ }
  }
  if (viewer) {
    try {
      const d = await viewer.getMemberDashboard(address);
      const STATUS: MemberStatus[] = ['pending', 'proven', 'late', 'missed'];
      out.circles = (d.circleIds as bigint[]).map((id, i) => ({ id: String(id), name: String(d.names[i]), round: Number(d.currentRounds[i]), status: STATUS[Number(d.myStatus[i])] ?? 'pending' }));
    } catch { /* viewer not deployed */ }
  } else {
    const ids = (await ledger.getMemberCircles(address)) as bigint[];
    for (const id of ids) {
      const c = await readCircle(id);
      const me = c.members.find((m) => m.address.toLowerCase() === address.toLowerCase());
      out.circles.push({ id: c.id, name: c.name, round: c.currentRound, status: me?.status ?? 'pending' });
    }
  }
  return out;
}

const MAX_RANGE = 2_000; // public RPCs cap eth_getLogs ranges

/** Every watched ledger event in (from, to], oldest first. */
export async function scanEvents(from: number, to: number): Promise<LedgerEvent[]> {
  const out: LedgerEvent[] = [];
  for (let a = from; a <= to; a += MAX_RANGE) {
    const b = Math.min(a + MAX_RANGE - 1, to);
    const logs = await ccProvider.getLogs({ address: botCfg.ledger, fromBlock: a, toBlock: b });
    for (const l of logs) {
      const parsed = (() => { try { return ledgerInterface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } })();
      if (!parsed || !WATCHED_EVENTS.includes(parsed.name)) continue;
      const args: Record<string, unknown> = {};
      parsed.fragment.inputs.forEach((inp, i) => { args[inp.name] = parsed.args[i]; });
      out.push({ name: parsed.name, args, tx: l.transactionHash, block: l.blockNumber });
    }
  }
  return out;
}

export const head = () => ccProvider.getBlockNumber();

const names = new Map<string, string>();
export async function circleName(id: unknown): Promise<string | undefined> {
  if (id === undefined) return undefined;
  const k = String(id);
  if (!names.has(k)) {
    try { names.set(k, String((await ledger.getCircle(BigInt(k))).name)); } catch { return undefined; }
  }
  return names.get(k);
}

/** Active circles containing `member`, with the member's current-round status: the reminder's input. */
export async function memberPending(member: string): Promise<{ circle: CircleState; row: MemberRow }[]> {
  const ids = (await ledger.getMemberCircles(member)) as bigint[];
  const out: { circle: CircleState; row: MemberRow }[] = [];
  for (const id of ids) {
    const circle = await readCircle(id);
    if (circle.status !== 0 || circle.roundStatus !== 0) continue;
    const row = circle.members.find((m) => m.address.toLowerCase() === member.toLowerCase());
    if (row && row.status === 'pending') out.push({ circle, row });
  }
  return out;
}
