import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { cfg } from '../config'

function Slide({ eyebrow, title, children, big }: { eyebrow?: string; title: string; children?: ReactNode; big?: boolean }) {
  return (
    <section className="slide">
      <div className="w-full max-w-5xl">
        {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
        <h1 className={big ? 'text-5xl md:text-7xl' : 'text-4xl md:text-5xl'}>{title}</h1>
        <div className="mt-6 text-lg leading-relaxed" style={{ color: 'var(--muted)' }}>{children}</div>
      </div>
    </section>
  )
}
const Li = ({ children }: { children: ReactNode }) => <li className="mb-2 max-w-[60ch]" style={{ color: 'var(--ink)' }}>{children}</li>

const slides: ReactNode[] = [
  <Slide key={0} eyebrow="BUIDL CTC 2026 Fall · DeFi" title="Kitty" big>Savings circles where every payment is proven, not promised.<br />Ethereum stablecoins · settled and credit-scored on Creditcoin · via the Attestcoin Protocol</Slide>,
  <Slide key={1} eyebrow="Problem" title="Hundreds of millions save in circles nobody can see.">
    <ul className="list-disc pl-5"><Li>Chit funds, susu, tandas, chamas, stokvels: ten friends, one pot a month.</Li><Li>They fail two ways: the treasurer runs, or a member stops paying and nobody outside the group ever knows.</Li><Li>Ten years of perfect payments builds zero formal credit history.</Li></ul></Slide>,
  <Slide key={2} eyebrow="Trust today" title="Who you have to trust">
    <table><thead><tr><th>Step</th><th>Informal circle</th><th>“ROSCA on-chain” apps</th><th>Kitty</th></tr></thead><tbody>
      <tr><td>Holds the money</td><td>Treasurer</td><td>One contract on one chain</td><td>Escrow vault on Ethereum</td></tr>
      <tr><td>Knows who paid</td><td>Treasurer’s notebook</td><td>Same contract</td><td>Attestcoin-proven txs on Creditcoin</td></tr>
      <tr><td>Decides the deadline</td><td>Treasurer</td><td>block.timestamp / admin</td><td>Attested source-chain block height</td></tr>
      <tr><td>Picks the recipient</td><td>Treasurer / lottery</td><td>VRF oracle</td><td>Fixed order or by proven score</td></tr>
      <tr><td>Credit history</td><td>None</td><td>None</td><td>Kitty Score, readable by any lender</td></tr></tbody></table></Slide>,
  <Slide key={3} eyebrow="Solution" title="Money on Ethereum. Rules on Creditcoin. Proofs in between.">
    <ul className="list-disc pl-5"><Li>Members pay into a minimal escrow vault on Sepolia.</Li><Li>The attestor network attests the block; one batch proof covers the whole round.</Li><Li>KittyLedger verifies through precompile 0x0FD2, decodes and binds every payment, enforces deadlines from 0x0FD3.</Li><Li>Payouts are proven back. “Paid” is never an operator’s word.</Li><Li>Any member can prove a round from the browser: the Proof Builder serves CORS, the ledger doesn’t care who submits.</Li></ul></Slide>,
  <Slide key={4} eyebrow="Live loop" title="Pay → attest → prove → verify → close → pay out → prove back">
    <p>Demo: three members, 100 tUSD, round 0 everyone pays; round 1 one member misses; the deadline block is attested; the round closes with a missed record; the score drops from 515 to 395.</p></Slide>,
  <Slide key={5} eyebrow="Attestcoin depth" title="What the ledger actually checks">
    <ul className="list-disc pl-5"><Li>Batch <span className="mono">verifyAndEmit</span>: up to 10 txs, one continuity proof, one call for up to ten payments pooled across every open circle, preflighted free with the view verify, 24% cheaper than singles on the live 0x0FD2.</Li><Li>EvmV1Decoder: receipt status 1, exactly one Contributed log, emitter = registered vault, tx.to = vault, tx.from = member, exact amount, current round.</Li><Li>Query id = keccak(chainKey ‖ height ‖ txIndex), same as ASCBase; per-circle chain key validated with <span className="mono">get_chain_by_key</span>; vault allowlist keyed by chain.</Li><Li>Deadlines from attested height: <span className="mono">is_height_attested(chainKey, deadline + 64)</span>.</Li><Li>The dashboard asks 0x0FD3 which attestation covers a payment: <span className="mono">find_lowest_attested_after</span>, <span className="mono">get_attestation_bounds</span>.</Li><Li>Proven against the live precompile before deploying: a real Sepolia proof → <span className="mono">0x0FD2.verify = true</span>; tampered bytes and a wrong chain key revert (<span className="mono">pnpm verify:live</span>).</Li></ul></Slide>,
  <Slide key={6} eyebrow="Attack lab" title="Eight ways to cheat: six decoded rejections, two accepted by design">
    <ul className="list-disc pl-5"><Li>Replay → QueryAlreadyProcessed</Li><Li>Fake vault with a perfect event → WrongEmitter</Li><Li>Same proof, chain key 3 → WrongChain</Li><Li>Included but reverted tx → SourceTxFailed</Li><Li>Paid after the deadline → accepted, flagged late, −20</Li><Li>Steal the steward’s key → NotOperator / OwnableUnauthorizedAccount / RoundStillOpenOnSource / VaultNotTrusted</Li><Li>Fire the agent → accepted: the ledger checks the proof, not the caller</Li><Li>Poison the reasoning → three invented figures stripped before display</Li></ul>
    <p className="mt-4 text-base">Reviewed adversarially before submission: only owner-trusted vaults can feed the ledger, nobody can be penalised for a circle they never consented to, a 64-block grace window protects on-time payers from a hostile early close, and pots only go to members who paid this round.</p></Slide>,
  <Slide key={7} eyebrow="Kitty Steward" title="An agent whose only power is proof">
    <table><thead><tr><th>Layer</th><th>Holds</th><th>What it does</th></tr></thead><tbody>
      <tr><td>1 · The ledger</td><td>final say</td><td>Verified proof, receipt status 1, trusted emitter, right sender and target, exact amount, current round, unseen query id. Any failure: nothing happens.</td></tr>
      <tr><td>2 · Deterministic decisions</td><td>timing only</td><td>Prove now or wait for a fuller batch? Missing the grace window costs 120 points: urgency beats thrift. Decisions logged.</td></tr>
      <tr><td>3 · Cited reasoning</td><td>none</td><td>Claude explains the log in plain language. Any sentence with an uncited or unverifiable figure is stripped before display.</td></tr></tbody></table>
    <p className="mt-4">No API key: the deterministic sentence, identical behaviour.</p></Slide>,
  <Slide key={8} eyebrow="Kitty Score → credit" title="The score is used, not just displayed">
    <ul className="list-disc pl-5"><Li>500 base · +15 on time · −20 late · −120 missed · 300–850.</Li><Li>KittyCreditLine on Creditcoin underwrites from the score alone: tier A borrows 100% of proven volume, B 50%, C 20%, D nothing.</Li><Li>A soulbound Kitty Score badge renders live from the ledger, so a lender can read it on any explorer.</Li><Li>Every input is a proven transaction or an attested deadline. This is the data Creditcoin was built to carry.</Li></ul></Slide>,
  <Slide key={9} eyebrow="Roadmap · CEIP" title="From circles to credit lines">
    <ul className="list-disc pl-5"><Li>Score-gated circle sizes and seat bidding.</Li><Li>Lender integrations on Creditcoin.</Li><Li>Attestcoin writability for payouts once audited; Ethereum mainnet chainKey on CC3 mainnet.</Li><Li>Pot cover through proven-event insurance.</Li></ul></Slide>,
  <Slide key={10} eyebrow="Team" title="Prashant · solo builder">
    <p>Foundry · TypeScript · React. Repo: {cfg.repo}. Contracts on Sepolia and Creditcoin CC3 Testnet; 103 Foundry tests · 26 agent tests · 8 attack scenarios end to end in CI; verified against the live 0x0FD2.</p></Slide>,
]

export function Presentation() {
  const [i, setI] = useState(0)
  const next = useCallback(() => setI((c) => Math.min(c + 1, slides.length - 1)), [])
  const prev = useCallback(() => setI((c) => Math.max(c - 1, 0)), [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (['ArrowRight', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next() } if (['ArrowLeft', 'Backspace'].includes(e.key)) { e.preventDefault(); prev() } }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [next, prev])
  return (
    <div>
      <div className="noprint fixed bottom-4 right-4 z-40 flex items-center gap-2 text-xs mono" style={{ color: 'var(--muted)' }}>
        <button className="btn" onClick={prev} disabled={i === 0}>←</button><span>{i + 1} / {slides.length}</span><button className="btn" onClick={next} disabled={i === slides.length - 1}>→</button>
        <button className="btn btn-ghost" onClick={() => window.print()}>Print → PDF</button>
      </div>
      <div className="noprint">{slides[i]}</div>
      <div className="hidden print:block">{slides}</div>
    </div>
  )
}
