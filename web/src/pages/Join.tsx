import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAccount, useConnect, usePublicClient, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { isAddress, isHex, recoverMessageAddress } from 'viem'
import { Wallet, ArrowRight } from 'lucide-react'
import { cfg } from '../config'
import { ledgerAbi } from '../lib/abi'
import { creditcoinTestnet, wagmiConfig } from '../lib/wagmi'
import { short, usd, num } from '../lib/format'
import { blocksToHuman, inviteMessage, revertReason, simulateLedger } from '../lib/tx'
import { chainName } from '../lib/verifier'
import { useCircle } from '../hooks'
import { Blockie, Section, Stat, Tag } from '../components/ui'
import { Reveal } from '../components/motion'
import { useToast } from '../components/Toast'

export function Join() {
  const { circleId: idParam } = useParams()
  const circleId = BigInt(/^\d+$/.test(idParam ?? '') ? idParam! : '0')
  const [search] = useSearchParams()
  const nav = useNavigate()
  const { address, chainId } = useAccount()
  const { connect, connectors, isPending: connecting } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: creditcoinTestnet.id })
  const { toast, update } = useToast()
  const { circle, isLoading, error, refetch } = useCircle(circleId)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [signer, setSigner] = useState<`0x${string}` | 'bad' | undefined>()

  const inviteeRaw = search.get('invitee') ?? ''
  const nonceRaw = search.get('nonce') ?? ''
  const sig = (search.get('sig') ?? '') as `0x${string}`
  const invitee = isAddress(inviteeRaw) ? (inviteeRaw as `0x${string}`) : undefined
  const nonce = /^\d+$/.test(nonceRaw) ? BigInt(nonceRaw) : undefined
  const linkOk = !!invitee && nonce !== undefined && isHex(sig) && sig.length === 132
  const used = useReadContract({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'usedInviteNonces', args: [circleId, nonce ?? 0n], query: { enabled: linkOk && !!cfg.ledger, refetchInterval: 8000 } })
  const already = !!address && !!circle && circle.members.some((m) => m.toLowerCase() === address.toLowerCase())
  const wrongWallet = !!address && !!invitee && address.toLowerCase() !== invitee.toLowerCase()
  const noWallet = connectors.length === 0 || typeof window.ethereum === 'undefined'

  // Recover the signer client-side so a tampered or mis-signed link is explained before any gas is spent.
  useEffect(() => {
    if (!linkOk) { setSigner(undefined); return }
    let live = true
    recoverMessageAddress({ message: { raw: inviteMessage(circleId, invitee!, nonce!) }, signature: sig }).then((a) => { if (live) setSigner(a) }).catch(() => { if (live) setSigner('bad') })
    return () => { live = false }
  }, [linkOk, circleId, invitee, nonce, sig])
  const signedByOrganiser = !!circle && signer !== undefined && signer !== 'bad' && signer.toLowerCase() === circle.organiser.toLowerCase()

  const blockers: string[] = []
  if (!linkOk) blockers.push('This link is incomplete: it needs invitee, nonce and sig.')
  else if (signer === 'bad') blockers.push('The signature in this link does not decode.')
  else if (circle && signer && !signedByOrganiser) blockers.push(`The link was signed by ${short(signer)}, not by the organiser ${short(circle.organiser)}.`)
  if (circle && !circle.open) blockers.push('This circle is no longer open for invites.')
  if (circle && circle.open && circle.members.length >= circle.maxMembers) blockers.push(`The circle is full (${circle.maxMembers} members).`)
  if (used.data === true) blockers.push('This invite has already been redeemed.')
  if (already) blockers.push('This wallet is already a member.')
  if (wrongWallet) blockers.push(`This invite is for ${short(invitee)}; connect that wallet to redeem it.`)
  const ready = blockers.length === 0 && !!address && !!circle && !busy

  async function redeem() {
    if (!ready || !client || !address || nonce === undefined) return
    setBusy(true); setMsg('')
    const args = [circleId, nonce, sig] as const
    const t = toast({ title: 'Simulating redeemInvite', description: 'Dry run against the ledger before your wallet is asked…', tone: 'sky', busy: true, duration: 0 })
    const fail = (title: string, why: string) => { setMsg(why); update(t, { title, description: why, tone: 'rose', busy: false, duration: 9000 }) }
    try {
      try { await simulateLedger(client, address, 'redeemInvite', args) } catch (err) { fail('Ledger would reject', `${revertReason(err)}. Nothing submitted.`); return }
      update(t, { title: 'Confirm in your wallet', description: `Joining "${circle!.name}" on Creditcoin…`, tone: 'sky', busy: true, duration: 0 })
      if (chainId !== creditcoinTestnet.id) await switchChainAsync({ chainId: creditcoinTestnet.id })
      const h = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'redeemInvite', args })
      update(t, { title: 'Submitted to Creditcoin', description: `${h.slice(0, 14)}… · waiting for the receipt`, tone: 'sky', busy: true, duration: 0 })
      const rc = await waitForTransactionReceipt(wagmiConfig, { hash: h, chainId: creditcoinTestnet.id })
      if (rc.status !== 'success') { fail('Reverted on chain', `${h.slice(0, 14)}… · see the explorer for the reason.`); return }
      update(t, { title: `Joined circle #${String(circleId)}`, description: `${short(address)} is a consenting member · block ${num(rc.blockNumber)}.`, tone: 'mint', busy: false, duration: 7000 })
      refetch()
      nav(`/circle/${String(circleId)}`)
    } catch (err) { fail('Transaction failed', revertReason(err)) } finally { setBusy(false) }
  }

  if (!cfg.ledger) return <main className="mx-auto max-w-6xl px-4 py-8"><div className="panel p-5" style={{ color: 'var(--muted)' }}>Ledger not deployed yet.</div></main>
  if (isLoading || (!circle && !error)) return <main className="mx-auto max-w-6xl px-4 py-8"><div className="panel p-5" style={{ color: 'var(--muted)' }}>Loading circle #{String(circleId)} from Creditcoin…</div></main>
  if (!circle) return <main className="mx-auto max-w-6xl px-4 py-8"><div className="panel p-5" style={{ color: 'var(--muted)' }}>Circle #{String(circleId)} not found. <Link to="/circles">All circles</Link>.</div></main>

  const n = circle.members.length
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Reveal>
        <div className="eyebrow">Invitation</div>
        <h1 className="text-3xl">Join #{String(circleId)} · {circle.name}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          {circle.open ? <>Organiser <span className="mono">{short(circle.organiser)}</span> invited <span className="mono">{invitee ? short(invitee) : '—'}</span>. Redeeming adds the wallet as a consenting member on Creditcoin.</> : 'Invites for this circle are closed.'}
        </p>
      </Reveal>

      <Reveal i={1} className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Installment" value={usd(circle.contribution)} />
        <Stat label="Round length" value={num(circle.roundBlocks)} sub={`${blocksToHuman(Number(circle.roundBlocks))} · source-chain blocks`} />
        <Stat label="Members" value={`${n} / ${circle.maxMembers}`} sub="rotation order = join order" tone="sky" />
        <Stat label="Settles from" value={<span style={{ fontSize: 17 }}>{chainName(circle.chainKey)}</span>} sub={`starts at block ${num(circle.startHeight)}`} />
      </Reveal>

      <Reveal i={2} className="mt-4 grid gap-4 md:grid-cols-[3fr_2fr] md:items-start">
        <Section title="Redeem invite" right={signer === undefined && linkOk ? <Tag tone="muted">checking signature…</Tag> : signedByOrganiser ? <Tag tone="mint">signed by the organiser</Tag> : <Tag tone="rose">signature not verified</Tag>}>
          <div className="panel-2 grid gap-1 p-3 text-sm">
            <div className="flex justify-between gap-2"><span style={{ color: 'var(--muted)' }}>Invitee</span><span className="mono break-all text-right">{invitee ?? '—'}</span></div>
            <div className="flex justify-between gap-2"><span style={{ color: 'var(--muted)' }}>Nonce</span><span className="mono truncate" title={nonceRaw}>{nonce !== undefined ? (nonceRaw.length > 18 ? `${nonceRaw.slice(0, 8)}…${nonceRaw.slice(-6)}` : nonceRaw) : '—'}</span></div>
            <div className="flex justify-between gap-2"><span style={{ color: 'var(--muted)' }}>Redeemed</span><span className="mono">{used.data === undefined ? '…' : used.data ? 'yes' : 'not yet'}</span></div>
            <div className="flex justify-between gap-2"><span style={{ color: 'var(--muted)' }}>Your wallet</span><span className="mono">{address ? short(address) : 'not connected'}</span></div>
          </div>
          <ul className="mt-3 grid gap-1 text-xs" style={{ color: blockers.length ? 'var(--amber)' : 'var(--muted)' }} aria-live="polite">
            {blockers.length ? blockers.map((b) => <li key={b}>{b}</li>) : <li>Everything checks out. redeemInvite is simulated first; the ledger verifies the organiser's EIP-191 signature on chain.</li>}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {address
              ? <button type="button" className="btn btn-mint" disabled={!ready} onClick={redeem}>{busy ? 'Working…' : 'Join circle'} <ArrowRight size={14} className="arrow" /></button>
              : noWallet ? <span className="pill amber">no wallet · read-only</span>
              : <button type="button" className="btn btn-mint" disabled={connecting} onClick={() => connect({ connector: connectors[0] })}><Wallet size={15} /> {connecting ? 'Connecting…' : 'Connect wallet'}</button>}
            {already && <Link to={`/circle/${String(circleId)}`} className="btn">Open the circle</Link>}
          </div>
          {msg && <p className="mt-3 text-xs" style={{ color: 'var(--rose)' }}>{msg}</p>}
          <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            Joining is consent: a consenting member who does not pay by the attested deadline is recorded as missed, and that record follows the address. Each installment is paid into the vault on {chainName(circle.chainKey)} and proven back to Creditcoin.
          </p>
        </Section>
        <Section title={`Members · ${n} of ${circle.maxMembers}`}>
          <div className="grid gap-2">
            {circle.members.map((m, i) => (
              <div key={m} className="panel-2 flex items-center justify-between gap-2 px-3 py-2">
                <span className="flex items-center gap-2"><Blockie address={m} /><Link to={`/score/${m}`} className="mono text-sm no-underline" style={{ color: 'var(--ink)' }}>{short(m)}</Link></span>
                <span className="flex gap-1">{i === 0 && <Tag tone="muted">organiser</Tag>}{address && m.toLowerCase() === address.toLowerCase() && <Tag tone="mint">you</Tag>}</span>
              </div>
            ))}
            {invitee && !already && circle.open && <div className="panel-2 flex items-center justify-between gap-2 px-3 py-2" style={{ borderStyle: 'dashed' }}><span className="flex items-center gap-2"><Blockie address={invitee} /><span className="mono text-sm" style={{ color: 'var(--muted)' }}>{short(invitee)}</span></span><Tag tone="amber">invited</Tag></div>}
          </div>
        </Section>
      </Reveal>
    </main>
  )
}
