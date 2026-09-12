import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { isAddress } from 'viem'
import { useAccount, useConnect, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { wagmiConfig } from '../lib/wagmi'
import { Landmark, Coins, Wallet, Search } from 'lucide-react'
import { cfg } from '../config'
import { creditAbi, kusdAbi } from '../lib/creditAbi'
import { creditcoinTestnet } from '../lib/wagmi'
import { Section, Stat, Tag } from '../components/ui'
import { Reveal, EASE_OUT } from '../components/motion'
import { Skeleton, SkeletonStat, Empty } from '../components/Skeleton'
import { useToast } from '../components/Toast'
import { short } from '../lib/format'
import { useCircle, useCircleCount } from '../hooks'
import { Blockie } from '../components/ui'

const k = (v?: bigint) => (v === undefined ? '—' : `${(Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} kUSD`)

export function Borrow() {
  const { address, chainId } = useAccount()
  const { connect, connectors, isPending: connecting } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync, isPending } = useWriteContract()
  const { toast, update } = useToast()
  const reduced = useReducedMotion()
  const [amt, setAmt] = useState('100')
  const [msg, setMsg] = useState('')
  const zero = '0x0000000000000000000000000000000000000000'
  // Read-only lookup: `/borrow/:address` (when routed) or `/borrow?address=…`; with nothing given and no wallet, the latest circle's
  // current recipient so a judge without a member key still sees underwrite(address) do its work.
  const { address: param } = useParams()
  const [search] = useSearchParams()
  const nav = useNavigate()
  const { data: count } = useCircleCount()
  const latestId = count && (count as bigint) > 0n ? (count as bigint) : undefined
  const { circle: latest } = useCircle(latestId)
  const explicit = [param, search.get('address')].find((a) => a && isAddress(a)) as `0x${string}` | undefined
  const fallback = latest && latest.rotation !== 1 ? latest.members[latest.currentRound] : latest?.members[0]
  const subject = explicit ?? address ?? fallback
  const readOnly = !!subject && subject.toLowerCase() !== address?.toLowerCase()
  const [input, setInput] = useState('')
  const [formErr, setFormErr] = useState('')
  const cc = { chainId: creditcoinTestnet.id, address: cfg.credit, abi: creditAbi } as const
  const enabled = !!cfg.credit && !!subject
  const uw = useReadContract({ ...cc, functionName: 'underwrite', args: [subject ?? zero], query: { enabled } })
  const owed = useReadContract({ ...cc, functionName: 'outstanding', args: [subject ?? zero], query: { enabled } })
  const pool = useReadContract({ ...cc, functionName: 'totalDeposits', query: { enabled: !!cfg.credit } })
  const bal = useReadContract({ chainId: creditcoinTestnet.id, address: cfg.kusd, abi: kusdAbi, functionName: 'balanceOf', args: [address ?? zero], query: { enabled: enabled && !!cfg.kusd } })
  const allowance = useReadContract({ chainId: creditcoinTestnet.id, address: cfg.kusd, abi: kusdAbi, functionName: 'allowance', args: [address ?? zero, cfg.credit], query: { enabled: enabled && !!cfg.kusd } })
  const d = uw.data as readonly [number, string, bigint, string] | undefined
  const limit = d?.[2] ?? 0n
  const available = limit > (owed.data ?? 0n) ? limit - (owed.data ?? 0n) : 0n
  const parsed = Number(amt)
  const amount = Number.isFinite(parsed) && parsed > 0 ? BigInt(Math.round(parsed * 1e6)) : 0n
  const underwriting = enabled && (uw.data === undefined || owed.data === undefined) && !uw.error
  const noWallet = connectors.length === 0 || typeof window.ethereum === 'undefined'
  const lookup = (e: { preventDefault(): void }) => { e.preventDefault(); if (isAddress(input)) { setFormErr(''); nav(`/borrow?address=${input}`) } else setFormErr('Not an address') }
  const refetch = () => { uw.refetch(); owed.refetch(); pool.refetch(); bal.refetch(); allowance.refetch() }
  const ensure = async () => { if (chainId !== creditcoinTestnet.id) await switchChainAsync({ chainId: creditcoinTestnet.id }) }
  const oops = (e: unknown, id: string) => { const m = (e as Error).message.split('\n')[0]; setMsg(m); update(id, { title: 'Transaction failed', description: m, tone: 'rose', busy: false, duration: 8000 }) }

  async function borrow() {
    const t = toast({ title: 'Borrowing', description: `Confirm ${k(amount)} in your wallet…`, tone: 'sky', busy: true, duration: 0 })
    try {
      setMsg(''); await ensure(); const h = await writeContractAsync({ ...cc, functionName: 'borrow', args: [amount] })
      setMsg(`Borrowed · ${h.slice(0, 12)}…`); update(t, { title: 'Borrowed', description: `${k(amount)} · ${h.slice(0, 12)}…`, tone: 'mint', busy: false, duration: 6000 }); setTimeout(refetch, 5000)
    } catch (e) { oops(e, t) }
  }
  async function repay() {
    const t = toast({ title: 'Repaying', description: `Confirm ${k(amount)} in your wallet…`, tone: 'sky', busy: true, duration: 0 })
    try {
      setMsg(''); await ensure()
      if ((allowance.data ?? 0n) < amount) {
        setMsg('Approving kUSD…'); update(t, { title: 'Approving kUSD', description: 'One-time allowance for the credit line…', tone: 'amber', busy: true, duration: 0 })
        const a = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.kusd, abi: kusdAbi, functionName: 'approve', args: [cfg.credit, 2n ** 256n - 1n] })
        await waitForTransactionReceipt(wagmiConfig, { hash: a, chainId: creditcoinTestnet.id })
        update(t, { title: 'Repaying', description: `Allowance set · confirm ${k(amount)}…`, tone: 'sky', busy: true, duration: 0 })
      }
      const h = await writeContractAsync({ ...cc, functionName: 'repay', args: [amount] })
      setMsg(`Repaid · ${h.slice(0, 12)}…`); update(t, { title: 'Repaid', description: `${k(amount)} · ${h.slice(0, 12)}…`, tone: 'mint', busy: false, duration: 6000 }); setTimeout(refetch, 5000)
    } catch (e) { oops(e, t) }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Reveal className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Credit line</div>
          <h1 className="text-3xl">Borrow against proven history</h1>
          <p className="mt-1 max-w-[70ch] text-sm" style={{ color: 'var(--muted)' }}>KittyCreditLine is a demo lender on Creditcoin that underwrites from nothing but the Kitty Score: tier A unlocks 100% of your proven contribution volume, B 50%, C 20%, D nothing. Every input is an Attestcoin-proven payment or an attested deadline.</p>
        </div>
        {cfg.credit && (
          <form className="flex flex-wrap gap-2" onSubmit={lookup} aria-label="Look up any address">
            <div className="grid gap-1">
              <input value={input} onChange={(e) => { setInput(e.target.value); if (formErr) setFormErr('') }} placeholder="0x… any member address" className="mono panel-2 px-3 py-2 text-sm" style={{ width: 'min(300px, 100%)', color: 'var(--ink)' }} aria-label="Address to underwrite" />
              {formErr && <span className="text-xs" style={{ color: 'var(--amber)' }}>{formErr}</span>}
            </div>
            <button className="btn" type="submit"><Search size={14} /> Underwrite</button>
          </form>
        )}
      </Reveal>
      {!cfg.credit && <Reveal i={1} className="mt-5"><Empty icon={<Landmark size={22} />} title="Credit line not deployed" body={<>Set <code className="mono">VITE_KITTY_CREDIT_ADDRESS</code> after <code className="mono">scripts/deploy.sh</code> runs on Creditcoin.</>} /></Reveal>}
      {cfg.credit && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Reveal i={1}>
            <Section title="Underwriting · read live from KittyLedger" right={<Tag tone="sky">underwrite(address)</Tag>}>
              {!subject && (
                <Empty
                  icon={<Wallet size={22} />}
                  title="Connect a member wallet, or look one up"
                  body="The lender reads a Kitty Score straight from the ledger and turns it into a limit. underwrite(address) is a view: paste any member address above to see what it would be offered. Nothing is submitted until you borrow."
                  action={noWallet ? { label: 'Read the score model instead', to: '/score' } : { label: <><Wallet size={15} /> {connecting ? 'Connecting…' : 'Connect wallet'}</>, onClick: () => connect({ connector: connectors[0] }), primary: true }}
                />
              )}
              {subject && underwriting && (
                <div aria-busy="true" aria-label="Reading underwriting">
                  <div className="grid grid-cols-2 gap-2"><SkeletonStat /><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
                  <div className="mt-3 flex items-center gap-2"><Skeleton w={14} h={14} r={4} /><Skeleton w="60%" h={12} /></div>
                </div>
              )}
              {subject && !underwriting && (
                <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                    <Blockie address={subject} size={22} />
                    <span className="mono">{short(subject)}</span>
                    {readOnly ? <Tag tone="muted">read-only lookup{!explicit && fallback && subject === fallback ? ' · latest circle\'s recipient' : ''}</Tag> : <Tag tone="mint">your wallet</Tag>}
                    {d && <Tag tone={d[1] === 'A' ? 'mint' : d[1] === 'D' ? 'rose' : 'sky'}>tier {d[1]} · limit {k(limit)}</Tag>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Score" value={d ? `${d[0]} (${d[1]})` : '—'} tone={d && d[1] === 'A' ? 'mint' : d && d[1] === 'D' ? 'rose' : undefined} />
                    <Stat label="Credit limit" value={k(limit)} tone="mint" />
                    <Stat label="Outstanding" value={k(owed.data)} tone={owed.data ? 'amber' : undefined} />
                    <Stat label="Available" value={k(available)} />
                  </div>
                  <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}><Landmark size={14} style={{ display: 'inline' }} /> {d?.[3] ?? (uw.error ? 'could not read underwriting' : '…')} · member {short(subject)}</p>
                  {readOnly && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                      {noWallet ? 'Connect this wallet to borrow.' : <>Connect this wallet to borrow. <button type="button" className="btn btn-ghost" style={{ padding: '.15rem .5rem', fontSize: 12 }} onClick={() => connect({ connector: connectors[0] })} disabled={connecting}><Wallet size={12} /> {connecting ? 'Connecting…' : address ? 'Switch wallet' : 'Connect wallet'}</button></>}
                    </p>
                  )}
                </motion.div>
              )}
            </Section>
          </Reveal>
          <Reveal i={2}>
            <Section title="Pool" right={pool.data === undefined && !pool.error ? <Skeleton w={110} h={12} /> : <span className="mono text-xs" style={{ color: 'var(--muted)' }}>{k(pool.data)} deposited</span>}>
              <div className="grid gap-3">
                <label className="text-sm" style={{ color: 'var(--muted)' }}>Amount (kUSD)
                  <input value={amt} onChange={(e) => setAmt(e.target.value)} className="mono panel-2 mt-1 w-full px-3 py-2" style={{ color: 'var(--ink)' }} inputMode="decimal" aria-label="Amount in kUSD" /></label>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-mint" disabled={!address || readOnly || isPending || amount === 0n || amount > available} onClick={borrow} title={readOnly ? 'The underwriting shown is for a looked-up address; connect that wallet to borrow' : undefined}><Coins size={15} /> Borrow</button>
                  <button className="btn" disabled={!address || readOnly || isPending || amount === 0n || !(owed.data && owed.data > 0n)} onClick={repay}>Repay</button>
                </div>
                <div className="text-xs mono" style={{ color: 'var(--muted)' }}>
                  {address && bal.data === undefined && !bal.error && !!cfg.kusd ? <Skeleton w={180} h={12} style={{ display: 'inline-block', verticalAlign: 'middle' }} /> : <>your kUSD balance {k(bal.data)}</>} · flat 5% fee added to what you owe
                </div>
                <AnimatePresence initial={false}>
                  {msg && <motion.p key={msg} className="m-0 text-xs" style={{ color: 'var(--amber)' }} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }}>{msg}</motion.p>}
                </AnimatePresence>
              </div>
            </Section>
          </Reveal>
        </div>
      )}
    </main>
  )
}
