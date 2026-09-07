import { useState } from 'react'
import { useAccount, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { wagmiConfig } from '../lib/wagmi'
import { Landmark, Coins } from 'lucide-react'
import { cfg } from '../config'
import { creditAbi, kusdAbi } from '../lib/creditAbi'
import { creditcoinTestnet } from '../lib/wagmi'
import { Section, Stat, Tag } from '../components/ui'
import { short } from '../lib/format'

const k = (v?: bigint) => (v === undefined ? '—' : `${(Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} kUSD`)

export function Borrow() {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync, isPending } = useWriteContract()
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
  const refetch = () => { uw.refetch(); owed.refetch(); pool.refetch(); bal.refetch(); allowance.refetch() }
  const ensure = async () => { if (chainId !== creditcoinTestnet.id) await switchChainAsync({ chainId: creditcoinTestnet.id }) }

  async function borrow() {
    try { setMsg(''); await ensure(); const h = await writeContractAsync({ ...cc, functionName: 'borrow', args: [amount] }); setMsg(`Borrowed · ${h.slice(0, 12)}…`); setTimeout(refetch, 5000) } catch (e) { setMsg((e as Error).message.split('\n')[0]) }
  }
  async function repay() {
    try {
      setMsg(''); await ensure()
      if ((allowance.data ?? 0n) < amount) {
        setMsg('Approving kUSD…')
        const a = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.kusd, abi: kusdAbi, functionName: 'approve', args: [cfg.credit, 2n ** 256n - 1n] })
        await waitForTransactionReceipt(wagmiConfig, { hash: a, chainId: creditcoinTestnet.id })
      }
      const h = await writeContractAsync({ ...cc, functionName: 'repay', args: [amount] }); setMsg(`Repaid · ${h.slice(0, 12)}…`); setTimeout(refetch, 5000)
    } catch (e) { setMsg((e as Error).message.split('\n')[0]) }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="eyebrow">Credit line</div>
      <h1 className="text-3xl">Borrow against proven history</h1>
      <p className="mt-1 max-w-[70ch] text-sm" style={{ color: 'var(--muted)' }}>KittyCreditLine is a demo lender on Creditcoin that underwrites from nothing but the Kitty Score: tier A unlocks 100% of your proven contribution volume, B 50%, C 20%, D nothing. Every input is an Attestcoin-proven payment or an attested deadline.</p>
      {!cfg.credit && <div className="panel mt-5 p-5 text-sm" style={{ color: 'var(--amber)' }}>KittyCreditLine is not deployed yet (VITE_KITTY_CREDIT_ADDRESS empty).</div>}
      {cfg.credit && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Section title="Underwriting · read live from KittyLedger" right={<Tag tone="sky">underwrite(address)</Tag>}>
            {!address && <p className="text-sm" style={{ color: 'var(--muted)' }}>Connect a member wallet.</p>}
            {address && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Score" value={d ? `${d[0]} (${d[1]})` : '—'} tone={d && d[1] === 'A' ? 'mint' : d && d[1] === 'D' ? 'rose' : undefined} />
                  <Stat label="Credit limit" value={k(limit)} tone="mint" />
                  <Stat label="Outstanding" value={k(owed.data)} tone={owed.data ? 'amber' : undefined} />
                  <Stat label="Available" value={k(available)} />
                </div>
                <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}><Landmark size={14} style={{ display: 'inline' }} /> {d?.[3] ?? '…'} · member {short(address)}</p>
              </>
            )}
          </Section>
          <Section title="Pool" right={<span className="mono text-xs" style={{ color: 'var(--muted)' }}>{k(pool.data)} deposited</span>}>
            <div className="grid gap-3">
              <label className="text-sm" style={{ color: 'var(--muted)' }}>Amount (kUSD)
                <input value={amt} onChange={(e) => setAmt(e.target.value)} className="mono panel-2 mt-1 w-full px-3 py-2" style={{ color: 'var(--ink)' }} inputMode="decimal" /></label>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-mint" disabled={!address || isPending || amount === 0n || amount > available} onClick={borrow}><Coins size={15} /> Borrow</button>
                <button className="btn" disabled={!address || isPending || amount === 0n || !(owed.data && owed.data > 0n)} onClick={repay}>Repay</button>
              </div>
              <div className="text-xs mono" style={{ color: 'var(--muted)' }}>your kUSD balance {k(bal.data)} · flat 5% fee added to what you owe</div>
              {msg && <p className="text-xs" style={{ color: 'var(--amber)' }}>{msg}</p>}
            </div>
          </Section>
        </div>
      )}
    </main>
  )
}
