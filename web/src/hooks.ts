import { useEffect, useState } from 'react'
import { useBlockNumber, usePublicClient, useReadContract, useReadContracts } from 'wagmi'
import { cfg, CHAIN_INFO_PRECOMPILE } from './config'
import { chainInfoAbi, ledgerAbi } from './lib/abi'
import type { Circle, Contribution, Record_, Round } from './lib/types'
import { creditcoinTestnet, sepolia } from './lib/wagmi'

const cc = { chainId: creditcoinTestnet.id } as const

export function useAttestation() {
  const { data: head } = useBlockNumber({ chainId: sepolia.id, watch: true })
  const { data } = useReadContract({
    ...cc,
    address: CHAIN_INFO_PRECOMPILE,
    abi: chainInfoAbi,
    functionName: 'get_latest_attestation_height_and_hash',
    args: [BigInt(cfg.sourceChainKey)],
    query: { refetchInterval: 8000 },
  })
  const attested = data?.exists ? data.height : undefined
  return { head, attested, lag: head !== undefined && attested !== undefined ? Number(head - attested) : undefined }
}

export function useCircleCount() {
  return useReadContract({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'circleCount', query: { enabled: !!cfg.ledger } })
}

export function useCircle(id: bigint | undefined) {
  const enabled = !!cfg.ledger && id !== undefined && id > 0n
  const circle = useReadContract({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'getCircle', args: [id ?? 0n], query: { enabled } })
  const c = circle.data as Circle | undefined
  const round = useReadContract({
    ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'getRound', args: [id ?? 0n, c?.currentRound ?? 0], query: { enabled: enabled && !!c },
  })
  const deadline = useReadContract({
    ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'deadlineHeight', args: [id ?? 0n, c?.currentRound ?? 0], query: { enabled: enabled && !!c },
  })
  return { circle: c, round: round.data as Round | undefined, deadline: deadline.data as bigint | undefined, refetch: () => { circle.refetch(); round.refetch() } }
}

export function useRoundDetail(id: bigint | undefined, round: number | undefined, members: readonly `0x${string}`[] | undefined) {
  const enabled = !!cfg.ledger && id !== undefined && round !== undefined && !!members?.length
  const contribs = useReadContracts({
    contracts: (members ?? []).map((m) => ({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'getContribution', args: [id ?? 0n, round ?? 0, m] })),
    query: { enabled },
  })
  const records = useReadContracts({
    contracts: (members ?? []).map((m) => ({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'getRecord', args: [m] })),
    query: { enabled },
  })
  const scores = useReadContracts({
    contracts: (members ?? []).map((m) => ({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'creditScore', args: [m] })),
    query: { enabled },
  })
  return {
    contributions: contribs.data?.map((r) => r.result as Contribution | undefined),
    records: records.data?.map((r) => r.result as Record_ | undefined),
    scores: scores.data?.map((r) => r.result as readonly [number, string] | undefined),
  }
}

export function useRounds(id: bigint | undefined, count: number) {
  const enabled = !!cfg.ledger && id !== undefined && count > 0
  const q = useReadContracts({
    contracts: Array.from({ length: count }, (_, r) => ({ ...cc, address: cfg.ledger, abi: ledgerAbi, functionName: 'getRound', args: [id ?? 0n, r] })),
    query: { enabled },
  })
  return q.data?.map((r) => r.result as Round | undefined)
}

export type FeedItem = { kind: string; text: string; tx: `0x${string}`; block: bigint; qid?: string }

export function useProofFeed(circleId: bigint | undefined) {
  const client = usePublicClient({ chainId: creditcoinTestnet.id })
  const { data: ccHead } = useBlockNumber({ chainId: creditcoinTestnet.id, watch: true })
  const [items, setItems] = useState<FeedItem[]>([])
  useEffect(() => {
    if (!client || !cfg.ledger || ccHead === undefined) return
    let cancelled = false
    ;(async () => {
      const from = cfg.ledgerDeployBlock > 0n ? cfg.ledgerDeployBlock : ccHead > 5000n ? ccHead - 5000n : 0n
      const names = ['CircleCreated', 'BatchVerified', 'ContributionRecorded', 'ContributionMissed', 'RoundClosed', 'RoundOpened', 'PayoutConfirmed', 'CircleCompleted']
      const logs = await client.getContractEvents({ address: cfg.ledger, abi: ledgerAbi, fromBlock: from, toBlock: ccHead }).catch(() => [])
      const out: FeedItem[] = []
      for (const l of logs) {
        const name = (l as { eventName?: string }).eventName ?? ''
        if (!names.includes(name)) continue
        const a = (l as { args?: Record<string, unknown> }).args ?? {}
        if (circleId !== undefined && 'circleId' in a && (a.circleId as bigint) !== circleId) continue
        const s = (v: unknown) => (typeof v === 'string' && v.startsWith('0x') && v.length === 42 ? `${v.slice(0, 6)}…${v.slice(-4)}` : String(v))
        let text = name
        if (name === 'ContributionRecorded') text = `Proven: ${s(a.member)} paid ${Number(a.amount as bigint) / 1e6} tUSD for round ${a.round} at Sepolia block ${a.sourceHeight} (${a.onTime ? 'on time' : 'LATE'})`
        if (name === 'BatchVerified') text = `0x0FD2 verified ${a.count} tx in ONE call · Sepolia blocks ${a.fromHeight}–${a.toHeight}`
        if (name === 'ContributionMissed') text = `Missed: ${s(a.member)} did not pay round ${a.round} by attested block ${a.deadlineHeight}`
        if (name === 'RoundClosed') text = `Round ${a.round} closed → ${s(a.recipient)} receives ${Number(a.pot as bigint) / 1e6} tUSD (${a.missedCount} missed)`
        if (name === 'RoundOpened') text = `Round ${a.round} open · pay by Sepolia block ${a.deadlineHeight}`
        if (name === 'PayoutConfirmed') text = `Payout proven: ${s(a.recipient)} received ${Number(a.amount as bigint) / 1e6} tUSD on Ethereum`
        if (name === 'CircleCreated') text = `Circle "${a.name}" created · ${(a.members as string[]).length} members · ${Number(a.contribution as bigint) / 1e6} tUSD/round`
        if (name === 'CircleCompleted') text = `Circle completed — every member has received a pot`
        out.push({ kind: name, text, tx: l.transactionHash as `0x${string}`, block: l.blockNumber as bigint, qid: a.queryId as string | undefined })
      }
      if (!cancelled) setItems(out.reverse())
    })()
    return () => { cancelled = true }
  }, [client, ccHead, circleId])
  return items
}
