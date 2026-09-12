import { cfg } from '../config'
import { Tag } from '../components/ui'
import { Canvas3D } from '../three/Canvas3D'
import { useAttestation, useLedgerEvents } from '../hooks'

// three.js lives in its own chunk: Canvas3D fetches it only when the stage decides to render
const flowScene = () => import('../three/FlowScene')
const FLOW_CAMERA = { position: [0, 3.2, 8.0] as [number, number, number], fov: 30 }

/** Shown in place of the 3D stage on small screens, without WebGL, or under reduced motion. */
const FlowFallback = () => (
  <div className="flow-fallback flex flex-wrap items-center gap-2 px-4 py-3">
    <span className="t3-label"><b>Ethereum</b> · KittyVault</span><span style={{ color: 'var(--dim)' }}>→</span>
    <span className="t3-label sky">0x0FD2 · block prover</span><span style={{ color: 'var(--dim)' }}>→</span>
    <span className="t3-label mint"><b>Creditcoin</b> · KittyLedger</span><span style={{ color: 'var(--dim)' }}>←</span>
    <span className="t3-label amber">0x0FD3 · ChainInfo</span>
  </div>
)

const NODES = [
  { k: 'pay', t: 'Pay', chain: 'Sepolia', d: 'Member calls KittyVault.contribute. Escrow moves; a purpose-named Contributed event is emitted. The vault knows nothing about circles.', file: 'src/source/KittyVault.sol', tone: 'muted' },
  { k: 'attest', t: 'Attest', chain: 'Creditcoin', d: 'The attestor network attests the Sepolia block on Creditcoin. Nothing happens until then — attestation is the only clock Kitty uses.', file: 'docs/ATTESTCOIN_INTEGRATION.md', tone: 'sky' },
  { k: 'prove', t: 'Prove (batch)', chain: 'worker', d: 'One Proof Builder call returns up to 10 Merkle proofs sharing a single continuity proof for the round.', file: 'worker/src/proofs.ts', tone: 'sky' },
  { k: 'verify', t: 'Verify', chain: '0x0FD2', d: 'KittyLedger.recordContributions calls verifyAndEmit(batch) once. Query ids are derived exactly as ASCBase does and marked processed first.', file: 'src/asc/KittyLedger.sol', tone: 'mint' },
  { k: 'decode', t: 'Decode + bind', chain: 'EvmV1Decoder', d: 'Receipt status must be 1. Exactly one Contributed log, emitted by the registered vault. The tx’s own to/from must be the vault/member. Amount and round must match.', file: 'src/asc/KittyLedger.sol', tone: 'mint' },
  { k: 'clock', t: 'Clock', chain: '0x0FD3', d: 'On time iff proven height ≤ deadline height. closeRound is allowed early when full, else only when is_height_attested(chainKey, deadline + 64).', file: 'src/interfaces/IChainInfo.sol', tone: 'amber' },
  { k: 'score', t: 'Score + payout proof', chain: 'Creditcoin', d: 'Missed/late/on-time write the Kitty Score. The Ethereum payout is proven back before a round shows Paid.', file: 'src/asc/KittyLedger.sol', tone: 'mint' },
]

export function Architecture() {
  // the stage is driven by the chain: packets for proven payments, an amber tick when the attested frontier moves
  const { attested } = useAttestation()
  const { items } = useLedgerEvents()
  const proven = items.filter((i) => i.kind === 'ContributionRecorded').length
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flow-scene mb-8" aria-label="Proof flow: KittyVault on Ethereum, through the 0x0FD2 block prover, into KittyLedger on Creditcoin; 0x0FD3 ChainInfo attests the clock">
        <Canvas3D scene={flowScene} sceneProps={{ attested, items, proven }} camera={FLOW_CAMERA} fallback={<FlowFallback />} />
        <div className="flow-caption eyebrow">Proof flow · vault → 0x0FD2 → ledger · 0x0FD3 attests the clock</div>
      </div>
      <div className="eyebrow">Architecture</div>
      <h1 className="text-3xl">Verify → decode → bind → clock → score</h1>
      <p className="mt-1 max-w-[72ch] text-sm" style={{ color: 'var(--muted)' }}>Two chains, one worker, two precompiles. Every arrow that changes money or reputation is a proven transaction or an attested block. Click a node to open the source.</p>
      <ol className="mt-6 grid gap-0">
        {NODES.map((n, i) => (
          <li key={n.k} className="grid grid-cols-[28px_1fr] gap-3">
            <div className="flex flex-col items-center"><span className="dot" style={{ background: `var(--${n.tone === 'muted' ? 'muted' : n.tone})`, width: 12, height: 12 }} />{i < NODES.length - 1 && <span style={{ width: 2, flex: 1, background: 'var(--line)' }} />}</div>
            <a href={`${cfg.repo}/blob/main/${n.file}`} target="_blank" rel="noreferrer" className="panel mb-3 block p-4 no-underline" style={{ color: 'var(--ink)' }}>
              <div className="flex flex-wrap items-center gap-2"><span className="display text-lg">{n.t}</span><Tag tone={n.tone as 'mint'}>{n.chain}</Tag><span className="mono ml-auto text-[11px]" style={{ color: 'var(--muted)' }}>{n.file}</span></div>
              <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>{n.d}</p>
            </a>
          </li>
        ))}
      </ol>
      <section className="panel mt-6 p-5">
        <h2 className="text-xl">Why not inherit ASCBase?</h2>
        <p className="mt-2 max-w-[75ch] text-sm" style={{ color: 'var(--muted)' }}>The stock base contract’s <span className="mono">execute</span> drops <span className="mono">chainKey</span> and the source block height before calling app logic. Kitty needs both — chain binding and height-based deadlines — and needs the batch overload of the precompile. So KittyLedger re-implements the same verify → dedupe → act pipeline with identical query-id derivation and adds <span className="mono">recordContributions</span>.</p>
        <div className="mt-4 grid gap-2 md:grid-cols-3 text-sm">
          {[['Block prover', '0x0000…0FD2', 'verifyAndEmit (single + batch), calculateTxIndex'], ['ChainInfo', '0x0000…0fD3', 'is_height_attested, get_chain_by_key, get_latest_attestation_height_and_hash, find_lowest_attested_after, get_attestation_bounds'], ['Proof Builder', 'prover.cc3-testnet', '/api/v1/proof-batch-by-tx, /attested-height/1']].map(([a, b, c]) => (
            <div key={a} className="panel-2 p-3"><div className="eyebrow">{a}</div><div className="mono">{b}</div><div className="text-xs" style={{ color: 'var(--muted)' }}>{c}</div></div>
          ))}
        </div>
      </section>
    </main>
  )
}
