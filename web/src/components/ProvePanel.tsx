import { useState } from 'react'
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import { ShieldCheck, ExternalLink } from 'lucide-react'
import { cfg } from '../config'
import { ledgerAbi } from '../lib/abi'
import { creditcoinTestnet, wagmiConfig } from '../lib/wagmi'
import { attestedHeight, batchProof } from '../lib/prover'
import { verifierAbi, VERIFIER, precompileReason } from '../lib/verifier'
import { isProven, useCoveringAttestations, type VaultPayment } from '../hooks'
import type { Contribution } from '../lib/types'
import { Section, Tag } from './ui'
import { short, num } from '../lib/format'

/** Member self-service: prove every pending payment of the round in ONE precompile call, from your own wallet. No operator. */
export function ProvePanel({ members, contributions, payments, attested, chainKey, contribution, onDone }: {
  members: readonly `0x${string}`[]; contributions?: (Contribution | undefined)[]; payments: VaultPayment[]; attested?: bigint; chainKey: bigint; contribution: bigint; onDone: () => void
}) {
  const { chainId, address } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: creditcoinTestnet.id })
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const pending = members.map((m, i) => ({ m, i, c: contributions?.[i] })).filter((x) => !isProven(x.c))
  // Only a payment of exactly the installment can be recorded; anything else would revert in the ledger.
  const payFor = (m: `0x${string}`) => payments.find((p) => p.member.toLowerCase() === m.toLowerCase() && p.amount === contribution)
  const provable = pending.map((x) => ({ ...x, pay: payFor(x.m) })).filter((x) => x.pay)
  // Ask 0x0FD3 which attestation covers each payment block — the covering block comes from the precompile, not arithmetic.
  const covering = useCoveringAttestations(chainKey, provable.map((x) => x.pay!.block))
  const ready = provable.filter((x) => covering.get(x.pay!.block)?.exists)
  const push = (l: string) => setLog((s) => [...s, l])

  async function prove() {
    setBusy(true); setLog([])
    try {
      const hashes = ready.slice(0, 10).map((x) => x.pay!.tx)
      push(`checking Proof Builder attested height…`)
      const ah = await attestedHeight(); push(`attested height ${ah}; highest payment block ${String(ready.reduce((a, x) => (x.pay!.block > a ? x.pay!.block : a), 0n))}`)
      push(`requesting ONE batch proof for ${hashes.length} payment(s)…`)
      const p = await batchProof(hashes)
      push(`proof received · continuity roots ${p.continuity.roots.length} · heights ${p.heights.map(String).join(', ')}`)
      // Free preflight: the precompile's `verify` is a view, so ask before paying to submit.
      push('preflight: asking 0x0FD2 whether this batch verifies…')
      try {
        const ok = await client!.readContract({ address: VERIFIER, abi: verifierAbi, functionName: 'verify',
          args: p.heights.length === 1
            ? [p.chainKey, p.heights[0], p.txBytes[0], p.merkleProofs[0], p.continuity]
            : [p.chainKey, p.heights, p.txBytes, p.merkleProofs, p.continuity] })
        if (!ok) { push('✗ 0x0FD2 says this batch would not verify — nothing submitted, no gas spent'); return }
        push('✓ 0x0FD2 preflight passed')
      } catch (e) { push(`✗ 0x0FD2 preflight failed: ${precompileReason(e)} — nothing submitted, no gas spent`); return }
      // Simulate the ledger call itself: the precompile can pass while the ledger still rejects (wrong round, amount, emitter, replay…).
      const args = [p.chainKey, p.heights, p.txBytes, p.merkleProofs, p.continuity] as const
      push('simulating KittyLedger.recordContributions…')
      try {
        await client!.simulateContract({ address: cfg.ledger, abi: ledgerAbi, functionName: 'recordContributions', args, account: address })
      } catch (e) {
        const rev = (e as BaseError).walk?.((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined
        push(`✗ ledger would reject: ${rev?.data?.errorName ?? precompileReason(e)}(${(rev?.data?.args ?? []).map(String).join(', ')}) — nothing submitted`)
        return
      }
      push('✓ ledger simulation passed')
      let gas = 4_000_000n
      try {
        const est = await client!.estimateContractGas({ address: cfg.ledger, abi: ledgerAbi, functionName: 'recordContributions', args, account: address })
        gas = est * 13n / 10n > gas ? est * 13n / 10n : gas
      } catch { /* keep the floor */ }
      if (chainId !== creditcoinTestnet.id) await switchChainAsync({ chainId: creditcoinTestnet.id })
      push(`submitting recordContributions from ${short(address)} on Creditcoin…`)
      const h = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'recordContributions', args, gas })
      push(`sent · ${h} · waiting for the receipt…`)
      const rc = await waitForTransactionReceipt(wagmiConfig, { hash: h, chainId: creditcoinTestnet.id })
      if (rc.status === 'success') push(`✓ mined · status ${rc.status} · block ${String(rc.blockNumber)} · ${cfg.creditcoinExplorer}/tx/${h}`)
      else push(`✗ reverted on chain · ${cfg.creditcoinExplorer}/tx/${h}`)
      onDone()
    } catch (e) { push(`✗ ${(e as Error).message.split('\n')[0]}`) } finally { setBusy(false) }
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
      <div className="mt-3 flex items-center gap-3">
        <button className="btn btn-mint" disabled={busy || ready.length === 0 || !address} onClick={prove}><ShieldCheck size={15} /> Prove {ready.length} payment{ready.length === 1 ? '' : 's'} in one call</button>
        {!address && <span className="text-xs" style={{ color: 'var(--muted)' }}>Connect any wallet with a little tCTC.</span>}
      </div>
      {log.length > 0 && <div className="log panel-2 mt-3 p-3">{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
    </Section>
  )
}
