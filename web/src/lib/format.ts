export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—')
export const usd = (v: bigint | number | undefined) =>
  v === undefined ? '—' : `${(Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} tUSD`
export const num = (v: bigint | number | undefined) => (v === undefined ? '—' : Number(v).toLocaleString())
