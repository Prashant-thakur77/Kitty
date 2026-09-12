/**
 * Message formatting. Pure functions: no chain, no Telegram, so `pnpm test:bot` runs anywhere.
 * Output is Telegram HTML (parse_mode: 'HTML'); everything user-controlled goes through esc().
 * Event wording mirrors web/src/hooks.ts describe() so the feed reads the same in both places.
 */

export interface Links { ccExplorer: string; sourceExplorer: string; webAppUrl: string }

export const esc = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const short = (v: unknown) => (typeof v === 'string' && v.startsWith('0x') && v.length === 42 ? `${v.slice(0, 6)}…${v.slice(-4)}` : String(v));
export const usd6 = (v: unknown) => (Number(v as bigint) / 1e6).toLocaleString('en-US');
export const num = (v: unknown) => Number(v).toLocaleString('en-US');
/** Human round label: 1-indexed; the on-chain index is appended as `(rN)` like the dashboard feed. */
const r1 = (v: unknown) => Number(v) + 1;
const att = (h: unknown) => (typeof h === 'bigint' ? h > 0n : Number(h ?? 0) > 0);

const link = (href: string, text: string) => (href ? `<a href="${href}">${esc(text)}</a>` : `<code>${esc(text)}</code>`);
export const ccTx = (l: Links, hash: string) => link(l.ccExplorer && `${l.ccExplorer}/tx/${hash}`, `${hash.slice(0, 10)}…`);
export const ccAddr = (l: Links, addr: string) => link(l.ccExplorer && `${l.ccExplorer}/address/${addr}`, short(addr));
export const srcTx = (l: Links, hash: string) => link(l.sourceExplorer && `${l.sourceExplorer}/tx/${hash}`, `${hash.slice(0, 10)}…`);
export const srcBlock = (l: Links, h: unknown) => link(l.sourceExplorer && `${l.sourceExplorer}/block/${h}`, num(h));
export const circleUrl = (l: Links, id: unknown) => `${l.webAppUrl}circle/${id}`;
export const scoreUrl = (l: Links, addr: string) => `${l.webAppUrl}score/${addr}`;

export type EventArgs = Record<string, unknown>;
export interface LedgerEvent { name: string; args: EventArgs; tx: string; block: number }

const ICON: Record<string, string> = {
  ContributionRecorded: '✅', ContributionMissed: '❌', BatchVerified: '🔏', RoundClosed: '🔒', RoundOpened: '🔔', PayoutConfirmed: '💸',
  CircleCreated: '🐱', CircleCompleted: '🏁', InviteRedeemed: '🤝',
};
export const WATCHED_EVENTS = Object.keys(ICON);

/** One line, same wording as the dashboard feed. */
export function describe(name: string, a: EventArgs): string {
  switch (name) {
    case 'ContributionRecorded': return `Proven: ${short(a.member)} paid ${usd6(a.amount)} tUSD for round ${r1(a.round)} at Sepolia block ${a.sourceHeight} (${a.onTime ? 'on time' : 'LATE'}) (r${a.round})`;
    case 'BatchVerified': return `0x0FD2 verified ${a.count} tx in ONE call · Sepolia blocks ${a.fromHeight}–${a.toHeight}`;
    case 'ContributionMissed': return `Missed: ${short(a.member)} did not pay round ${r1(a.round)} by attested block ${a.deadlineHeight}${att(a.attestedHeight) ? ` · proven by attestation @ ${a.attestedHeight} ${String(a.attestedHash ?? '').slice(0, 10)}…` : ''} (r${a.round})`;
    case 'RoundClosed': return `Round ${r1(a.round)} closed → ${short(a.recipient)} receives ${usd6(a.pot)} tUSD (${a.missedCount} missed)${att(a.attestedHeight) ? ` · attested @ ${a.attestedHeight}` : ''} (r${a.round})`;
    case 'RoundOpened': return `Round ${r1(a.round)} open · pay by Sepolia block ${a.deadlineHeight} (r${a.round})`;
    case 'PayoutConfirmed': return `Payout proven: ${short(a.recipient)} received ${usd6(a.amount)} tUSD on Ethereum`;
    case 'CircleCreated': return `Circle "${a.name}" created · ${(a.members as string[]).length} members · ${usd6(a.contribution)} tUSD/round`;
    case 'CircleCompleted': return 'Circle completed — every member has received a pot';
    case 'InviteRedeemed': return `${short(a.member)} joined by invite`;
    default: return name;
  }
}

/** The push message for one ledger event: the feed line, the circle, and the proof links. */
export function formatEvent(e: LedgerEvent, l: Links, circleName?: string): string {
  const a = e.args;
  const icon = ICON[e.name] ?? '•';
  const head = `${icon} <b>${esc(describe(e.name, a))}</b>`;
  const lines: string[] = [head];
  if (a.circleId !== undefined) lines.push(`Circle ${a.circleId}${circleName ? ` · ${esc(circleName)}` : ''} · <a href="${circleUrl(l, a.circleId)}">open</a>`);
  const proof: string[] = [`Creditcoin tx ${ccTx(l, e.tx)}`];
  if (typeof a.queryId === 'string' && /^0x0*$/.test(a.queryId) === false) proof.push(`query id <code>${a.queryId.slice(0, 10)}…</code>`);
  if (a.sourceHeight !== undefined) proof.push(`Sepolia block ${srcBlock(l, a.sourceHeight)}`);
  if (e.name === 'BatchVerified') proof.push(`blocks ${srcBlock(l, a.fromHeight)}–${srcBlock(l, a.toHeight)}`);
  if (e.name === 'RoundOpened') proof.push(`deadline ${srcBlock(l, a.deadlineHeight)}`);
  lines.push(proof.join(' · '));
  return lines.join('\n');
}

export interface MemberRow {
  address: string;
  status: 'proven' | 'late' | 'pending' | 'missed';
  height?: number;
  score: number;
  tier: string;
  received: boolean;
}
export interface CircleState {
  id: string;
  name: string;
  status: number; // 0 Active, 1 Completed
  currentRound: number;
  rounds: number;
  roundStatus: number; // 0 Open, 1 Closed, 2 Paid
  contribution: bigint;
  pot: bigint;
  deadline: number;
  closeHeight: number;
  attested: number | undefined;
  attestedHash?: string;
  rotation: number; // 0 Fixed, 1 ByScore
  members: MemberRow[];
  nextRecipient: string | undefined;
  nextRecipientTentative: boolean;
  recipient?: string; // set once the round is closed
}

const STATUS_ICON = { proven: '✅', late: '🕒', pending: '⏳', missed: '❌' } as const;
const ROUND_STATUS = ['Open', 'Closed', 'Paid'];

export function formatCircle(c: CircleState, l: Links): string {
  const paid = c.members.filter((m) => m.status === 'proven' || m.status === 'late').length;
  const lines: string[] = [];
  lines.push(`🐱 <b>Circle ${c.id} · ${esc(c.name)}</b>${c.status === 1 ? ' · completed' : ''}`);
  lines.push(`Round ${c.currentRound + 1} of ${c.rounds} · ${ROUND_STATUS[c.roundStatus] ?? c.roundStatus} · ${paid}/${c.members.length} proven · pot ${usd6(c.pot)} tUSD · ${usd6(c.contribution)} tUSD each`);
  const toGo = c.attested === undefined ? undefined : c.deadline - c.attested;
  const clock = c.attested === undefined
    ? 'attested frontier unknown'
    : toGo! > 0
      ? `attested frontier ${num(c.attested)} · ${num(toGo)} blocks to go`
      : `attested frontier ${num(c.attested)} · deadline attested; closes once block ${num(c.closeHeight)} is attested`;
  lines.push(`Deadline Sepolia block ${srcBlock(l, c.deadline)} · ${clock}`);
  lines.push('');
  for (const m of c.members) {
    const st = m.status === 'proven' ? `proven @ ${num(m.height)} (on time)` : m.status === 'late' ? `proven @ ${num(m.height)} (late)` : m.status === 'missed' ? 'missed' : 'pending';
    lines.push(`${STATUS_ICON[m.status]} ${ccAddr(l, m.address)} · ${st} · score ${m.score} ${esc(m.tier)}${m.received ? ' · received' : ''}`);
  }
  lines.push('');
  if (c.roundStatus !== 0 && c.recipient) lines.push(`Recipient: ${ccAddr(l, c.recipient)}${c.roundStatus === 2 ? ' · payout proven back' : ' · payout pending'}`);
  else if (c.nextRecipient) lines.push(`Next recipient${c.nextRecipientTentative ? ' (if they pay)' : ''}: ${ccAddr(l, c.nextRecipient)} · ${c.rotation === 1 ? 'by proven score' : 'fixed order'}`);
  else lines.push(`Next recipient: decided at close · ${c.rotation === 1 ? 'by proven score' : 'fixed order'}`);
  lines.push(`<a href="${circleUrl(l, c.id)}">Open in Kitty</a>`);
  return lines.join('\n');
}

export interface ScoreState {
  address: string;
  score: number;
  tier: string;
  record: { onTime: number; late: number; missed: number; received: number; volume: bigint };
  credit?: { limit: bigint; reason: string };
  circles: { id: string; name: string; round: number; status: 'proven' | 'late' | 'pending' | 'missed' }[];
}

export function formatScore(s: ScoreState, l: Links): string {
  const r = s.record;
  const lines = [
    `🏅 <b>Kitty Score ${s.score} · tier ${esc(s.tier)}</b> · ${ccAddr(l, s.address)}`,
    `${r.onTime} on time · ${r.late} late · ${r.missed} missed · ${r.received} pots received · ${usd6(r.volume)} tUSD proven volume`,
  ];
  if (s.credit) lines.push(`Credit limit ${usd6(s.credit.limit)} kUSD · ${esc(s.credit.reason)}`);
  if (s.circles.length) {
    lines.push('');
    for (const c of s.circles) lines.push(`${STATUS_ICON[c.status]} Circle ${c.id} · ${esc(c.name)} · round ${c.round + 1} · ${c.status}`);
  } else lines.push('No circles yet.');
  lines.push('Every number above is derived only from proven transactions and attested deadlines.');
  lines.push(`<a href="${scoreUrl(l, s.address)}">Open in Kitty</a>`);
  return lines.join('\n');
}

export interface Decision { at: string; kind: string; summary: string; evidence: Record<string, unknown>; txs?: { chain: string; hash: string }[] }
const KIND_ICON: Record<string, string> = { prove: '🔏', wait: '⏸', close: '🔒', payout: '💸', confirm: '✅', skip: '↷', error: '⚠️' };

export function formatSteward(decisions: Decision[], l: Links): string {
  if (!decisions.length) return '🤖 No steward decisions logged yet.';
  const lines = ['🤖 <b>Kitty Steward · last decisions</b>'];
  for (const d of decisions) {
    const when = d.at.replace('T', ' ').slice(0, 19);
    const cc = d.txs?.find((t) => t.chain === 'creditcoin');
    const src = d.txs?.find((t) => t.chain === 'source');
    const tx = cc ? ccTx(l, cc.hash) : src ? srcTx(l, src.hash) : '';
    lines.push(`${KIND_ICON[d.kind] ?? '•'} <code>${when}</code> ${esc(d.summary)}${tx ? ` · ${tx}` : ''}`);
  }
  lines.push(`<a href="${l.webAppUrl}steward">Full log and cited explanation</a>`);
  return lines.join('\n');
}

export function formatReminder(o: { member: string; circleId: string; name: string; round: number; deadline: number; attested: number; contribution: bigint }, l: Links): string {
  const left = o.deadline - o.attested;
  return [
    `⏰ <b>Reminder: ${short(o.member)} has not paid round ${o.round + 1} of ${esc(o.name)}</b>`,
    `${usd6(o.contribution)} tUSD due by Sepolia block ${srcBlock(l, o.deadline)} · attested frontier ${num(o.attested)} · ${left > 0 ? `${num(left)} blocks left` : 'deadline reached, 64-block grace running'}`,
    'A missed round costs 120 Kitty Score points and is recorded on Creditcoin against the attestation that proved the deadline.',
    `<a href="${circleUrl(l, o.circleId)}">Pay in Kitty</a>`,
  ].join('\n');
}

export function formatStart(l: Links): string {
  return [
    '🐱 <b>Kitty</b> — savings circles where every payment is proven, not promised.',
    'Members pay stablecoins into a vault on Ethereum; the Attestcoin Protocol proves each payment to Creditcoin, where the rules, the rotation and your Kitty Score live.',
    `No treasurer, no oracle, no bridge. Dashboard: ${l.webAppUrl}`,
    '',
    '/circle 1 — live state of a circle',
    '/score 0x… — Kitty Score, counters, credit limit',
    '/watch 0x… or /watch circle 1 — get every proof and a deadline reminder here',
    '/unwatch, /list, /steward',
  ].join('\n');
}

export const HELP = formatStart;
