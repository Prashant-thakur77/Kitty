import { useState } from 'react'
import { useAccount, useReadContract, useSwitchChain, useWriteContract } from 'wagmi'
import { Award } from 'lucide-react'
import { cfg } from '../config'
import { badgeAbi } from '../lib/creditAbi'
import { creditcoinTestnet } from '../lib/wagmi'
import { Section, Tag } from './ui'

export function BadgeCard({ address }: { address: `0x${string}` }) {
  const { address: me, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync, isPending } = useWriteContract()
  const [msg, setMsg] = useState('')
  const enabled = !!cfg.badge
  const bal = useReadContract({ chainId: creditcoinTestnet.id, address: cfg.badge, abi: badgeAbi, functionName: 'balanceOf', args: [address], query: { enabled } })
  const has = (bal.data ?? 0n) > 0n
  const uri = useReadContract({ chainId: creditcoinTestnet.id, address: cfg.badge, abi: badgeAbi, functionName: 'tokenURI', args: [BigInt(address)], query: { enabled: enabled && has } })
  let img: string | undefined
  try { if (uri.data) { const j = JSON.parse(atob((uri.data as string).split(',')[1])); img = j.image } } catch { /* ignore */ }
  async function claim() {
    try { setMsg(''); if (chainId !== creditcoinTestnet.id) await switchChainAsync({ chainId: creditcoinTestnet.id }); const h = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.badge, abi: badgeAbi, functionName: 'claim' }); setMsg(`Claimed · ${h.slice(0, 12)}…`); setTimeout(() => { bal.refetch(); uri.refetch() }, 5000) } catch (e) { setMsg((e as Error).message.split('\n')[0]) }
  }
  if (!cfg.badge) return null
  return (
    <Section title="Kitty Score badge · soulbound, live-rendered from the ledger" right={<Tag tone="sky">ERC-5192</Tag>}>
      {has && img ? <img src={img} alt="Kitty Score badge" style={{ width: '100%', maxWidth: 400, borderRadius: 10, border: '1px solid var(--line)' }} /> : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm" style={{ color: 'var(--muted)' }}>{has ? 'Badge minted; rendering…' : 'No badge yet. Any member with proven history can claim one; it cannot be transferred and its picture updates as history changes.'}</p>
          {!has && me && me.toLowerCase() === address.toLowerCase() && <button className="btn" disabled={isPending} onClick={claim}><Award size={15} /> Claim badge</button>}
        </div>
      )}
      {msg && <p className="mt-2 text-xs" style={{ color: 'var(--amber)' }}>{msg}</p>}
    </Section>
  )
}
