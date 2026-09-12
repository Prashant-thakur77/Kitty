import { useEffect, useState } from 'react'
import { useAccount, usePublicClient, useSignMessage, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { hashMessage, isAddress, recoverMessageAddress } from 'viem'
import { Copy, Check, Link2 } from 'lucide-react'
import { cfg } from '../config'
import { ledgerAbi } from '../lib/abi'
import { creditcoinTestnet, wagmiConfig } from '../lib/wagmi'
import { short } from '../lib/format'
import { inviteMessage, randomNonce, revertReason, simulateLedger } from '../lib/tx'
import type { Circle } from '../lib/types'
import { Section, Tag } from './ui'
import { useToast } from './Toast'

type Invite = { invitee: `0x${string}`; nonce: string; sig: `0x${string}` }
const storeKey = (id: bigint) => `kitty:invites:${cfg.ledger.toLowerCase()}:${String(id)}`
const load = (id: bigint): Invite[] => { try { return JSON.parse(localStorage.getItem(storeKey(id)) ?? '[]') } catch { return [] } }

/** Organiser-only: sign invite links for an open circle and close invites once everyone is in. Links are kept in this browser only. */
export function InvitePanel({ circleId, circle, onChange }: { circleId: bigint; circle: Circle; onChange: () => void }) {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { signMessageAsync } = useSignMessage()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: creditcoinTestnet.id })
  const { toast, update } = useToast()
  const [invitee, setInvitee] = useState('')
  const [invites, setInvites] = useState<Invite[]>(() => load(circleId))
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => { try { localStorage.setItem(storeKey(circleId), JSON.stringify(invites)) } catch { /* private mode */ } }, [invites, circleId])

  const n = circle.members.length
  const seats = circle.maxMembers - n
  const target = invitee.trim()
  const isMember = isAddress(target) && circle.members.some((m) => m.toLowerCase() === target.toLowerCase())
  const linkFor = (i: Invite) => `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/join/${String(circleId)}?invitee=${i.invitee}&nonce=${i.nonce}&sig=${i.sig}`

  async function generate() {
    if (!isAddress(target) || !address || !client) return
    setBusy(true)
    const who = target as `0x${string}`
    const nonce = randomNonce()
    const raw = inviteMessage(circleId, who, nonce)
    const t = toast({ title: 'Sign the invite', description: `personal_sign over the invite hash for ${short(who)} · nothing is sent on chain.`, tone: 'sky', busy: true, duration: 0 })
    try {
      // The ledger's inviteDigest is the EIP-191 hash of the bytes the wallet signs; check both agree before asking for a signature.
      const digest = (await client.readContract({ address: cfg.ledger, abi: ledgerAbi, functionName: 'inviteDigest', args: [circleId, who, nonce] })) as `0x${string}`
      if (digest.toLowerCase() !== hashMessage({ raw }).toLowerCase()) { update(t, { title: 'Digest mismatch', description: 'The ledger computes a different invite digest than this page (chain id or ledger address differ). No signature requested.', tone: 'rose', busy: false, duration: 9000 }); return }
      const sig = await signMessageAsync({ message: { raw } })
      const signer = await recoverMessageAddress({ message: { raw }, signature: sig })
      if (signer.toLowerCase() !== circle.organiser.toLowerCase()) { update(t, { title: 'Signature does not recover to the organiser', description: `Recovered ${short(signer)}, organiser is ${short(circle.organiser)}. The wallet did not sign the raw 32-byte hash as expected.`, tone: 'rose', busy: false, duration: 9000 }); return }
      const inv: Invite = { invitee: who, nonce: nonce.toString(), sig }
      setInvites((s) => [inv, ...s])
      setInvitee('')
      update(t, { title: 'Invite link ready', description: `Send it to ${short(who)}; only that wallet can redeem it, once.`, tone: 'mint', busy: false, duration: 6000 })
    } catch (e) { update(t, { title: 'Invite not signed', description: revertReason(e), tone: 'rose', busy: false, duration: 8000 }) } finally { setBusy(false) }
  }

  async function copy(i: Invite) {
    const url = linkFor(i)
    try { await navigator.clipboard.writeText(url); setCopied(i.nonce); setTimeout(() => setCopied(null), 1600) } catch { toast({ title: 'Copy failed', description: url, tone: 'amber', duration: 12000 }) }
  }

  async function closeInvites() {
    if (!address || !client) return
    setBusy(true)
    const t = toast({ title: 'Simulating closeInvites', description: 'Dry run against the ledger before your wallet is asked…', tone: 'sky', busy: true, duration: 0 })
    try {
      try { await simulateLedger(client, address, 'closeInvites', [circleId]) } catch (err) { update(t, { title: 'Ledger would reject', description: `${revertReason(err)}. Nothing submitted.`, tone: 'rose', busy: false, duration: 9000 }); return }
      update(t, { title: 'Confirm in your wallet', description: `Fixing the member list at ${n}…`, tone: 'sky', busy: true, duration: 0 })
      if (chainId !== creditcoinTestnet.id) await switchChainAsync({ chainId: creditcoinTestnet.id })
      const h = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'closeInvites', args: [circleId] })
      update(t, { title: 'Submitted to Creditcoin', description: `${h.slice(0, 14)}… · waiting for the receipt`, tone: 'sky', busy: true, duration: 0 })
      const rc = await waitForTransactionReceipt(wagmiConfig, { hash: h, chainId: creditcoinTestnet.id })
      if (rc.status !== 'success') { update(t, { title: 'Reverted on chain', description: `${h.slice(0, 14)}…`, tone: 'rose', busy: false, duration: 9000 }); return }
      update(t, { title: 'Invites closed', description: `${n} members · rotation order is fixed. Payments can now be recorded.`, tone: 'mint', busy: false, duration: 7000 })
      onChange()
    } catch (e) { update(t, { title: 'Transaction failed', description: revertReason(e), tone: 'rose', busy: false, duration: 8000 }) } finally { setBusy(false) }
  }

  return (
    <Section title="Invites · organiser" right={<Tag tone="amber">{seats > 0 ? `${seats} seat${seats === 1 ? '' : 's'} left` : 'full'}</Tag>}>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Your wallet signs each invite off chain (EIP-191 over the ledger address, chain id, circle id, invitee and a random nonce). The invitee redeems it from their own wallet; the ledger recovers the signer and admits them once. Close invites before the first payment is recorded.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm" style={{ color: 'var(--muted)' }}>Invitee address
          <input value={invitee} onChange={(e) => setInvitee(e.target.value)} placeholder="0x… the wallet that will redeem" className="mono panel-2 mt-1 w-full px-3 py-2 text-sm" style={{ color: 'var(--ink)' }} spellCheck={false} aria-label="Invitee address" />
        </label>
        <button type="button" className="btn btn-mint" disabled={busy || !isAddress(target) || isMember || seats <= 0} onClick={generate} title={isMember ? 'Already a member' : seats <= 0 ? 'The circle is full' : undefined}><Link2 size={14} /> Sign invite link</button>
        <button type="button" className="btn" disabled={busy || n < 2} onClick={closeInvites} title={n < 2 ? 'At least two members are needed before invites can close' : undefined}>Close invites</button>
      </div>
      {isMember && <p className="mt-2 text-xs" style={{ color: 'var(--amber)' }}>{short(target)} is already a member.</p>}
      {invites.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {invites.map((i) => {
            const joined = circle.members.some((m) => m.toLowerCase() === i.invitee.toLowerCase())
            return (
              <li key={i.nonce} className="panel-2 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="mono">{short(i.invitee)}</span>
                  <span className="mono truncate text-xs" style={{ color: 'var(--dim)', maxWidth: '22ch' }} title={linkFor(i)}>nonce {i.nonce.slice(0, 6)}…{i.nonce.slice(-4)}</span>
                  {joined ? <Tag tone="mint">joined</Tag> : <Tag tone="muted">not redeemed</Tag>}
                </span>
                <span className="flex gap-1">
                  <a className="btn btn-ghost" style={{ padding: '.2rem .55rem', fontSize: 12 }} href={linkFor(i)} target="_blank" rel="noreferrer">open</a>
                  <button type="button" className="btn" style={{ padding: '.2rem .6rem', fontSize: 12 }} onClick={() => copy(i)} aria-label={`Copy invite link for ${i.invitee}`}>{copied === i.nonce ? <><Check size={12} /> copied</> : <><Copy size={12} /> copy link</>}</button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-xs" style={{ color: 'var(--dim)' }}>Links are kept in this browser only; the ledger stores nothing until an invite is redeemed.</p>
    </Section>
  )
}
