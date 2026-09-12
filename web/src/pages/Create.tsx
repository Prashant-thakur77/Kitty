import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAccount, useBalance, useConnect, usePublicClient, useReadContract, useReadContracts, useSwitchChain, useWriteContract } from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { hexToString, isAddress, parseEventLogs } from 'viem'
import { Wallet, ArrowRight, ExternalLink } from 'lucide-react'
import { cfg, CHAIN_INFO_PRECOMPILE } from '../config'
import { chainInfoAbi, ledgerAbi } from '../lib/abi'
import { creditcoinTestnet, wagmiConfig } from '../lib/wagmi'
import { short, num } from '../lib/format'
import { blocksToHuman, revertReason, simulateLedger } from '../lib/tx'
import { useCircleCount } from '../hooks'
import { Section, Tag } from '../components/ui'
import { Reveal } from '../components/motion'
import { useToast } from '../components/Toast'

const FAUCET_DOCS = 'https://docs.creditcoin.org/wallets/using-testnet-faucet'
const MAX_MEMBERS = 10 // KittyLedger.MAX_MEMBERS
const START_LEAD = 20n // blocks past the attested frontier where round 0 opens by default

type Mode = 'listed' | 'open'
type Rotation = 'fixed' | 'score'
type ChainRow = { chainKey: bigint; chainId: bigint; chainName: `0x${string}`; chainEncoding: number }

const decodeName = (b: `0x${string}`) => { try { return hexToString(b).replace(/\0+$/, '') } catch { return b } }
const fieldCls = 'mono panel-2 mt-1 w-full px-3 py-2 text-sm'
const ink = { color: 'var(--ink)' } as const

export function Create() {
  const nav = useNavigate()
  const { address, chainId } = useAccount()
  const { connect, connectors, isPending: connecting } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const client = usePublicClient({ chainId: creditcoinTestnet.id })
  const { toast, update } = useToast()
  const { data: count } = useCircleCount()
  const noWallet = connectors.length === 0 || typeof window.ethereum === 'undefined'
  const ctc = useBalance({ address, chainId: creditcoinTestnet.id, query: { enabled: !!address, refetchInterval: 12000 } })
  const noGas = !!address && ctc.data !== undefined && ctc.data.value === 0n

  // Form state
  const [name, setName] = useState('')
  const [mode, setMode] = useState<Mode>('listed')
  const [membersText, setMembersText] = useState('')
  const [maxMembers, setMaxMembers] = useState('5')
  const [installment, setInstallment] = useState('100')
  const [roundBlocks, setRoundBlocks] = useState('300')
  const [rotation, setRotation] = useState<Rotation>('fixed')
  const [chainKey, setChainKey] = useState<bigint>(BigInt(cfg.sourceChainKey))
  const [startHeight, setStartHeight] = useState('')
  const [startTouched, setStartTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // The registry decides which chains exist; the ledger decides which vaults it trusts on each of them.
  const chains = useReadContract({ chainId: creditcoinTestnet.id, address: CHAIN_INFO_PRECOMPILE, abi: chainInfoAbi, functionName: 'get_supported_chains' })
  const rows = (chains.data ?? []) as readonly ChainRow[]
  const trust = useReadContracts({
    contracts: rows.map((r) => ({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'trustedVault', args: [r.chainKey, cfg.vault] } as const)),
    query: { enabled: rows.length > 0 && !!cfg.ledger && !!cfg.vault },
  })
  const trusted = (i: number) => trust.data?.[i]?.result === true
  const latest = useReadContract({
    chainId: creditcoinTestnet.id, address: CHAIN_INFO_PRECOMPILE, abi: chainInfoAbi, functionName: 'get_latest_attestation_height_and_hash',
    args: [chainKey], query: { refetchInterval: 8000 },
  })
  const attested = latest.data?.exists ? latest.data.height : undefined
  useEffect(() => { if (!startTouched && attested !== undefined) setStartHeight(String(attested + START_LEAD)) }, [attested, startTouched])

  // Derived values and validation (mirrors the ledger's own checks so a revert is the exception, not the UX).
  const members = useMemo(() => membersText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean), [membersText])
  const badMembers = members.filter((m) => !isAddress(m))
  const dupMembers = members.filter((m, i) => members.findIndex((x) => x.toLowerCase() === m.toLowerCase()) !== i)
  const maxN = Number(maxMembers)
  const instNum = Number(installment)
  const contribution = Number.isFinite(instNum) && instNum > 0 ? BigInt(Math.round(instNum * 1e6)) : 0n
  const blocksNum = /^\d+$/.test(roundBlocks) ? Number(roundBlocks) : NaN
  const startNum = /^\d+$/.test(startHeight) ? BigInt(startHeight) : undefined
  const firstDeadline = startNum !== undefined && Number.isFinite(blocksNum) ? startNum + BigInt(blocksNum) : undefined
  const chainIdx = rows.findIndex((r) => r.chainKey === chainKey)
  const chainOk = chainIdx >= 0 && trusted(chainIdx)
  const problems: string[] = []
  if (!name.trim()) problems.push('Give the circle a name.')
  if (mode === 'listed') {
    if (members.length < 2 || members.length > MAX_MEMBERS) problems.push(`List 2 to ${MAX_MEMBERS} member addresses (${members.length} given).`)
    if (badMembers.length) problems.push(`Not an address: ${badMembers.slice(0, 2).map((m) => m.slice(0, 12)).join(', ')}${badMembers.length > 2 ? '…' : ''}`)
    if (dupMembers.length) problems.push('Duplicate member address.')
  } else if (!(maxN >= 2 && maxN <= MAX_MEMBERS)) problems.push(`Maximum members must be 2 to ${MAX_MEMBERS}.`)
  if (contribution === 0n) problems.push('Installment must be a positive tUSD amount.')
  if (!(blocksNum > 0)) problems.push('Round length must be a whole number of blocks.')
  if (startNum === undefined) problems.push('Start height must be a whole block number.')
  if (attested !== undefined && firstDeadline !== undefined && firstDeadline <= attested) problems.push(`Round 0 would end at block ${num(firstDeadline)}, at or below the attested frontier ${num(attested)}. The ledger rejects this (InvalidCircle "round 0 already attested").`)
  if (rows.length > 0 && !chainOk) problems.push('Pick a source chain on which the ledger trusts the vault.')
  if (!cfg.vault) problems.push('No vault configured (VITE_KITTY_VAULT_ADDRESS).')
  const ready = problems.length === 0 && !!address && !busy

  async function ensure() { if (chainId !== creditcoinTestnet.id) await switchChainAsync({ chainId: creditcoinTestnet.id }) }

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!ready || !client || !address || startNum === undefined) return
    setBusy(true); setMsg('')
    const fn = mode === 'listed' ? 'createCircle' : 'createOpenCircle'
    const args = mode === 'listed'
      ? [name.trim(), members as `0x${string}`[], contribution, BigInt(blocksNum), startNum, cfg.vault, chainKey]
      : [name.trim(), contribution, BigInt(blocksNum), startNum, cfg.vault, maxN, chainKey]
    const t = toast({ title: 'Simulating on Creditcoin', description: `${fn} · dry run against the ledger before your wallet is asked…`, tone: 'sky', busy: true, duration: 0 })
    const fail = (title: string, why: string) => { setMsg(why); update(t, { title, description: why, tone: 'rose', busy: false, duration: 9000 }) }
    try {
      try { await simulateLedger(client, address, fn, args) } catch (err) { fail('Ledger would reject', `${revertReason(err)}. Nothing submitted.`); return }
      update(t, { title: 'Confirm in your wallet', description: `Creating "${name.trim()}" on Creditcoin…`, tone: 'sky', busy: true, duration: 0 })
      await ensure()
      const h = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: fn, args })
      update(t, { title: 'Submitted to Creditcoin', description: `${h.slice(0, 14)}… · waiting for the receipt`, tone: 'sky', busy: true, duration: 0 })
      const rc = await waitForTransactionReceipt(wagmiConfig, { hash: h, chainId: creditcoinTestnet.id })
      if (rc.status !== 'success') { fail('Reverted on chain', `${h.slice(0, 14)}… · see the explorer for the reason.`); return }
      // The id comes from the receipt's CircleCreated log; circleCount is the fallback if the log is missing.
      let id: bigint | undefined
      try { id = (parseEventLogs({ abi: ledgerAbi, logs: rc.logs, eventName: 'CircleCreated' })[0]?.args as { circleId?: bigint } | undefined)?.circleId } catch { /* fall through */ }
      if (id === undefined) id = (await client.readContract({ address: cfg.ledger, abi: ledgerAbi, functionName: 'circleCount' })) as bigint
      if (rotation === 'score') {
        update(t, { title: `Circle #${String(id)} created`, description: 'Now setting rotation to by proven score · confirm in your wallet…', tone: 'mint', busy: true, duration: 0 })
        try { await simulateLedger(client, address, 'setRotation', [id, 1]) } catch (err) { fail(`Circle #${String(id)} created, rotation stays fixed`, `setRotation would revert: ${revertReason(err)}`); nav(`/circle/${String(id)}`); return }
        const h2 = await writeContractAsync({ chainId: creditcoinTestnet.id, address: cfg.ledger, abi: ledgerAbi, functionName: 'setRotation', args: [id, 1] })
        await waitForTransactionReceipt(wagmiConfig, { hash: h2, chainId: creditcoinTestnet.id })
      }
      update(t, { title: `Circle #${String(id)} created`, description: mode === 'open' ? 'Invite members from the circle page, then close invites before the first payment.' : 'Listed members accept membership from the circle page.', tone: 'mint', busy: false, duration: 7000 })
      nav(`/circle/${String(id)}`)
    } catch (err) {
      fail('Transaction failed', revertReason(err))
    } finally { setBusy(false) }
  }

  const walletNote = noWallet
    ? 'No wallet detected. The form is a read-only preview; open this page in a wallet browser to create a circle.'
    : !address ? 'Connect a wallet to create. Until then the form is a read-only preview.' : undefined

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Ledger</div>
            <h1 className="text-3xl">Create a circle</h1>
            <p className="mt-1 max-w-[62ch] text-sm" style={{ color: 'var(--muted)' }}>
              One transaction on Creditcoin opens the circle; money never touches the ledger. Members pay the vault on the source chain and every payment is proven back through 0x0FD2.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tag tone="sky">Creditcoin · KittyLedger {short(cfg.ledger)}</Tag>
            {count !== undefined && <Tag tone="muted">{String(count)} circle{count === 1n ? '' : 's'} so far</Tag>}
          </div>
        </div>
      </Reveal>

      {walletNote && (
        <Reveal i={1} className="mt-4">
          <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm" style={{ color: 'var(--amber)' }}>
            <span>{walletNote}</span>
            {!noWallet && !address && <button type="button" className="btn btn-mint" disabled={connecting} onClick={() => connect({ connector: connectors[0] })}><Wallet size={15} /> {connecting ? 'Connecting…' : 'Connect wallet'}</button>}
          </div>
        </Reveal>
      )}
      {noGas && (
        <Reveal i={1} className="mt-4">
          <div className="panel p-4 text-sm" style={{ color: 'var(--amber)' }}>
            <span className="mono">{short(address)}</span> holds no tCTC on Creditcoin Testnet, so it cannot pay for the create transaction. Get testnet CTC from the{' '}
            <a href={FAUCET_DOCS} target="_blank" rel="noreferrer">Creditcoin faucet docs <ExternalLink size={11} style={{ display: 'inline' }} /></a>{' '}
            (the <span className="mono">/faucet</span> command in the Creditcoin Discord). The form stays usable; the submit will fail until the balance is funded.
          </div>
        </Reveal>
      )}

      <form onSubmit={submit} className="mt-5 grid gap-4 lg:grid-cols-[3fr_2fr] lg:items-start" aria-label="Create a circle">
        <Reveal i={2} className="grid gap-4">
          <Section title="Circle" right={<Tag tone="muted">{mode === 'listed' ? 'listed members' : 'open · invites'}</Tag>}>
            <div className="grid gap-4">
              <label className="text-sm" style={{ color: 'var(--muted)' }}>Name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Delhi Chit Circle" className={fieldCls} style={ink} maxLength={64} />
              </label>
              <div>
                <div className="text-sm" style={{ color: 'var(--muted)' }}>Membership</div>
                <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Membership mode">
                  <button type="button" role="radio" aria-checked={mode === 'listed'} className={`btn ${mode === 'listed' ? 'btn-mint' : ''}`} onClick={() => setMode('listed')}>Listed members</button>
                  <button type="button" role="radio" aria-checked={mode === 'open'} className={`btn ${mode === 'open' ? 'btn-mint' : ''}`} onClick={() => setMode('open')}>Open circle with invites</button>
                </div>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {mode === 'listed'
                    ? 'You name every member now. Each of them accepts membership from the circle page; until they do, the circle cannot mark them missed.'
                    : 'You are the first member. Invite others with links signed by your wallet; rotation order is join order. Close invites before the first payment is recorded.'}
                </p>
              </div>
              {mode === 'listed' ? (
                <label className="text-sm" style={{ color: 'var(--muted)' }}>Members · one address per line, 2 to {MAX_MEMBERS}
                  <textarea value={membersText} onChange={(e) => setMembersText(e.target.value)} rows={5} placeholder={'0x…\n0x…'} className={fieldCls} style={{ ...ink, resize: 'vertical' }} spellCheck={false} />
                  <span className="mono mt-1 block text-xs" style={{ color: badMembers.length || dupMembers.length ? 'var(--rose)' : 'var(--dim)' }}>{members.length} address{members.length === 1 ? '' : 'es'}{badMembers.length ? ` · ${badMembers.length} invalid` : ''}{dupMembers.length ? ' · duplicates' : ''}</span>
                </label>
              ) : (
                <label className="text-sm" style={{ color: 'var(--muted)' }}>Maximum members · 2 to {MAX_MEMBERS}
                  <input value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)} inputMode="numeric" className={fieldCls} style={{ ...ink, width: 'min(160px, 100%)' }} />
                </label>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm" style={{ color: 'var(--muted)' }}>Installment · tUSD per member per round
                  <input value={installment} onChange={(e) => setInstallment(e.target.value)} inputMode="decimal" className={fieldCls} style={ink} />
                  <span className="mono mt-1 block text-xs" style={{ color: 'var(--dim)' }}>{contribution > 0n ? `${String(contribution)} units · 6 decimals` : 'exact amount the vault must receive'}</span>
                </label>
                <label className="text-sm" style={{ color: 'var(--muted)' }}>Round length · source-chain blocks
                  <input value={roundBlocks} onChange={(e) => setRoundBlocks(e.target.value)} inputMode="numeric" className={fieldCls} style={ink} />
                  <span className="mono mt-1 block text-xs" style={{ color: 'var(--dim)' }}>{blocksToHuman(blocksNum)} at 12 s per block · plus a 64-block grace before a round can close</span>
                </label>
              </div>
              <div>
                <div className="text-sm" style={{ color: 'var(--muted)' }}>Rotation</div>
                <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Rotation">
                  <button type="button" role="radio" aria-checked={rotation === 'fixed'} className={`btn ${rotation === 'fixed' ? 'btn-mint' : ''}`} onClick={() => setRotation('fixed')}>Fixed order</button>
                  <button type="button" role="radio" aria-checked={rotation === 'score'} className={`btn ${rotation === 'score' ? 'btn-mint' : ''}`} onClick={() => setRotation('score')}>By proven score</button>
                </div>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {rotation === 'fixed'
                    ? 'The pot goes to members[round]: the classic order (join order for open circles).'
                    : 'Each round pays the member with the best proven record who has not received yet. Set with a second transaction (setRotation) right after creation, while round 0 is still empty.'}
                </p>
              </div>
            </div>
          </Section>
        </Reveal>

        <Reveal i={3} className="grid gap-4">
          <Section title="Source chain and timing" right={<Tag tone="sky">0x0FD3</Tag>}>
            <div className="grid gap-4">
              <div>
                <div className="text-sm" style={{ color: 'var(--muted)' }}>Settles from</div>
                <div className="mt-1 grid gap-2" role="radiogroup" aria-label="Source chain">
                  {chains.isLoading && <div className="panel-2 px-3 py-2 text-xs" style={{ color: 'var(--muted)' }}>Reading get_supported_chains() from the ChainInfo precompile…</div>}
                  {chains.error && <div className="panel-2 px-3 py-2 text-xs" style={{ color: 'var(--rose)' }}>Could not read the chain registry: {revertReason(chains.error)}</div>}
                  {rows.map((r, i) => {
                    const ok = trusted(i)
                    const sel = r.chainKey === chainKey
                    return (
                      <button key={String(r.chainKey)} type="button" role="radio" aria-checked={sel} disabled={!ok} onClick={() => setChainKey(r.chainKey)}
                        className="panel-2 flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-left" style={{ borderColor: sel ? 'var(--mint)' : undefined, opacity: ok ? 1 : 0.55, cursor: ok ? 'pointer' : 'not-allowed' }}>
                        <span className="flex items-center gap-2 text-sm" style={ink}>{decodeName(r.chainName)} <span className="mono text-xs" style={{ color: 'var(--muted)' }}>key {String(r.chainKey)} · chain id {String(r.chainId)}</span></span>
                        {ok ? <Tag tone={sel ? 'mint' : 'muted'}>{sel ? 'selected' : 'vault trusted'}</Tag> : <Tag tone="amber" wrap>vault {short(cfg.vault)} not trusted on this chain</Tag>}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  The registry on 0x0FD3 lists the chains the attestor network serves. A chain is disabled when <span className="mono">trustedVault(chainKey, vault)</span> is false: the ledger owner has not approved this vault for proofs from that chain, so createCircle would revert with <span className="mono">VaultNotTrusted</span>.
                </p>
              </div>
              <div className="panel-2 grid gap-1 p-3 text-sm">
                <div className="flex justify-between gap-2"><span style={{ color: 'var(--muted)' }}>Vault</span><span className="mono">{short(cfg.vault)}</span></div>
                <div className="flex justify-between gap-2"><span style={{ color: 'var(--muted)' }}>Latest attested block</span><span className="mono">{attested !== undefined ? num(attested) : latest.isLoading ? '…' : 'none yet'}</span></div>
                <div className="flex justify-between gap-2"><span style={{ color: 'var(--muted)' }}>Round 0 ends at</span><span className="mono" style={{ color: attested !== undefined && firstDeadline !== undefined && firstDeadline <= attested ? 'var(--rose)' : undefined }}>{firstDeadline !== undefined ? num(firstDeadline) : '—'}</span></div>
              </div>
              <label className="text-sm" style={{ color: 'var(--muted)' }}>Start height · source-chain block where round 0 opens
                <input value={startHeight} onChange={(e) => { setStartTouched(true); setStartHeight(e.target.value) }} inputMode="numeric" className={fieldCls} style={ink} />
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--dim)' }}>
                  <span>default: latest attested + {String(START_LEAD)}</span>
                  {startTouched && attested !== undefined && <button type="button" className="btn btn-ghost" style={{ padding: '.1rem .45rem', fontSize: 11 }} onClick={() => { setStartTouched(false); setStartHeight(String(attested + START_LEAD)) }}>reset</button>}
                </span>
              </label>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                Round 0 runs from the start height for one round length, and its deadline must lie beyond the attested frontier. Otherwise a circle could open with its first round already over, collect consent through invites, and have every member marked missed for a round that never existed for them. Payments mined before the start height are refused.
              </p>
            </div>
          </Section>

          <Section title="Create">
            <ul className="grid gap-1 text-xs" style={{ color: problems.length ? 'var(--amber)' : 'var(--muted)' }} aria-live="polite">
              {problems.length ? problems.map((p) => <li key={p}>{p}</li>) : <li>Ready: {mode === 'listed' ? `${members.length} members` : `open, up to ${maxN}`} · {installment} tUSD · {num(blocksNum)} blocks per round · {rotation === 'score' ? 'by score' : 'fixed'} · chain key {String(chainKey)}.</li>}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="submit" className="btn btn-mint" disabled={!ready}>{busy ? 'Working…' : mode === 'listed' ? 'Create circle' : 'Open circle'} <ArrowRight size={14} className="arrow" /></button>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{address ? <>from <span className="mono">{short(address)}</span> on Creditcoin · simulated first, then signed</> : 'read-only preview'}</span>
            </div>
            {msg && <p className="mt-3 text-xs" style={{ color: 'var(--rose)' }}>{msg}</p>}
            <p className="mt-3 text-xs" style={{ color: 'var(--dim)' }}>Prefer the CLI? <span className="mono">pnpm demo create</span> does the same from the repo. <Link to="/circles">Back to circles</Link>.</p>
          </Section>
        </Reveal>
      </form>
    </main>
  )
}
