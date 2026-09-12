/** Subscriptions, the event cursor and sent reminders. Persisted to bot/state.json (gitignored). */
import fs from 'node:fs';
import path from 'node:path';
import { botCfg } from './config.ts';

export interface ChatSubs { members: string[]; circles: string[] }
export interface BotState {
  /** Last Creditcoin block whose ledger events were delivered. */
  lastBlock: number;
  chats: Record<string, ChatSubs>;
  /** `${circleId}:${round}:${member}` → reminder already sent for that round. */
  reminded: Record<string, true>;
}

export function loadState(file = botCfg.stateFile): BotState {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<BotState>;
    return { lastBlock: s.lastBlock ?? 0, chats: s.chats ?? {}, reminded: s.reminded ?? {} };
  } catch {
    return { lastBlock: 0, chats: {}, reminded: {} };
  }
}

export function saveState(s: BotState, file = botCfg.stateFile) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
}

export const subs = (s: BotState, chatId: string): ChatSubs => (s.chats[chatId] ??= { members: [], circles: [] });

/** Chats that should hear about an event touching `member` (any of them) or `circleId`. */
export function watchersOf(s: BotState, circleId: string | undefined, members: string[]): string[] {
  const want = members.map((m) => m.toLowerCase());
  return Object.entries(s.chats)
    .filter(([, c]) => (circleId !== undefined && c.circles.includes(circleId)) || c.members.some((m) => want.includes(m.toLowerCase())))
    .map(([id]) => id);
}
