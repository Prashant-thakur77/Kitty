import { Link } from 'react-router-dom'
import { Compass, ArrowRight } from 'lucide-react'
import { Reveal, Stagger, Item, Spotlight } from '../components/motion'
import { Tag } from '../components/ui'
import { useTour } from '../tour/Tour'
import { firstStepOfTab, STEPS, type TourStep } from '../tour/steps'

type Source = { label: string; tone: 'mint' | 'sky' | 'amber' | 'muted' }
const LEDGER: Source = { label: 'KittyLedger views', tone: 'mint' }
const EVENTS: Source = { label: 'KittyLedger events', tone: 'mint' }
const FD3: Source = { label: '0x0FD3 ChainInfo', tone: 'amber' }
const FD2: Source = { label: '0x0FD2 block prover', tone: 'sky' }
const PROVER: Source = { label: 'Proof Builder', tone: 'sky' }
const VAULT: Source = { label: 'KittyVault events · Sepolia', tone: 'muted' }
const CREDIT: Source = { label: 'KittyCreditLine views', tone: 'mint' }
const BADGE: Source = { label: 'KittyBadge tokenURI', tone: 'mint' }
const RECORD: Source = { label: 'recorded testnet run', tone: 'muted' }
const LABAPI: Source = { label: 'local lab API', tone: 'muted' }

type Entry = { tab: TourStep['tab']; name: string; route: string; path: string; summary: string; can: string[]; sources: Source[] }

const ENTRIES: Entry[] = [
  {
    tab: 'landing', name: 'Home', route: '/', path: '/',
    summary: 'The pitch and the live state of the ledger on one page. The 3D circle is a real circle, the counters are real events.',
    can: ['Open the newest circle or the attack lab from the hero', 'Read the four counters: payments proven, on-time share, misses, tUSD settled', 'Follow the four-step settlement and the trust comparison', 'Jump to a score lookup or the credit line'],
    sources: [LEDGER, EVENTS, FD3],
  },
  {
    tab: 'circles', name: 'Circles', route: '/circles', path: '/circles',
    summary: 'Every circle on KittyLedger as a card, newest last, with a live strip for the pot, the deadline block and the attested distance to it.',
    can: ['See members, installment, round and source chain per circle', 'Read how many blocks the attested frontier is short of the deadline', 'Open a circle, or start the Create form'],
    sources: [LEDGER, FD3],
  },
  {
    tab: 'circle', name: 'A circle', route: '/circle/:id', path: '/circles',
    summary: 'The round as the ledger sees it: an urgency band in blocks, the rotation wheel, the members with their proofs, the round history and the proof feed.',
    can: ['Pay the installment into the vault on Sepolia (listed members)', 'Prove the whole round from any wallet: attestation, batch proof, free preflight, one precompile call', 'Re-verify any proven payment against 0x0FD2 in the browser', 'Close a round once everyone is proven or the deadline plus grace is attested', 'Accept membership, or sign and redeem invites in an open circle'],
    sources: [LEDGER, EVENTS, FD3, FD2, PROVER, VAULT],
  },
  {
    tab: 'create', name: 'Create and Join', route: '/create · /join/:id', path: '/create',
    summary: 'One Creditcoin transaction opens a circle; invites are links signed by the organiser that only the invited wallet can redeem, once.',
    can: ['List 2 to 10 members, or open a circle with a member cap', 'Set the installment, the round length in Sepolia blocks and the rotation rule', 'Pick the source chain from the 0x0FD3 registry; the start height is placed beyond the attested frontier', 'Redeem an invite at /join/:id with the invited wallet'],
    sources: [LEDGER, FD3],
  },
  {
    tab: 'score', name: 'Score', route: '/score/:address', path: '/score',
    summary: 'What a lender sees: the Kitty Score dial, the counters behind it, the score replayed over time, a proof bundle, the soulbound badge and the history with its evidence.',
    can: ['Look up any address, or your own wallet', 'Download a proof bundle a lender can re-check against the precompile', 'Claim the ERC-5192 badge once you have proven history', 'Open the Creditcoin transaction behind every history row'],
    sources: [LEDGER, EVENTS, BADGE],
  },
  {
    tab: 'borrow', name: 'Borrow', route: '/borrow', path: '/borrow',
    summary: 'KittyCreditLine underwrites from nothing but the score: tier A borrows 100% of proven volume, B 50%, C 20%, D nothing.',
    can: ['Read underwrite(address) for any member, with the reason string from the contract', 'Borrow kUSD against the limit and repay it from the connected wallet', 'See the pool size and your kUSD balance'],
    sources: [CREDIT, LEDGER],
  },
  {
    tab: 'steward', name: 'Steward', route: '/steward', path: '/steward',
    summary: 'The agent in three layers: the ledger has final say, deterministic policy decides only when to prove, and the model may only cite figures from the log.',
    can: ['Read every decision with the chain state it saw and the transactions it produced', 'Ask the steward a question and watch the citation validator strip what it cannot back', 'Open each transaction on the explorer (testnet log)'],
    sources: [LABAPI, RECORD],
  },
  {
    tab: 'lab', name: 'Attack lab', route: '/lab', path: '/lab',
    summary: 'Eight ways to cheat the ledger, each pushed through proof, precompile and ledger for real; six decoded rejections, two accepted by design.',
    can: ['Read the recorded run against Sepolia and CC3 Testnet with explorer links on every hash', 'Run each scenario live against a local world with the lab API', 'See why each check holds, in one line per card'],
    sources: [RECORD, LABAPI, FD2],
  },
  {
    tab: 'architecture', name: 'Architecture', route: '/architecture', path: '/architecture',
    summary: 'The proof flow as a scene and as seven nodes: pay, attest, prove, verify, decode and bind, clock, score and payout proof.',
    can: ['Watch packets for proven payments and ticks when the attested frontier moves', 'Open the source file behind each node on GitHub', 'See which precompile functions and Proof Builder endpoints the app uses'],
    sources: [EVENTS, FD3],
  },
  {
    tab: 'present', name: 'Present', route: '/presentation', path: '/presentation',
    summary: 'The submission deck as slides, with a live-circle slide reading circle 1 from the ledger and a testnet slide of real transactions.',
    can: ['Move with the arrows, Space, Enter and Backspace', 'Print every slide to PDF', 'Read the steward\'s last recorded decisions on the steward slide'],
    sources: [LEDGER, EVENTS, FD3, RECORD],
  },
  {
    tab: 'story', name: 'Story', route: '/story', path: '/story',
    summary: 'The 3D explainer that opens the demo video, in three chapters: the problem, the split, what Creditcoin makes possible.',
    can: ['Play, pause and change chapter with Space and the arrow keys', 'Read the captions as text without WebGL or under reduced motion'],
    sources: [],
  },
  {
    tab: 'telegram', name: 'Telegram', route: '@KittyCirclesBot', path: '/',
    summary: 'A circle lives in a group chat, so the bot does too: every answer is a chain read, every push is a ledger event, and it holds no key.',
    can: ['/circle and /score from chain reads only', '/watch pushes every proof, miss, close and payout with its Creditcoin transaction, and reminds before deadlines', 'Open the dashboard inside Telegram as a Mini App'],
    sources: [LEDGER, EVENTS, FD3, CREDIT],
  },
]

export function Guide() {
  const tour = useTour()
  return (
    <main className="page">
      <Reveal className="page-head">
        <div>
          <div className="eyebrow">Guide</div>
          <h1>What each tab does</h1>
          <p className="sub">
            Kitty keeps the money in a vault on Ethereum Sepolia and the rules in KittyLedger on Creditcoin, fed only by transactions the Attestcoin block prover (0x0FD2) verified and deadlines the ChainInfo precompile (0x0FD3) attested. Every page below reads that ledger; the chips say which source feeds it. The nav shows the latest Sepolia block against the latest attested block, the only clock Kitty uses.
          </p>
        </div>
        <button type="button" className="btn btn-mint" onClick={() => tour.start()} title="Start the guided tour at step 1"><Compass size={15} /> Take the full tour</button>
      </Reveal>
      <Stagger className="section-gap grid gap-3 md:grid-cols-2">
        {ENTRIES.map((e) => {
          const step = firstStepOfTab(e.tab)
          const count = STEPS.filter((s) => s.tab === e.tab).length
          return (
            <Item key={e.tab} as="section">
              <Spotlight className="panel flex h-full flex-col p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-2xl">{e.name}</h2>
                  <span className="mono text-[11px]" style={{ color: 'var(--muted)' }}>{e.route}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>{e.summary}</p>
                <ul className="mt-3 grid gap-1 pl-4 text-sm" style={{ color: 'var(--muted)', listStyle: 'disc' }}>
                  {e.can.map((c) => <li key={c}>{c}</li>)}
                </ul>
                {e.sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {e.sources.map((s) => <Tag key={s.label} tone={s.tone}>{s.label}</Tag>)}
                  </div>
                )}
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                  <button type="button" className="btn btn-sm" onClick={() => tour.start(step)} title={`Start the tour at the ${e.name} step`}><Compass size={14} /> Take the tour from here</button>
                  <Link to={e.path} className="btn btn-ghost btn-sm no-underline" title={`Go to ${e.path}`}>Open <ArrowRight size={14} className="arrow" /></Link>
                  <span className="mono ml-auto text-[11px]" style={{ color: 'var(--dim)' }}>{count} step{count === 1 ? '' : 's'}</span>
                </div>
              </Spotlight>
            </Item>
          )
        })}
      </Stagger>
      <p className="section-gap text-xs" style={{ color: 'var(--muted)' }}>
        Add <span className="mono">?tour=1</span> to any address to start the tour there. Your progress is not stored on chain: finishing or skipping is remembered in this browser only.
      </p>
    </main>
  )
}
