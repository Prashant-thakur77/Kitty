import { useEffect, useState } from 'react'
import { useBlockNumber, usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { cfg, CHAIN_INFO_PRECOMPILE, ZERO32 } from './config'
import { chainInfoAbi, ledgerAbi, vaultAbi } from './lib/abi'
import type { Circle, Contribution, Record_, Round } from './lib/types'
import { creditcoinTestnet, sepolia } from './lib/wagmi'

const cc = { chainId: creditcoinTestnet.id } as const
const enabledLedger = () => !!cfg.ledger

export function useAttestation() {
  const { data: head } = useBlockNumber({ chainId: sepolia.id, watch: true })
  const { data } = useReadContract({
    ...cc, address: CHAIN_INFO_PRECOMPILE, abi: chainInfoAbi, functionName: 'get_latest_attestation_height_and_hash',
    args: [BigInt(cfg.sourceChainKey)], query: { refetchInterval: 8000 },
  })
  const attested = data?.exists ? data.height : undefined
  return { head, attested, lag: head !== undefined && attested !== undefined ? Number(head - attested) : undefined }
}

export function useCircleCount() {
  return useReadContract({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'circleCount', query: { enabled: enabledLedger() } })
}

export function useCircle(id: bigint | undefined) {
  const enabled = enabledLedger() && id !== undefined && id > 0n
  const circle = useReadContract({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'getCircle', args: [id ?? 0n], query: { enabled } })
  const c = circle.data as Circle | undefined
  const round = useReadContract({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'getRound', args: [id ?? 0n, c?.currentRound ?? 0], query: { enabled: enabled && !!c } })
  const deadline = useReadContract({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'deadlineHeight', args: [id ?? 0n, c?.currentRound ?? 0], query: { enabled: enabled && !!c } })
  const closeAt = useReadContract({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'closeHeight', args: [id ?? 0n, c?.currentRound ?? 0], query: { enabled: enabled && !!c } })
  return { circle: c, round: round.data as Round | undefined, deadline: deadline.data as bigint | undefined, closeAt: closeAt.data as bigint | undefined, isLoading: circle.isLoading, error: circle.error, refetch: () => { circle.refetch(); round.refetch() } }
}

export function useRoundDetail(id: bigint | undefined, round: number | undefined, members: readonly `0x${string}`[] | undefined) {
  const enabled = enabledLedger() && id !== undefined && round !== undefined && !!members?.length
  const mk = (fn: string, argsFor: (m: `0x${string}`) => unknown[]) => (members ?? []).map((m) => ({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: fn, args: argsFor(m) }))
  const contribs = useReadContracts({ contracts: mk('getContribution', (m) => [id ?? 0n, round ?? 0, m]), query: { enabled } })
  const records = useReadContracts({ contracts: mk('getRecord', (m) => [m]), query: { enabled } })
  const scores = useReadContracts({ contracts: mk('creditScore', (m) => [m]), query: { enabled } })
  return {
    contributions: contribs.data?.map((r) => r.result as Contribution | undefined),
    records: records.data?.map((r) => r.result as Record_ | undefined),
    scores: scores.data?.map((r) => r.result as readonly [number, string] | undefined),
  }
}

export function useRounds(id: bigint | undefined, count: number) {
  const enabled = enabledLedger() && id !== undefined && count > 0
  const q = useReadContracts({
    contracts: Array.from({ length: count }, (_, r) => ({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'getRound', args: [id ?? 0n, r] })),
    query: { enabled },
  })
  return q.data?.map((r) => r.result as Round | undefined)
}

export function useScore(address: `0x${string}` | undefined) {
  const enabled = enabledLedger() && !!address
  const score = useReadContract({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'creditScore', args: [address ?? '0x0000000000000000000000000000000000000000'], query: { enabled } })
  const record = useReadContract({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'getRecord', args: [address ?? '0x0000000000000000000000000000000000000000'], query: { enabled } })
  return { score: score.data as readonly [number, string] | undefined, record: record.data as Record_ | undefined }
}

export type FeedItem = { kind: string; text: string; tx: `0x${string}`; block: bigint; qid?: string; args: Record<string, unknown> }

const NAMES = ['CircleCreated', 'BatchVerified', 'ContributionRecorded', 'ContributionMissed', 'RoundClosed', 'RoundOpened', 'PayoutConfirmed', 'CircleCompleted', 'InviteRedeemed']
const s = (v: unknown) => (typeof v === 'string' && v.startsWith('0x') && v.length === 42 ? `${v.slice(0, 6)}…${v.slice(-4)}` : String(v))
const usd6 = (v: unknown) => (Number(v as bigint) / 1e6).toLocaleString()

export function describe(name: string, a: Record<string, unknown>): string {
  switch (name) {
    case 'ContributionRecorded': return `Proven: ${s(a.member)} paid ${usd6(a.amount)} tUSD for round ${a.round} at Sepolia block ${a.sourceHeight} (${a.onTime ? 'on time' : 'LATE'})`
    case 'BatchVerified': return `0x0FD2 verified ${a.count} tx in ONE call · Sepolia blocks ${a.fromHeight}–${a.toHeight}`
    case 'ContributionMissed': return `Missed: ${s(a.member)} did not pay round ${a.round} by attested block ${a.deadlineHeight}`
    case 'RoundClosed': return `Round ${a.round} closed → ${s(a.recipient)} receives ${usd6(a.pot)} tUSD (${a.missedCount} missed)`
    case 'RoundOpened': return `Round ${a.round} open · pay by Sepolia block ${a.deadlineHeight}`
    case 'PayoutConfirmed': return `Payout proven: ${s(a.recipient)} received ${usd6(a.amount)} tUSD on Ethereum`
    case 'CircleCreated': return `Circle "${a.name}" created · ${(a.members as string[]).length} members · ${usd6(a.contribution)} tUSD/round`
    case 'CircleCompleted': return 'Circle completed — every member has received a pot'
    case 'InviteRedeemed': return `${s(a.member)} joined by invite`
    default: return name
  }
}

/** All ledger events (optionally one circle, optionally one member). Newest first. */
export function useLedgerEvents(filter?: { circleId?: bigint; member?: `0x${string}` }) {
  const client = usePublicClient({ chainId: creditcoinTestnet.id })
  const { data: ccHead } = useBlockNumber({ chainId: creditcoinTestnet.id, watch: true })
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const circleId = filter?.circleId
  const member = filter?.member?.toLowerCase()
  useEffect(() => {
    if (!client || !cfg.ledger || ccHead === undefined) return
    let cancelled = false
    ;(async () => {
      const from = cfg.ledgerDeployBlock > 0n ? cfg.ledgerDeployBlock : ccHead > 20000n ? ccHead - 20000n : 0n
      let logs: unknown[] = []
      try {
        logs = await client.getContractEvents({ address: cfg.ledger, abi: ledgerAbi, fromBlock: from, toBlock: ccHead })
      } catch {
        // some RPCs cap ranges; retry with a smaller window
        try { logs = await client.getContractEvents({ address: cfg.ledger, abi: ledgerAbi, fromBlock: ccHead > 2000n ? ccHead - 2000n : 0n, toBlock: ccHead }) } catch { logs = [] }
      }
      const out: FeedItem[] = []
      for (const l of logs as { eventName?: string; args?: Record<string, unknown>; transactionHash: string; blockNumber: bigint }[]) {
        const name = l.eventName ?? ''
        if (!NAMES.includes(name)) continue
        const a = l.args ?? {}
        if (circleId !== undefined && 'circleId' in a && (a.circleId as bigint) !== circleId) continue
        if (member) {
          const who = (a.member ?? a.recipient) as string | undefined
          const list = a.members as string[] | undefined
          const hit = (who && who.toLowerCase() === member) || (list && list.some((m) => m.toLowerCase() === member))
          if (!hit) continue
        }
        out.push({ kind: name, text: describe(name, a), tx: l.transactionHash as `0x${string}`, block: l.blockNumber, qid: a.queryId as string | undefined, args: a })
      }
      if (!cancelled) { setItems(out.reverse()); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [client, ccHead, circleId, member])
  return { items, loading }
}

export function useGlobalStats() {
  const { items } = useLedgerEvents()
  const proven = items.filter((i) => i.kind === 'ContributionRecorded')
  const onTime = proven.filter((i) => i.args.onTime).length
  const missed = items.filter((i) => i.kind === 'ContributionMissed').length
  const settled = items.filter((i) => i.kind === 'PayoutConfirmed').reduce((acc, i) => acc + Number(i.args.amount as bigint), 0) / 1e6
  const batches = items.filter((i) => i.kind === 'BatchVerified')
  const batched = batches.reduce((acc, i) => acc + Number(i.args.count as bigint), 0)
  return { proven: proven.length, onTimePct: proven.length ? Math.round((onTime / proven.length) * 100) : 0, missed, settled, batches: batches.length, batched }
}

export const isProven = (c?: Contribution) => !!c && c.queryId !== ZERO32

export type VaultPayment = { member: `0x${string}`; amount: bigint; tx: `0x${string}`; block: bigint }

/** Contributed events on the Sepolia vault for one (circle, round). Scans from the round's opening block. */
export function useVaultPayments(circleId: bigint | undefined, round: number | undefined, fromBlock: bigint | undefined) {
  const client = usePublicClient({ chainId: sepolia.id })
  const { data: head } = useBlockNumber({ chainId: sepolia.id, watch: true })
  const [payments, setPayments] = useState<VaultPayment[]>([])
  useEffect(() => {
    if (!client || !cfg.vault || circleId === undefined || round === undefined || fromBlock === undefined || head === undefined) return
    let cancelled = false
    ;(async () => {
      const start = fromBlock > 20n ? fromBlock - 20n : 0n
      const out: VaultPayment[] = []
      try {
        const logs = await client.getContractEvents({ address: cfg.vault, abi: vaultAbi, eventName: 'Contributed', args: { circleId, round }, fromBlock: start, toBlock: head })
        for (const l of logs as { args: Record<string, unknown>; transactionHash: string; blockNumber: bigint }[]) out.push({ member: l.args.member as `0x${string}`, amount: l.args.amount as bigint, tx: l.transactionHash as `0x${string}`, block: l.blockNumber })
      } catch {
        // range-capped RPC: walk backwards in 2000-block windows, at most 10 windows
        let to = head
        for (let i = 0; i < 10 && to > start; i++) {
          const from = to - 2000n > start ? to - 2000n : start
          try {
            const logs = await client.getContractEvents({ address: cfg.vault, abi: vaultAbi, eventName: 'Contributed', args: { circleId, round }, fromBlock: from, toBlock: to })
            for (const l of logs as { args: Record<string, unknown>; transactionHash: string; blockNumber: bigint }[]) out.push({ member: l.args.member as `0x${string}`, amount: l.args.amount as bigint, tx: l.transactionHash as `0x${string}`, block: l.blockNumber })
          } catch { /* skip window */ }
          to = from - 1n
        }
      }
      if (!cancelled) setPayments(out)
    })()
    return () => { cancelled = true }
  }, [client, circleId, round, fromBlock, head])
  return payments
}
