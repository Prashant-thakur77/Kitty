import { useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ShieldCheck, ExternalLink, Check, X } from 'lucide-react'
import { cfg } from '../config'
import { ledgerAbi } from '../lib/abi'
import { creditcoinTestnet, wagmiConfig } from '../lib/wagmi'
import { attestedHeight, batchProof } from '../lib/prover'
import { verifierAbi, VERIFIER, precompileReason } from '../lib/verifier'
import { isProven, useCoveringAttestations, type VaultPayment } from '../hooks'
import type { Contribution } from '../lib/types'
import { Section, Tag } from './ui'
import { useToast } from './Toast'
import { EASE_OUT } from './motion'
import { short, num } from '../lib/format'

const STEPS = ['Attested', 'Proof fetched', 'Preflight ok', 'Verified on Creditcoin'] as const
/** `done` = how many steps are complete (0–4); `failed` = the index of the step that failed, if any. */
function Stepper({ done, failed, busy, waiting }: { done: number; failed: number | null; busy: boolean; waiting?: boolean }) {
  const reduced = useReducedMotion()
  // the rail spans three gaps between four nodes, so each completed step fills a third
  const fill = Math.max(0, Math.min(3, done - 1)) / 3
  return (
    <div className="stepper mt-4" role="list" aria-label="Proof progress">
      <motion.span className="rail" aria-hidden initial={false} animate={{ scaleX: fill }} transition={reduced ? { duration: 0 } : { duration: 0.6, ease: EASE_OUT }} />
      {STEPS.map((label, i) => {
        // 'waiting' = a payment is mined on Sepolia but no attestation covers it yet: step 1 sits in amber until 0x0FD3 says otherwise
        const state = failed === i ? 'error' : i < done ? 'done' : busy && i === done ? 'active' : waiting && i === 0 && done === 0 ? 'waiting' : 'idle'
        return (
          <div key={label} className="step" data-state={state} role="listitem" aria-current={state === 'active' || state === 'waiting' ? 'step' : undefined}>
            <motion.span className="step-dot" initial={false} animate={reduced ? {} : { scale: state === 'done' ? [1, 1.25, 1] : 1 }} transition={{ duration: 0.4, ease: EASE_OUT }}>
              {state === 'done' ? <Check size={13} strokeWidth={3} /> : state === 'error' ? <X size={13} strokeWidth={3} /> : i + 1}
            </motion.span>
            <span className="step-label">{state === 'waiting' ? 'Attesting…' : label}<span className="sr-only">{state === 'done' ? ', complete' : state === 'error' ? ', failed' : state === 'active' ? ', in progress' : state === 'waiting' ? ', waiting for the attestor network' : ''}</span></span>
          </div>
        )
      })}
    </div>
  )
}

/** Member self-service: prove every pending payment of the round in ONE precompile call, from your own wallet. No operator. */
export function ProvePanel({ members, contributions, payments, attested, chainKey, contribution, onDone }: {
  members: readonly `0x${string}`[]; contributions?: (Contribution | undefined)[]; payments: VaultPayment[]; attested?: bigint; chainKey: bigint; contribution: bigint; onDone: () => void
}) {
  const { chainId, address } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: creditcoinTestnet.id })
  const { toast, update } = useToast()
  const reduced = useReducedMotion()
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState<number | null>(null)
  const pending = members.map((m, i) => ({ m, i, c: contributions?.[i] })).filter((x) => !isProven(x.c))
  // Only a payment of exactly the installment can be recorded; anything else would revert in the ledger.
  const payFor = (m: `0x${string}`) => payments.find((p) => p.member.toLowerCase() === m.toLowerCase() && p.amount === contribution)
  const provable = pending.map((x) => ({ ...x, pay: payFor(x.m) })).filter((x) => x.pay)
  // Ask 0x0FD3 which attestation covers each payment block — the covering block comes from the precompile, not arithmetic.
  const covering = useCoveringAttestations(chainKey, provable.map((x) => x.pay!.block))
  const ready = provable.filter((x) => covering.get(x.pay!.block)?.exists)
  const push = (l: string) => setLog((s) => [...s, l])
  // Step 1 (Attested) is complete the moment 0x0FD3 says an attestation covers at least one payment, before any click.
  const shownDone = Math.max(done, ready.length > 0 ? 1 : 0)
  // Paid on Sepolia but no attestation covers it yet: say which block we are waiting on instead of "Prove 0 payments".
  const waiting = ready.length === 0 && provable.length > 0
  const maxPaidBlock = provable.reduce((a, x) => (x.pay!.block > a ? x.pay!.block : a), 0n)
  const lag = attested !== undefined && maxPaidBlock > attested ? maxPaidBlock - attested : 0n
  const buttonText = busy ? 'Proving…'
    : ready.length > 0 ? `Prove ${ready.length} payment${ready.length === 1 ? '' : 's'} in one call`
    : waiting ? `Waiting for attestation of Sepolia block ${num(maxPaidBlock)} (attested ${num(attested)}, lag ${num(lag)})`
    : 'Nothing to prove yet'

  async function prove() {
    setBusy(true); setLog([]); setFailed(null)
    let stage = 1; const advance = (n: number) => { stage = n; setDone(n) }
    advance(1)
    const t = toast({ title: 'Fetching batch proof', description: `Asking the Proof Builder for ${Math.min(ready.length, 10)} payment(s)…`, tone: 'sky', busy: true, duration: 0 })
    const fail = (step: number, title: string, description?: string) => { setFailed(step); update(t, { title, description, tone: 'rose', busy: false, duration: 9000 }) }
    try {
      const hashes = ready.slice(0, 10).map((x) => x.pay!.tx)
      push(`checking Proof Builder attested height…`)
      const ah = await attestedHeight(); push(`attested height ${ah}; highest payment block ${String(ready.reduce((a, x) => (x.pay!.block > a ? x.pay!.block : a), 0n))}`)
      push(`requesting ONE batch proof for ${hashes.length} payment(s)…`)
      const p = await batchProof(hashes)
      push(`proof received · continuity roots ${p.continuity.roots.length} · heights ${p.heights.map(String).join(', ')}`)
      advance(2)
      update(t, { title: 'Proof fetched', description: `${p.heights.length} height(s) · ${p.continuity.roots.length} continuity roots · running the free preflight on 0x0FD2…`, tone: 'sky', busy: true, duration: 0 })
      // Free preflight: the precompile's `verify` is a view, so ask before paying to submit.
      push('preflight: asking 0x0FD2 whether this batch verifies…')
      try {
        const ok = await client!.readContract({ address: VERIFIER, abi: verifierAbi, functionName: 'verify',
          args: p.heights.length === 1
            ? [p.chainKey, p.heights[0], p.txBytes[0], p.merkleProofs[0], p.continuity]
            : [p.chainKey, p.heights, p.txBytes, p.merkleProofs, p.continuity] })
        if (!ok) { push('✗ 0x0FD2 says this batch would not verify — nothing submitted, no gas spent'); fail(2, 'Preflight failed', '0x0FD2 says this batch would not verify. Nothing submitted, no gas spent.'); return }
        push('✓ 0x0FD2 preflight passed')
      } catch (e) { const r = precompileReason(e); push(`✗ 0x0FD2 preflight failed: ${r} — nothing submitted, no gas spent`); fail(2, 'Preflight failed', `${r}. Nothing submitted, no gas spent.`); return }
      // Simulate the ledger call itself: the precompile can pass while the ledger still rejects (wrong round, amount, emitter, replay…).
      const args = [p.chainKey, p.heights, p.txBytes, p.merkleProofs, p.continuity] as const
      push('simulating KittyLedger.recordContributions…')
      try {
        await client!.simulateContract({ address: cfg.ledger, abi: ledgerAbi, functionName: 'recordContributions', args, account: address })
      } catch (e) {
        const rev = (e as BaseError).walk?.((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined
        const why = `${rev?.data?.errorName ?? precompileReason(e)}(${(rev?.data?.args ?? []).map(String).join(', ')})`
        push(`✗ ledger would reject: ${why} — nothing submitted`)
        fail(2, 'Ledger would reject', `${why}. Nothing submitted.`)
        return
      }
      push('✓ ledger simulation passed')
      advance(3)
      update(t, { title: 'Preflight passed', description: 'Precompile and ledger simulation both accept the batch. Confirm the transaction in your wallet.', tone: 'mint', busy: true, duration: 0 })
      let gas = 4_000_000n
      try {
        const est = await client!.estimateContractGas({ address: cfg.ledger, abi: ledgerAbi, functionName: 'recordContributions', args, account: address })
        gas = est * 13n / 10n > gas ? est * 13n / 10n : gas
      } catch { /* keep the floor */ }
      if (chainId !== creditcoinTestnet.id) await switchChainAsync({ chainId: creditcoinTestnet.id })
      push(`submitting recordContributions from ${short(address)} on Creditcoin…`)
      const h = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'recordContributions', args, gas })
      push(`sent · ${h} · waiting for the receipt…`)
      update(t, { title: 'Submitted to Creditcoin', description: `${h.slice(0, 14)}… · waiting for the receipt`, tone: 'sky', busy: true, duration: 0 })
      const rc = await waitForTransactionReceipt(wagmiConfig, { hash: h, chainId: creditcoinTestnet.id })
      if (rc.status === 'success') {
        push(`✓ mined · status ${rc.status} · block ${String(rc.blockNumber)} · ${cfg.creditcoinExplorer}/tx/${h}`)
        advance(4)
        update(t, { title: 'Verified on Creditcoin', description: `${hashes.length} payment(s) recorded in block ${num(rc.blockNumber)}.`, tone: 'mint', busy: false, duration: 7000 })
      } else {
        push(`✗ reverted on chain · ${cfg.creditcoinExplorer}/tx/${h}`)
        fail(3, 'Reverted on chain', `${h.slice(0, 14)}… · see the explorer for the reason.`)
      }
      onDone()
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0]
      push(`✗ ${msg}`)
      fail(Math.min(stage, 3), stage < 2 ? 'Could not fetch the proof' : 'Proving stopped', msg)
    } finally { setBusy(false) }
  }

  if (pending.length === 0) return null
  return (
    <Section title="Prove it yourself · no operator needed" right={<Tag tone="sky">Proof Builder → 0x0FD2</Tag>}>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>Any member can fetch the round's batch proof from the Attestcoin Proof Builder in the browser and submit it from their own wallet. The ledger checks everything; the submitter is irrelevant.</p>
      <ul className="mt-3 grid gap-1.5">
        {pending.map((x) => {
          const pay = payFor(x.m)
          const cov = pay ? covering.get(pay.block) : undefined
          const att = !!cov?.exists
          return (
            <li key={x.m} className="panel-2 flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="mono">{short(x.m)}</span>
              {pay ? (
                <span className="flex items-center gap-2 text-xs">
                  <a className="mono" href={`${cfg.sepoliaExplorer}/tx/${pay.tx}`} target="_blank" rel="noreferrer">paid · block {num(pay.block)} <ExternalLink size={11} style={{ display: 'inline' }} /></a>
                  <Tag tone={att ? 'mint' : 'amber'}>{att ? `covered by attestation #${num(cov!.height)}` : `not attested yet · latest ${num(attested)}`}</Tag>
                </span>
              ) : <Tag tone="muted">no payment on Sepolia yet</Tag>}
            </li>
          )
        })}
      </ul>
      <Stepper done={shownDone} failed={failed} busy={busy} waiting={waiting} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className={`btn ${ready.length > 0 ? 'btn-mint' : ''}`} style={{ textAlign: 'left' }} disabled={busy || ready.length === 0 || !address} onClick={prove} aria-busy={busy}><ShieldCheck size={15} style={{ flex: 'none' }} /> <span>{buttonText}</span></button>
        {!address && ready.length > 0 && <span className="text-xs" style={{ color: 'var(--muted)' }}>Connect any wallet with a little tCTC.</span>}
        {waiting && <span className="text-xs" style={{ color: 'var(--muted)' }}>{provable.length} payment{provable.length === 1 ? '' : 's'} mined on Sepolia; the attestor network attests roughly every 8 minutes.</span>}
      </div>
      <AnimatePresence initial={false}>
        {log.length > 0 && (
          <motion.div initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reduced ? 0 : 0.3, ease: EASE_OUT }} style={{ overflow: 'hidden' }}>
            <div className="log panel-2 mt-3 p-3" aria-live="polite">
              {log.map((l, i) => <motion.div key={i} initial={reduced ? false : { opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }}>{l}</motion.div>)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Section>
  )
}
