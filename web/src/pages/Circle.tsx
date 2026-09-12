import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAccount, usePublicClient, useReadContract, useSwitchChain, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { wagmiConfig } from '../lib/wagmi'
import * as Dialog from '@radix-ui/react-dialog'
import { X, ExternalLink } from 'lucide-react'
import { cfg } from '../config'
import { ledgerAbi, usdAbi, vaultAbi } from '../lib/abi'
import { creditcoinTestnet, sepolia } from '../lib/wagmi'
import { short, usd, num } from '../lib/format'
import { useAttestation, useCircle, useRoundDetail, useRounds, useLedgerEvents, useVaultPayments, useDeadlineBounds, isProven } from '../hooks'
import { ProvePanel } from '../components/ProvePanel'
import { ReverifyModal } from '../components/ReverifyModal'
import { ROUND_STATUS } from '../lib/types'
import { BlockProgress, Blockie, Section, Stat, Tag } from '../components/ui'
import { chainName } from '../lib/verifier'
import { ProofFeed } from '../components/ProofFeed'
import { RotationWheel, RoundTimeline, WheelLegend } from '../components/RotationWheel'
import { Reveal } from '../components/motion'
import { InvitePanel } from '../components/InvitePanel'
import { useToast } from '../components/Toast'
import { revertReason, simulateLedger } from '../lib/tx'

type Urgency = 'calm' | 'attention' | 'urgent' | 'proven'

export function CirclePage() {
  const { id: idParam } = useParams()
  const circleId = BigInt(idParam ?? '0')
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { head, attested } = useAttestation()
  const { circle, round, deadline, closeAt, isLoading, error, refetch } = useCircle(circleId)
  const detail = useRoundDetail(circleId, circle?.currentRound, circle?.members)
  const rounds = useRounds(circleId, circle?.members.length ?? 0)
  const { items: feed } = useLedgerEvents({ circleId })
  // Scan from the circle's start: closeRound opens round r+1 as soon as round r closes early, so its payments land before the nominal block. Contributed is indexed by (circleId, round) so the query stays small.
  const payments = useVaultPayments(circleId, circle?.currentRound, circle?.startHeight)
  const bounds = useDeadlineBounds(circle?.chainKey ?? BigInt(cfg.sourceChainKey), deadline)
  const { writeContractAsync, isPending } = useWriteContract()
  const ccClient = usePublicClient({ chainId: creditcoinTestnet.id })
  const { toast, update } = useToast()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [msg, setMsg] = useState('')
  const [modal, setModal] = useState<'closed' | 'confirm' | 'sent'>('closed')
  const [reverify, setReverify] = useState<{ tx: `0x${string}`; member: `0x${string}` } | null>(null)
  const [showList, setShowList] = useState(false)
  const receipt = useWaitForTransactionReceipt({ hash: txHash, chainId: sepolia.id })
  const zero = '0x0000000000000000000000000000000000000000'
  const allowance = useReadContract({ chainId: sepolia.id, address: cfg.token, abi: usdAbi, functionName: 'allowance', args: [address ?? zero, cfg.vault], query: { enabled: !!address && !!cfg.token } })
  const balance = useReadContract({ chainId: sepolia.id, address: cfg.token, abi: usdAbi, functionName: 'balanceOf', args: [address ?? zero], query: { enabled: !!address && !!cfg.token } })
  // Consent: a listed member is only penalised for a circle they accepted (redeemed an invite, organised it, accepted, or paid).
  const accepted = useReadContract({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'accepted', args: [circleId, address ?? zero], query: { enabled: !!address && !!cfg.ledger } })

  const myIdx = useMemo(() => (address && circle ? circle.members.findIndex((m) => m.toLowerCase() === address.toLowerCase()) : -1), [address, circle])
  if (!cfg.ledger) return <main className="mx-auto max-w-6xl px-4 py-8"><div className="panel p-5" style={{ color: 'var(--muted)' }}>Ledger not deployed yet.</div></main>
  if (isLoading || !circle) return <main className="mx-auto max-w-6xl px-4 py-8"><div className="panel p-5" style={{ color: 'var(--muted)' }}>{error ? `Circle #${String(circleId)} not found.` : `Loading circle #${String(circleId)} from Creditcoin…`}</div></main>

  const n = circle.members.length
  const active = circle.status === 0
  const full = !!round && round.contributions >= n
  const start = circle.startHeight + BigInt(circle.currentRound) * circle.roundBlocks
  const dl = deadline ?? start + circle.roundBlocks
  const closeHeight = closeAt ?? dl + 64n
  const blocksToAttested = attested !== undefined ? Number(dl - attested) : undefined
  const blocksToClose = attested !== undefined ? Number(closeHeight - attested) : undefined
  const deadlinePassed = blocksToAttested !== undefined && blocksToAttested <= 0
  const deadlineAttested = blocksToClose !== undefined && blocksToClose <= 0 // deadline + grace attested → closable
  const mine = myIdx >= 0 ? detail.contributions?.[myIdx] : undefined
  const iProved = isProven(mine)
  const iPaidOnSepolia = !!address && payments.some((p) => p.member.toLowerCase() === address.toLowerCase())
  const urgency: Urgency = !active ? 'calm' : iProved || iPaidOnSepolia ? 'proven' : deadlineAttested || full ? 'urgent' : blocksToAttested !== undefined && blocksToAttested <= 20 ? 'attention' : 'calm'
  const byScore = circle.rotation === 1
  const isOrganiser = !!address && circle.organiser.toLowerCase() === address.toLowerCase()
  const needsConsent = active && myIdx >= 0 && accepted.data === false
  // ByScore: the pot goes to the best current score among members who have not received yet (ties → earlier member)
  const recipient = byScore
    ? circle.members.reduce<{ m?: `0x${string}`; s: number }>((acc, m, i) => {
        const rd = rounds ?? []
        const already = rd.some((x) => x && x.status !== 0 && x.recipient.toLowerCase() === m.toLowerCase())
        const sc = detail.scores?.[i]?.[0] ?? 500
        return !already && (acc.m === undefined || sc > acc.s) ? { m, s: sc } : acc
      }, { s: 0 }).m
    : circle.members[circle.currentRound]

  async function ensure(chain: number) { if (chainId !== chain) await switchChainAsync({ chainId: chain }) }
  async function contribute() {
    try {
      setMsg('')
      await ensure(sepolia.id)
      if (((allowance.data as bigint | undefined) ?? 0n) < circle!.contribution) {
        setMsg('Approving tUSD… (waiting for it to mine)')
        const h = await writeContractAsync({ chainId: sepolia.id, address: cfg.token, abi: usdAbi, functionName: 'approve', args: [cfg.vault, 2n ** 256n - 1n] })
        setTxHash(h)
        await waitForTransactionReceipt(wagmiConfig, { hash: h, chainId: sepolia.id })
      }
      setMsg('Confirm the contribution in your wallet…')
      const h = await writeContractAsync({ chainId: sepolia.id, address: cfg.vault, abi: vaultAbi, functionName: 'contribute', args: [circleId, circle!.currentRound, circle!.contribution] })
      setTxHash(h); setMsg(''); setModal('sent')
    } catch (e) { setMsg((e as Error).message.split('\n')[0]) }
  }
  async function mintDemo() {
    try { await ensure(sepolia.id); const h = await writeContractAsync({ chainId: sepolia.id, address: cfg.token, abi: usdAbi, functionName: 'mint', args: [address!, 1000n * 10n ** 6n] }); setTxHash(h); setMsg('Minted 1,000 tUSD (testnet faucet token).') } catch (e) { setMsg((e as Error).message.split('\n')[0]) }
  }
  async function closeRound() {
    try { await ensure(creditcoinTestnet.id); const h = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'closeRound', args: [circleId] }); setMsg(`closeRound sent on Creditcoin · ${h.slice(0, 12)}…`); setTimeout(refetch, 5000) } catch (e) { setMsg((e as Error).message.split('\n')[0]) }
  }
  async function acceptMembership() {
    const t = toast({ title: 'Simulating acceptMembership', description: 'Dry run against the ledger before your wallet is asked…', tone: 'sky', busy: true, duration: 0 })
    try {
      setMsg('')
      try { await simulateLedger(ccClient!, address!, 'acceptMembership', [circleId]) } catch (e) { update(t, { title: 'Ledger would reject', description: `${revertReason(e)}. Nothing submitted.`, tone: 'rose', busy: false, duration: 9000 }); return }
      update(t, { title: 'Confirm in your wallet', description: `Accepting membership of "${circle!.name}" on Creditcoin…`, tone: 'sky', busy: true, duration: 0 })
      await ensure(creditcoinTestnet.id)
      const h = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'acceptMembership', args: [circleId] })
      update(t, { title: 'Submitted to Creditcoin', description: `${h.slice(0, 14)}… · waiting for the receipt`, tone: 'sky', busy: true, duration: 0 })
      const rc = await waitForTransactionReceipt(wagmiConfig, { hash: h, chainId: creditcoinTestnet.id })
      if (rc.status !== 'success') { update(t, { title: 'Reverted on chain', description: `${h.slice(0, 14)}…`, tone: 'rose', busy: false, duration: 9000 }); return }
      update(t, { title: 'Membership accepted', description: 'From now on a missed deadline in this circle is recorded against your address.', tone: 'mint', busy: false, duration: 7000 })
      accepted.refetch()
    } catch (e) { update(t, { title: 'Transaction failed', description: revertReason(e), tone: 'rose', busy: false, duration: 8000 }) }
  }

  // Members with a payment mined on Sepolia this round (any amount) but no proof on Creditcoin yet — the band must not call them unpaid.
  const paidCount = new Set(payments.map((p) => p.member.toLowerCase())).size
  const proven = round?.contributions ?? 0
  const paidUnattested = active && round && paidCount > proven ? paidCount - proven : 0
  const headline = !active ? 'CIRCLE COMPLETE' : circle.open ? `OPEN · ${n} OF ${circle.maxMembers}` : iProved ? `PROVEN · BLOCK ${num(mine!.height)}` : iPaidOnSepolia ? 'PAID · PROOF PENDING' : myIdx >= 0 ? `PAY ${usd(circle.contribution)}` : full ? 'EVERYONE PAID' : deadlineAttested ? 'DEADLINE ATTESTED' : paidUnattested > 0 ? `${paidCount} PAID · ${proven} PROVEN` : `${proven} OF ${n} PROVEN`
  const sub = !active ? 'Every member has received a pot.' : circle.open ? 'Invites are open. No payment can be recorded until the organiser closes invites; the member list and rotation order are fixed then.' : paidUnattested > 0 && !deadlineAttested && !iProved && !iPaidOnSepolia && myIdx < 0 ? `${paidUnattested} payment${paidUnattested === 1 ? '' : 's'} mined on Sepolia, waiting for the attestor network${blocksToAttested !== undefined ? ` · ${blocksToAttested} blocks until the deadline is attested` : ''}` : deadlineAttested ? 'The deadline plus the 64-block grace window is attested on Creditcoin. Anyone can close the round; missing members are recorded.' : deadlinePassed ? `Deadline passed; payments now count as late. ${blocksToClose} blocks of grace before the round can close.` : blocksToAttested !== undefined ? `${blocksToAttested} Sepolia blocks until the deadline is attested` : 'Waiting for attestation data…'

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div><Link to="/circles" className="eyebrow no-underline">← circles</Link><h1 className="text-3xl">#{String(circleId)} · {circle.name}</h1></div>
        <div className="flex gap-2">{circle.open && <Tag tone="amber">open for invites · {n}/{circle.maxMembers}</Tag>}<Tag tone={active ? 'mint' : 'muted'}>{active ? 'active' : 'completed'}</Tag><Tag tone="sky">round {circle.currentRound + 1} of {n}</Tag><Tag tone="muted" title={`Proofs for this circle are only accepted from Attestcoin chain key ${circle.chainKey}`}>{chainName(circle.chainKey)}</Tag></div>
      </div>

      {/* Round header — urgency band (Saving Circles pattern, re-implemented; blocks not seconds) */}
      <section className={`band ${urgency}`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow">ROUND {circle.currentRound + 1} OF {n} · CONTRIBUTION</div>
            <div className="headline mt-2">{headline}</div>
            <div className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>{sub}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {active && !circle.open && myIdx >= 0 && !iProved && !iPaidOnSepolia && <button className="btn btn-mint" disabled={isPending} onClick={() => setModal('confirm')}>Contribute {usd(circle.contribution)}</button>}
            {active && !circle.open && myIdx >= 0 && ((balance.data as bigint | undefined) ?? 0n) < circle.contribution && <button className="btn" onClick={mintDemo}>Get demo tUSD</button>}
            {needsConsent && <button className="btn" disabled={isPending} onClick={acceptMembership} title="Consent to this circle on Creditcoin">Accept membership</button>}
            {active && (full || deadlineAttested) && round?.status === 0 && <button className="btn" disabled={isPending} onClick={closeRound}>Close round on Creditcoin</button>}
            {!address && <span className="self-center text-xs" style={{ color: 'var(--muted)' }}>Connect a member wallet to pay.</span>}
            {address && myIdx < 0 && <span className="self-center text-xs" style={{ color: 'var(--muted)' }}>This wallet is not a member.</span>}
          </div>
        </div>
        <div className="mt-5"><BlockProgress start={start} deadline={dl} now={head} attested={attested} /></div>
        {needsConsent && <p className="mt-3 text-xs" style={{ color: 'var(--amber)' }}>You were listed by the organiser but have not consented yet. Only consented members can be marked missed; accepting (or paying once) records your consent on Creditcoin.</p>}
        {msg && <p className="mt-3 text-xs" style={{ color: 'var(--amber)' }}>{msg}</p>}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Installment" value={usd(circle.contribution)} />
        <Stat label="Pot this round" value={usd(round?.pot)} tone="mint" />
        <Stat label="Proven" value={`${round?.contributions ?? 0} / ${n}`} />
        <Stat label="Deadline · Sepolia block" value={num(dl)} sub={bounds ? (bounds.isAttested ? `deadline attested · covering block ${num(bounds.childHeight)}` : `latest attested ${num(bounds.parentHeight)} · waiting for ${num(dl)}`) : deadlineAttested ? 'grace over — closable' : deadlinePassed ? `late until block ${num(closeHeight)}` : `attested head ${num(attested)}`} tone="sky" />
      </div>

      {circle.open && isOrganiser && <Reveal i={1} className="mt-4"><InvitePanel circleId={circleId} circle={circle} onChange={() => setTimeout(refetch, 1500)} /></Reveal>}
      {circle.open && !isOrganiser && <div className="mt-4 panel p-4 text-sm" style={{ color: 'var(--muted)' }}>This circle is open for invites ({n} of {circle.maxMembers} seats taken). The organiser <span className="mono">{short(circle.organiser)}</span> signs invite links; a link is redeemed at <span className="mono">/join/{String(circleId)}</span> by the invited wallet. No payment can be recorded until invites are closed.</div>}

      <Reveal i={1} className="mt-4 grid gap-4 lg:grid-cols-[2fr_3fr] lg:items-start">
        <Section title={byScore ? 'Rotation · by Kitty Score' : 'Rotation · fixed order'} right={byScore ? <Tag tone="mint">best record first</Tag> : <Tag tone="muted">hover a member</Tag>}>
          <RotationWheel members={circle.members} currentRound={circle.currentRound} active={active} byScore={byScore} recipient={recipient} rounds={rounds} roundStatus={round?.status}
            contributions={detail.contributions} scores={detail.scores} records={detail.records} payments={payments} pot={round?.pot} you={address} deadlineAttested={deadlineAttested} loading={!round || !detail.contributions} />
          <div className="mt-3"><WheelLegend /></div>
        </Section>

        <div className="grid content-start gap-4">
        <Section title={`Members · round ${circle.currentRound + 1} of ${n}`} right={<span className="mono text-xs" style={{ color: 'var(--muted)' }}>{round?.contributions ?? 0} of {n} proven</span>}>
          <div className="grid gap-2">
            {circle.members.map((m, i) => {
              const c = detail.contributions?.[i]
              const proven = isProven(c)
              const sc = detail.scores?.[i]
              const rec = detail.records?.[i]
              const isRecipient = m.toLowerCase() === recipient?.toLowerCase()
              return (
                <div key={m} className="panel-2 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Blockie address={m} />
                    <Link to={`/score/${m}`} className="mono text-sm no-underline" style={{ color: 'var(--ink)' }}>{short(m)}</Link>
                    {isRecipient && active && <Tag tone="sky">{byScore ? 'leading this round' : 'receives this round'}</Tag>}
                    {address && m.toLowerCase() === address.toLowerCase() && <Tag tone="muted">you</Tag>}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    {rec && <Spark rec={rec} />}
                    {proven && payments.find((p) => p.member.toLowerCase() === m.toLowerCase()) && (
                      <button className="btn btn-ghost" style={{ padding: '.15rem .5rem', fontSize: 12 }} onClick={() => setReverify({ tx: payments.find((p) => p.member.toLowerCase() === m.toLowerCase())!.tx, member: m })}>re-verify</button>
                    )}
                    {proven ? <Tag tone={c!.onTime ? 'mint' : 'amber'}>{c!.onTime ? 'proven · on time' : 'proven · late'} @ {num(c!.height)}</Tag>
                      : round && round.status !== 0 ? <Tag tone="rose">missed</Tag>
                      : <Tag tone="muted">pending{deadlineAttested ? ' · past deadline' : ''}</Tag>}
                    {sc && <span className="mono" title={rec ? `on-time ${rec.onTime} · late ${rec.late} · missed ${rec.missed}` : ''}>{sc[0]} <span style={{ color: 'var(--muted)' }}>({sc[1]})</span></span>}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
        <div>
        <Section title={`Round history · ${n} rounds`} right={<button className="btn btn-ghost" style={{ padding: '.2rem .55rem', fontSize: 12 }} onClick={() => setShowList((v) => !v)} aria-expanded={showList}>{showList ? 'hide list' : 'show as list'}</button>}>
          <RoundTimeline members={circle.members} currentRound={circle.currentRound} active={active} byScore={byScore} recipient={recipient} rounds={rounds} />
          {showList && <div className="mt-4">
          <ol className="grid gap-2">
            {circle.members.map((m, r) => {
              const rd = rounds?.[r]
              const st = rd ? ROUND_STATUS[rd.status] : 'Open'
              const upcoming = r > circle.currentRound && active
              const tone = st === 'Paid' ? 'mint' : st === 'Closed' ? 'amber' : r === circle.currentRound && active ? 'sky' : 'muted'
              const who = byScore ? (rd && rd.status !== 0 ? rd.recipient : r === circle.currentRound && active ? recipient : undefined) : m
              return (
                <li key={r} className="panel-2 flex items-center justify-between px-3 py-2 text-sm" style={r === circle.currentRound && active ? { borderColor: 'var(--sky)' } : {}}>
                  <span>round {r + 1} <span className="pill mono" style={{ padding: '0 .4rem', fontSize: 10, fontWeight: 500 }}>r{r}</span> → <span className="mono">{who ? short(who) : 'decided at close by score'}</span>{byScore && r === circle.currentRound && active && who && <span className="text-xs" style={{ color: 'var(--muted)' }}> (leading)</span>}</span>
                  <span className="flex items-center gap-2">{rd && rd.pot > 0n && <span className="mono text-xs">{usd(rd.pot)}</span>}<Tag tone={tone}>{upcoming ? 'upcoming' : st}</Tag></span>
                </li>
              )
            })}
          </ol>
          </div>}
          <p className="mt-3 text-xs" style={{ color: 'var(--dim)' }}>Rounds are numbered 1…{n} here; contracts and logs use the 0-based index <span className="mono">rN</span>.</p>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            A round closes early when every payment is proven, or once the deadline block is <em>attested</em> (ChainInfo precompile 0x0FD3). "Paid" appears only after the Ethereum payout itself is proven back through 0x0FD2.{byScore && ' In a by-score circle the pot goes to the member with the best proven record who has not received yet — missing or paying late this round lowers your score before the pick.'}
          </p>
        </Section>
        </div>
        </div>
      </Reveal>


      {active && round?.status === 0 && <div className="mt-4"><ProvePanel members={circle.members} contributions={detail.contributions} payments={payments} attested={attested} chainKey={circle.chainKey} contribution={circle.contribution} onDone={refetch} /></div>}
      <div className="mt-4"><ProofFeed items={feed} /></div>

      {reverify && <ReverifyModal tx={reverify.tx} member={reverify.member} onClose={() => setReverify(null)} />}
      <Dialog.Root open={modal !== 'closed'} onOpenChange={(o) => !o && setModal('closed')}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40" style={{ background: 'rgba(5,10,8,.8)' }} />
          <Dialog.Content className="panel fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 p-6">
            <div className="flex items-start justify-between"><Dialog.Title className="display text-xl">{modal === 'confirm' ? 'Confirm payment' : 'Payment sent'}</Dialog.Title><Dialog.Close className="btn btn-ghost" aria-label="Close"><X size={16} /></Dialog.Close></div>
            {modal === 'confirm' && (
              <div className="mt-4 grid gap-4">
                <div><div className="eyebrow">Round {circle.currentRound + 1} of {n} installment</div><div className="mono text-4xl">{usd(circle.contribution)}</div></div>
                <div className="panel-2 grid gap-1 p-3 text-sm">
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Pays into</span><span className="mono">KittyVault · Sepolia</span></div>
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Proven on</span><span className="mono">Creditcoin via 0x0FD2</span></div>
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Deadline</span><span className="mono">block {num(dl)}</span></div>
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Your balance</span><span className="mono">{usd(balance.data as bigint | undefined)}</span></div>
                </div>
                <Dialog.Description className="text-xs" style={{ color: 'var(--muted)' }}>Your wallet signs a normal ERC-20 escrow deposit on Sepolia. Nothing else is required from you: the worker proves it to Creditcoin after the block is attested (about 8 minutes).</Dialog.Description>
                {msg && <p className="text-xs" style={{ color: 'var(--amber)' }}>{msg}</p>}
                <button className="btn btn-mint justify-center" disabled={isPending} onClick={contribute}>{isPending ? 'Waiting for wallet…' : `Pay ${usd(circle.contribution)}`}</button>
              </div>
            )}
            {modal === 'sent' && (
              <div className="mt-4 grid gap-3">
                <div className="band proven"><div className="eyebrow">Sepolia</div><div className="display text-2xl">{receipt.isSuccess ? 'Mined' : 'Broadcast'}</div>
                  {txHash && <a className="mono text-xs" href={`${cfg.sepoliaExplorer}/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash.slice(0, 22)}… <ExternalLink size={11} style={{ display: 'inline' }} /></a>}</div>
                <div className="panel-2 p-3 text-sm">
                  <div className="flex justify-between"><span style={{ color: 'var(--muted)' }}>Proof pending</span><span className="mono">attested head {num(attested)}</span></div>
                  <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>When the attestor network attests block {receipt.data ? String(receipt.data.blockNumber) : '…'}, the worker fetches one batch proof for the round and calls <span className="mono">recordContributions</span>. Watch the proof feed below; your row turns mint.</p>
                </div>
                <Dialog.Close className="btn justify-center">Done</Dialog.Close>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  )
}

function Spark({ rec }: { rec: { onTime: number; late: number; missed: number } }) {
  const cells = [...Array(Math.min(rec.onTime, 5)).fill('mint'), ...Array(Math.min(rec.late, 5)).fill('amber'), ...Array(Math.min(rec.missed, 5)).fill('rose')].slice(-5)
  return <span className="flex gap-[2px]" title={`on-time ${rec.onTime} · late ${rec.late} · missed ${rec.missed}`}>{cells.length ? cells.map((c, i) => <i key={i} style={{ width: 6, height: 10, borderRadius: 1, background: `var(--${c})` }} />) : <i style={{ width: 6, height: 10, borderRadius: 1, background: '#223129' }} />}</span>
}
