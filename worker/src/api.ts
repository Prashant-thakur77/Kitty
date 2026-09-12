/**
 * Attack-lab API for the /lab page (local/dev only — it holds the operator key).
 *
 *   GET  /scenarios     → ScenarioMeta[]                       (see scenarios.ts)
 *   POST /run/:name     → text/event-stream
 *                           event: start   data: {"name","expected"}
 *                           (default)      data: {"line":"…"}      one per log line
 *                           event: done    data: ScenarioResult    {ok, expected, got, skipped?}
 *                         409 {"error","running"} while another run is in progress
 *   GET  /status        → {mode, chainKey, vault, ledger, token, viewer?, fakeVault?,
 *                          sourceHead, ccHead, attestedHeight|null, running: name|null}
 *   GET  /steward/log   → Decision[]                          newest first, last 20 (see agent/log.ts)
 *   POST /steward/explain {question} → Explanation             {text, source, verified, stripped}
 *                         (agent/explain.ts: deterministic without ANTHROPIC_API_KEY; the key stays here)
 *
 *   PORT (default 8790) · CORS * · no auth
 */
import http from 'node:http';
import { ethers } from 'ethers';
import { cfg, chainInfo, CHAIN_INFO_PRECOMPILE, sourceProvider, ccProvider, log } from './config.ts';
import { SCENARIOS, runScenario, type ScenarioResult } from './scenarios.ts';
import { read } from './agent/log.ts'; // after config.ts: dotenv must have run before log.ts reads STEWARD_LOG_FILE
import { explain } from './agent/explain.ts';

const PORT = Number(process.env.PORT ?? 8790);
let running: string | null = null;

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function body(req: http.IncomingMessage): Promise<{ question: string }> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const q = raw ? (JSON.parse(raw) as { question?: unknown }).question : undefined;
  return { question: typeof q === 'string' && q.trim() ? q.trim().slice(0, 500) : 'What have you done recently, and why?' };
}

const mockChainInfo = new ethers.Contract(CHAIN_INFO_PRECOMPILE, ['function attestedHeight(uint64) view returns (uint64)'], ccProvider);
async function attestedHeight(): Promise<number | null> {
  try {
    const r = await chainInfo.get_latest_attestation_height_and_hash(cfg.chainKey);
    return Number(r.height);
  } catch {}
  try {
    return Number(await mockChainInfo.attestedHeight(cfg.chainKey)); // MockChainInfo on the local anvil
  } catch {
    return null;
  }
}

async function status() {
  const [sourceHead, ccHead, attested] = await Promise.all([sourceProvider.getBlockNumber(), ccProvider.getBlockNumber(), attestedHeight()]);
  return {
    mode: cfg.mode,
    chainKey: cfg.chainKey,
    vault: cfg.vault,
    ledger: cfg.ledger,
    token: cfg.token,
    ...(process.env.KITTY_VIEWER_ADDRESS ? { viewer: process.env.KITTY_VIEWER_ADDRESS } : {}),
    ...(process.env.FAKE_VAULT_ADDRESS ? { fakeVault: process.env.FAKE_VAULT_ADDRESS } : {}),
    sourceHead,
    ccHead,
    attestedHeight: attested,
    running,
  };
}

async function stream(name: string, req: http.IncomingMessage, res: http.ServerResponse) {
  const meta = SCENARIOS.find((s) => s.name === name);
  if (!meta) return json(res, 404, { error: `unknown scenario ${name}` });
  if (running) return json(res, 409, { error: 'a scenario is already running', running });
  running = name;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let open = true;
  req.on('close', () => (open = false));
  const send = (event: string | null, data: unknown) => {
    if (!open) return;
    res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
  };
  const ping = setInterval(() => open && res.write(': ping\n\n'), 15_000);
  send('start', { name: meta.name, expected: meta.expected });
  let result: ScenarioResult;
  try {
    result = await runScenario(name, (line) => send(null, { line }));
  } catch (e) {
    result = { ok: false, expected: meta.expected, got: `error: ${(e as Error).message}` };
  } finally {
    clearInterval(ping);
    running = null;
  }
  send('done', result);
  res.end();
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/scenarios') return json(res, 200, SCENARIOS);
    if (req.method === 'GET' && url.pathname === '/status') return json(res, 200, await status());
    if (req.method === 'GET' && url.pathname === '/steward/log') return json(res, 200, read(20));
    if (req.method === 'POST' && url.pathname === '/steward/explain') {
      const { question } = await body(req);
      const entries = read(12);
      return json(res, 200, await explain(question, entries[0]?.summary ?? 'No decisions logged yet.', { entries }));
    }
    const m = url.pathname.match(/^\/run\/([A-Za-z]+)$/);
    if (req.method === 'POST' && m) return await stream(m[1], req, res);
    return json(res, 404, { error: 'not found', routes: ['GET /scenarios', 'POST /run/:name', 'GET /status', 'GET /steward/log', 'POST /steward/explain'] });
  } catch (e) {
    if (!res.headersSent) return json(res, 500, { error: (e as Error).message });
    res.end();
  }
});

server.listen(PORT, () => {
  log(`kitty lab api · http://localhost:${PORT} · mode=${cfg.mode} · vault ${cfg.vault} · ledger ${cfg.ledger}`);
  log(`GET /scenarios · POST /run/{${SCENARIOS.map((s) => s.name).join('|')}} (SSE) · GET /status · GET /steward/log · POST /steward/explain`);
});
