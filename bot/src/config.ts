/**
 * Kitty Telegram bot · configuration.
 *
 * Reuses the worker's chain configuration (RPC URLs, ledger address, KITTY_ENV_FILE overlay, the
 * ChainInfo precompile binding) so the bot and the steward always read the same world. The bot has
 * no key of its own: everything it does is a view call or an event read.
 */
import path from 'node:path';
import { ethers } from 'ethers';
import { cfg as worker, ccProvider, chainInfo, ROOT } from '../../worker/src/config.ts';
import ledgerAbi from '../../worker/abi/KittyLedger.json' with { type: 'json' };
import viewerAbi from '../../worker/abi/KittyViewer.json' with { type: 'json' };
import creditAbi from '../../worker/abi/KittyCreditLine.json' with { type: 'json' };

export const DEFAULT_WEBAPP_URL = 'https://prashant-thakur77.github.io/Kitty/';
export const DEFAULT_BOT_URL = 'https://t.me/KittyCirclesBot';

export const botCfg = {
  token: process.env.BOT_TOKEN ?? '',
  dryRun: !process.env.BOT_TOKEN || process.env.BOT_DRY_RUN === '1',
  // Inside Telegram the dashboard loads its SDK when opened with ?tg=1, so the Mini App URL carries it.
  webAppUrl: process.env.BOT_WEBAPP_URL ?? DEFAULT_WEBAPP_URL + '?tg=1',
  pollMs: Number(process.env.BOT_POLL_MS ?? 15_000),
  /** Blocks scanned on the very first start, when state.json has no cursor yet ('all' = from the ledger's deploy block, or genesis). */
  lookbackBlocks: process.env.BOT_LOOKBACK_BLOCKS === 'all' || (!process.env.BOT_LOOKBACK_BLOCKS && worker.mode === 'local') ? Infinity : Number(process.env.BOT_LOOKBACK_BLOCKS ?? 2_000),
  // The root .env's LEDGER_DEPLOY_BLOCK is a testnet number; a local anvil world starts at genesis.
  deployBlock: worker.mode === 'local' ? 0 : Number(process.env.LEDGER_DEPLOY_BLOCK ?? 0),
  /** Reminder fires when the attested frontier is within this many Sepolia blocks of the deadline. */
  reminderBlocks: Number(process.env.BOT_REMINDER_BLOCKS ?? 40),
  stateFile: path.resolve(ROOT, process.env.BOT_STATE_FILE ?? 'bot/state.json'),
  mode: worker.mode,
  creditcoinRpc: worker.creditcoinRpc,
  botUrl: process.env.BOT_URL ?? DEFAULT_BOT_URL,
  chainKey: worker.chainKey,
  ledger: worker.ledger,
  viewer: process.env.KITTY_VIEWER_ADDRESS ?? '',
  credit: process.env.KITTY_CREDIT_ADDRESS ?? '',
  // Explorers exist only for the public testnet; a local anvil world gets bare hashes.
  ccExplorer: worker.mode === 'local' ? '' : (process.env.CREDITCOIN_EXPLORER ?? 'https://creditcoin-testnet.blockscout.com'),
  sourceExplorer: worker.mode === 'local' ? '' : (process.env.SEPOLIA_EXPLORER ?? 'https://sepolia.etherscan.io'),
};

export { ccProvider, chainInfo };
export const ledger = new ethers.Contract(botCfg.ledger || ethers.ZeroAddress, ledgerAbi, ccProvider);
export const viewer = botCfg.viewer ? new ethers.Contract(botCfg.viewer, viewerAbi, ccProvider) : undefined;
export const credit = botCfg.credit ? new ethers.Contract(botCfg.credit, creditAbi, ccProvider) : undefined;
export const ledgerInterface = new ethers.Interface(ledgerAbi);

export function requireLedger() {
  if (!botCfg.ledger) throw new Error('Set KITTY_LEDGER_ADDRESS (root .env, or KITTY_ENV_FILE=worker/.env.world for the local world)');
}
