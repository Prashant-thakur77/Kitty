import { useState } from 'react'
import { useAccount, useConnect, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { wagmiConfig } from '../lib/wagmi'
import { Landmark, Coins, Wallet } from 'lucide-react'
import { cfg } from '../config'
import { creditAbi, kusdAbi } from '../lib/creditAbi'
import { creditcoinTestnet } from '../lib/wagmi'
import { Section, Stat, Tag } from '../components/ui'
import { Reveal, EASE_OUT } from '../components/motion'
import { Skeleton, SkeletonStat, Empty } from '../components/Skeleton'
import { useToast } from '../components/Toast'
import { short } from '../lib/format'

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
  const cc = { chainId: creditcoinTestnet.id, address: cfg.credit, abi: creditAbi } as const
  const enabled = !!cfg.credit && !!address
  const uw = useReadContract({ ...cc, functionName: 'underwrite', args: [address ?? zero], query: { enabled } })
  const owed = useReadContract({ ...cc, functionName: 'outstanding', args: [address ?? zero], query: { enabled } })
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
      <Reveal>
        <div className="eyebrow">Credit line</div>
        <h1 className="text-3xl">Borrow against proven history</h1>
        <p className="mt-1 max-w-[70ch] text-sm" style={{ color: 'var(--muted)' }}>KittyCreditLine is a demo lender on Creditcoin that underwrites from nothing but the Kitty Score: tier A unlocks 100% of your proven contribution volume, B 50%, C 20%, D nothing. Every input is an Attestcoin-proven payment or an attested deadline.</p>
      </Reveal>
      {!cfg.credit && <Reveal i={1} className="mt-5"><Empty icon={<Landmark size={22} />} title="Credit line not deployed" body={<>Set <code className="mono">VITE_KITTY_CREDIT_ADDRESS</code> after <code className="mono">scripts/deploy.sh</code> runs on Creditcoin.</>} /></Reveal>}
      {cfg.credit && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Reveal i={1}>
            <Section title="Underwriting · read live from KittyLedger" right={<Tag tone="sky">underwrite(address)</Tag>}>
              {!address && (
                <Empty
                  icon={<Wallet size={22} />}
                  title="Connect a member wallet"
                  body="The lender reads your Kitty Score straight from the ledger and turns it into a limit. Nothing is submitted until you borrow."
                  action={noWallet ? { label: 'Read the score model instead', to: '/score' } : { label: <><Wallet size={15} /> {connecting ? 'Connecting…' : 'Connect wallet'}</>, onClick: () => connect({ connector: connectors[0] }), primary: true }}
                />
              )}
              {address && underwriting && (
                <div aria-busy="true" aria-label="Reading underwriting">
                  <div className="grid grid-cols-2 gap-2"><SkeletonStat /><SkeletonStat /><SkeletonStat /><SkeletonStat /></div>
                  <div className="mt-3 flex items-center gap-2"><Skeleton w={14} h={14} r={4} /><Skeleton w="60%" h={12} /></div>
                </div>
              )}
              {address && !underwriting && (
                <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Score" value={d ? `${d[0]} (${d[1]})` : '—'} tone={d && d[1] === 'A' ? 'mint' : d && d[1] === 'D' ? 'rose' : undefined} />
                    <Stat label="Credit limit" value={k(limit)} tone="mint" />
                    <Stat label="Outstanding" value={k(owed.data)} tone={owed.data ? 'amber' : undefined} />
                    <Stat label="Available" value={k(available)} />
                  </div>
                  <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}><Landmark size={14} style={{ display: 'inline' }} /> {d?.[3] ?? (uw.error ? 'could not read underwriting' : '…')} · member {short(address)}</p>
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
                  <button className="btn btn-mint" disabled={!address || isPending || amount === 0n || amount > available} onClick={borrow}><Coins size={15} /> Borrow</button>
                  <button className="btn" disabled={!address || isPending || amount === 0n || !(owed.data && owed.data > 0n)} onClick={repay}>Repay</button>
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
