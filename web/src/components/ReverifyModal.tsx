import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { usePublicClient } from 'wagmi'
import { X, ShieldCheck } from 'lucide-react'
import { cfg } from '../config'
import { verifierAbi, VERIFIER as VERIFIER_PRECOMPILE, precompileReason } from '../lib/verifier'
import { creditcoinTestnet } from '../lib/wagmi'
import { singleProof } from '../lib/prover'
import { short } from '../lib/format'

/** "Re-verify now": refetch the proof for a recorded payment and ask the LIVE precompile again, from the browser. */
export function ReverifyModal({ tx, member, onClose }: { tx: `0x${string}`; member: `0x${string}`; onClose: () => void }) {
  const client = usePublicClient({ chainId: creditcoinTestnet.id })
  const [lines, setLines] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<boolean | null>(null)
  const push = (l: string) => setLines((s) => [...s, l])
  async function run() {
    if (!client) return
    setBusy(true); setLines([]); setResult(null)
    try {
      push(`fetching proof for ${tx.slice(0, 14)}… from the Attestcoin Proof Builder`)
      const p = await singleProof(tx)
      push(`proof: Sepolia block ${p.heights[0]} · ${p.merkleProofs[0].siblings.length} Merkle siblings · ${p.continuity.roots.length} continuity roots`)
      const idx = await client.readContract({ address: VERIFIER_PRECOMPILE, abi: verifierAbi, functionName: 'calculateTxIndex', args: [p.merkleProofs[0]] })
      push(`0x0FD2.calculateTxIndex = ${idx}`)
      const ok = await client.readContract({ address: VERIFIER_PRECOMPILE, abi: verifierAbi, functionName: 'verify', args: [p.chainKey, p.heights[0], p.txBytes[0], p.merkleProofs[0], p.continuity] })
      push(`0x0FD2.verify(chainKey ${p.chainKey}, height ${p.heights[0]}) = ${ok}`)
      setResult(Boolean(ok))
      const bad = (p.txBytes[0].slice(0, -2) + (p.txBytes[0].endsWith('00') ? '01' : '00')) as `0x${string}`
      try { await client.readContract({ address: VERIFIER_PRECOMPILE, abi: verifierAbi, functionName: 'verify', args: [p.chainKey, p.heights[0], bad, p.merkleProofs[0], p.continuity] }); push('tampered bytes: accepted (!)') } catch (e) { push(`tampered bytes → rejected: ${precompileReason(e)}`) }
    } catch (e) { push(`✗ ${(e as Error).message.split('\n')[0]}`) } finally { setBusy(false) }
  }
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ background: 'rgba(5,10,8,.8)' }} />
        <Dialog.Content className="panel fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 p-6">
          <div className="flex items-start justify-between"><Dialog.Title className="display text-xl">Re-verify this payment now</Dialog.Title><Dialog.Close className="btn btn-ghost" aria-label="Close"><X size={16} /></Dialog.Close></div>
          <Dialog.Description className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
            Payment by <span className="mono">{short(member)}</span>, Sepolia tx <a className="mono" href={`${cfg.sepoliaExplorer}/tx/${tx}`} target="_blank" rel="noreferrer">{tx.slice(0, 14)}…</a>.
            The browser refetches its proof and asks the live block-prover precompile on Creditcoin to verify it again. Nothing is cached, nothing is trusted.
          </Dialog.Description>
          <button className="btn btn-mint mt-4" disabled={busy} onClick={run}><ShieldCheck size={15} /> {busy ? 'Verifying…' : 'Ask 0x0FD2'}</button>
          {lines.length > 0 && <div className="log panel-2 mt-3 p-3" style={result === true ? { borderColor: 'var(--mint)' } : {}}>{lines.map((l, i) => <div key={i}>{l}</div>)}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
