import { useState } from 'react'
import { useAccount, useReadContract, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { cfg } from '../config'
import { ledgerAbi, usdAbi, vaultAbi } from '../lib/abi'
import { creditcoinTestnet, sepolia } from '../lib/wagmi'
import { short, usd, num } from '../lib/format'
import { useAttestation, useCircle, useRoundDetail, useRounds } from '../hooks'
import { CIRCLE_STATUS, ROUND_STATUS } from '../lib/types'

function Tag({ tone, children }: { tone: 'mint' | 'amber' | 'rose' | 'muted' | 'sky'; children: React.ReactNode }) {
  const color = { mint: 'var(--mint)', amber: 'var(--amber)', rose: 'var(--rose)', muted: 'var(--muted)', sky: 'var(--sky)' }[tone]
  return <span className="pill" style={{ color, borderColor: color }}>{children}</span>
}

export function CirclePanel({ circleId }: { circleId: bigint }) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { attested } = useAttestation()
  const { circle, round, deadline, refetch } = useCircle(circleId)
  const detail = useRoundDetail(circleId, circle?.currentRound, circle?.members)
  const rounds = useRounds(circleId, circle?.members.length ?? 0)
  const { writeContractAsync, isPending } = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [msg, setMsg] = useState<string>('')
  const receipt = useWaitForTransactionReceipt({ hash: txHash })
  const allowance = useReadContract({
    chainId: sepolia.id, address: cfg.token, abi: usdAbi, functionName: 'allowance', args: [address ?? '0x0000000000000000000000000000000000000000', cfg.vault], query: { enabled: !!address && !!cfg.token },
  })
  const balance = useReadContract({
    chainId: sepolia.id, address: cfg.token, abi: usdAbi, functionName: 'balanceOf', args: [address ?? '0x0000000000000000000000000000000000000000'], query: { enabled: !!address && !!cfg.token },
  })

  if (!circle) return <div className="panel p-6" style={{ color: 'var(--muted)' }}>Loading circle #{String(circleId)} from Creditcoin…</div>

  const isMemberHere = !!address && circle.members.some((m) => m.toLowerCase() === address.toLowerCase())
  const myIdx = address ? circle.members.findIndex((m) => m.toLowerCase() === address.toLowerCase()) : -1
  const myContribution = myIdx >= 0 ? detail.contributions?.[myIdx] : undefined
  const alreadyPaid = !!myContribution && myContribution.queryId !== '0x0000000000000000000000000000000000000000000000000000000000000000'
  const deadlinePassed = attested !== undefined && deadline !== undefined && attested >= deadline
  const full = round ? round.contributions >= circle.members.length : false
  const active = circle.status === 0

  async function contribute() {
    try {
      setMsg('')
      if (chainId !== sepolia.id) { await switchChain({ chainId: sepolia.id }); }
      if ((allowance.data as bigint | undefined ?? 0n) < circle!.contribution) {
        const h = await writeContractAsync({ chainId: sepolia.id, address: cfg.token, abi: usdAbi, functionName: 'approve', args: [cfg.vault, 2n ** 256n - 1n] })
        setTxHash(h); setMsg('Approving tUSD…')
      }
      const h = await writeContractAsync({ chainId: sepolia.id, address: cfg.vault, abi: vaultAbi, functionName: 'contribute', args: [circleId, circle!.currentRound, circle!.contribution] })
      setTxHash(h); setMsg(`Contribution sent on Sepolia · ${h.slice(0, 10)}… The worker will prove it on Creditcoin once the block is attested (~8 min).`)
    } catch (e) { setMsg((e as Error).message.split('\n')[0]) }
  }
  async function mintDemo() {
    try {
      if (chainId !== sepolia.id) await switchChain({ chainId: sepolia.id })
      const h = await writeContractAsync({ chainId: sepolia.id, address: cfg.token, abi: usdAbi, functionName: 'mint', args: [address!, 1000n * 10n ** 6n] })
      setTxHash(h); setMsg('Minted 1,000 tUSD (testnet faucet).')
    } catch (e) { setMsg((e as Error).message.split('\n')[0]) }
  }
  async function closeRound() {
    try {
      if (chainId !== creditcoinTestnet.id) await switchChain({ chainId: creditcoinTestnet.id })
      const h = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'closeRound', args: [circleId] })
      setTxHash(h); setMsg('closeRound sent on Creditcoin.'); setTimeout(refetch, 4000)
    } catch (e) { setMsg((e as Error).message.split('\n')[0]) }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <section className="panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">#{String(circleId)} · {circle.name}</h2>
          <div className="flex gap-2">
            <Tag tone={active ? 'mint' : 'muted'}>{CIRCLE_STATUS[circle.status]}</Tag>
            <Tag tone="sky">round {circle.currentRound + 1} / {circle.members.length}</Tag>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Installment" value={usd(circle.contribution)} />
          <Stat label="Pot this round" value={usd(round?.pot)} />
          <Stat label="Proven" value={`${round?.contributions ?? 0} / ${circle.members.length}`} />
          <Stat label="Deadline (Sepolia block)" value={num(deadline)} sub={deadlinePassed ? 'attested — closable' : attested && deadline ? `${Number(deadline - attested)} blocks until attested` : ''} />
        </div>

        <h3 className="mt-5 mb-2 text-sm font-semibold" style={{ color: 'var(--muted)' }}>Members · round {circle.currentRound}</h3>
        <div className="grid gap-2">
          {circle.members.map((m, i) => {
            const c = detail.contributions?.[i]
            const proven = !!c && c.queryId !== '0x0000000000000000000000000000000000000000000000000000000000000000'
            const sc = detail.scores?.[i]
            const rec = detail.records?.[i]
            const recipient = i === circle.currentRound
            return (
              <div key={m} className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: '#0f151d', border: '1px solid var(--line)' }}>
                <div className="flex items-center gap-2">
                  <span className="mono text-sm">{short(m)}</span>
                  {recipient && <Tag tone="sky">receives this round</Tag>}
                  {m.toLowerCase() === address?.toLowerCase() && <Tag tone="muted">you</Tag>}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {proven ? (
                    <Tag tone={c!.onTime ? 'mint' : 'amber'}>{c!.onTime ? 'proven · on time' : 'proven · LATE'} @ {num(c!.height)}</Tag>
                  ) : round && round.status !== 0 ? (
                    <Tag tone="rose">missed</Tag>
                  ) : (
                    <Tag tone="muted">pending{deadlinePassed ? ' · past deadline' : ''}</Tag>
                  )}
                  {sc && <span className="mono" title={rec ? `on-time ${rec.onTime} · late ${rec.late} · missed ${rec.missed}` : ''}>score {sc[0]} ({sc[1]})</span>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {isMemberHere && active && !alreadyPaid && (
            <button className="btn btn-mint" disabled={isPending} onClick={contribute}>Contribute {usd(circle.contribution)} on Sepolia</button>
          )}
          {isMemberHere && (balance.data as bigint | undefined ?? 0n) < circle.contribution && (
            <button className="btn" onClick={mintDemo}>Get demo tUSD</button>
          )}
          {active && (full || deadlinePassed) && round?.status === 0 && (
            <button className="btn" disabled={isPending} onClick={closeRound}>Close round on Creditcoin {full ? '(everyone paid)' : '(deadline attested)'}</button>
          )}
          {!address && <span className="text-xs" style={{ color: 'var(--muted)' }}>Connect a member wallet to contribute.</span>}
          {address && !isMemberHere && <span className="text-xs" style={{ color: 'var(--muted)' }}>This wallet is not a member of this circle.</span>}
        </div>
        {(msg || receipt.isLoading) && <p className="mt-3 text-xs" style={{ color: receipt.isLoading ? 'var(--amber)' : 'var(--muted)' }}>{receipt.isLoading ? 'Waiting for confirmation… ' : ''}{msg}</p>}
      </section>

      <section className="panel p-5">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>Rotation</h3>
        <ol className="mt-2 grid gap-2">
          {circle.members.map((m, r) => {
            const rd = rounds?.[r]
            const st = rd ? ROUND_STATUS[rd.status] : 'Open'
            const tone = st === 'Paid' ? 'mint' : st === 'Closed' ? 'amber' : r === circle.currentRound && active ? 'sky' : 'muted'
            return (
              <li key={r} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm" style={{ background: '#0f151d', border: '1px solid var(--line)' }}>
                <span>round {r} → <span className="mono">{short(m)}</span></span>
                <span className="flex items-center gap-2">
                  {rd && rd.pot > 0n && <span className="mono text-xs">{usd(rd.pot)}</span>}
                  <Tag tone={tone as 'mint'}>{r > circle.currentRound && active ? 'upcoming' : st}</Tag>
                </span>
              </li>
            )
          })}
        </ol>
        <p className="mt-4 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          A round closes early when every member's payment is proven, or once the deadline block is <em>attested</em> on Creditcoin
          (ChainInfo precompile 0x0FD3). Missed payments become permanent, proof-backed credit history. "Paid" appears only after the
          Ethereum payout itself has been proven back (precompile 0x0FD2).
        </p>
      </section>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: '#0f151d', border: '1px solid var(--line)' }}>
      <div className="text-xs" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="mono text-base">{value}</div>
      {sub && <div className="text-[11px]" style={{ color: 'var(--muted)' }}>{sub}</div>}
    </div>
  )
}
