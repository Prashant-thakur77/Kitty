/**
 * Kitty Telegram bot.
 *
 *   pnpm bot                       long-polls Telegram with BOT_TOKEN
 *   pnpm bot:dry                   no token: watches the ledger and prints what it would send
 *   BOT_SIMULATE="/circle 1" …     answers the command(s) on stdout and exits (CI, demo)
 *   … --once                       one watcher tick, then exit
 *
 * The bot holds no key and trusts nothing it is told: every reply is a view call on KittyLedger,
 * KittyViewer or KittyCreditLine, every push is a ledger event with its Creditcoin transaction, and
 * the deadline reminder is driven by the attested frontier from the ChainInfo precompile.
 */
import { ethers } from 'ethers';
import { Bot, type Context } from 'grammy';
import { botCfg, requireLedger } from './config.ts';
import { loadState, saveState, subs, watchersOf, type BotState } from './state.ts';
import { attestedFrontier, circleName, head, memberPending, readCircle, readScore, scanEvents } from './chain.ts';
import { esc, formatCircle, formatEvent, formatReminder, formatScore, formatStart, formatSteward, short, type Links } from './format.ts';
import { read as readDecisions } from '../../worker/src/agent/log.ts';

const links: Links = { ccExplorer: botCfg.ccExplorer, sourceExplorer: botCfg.sourceExplorer, webAppUrl: botCfg.webAppUrl };
const once = process.argv.includes('--once');
const simulate = process.env.BOT_SIMULATE;
const log = (...a: unknown[]) => console.log(`${new Date().toISOString().slice(11, 19)}`, ...a);

interface Reply { text: string; openKitty?: boolean }
type Send = (chatId: string, r: Reply) => Promise<void>;

/* ------------------------------------------------------------------ commands */

async function handle(state: BotState, chatId: string, chatType: string, text: string): Promise<Reply> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const command = cmd.toLowerCase().replace(/@\w+$/, '');
  const argv = rest.join(' ');
  const s = subs(state, chatId);
  const parseTarget = (v: string): { member?: string; circle?: string; error?: string } => {
    const m = v.match(/^circle\s+(\d+)$/i) ?? v.match(/^#?(\d+)$/);
    if (m) return { circle: m[1] };
    if (ethers.isAddress(v)) return { member: ethers.getAddress(v) };
    return { error: 'Give a member address (0x…) or <code>circle N</code>.' };
  };

  switch (command) {
    case '/start':
    case '/help':
      return { text: formatStart(links), openKitty: chatType === 'private' || chatType === 'sim' };

    case '/watch': {
      if (!argv) return { text: 'Usage: <code>/watch 0x…</code> or <code>/watch circle 1</code>' };
      const t = parseTarget(argv);
      if (t.error) return { text: t.error };
      if (t.member && !s.members.some((m) => m.toLowerCase() === t.member!.toLowerCase())) s.members.push(t.member);
      if (t.circle && !s.circles.includes(t.circle)) s.circles.push(t.circle);
      saveState(state);
      return { text: `👀 Watching ${t.member ? `member <code>${short(t.member)}</code>` : `circle ${t.circle}`}. Every proof, missed payment, close and payout lands here, plus a reminder when a deadline is ${botCfg.reminderBlocks} attested blocks away.` };
    }

    case '/unwatch': {
      if (!argv) { s.members = []; s.circles = []; saveState(state); return { text: 'Stopped watching everything.' }; }
      const t = parseTarget(argv);
      if (t.error) return { text: t.error };
      if (t.member) s.members = s.members.filter((m) => m.toLowerCase() !== t.member!.toLowerCase());
      if (t.circle) s.circles = s.circles.filter((c) => c !== t.circle);
      saveState(state);
      return { text: `Stopped watching ${t.member ? `<code>${short(t.member)}</code>` : `circle ${t.circle}`}.` };
    }

    case '/list': {
      if (!s.members.length && !s.circles.length) return { text: 'Not watching anything. Try <code>/watch circle 1</code>.' };
      const lines = ['👀 Watching'];
      for (const c of s.circles) lines.push(`• circle ${c}${await circleName(c).then((n) => (n ? ` · ${esc(n)}` : ''))}`);
      for (const m of s.members) lines.push(`• member <code>${m}</code>`);
      return { text: lines.join('\n') };
    }

    case '/circle': {
      requireLedger();
      const id = argv.replace(/^#/, '');
      if (!/^\d+$/.test(id)) return { text: 'Usage: <code>/circle 1</code>' };
      try {
        return { text: formatCircle(await readCircle(BigInt(id)), links) };
      } catch (e) {
        return { text: `Circle ${id} is not on this ledger (${esc(errorText(e))}).` };
      }
    }

    case '/score': {
      requireLedger();
      if (!ethers.isAddress(argv)) return { text: 'Usage: <code>/score 0x…</code>' };
      return { text: formatScore(await readScore(ethers.getAddress(argv)), links) };
    }

    case '/steward':
      return { text: formatSteward(readDecisions(5), links) };

    default:
      return { text: `Unknown command. ${formatStart(links)}` };
  }
}

const errorText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  return m.includes('UnknownCircle') ? 'UnknownCircle' : m.split('\n')[0].slice(0, 120);
};

/* ------------------------------------------------------------------ watcher */

async function tick(state: BotState, send: Send) {
  const to = await head();
  if (!state.lastBlock) {
    const deploy = Math.min(botCfg.deployBlock, to);
    state.lastBlock = Number.isFinite(botCfg.lookbackBlocks) ? Math.max(deploy, to - botCfg.lookbackBlocks) : deploy;
  }
  if (to > state.lastBlock) {
    const events = await scanEvents(state.lastBlock + 1, to);
    for (const e of events) {
      const a = e.args;
      const who = [a.member, a.recipient, ...((a.members as string[] | undefined) ?? [])].filter((x): x is string => typeof x === 'string');
      const circleId = a.circleId !== undefined ? String(a.circleId) : undefined;
      // BatchVerified carries no circle: it goes to every chat that watches anything.
      const chats = e.name === 'BatchVerified' ? Object.keys(state.chats).filter((c) => state.chats[c].members.length + state.chats[c].circles.length > 0) : watchersOf(state, circleId, who);
      const text = formatEvent(e, links, await circleName(a.circleId));
      if (botCfg.dryRun) log(`event ${e.name} @ ${e.block} → ${chats.length ? chats.join(',') : 'no watchers'}\n${text}\n`);
      for (const chat of chats) await send(chat, { text });
    }
    state.lastBlock = to;
    saveState(state);
  }
  await remind(state, send);
}

/** One reminder per (circle, round, member) once the attested frontier is within reminderBlocks of the deadline. */
async function remind(state: BotState, send: Send) {
  const frontier = await attestedFrontier();
  if (!frontier) return;
  const members = new Map<string, { address: string; chats: string[] }>(); // lowercased member → chats
  for (const [chat, s] of Object.entries(state.chats)) for (const m of s.members) {
    const e = members.get(m.toLowerCase()) ?? { address: m, chats: [] };
    e.chats.push(chat);
    members.set(m.toLowerCase(), e);
  }
  for (const [member, { address, chats }] of members) {
    let pending;
    try { pending = await memberPending(member); } catch { continue; }
    for (const { circle } of pending) {
      const key = `${circle.id}:${circle.currentRound}:${member}`;
      if (state.reminded[key] || circle.deadline - frontier.height > botCfg.reminderBlocks) continue;
      const text = formatReminder({ member: address, circleId: circle.id, name: circle.name, round: circle.currentRound, deadline: circle.deadline, attested: frontier.height, contribution: circle.contribution }, links);
      if (botCfg.dryRun) log(`reminder ${key} → ${chats.join(',')}\n${text}\n`);
      for (const chat of chats) await send(chat, { text });
      state.reminded[key] = true;
      saveState(state);
    }
  }
}

/* ------------------------------------------------------------------ transports */

const keyboard = (chatType: string) => ({
  inline_keyboard: [[chatType === 'private' ? { text: '🐱 Open Kitty', web_app: { url: botCfg.webAppUrl } } : { text: '🐱 Open Kitty', url: botCfg.webAppUrl }]],
});

async function main() {
  const state = loadState();
  log(`kitty bot · ${botCfg.dryRun ? 'DRY RUN (no BOT_TOKEN)' : 'live'} · ${botCfg.mode} · ledger ${botCfg.ledger || 'unset'} · ${botCfg.creditcoinRpc}`);

  if (simulate) {
    // CI and demo mode: run the commands as chat "sim", print the replies, exit.
    for (const line of simulate.split(';').map((l) => l.trim()).filter(Boolean)) {
      const r = await handle(state, 'sim', 'sim', line);
      console.log(`\n> ${line}\n${r.text}${r.openKitty ? `\n[button: Open Kitty → ${botCfg.webAppUrl}]` : ''}`);
    }
    if (!once) return;
  }

  if (botCfg.dryRun) {
    const send: Send = async (chat, r) => { log(`→ ${chat}: (sent)${r.openKitty ? ' + Open Kitty button' : ''}`); };
    // A demo subscription so the dry run has someone to deliver to: BOT_WATCH="circle 1; 0xabc…".
    for (const w of (process.env.BOT_WATCH ?? '').split(';').map((x) => x.trim()).filter(Boolean)) log((await handle(state, 'dry', 'sim', `/watch ${w}`)).text);
    await tick(state, send);
    if (once) return;
    setInterval(() => tick(state, send).catch((e) => log('tick failed:', errorText(e))), botCfg.pollMs);
    log(`watching ${botCfg.ledger} every ${botCfg.pollMs / 1000}s · ctrl-c to stop`);
    return;
  }

  const bot = new Bot(botCfg.token);
  const send: Send = async (chatId, r) => {
    try {
      await bot.api.sendMessage(chatId, r.text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(r.openKitty ? { reply_markup: keyboard('private') } : {}) });
    } catch (e) {
      log(`send to ${chatId} failed: ${errorText(e)}`);
      if (/blocked|chat not found|kicked/i.test(errorText(e))) { delete state.chats[chatId]; saveState(state); }
    }
  };
  bot.on('message:text', async (ctx: Context) => {
    const text = ctx.message?.text ?? '';
    if (!text.startsWith('/')) return;
    const chatId = String(ctx.chat!.id);
    let r: Reply;
    try { r = await handle(state, chatId, ctx.chat!.type, text); } catch (e) { r = { text: `Something went wrong: ${esc(errorText(e))}` }; }
    await ctx.reply(r.text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(r.openKitty ? { reply_markup: keyboard(ctx.chat!.type) } : {}) });
  });
  await bot.api.setMyCommands([
    { command: 'start', description: 'What Kitty is, and the Mini App' },
    { command: 'circle', description: '/circle 1 · live circle state with proofs' },
    { command: 'score', description: '/score 0x… · Kitty Score and credit limit' },
    { command: 'watch', description: '/watch 0x… or /watch circle 1' },
    { command: 'unwatch', description: 'Stop watching' },
    { command: 'list', description: 'What this chat watches' },
    { command: 'steward', description: 'Last 5 steward decisions' },
  ]).catch((e) => log('setMyCommands failed:', errorText(e)));
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Open Kitty', web_app: { url: botCfg.webAppUrl } } }).catch((e) => log('menu button failed:', errorText(e)));

  await tick(state, send).catch((e) => log('tick failed:', errorText(e)));
  if (once) return;
  setInterval(() => tick(state, send).catch((e) => log('tick failed:', errorText(e))), botCfg.pollMs);
  bot.catch((e) => log('bot error:', errorText(e.error)));
  log(`long-polling Telegram as ${botCfg.botUrl} · watching ${botCfg.ledger} every ${botCfg.pollMs / 1000}s`);
  await bot.start();
}

main().catch((e) => { console.error(e); process.exit(1); });
