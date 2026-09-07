export type Circle = {
  name: string
  members: readonly `0x${string}`[]
  contribution: bigint
  roundBlocks: bigint
  startHeight: bigint
  currentRound: number
  sourceVault: `0x${string}`
  status: number
  organiser: `0x${string}`
  open: boolean
  maxMembers: number
  rotation: number // 0 Fixed, 1 ByScore
}
export type Round = { status: number; contributions: number; pot: bigint; recipient: `0x${string}`; payoutQueryId: `0x${string}` }
export type Contribution = { height: bigint; queryId: `0x${string}`; onTime: boolean }
export type Record_ = { onTime: number; late: number; missed: number; received: number; volume: bigint }
export const ROUND_STATUS = ['Open', 'Closed', 'Paid'] as const
export const CIRCLE_STATUS = ['Active', 'Completed'] as const
