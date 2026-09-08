import { useState } from 'react'
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi'
import { ShieldCheck, ExternalLink } from 'lucide-react'
import { cfg } from '../config'
import { ledgerAbi } from '../lib/abi'
import { creditcoinTestnet } from '../lib/wagmi'
import { attestedHeight, batchProof } from '../lib/prover'
import { isProven, type VaultPayment } from '../hooks'
import type { Contribution } from '../lib/types'
import { Section, Tag } from './ui'
import { short, num } from '../lib/format'

/** Member self-service: prove every pending payment of the round in ONE precompile call, from your own wallet. No operator. */
export function ProvePanel({ members, contributions, payments, attested, onDone }: {
  members: readonly `0x${string}`[]; contributions?: (Contribution | undefined)[]; payments: VaultPayment[]; attested?: bigint; onDone: () => void
}) {
  const { chainId, address } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const pending = members.map((m, i) => ({ m, i, c: contributions?.[i] })).filter((x) => !isProven(x.c))
  const provable = pending.map((x) => ({ ...x, pay: payments.find((p) => p.member.toLowerCase() === x.m.toLowerCase()) })).filter((x) => x.pay)
  const ready = provable.filter((x) => attested !== undefined && x.pay!.block <= attested)
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
      if (chainId !== creditcoinTestnet.id) await switchChainAsync({ chainId: creditcoinTestnet.id })
      push(`submitting recordContributions from ${short(address)} on Creditcoin…`)
      const h = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'recordContributions', args: [p.chainKey, p.heights, p.txBytes, p.merkleProofs, p.continuity], gas: 4_000_000n })
      push(`✓ sent · ${h}`)
      setTimeout(onDone, 6000)
    } catch (e) { push(`✗ ${(e as Error).message.split('\n')[0]}`) } finally { setBusy(false) }
  }

  if (pending.length === 0) return null
  return (
    <Section title="Prove it yourself · no operator needed" right={<Tag tone="sky">Proof Builder → 0x0FD2</Tag>}>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>Any member can fetch the round's batch proof from the Attestcoin Proof Builder in the browser and submit it from their own wallet. The ledger checks everything; the submitter is irrelevant.</p>
      <ul className="mt-3 grid gap-1.5">
        {pending.map((x) => {
          const pay = payments.find((p) => p.member.toLowerCase() === x.m.toLowerCase())
          const att = pay && attested !== undefined && pay.block <= attested
          return (
            <li key={x.m} className="panel-2 flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="mono">{short(x.m)}</span>
              {pay ? (
                <span className="flex items-center gap-2 text-xs">
                  <a className="mono" href={`${cfg.sepoliaExplorer}/tx/${pay.tx}`} target="_blank" rel="noreferrer">paid · block {num(pay.block)} <ExternalLink size={11} style={{ display: 'inline' }} /></a>
                  <Tag tone={att ? 'mint' : 'amber'}>{att ? 'attested · provable' : attested !== undefined ? `waiting for attestation (${num(pay.block - attested)} blocks)` : 'waiting for attestation'}</Tag>
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
