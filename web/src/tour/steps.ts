/**
 * The guided tour, one step per thing a first-time visitor should understand. Every `target` is a `data-tour` value
 * on a real element; `route` may carry two tokens the tour resolves from the ledger at run time:
 *   `:latest`  the id of the newest circle (`circleCount`), so the circle steps open a circle that exists
 *   `:member`  the first member of that circle, so the score steps show a real record
 * If a token cannot be resolved (empty ledger) the route falls back to the list page and the card explains.
 * `mobileTarget` replaces `target` under 640px, where some nav elements live behind the menu button.
 */
export type Placement = 'top' | 'bottom' | 'left' | 'right' | 'auto'

export type TourStep = {
  id: string
  route: string
  /** A `data-tour` value; empty when the step has no element to point at (the card sits centred). */
  target: string
  title: string
  body: string
  placement: Placement
  mobileTarget?: string
  /** Tab the step belongs to; the Guide page starts the tour at the first step of each tab. */
  tab: 'nav' | 'landing' | 'circles' | 'circle' | 'create' | 'score' | 'borrow' | 'steward' | 'lab' | 'evidence' | 'architecture' | 'present' | 'telegram' | 'story'
}

export const STEPS: TourStep[] = [
  {
    id: 'nav', tab: 'nav', route: '/', target: 'nav', mobileTarget: 'nav-menu', placement: 'bottom',
    title: 'Seven tabs, two chains',
    body: 'Circles, Score and Borrow are what a member uses. Steward, Attack lab, Architecture and Present are for anyone checking the system. Every page reads the live ledger on Creditcoin and works without a wallet; on phones the tabs sit behind the menu button.',
  },
  {
    id: 'attestation', tab: 'nav', route: '/', target: 'attestation', placement: 'bottom',
    title: 'The only clock',
    body: 'The left number is the latest Ethereum Sepolia block. The right one is the latest Sepolia block the attestor network has attested on Creditcoin, read from the ChainInfo precompile 0x0FD3 every 8 seconds. Kitty never uses wall time or block.timestamp: a deadline counts only once its block is attested. On phones the same numbers sit at the foot of the menu.',
  },
  {
    id: 'hero', tab: 'landing', route: '/', target: 'hero', placement: 'auto',
    title: 'The circle, live',
    body: 'The 3D circle is the circle with the newest proven payment, drawn from ledger events, and every pulse it plays is one of that circle\'s own payments. Under 640px or without WebGL the rotation wheel stands in. "Open a live circle" jumps to the newest circle on the ledger.',
  },
  {
    id: 'stats', tab: 'landing', route: '/', target: 'stats', placement: 'top',
    title: 'Four numbers from ledger events',
    body: 'Payments proven counts ContributionRecorded events, each one verified by the block-prover precompile 0x0FD2. On time is the share of those proofs the ledger marked on time, meaning the proven height was at or below the deadline height. Missed counts ContributionMissed, and tUSD settled sums PayoutConfirmed, the payouts proven back from Ethereum.',
  },
  {
    id: 'circles-list', tab: 'circles', route: '/circles', target: 'circles-list', placement: 'auto',
    title: 'Every circle on the ledger',
    body: 'The list comes from circleCount and getCircle on KittyLedger, newest last. Each card shows the members, installment, current round and source chain, plus a live strip: the pot this round, the deadline block and how many blocks the attested frontier is short of it. Click a card to open the circle.',
  },
  {
    id: 'create-button', tab: 'circles', route: '/circles', target: 'create-button', placement: 'bottom',
    title: 'Open a circle from the browser',
    body: 'One Creditcoin transaction opens a circle; money never touches the ledger. The form is on the Create page, which the tour visits after the circle itself.',
  },
  {
    id: 'circle-band', tab: 'circle', route: '/circle/:latest', target: 'circle-band', placement: 'bottom',
    title: 'The urgency band',
    body: 'The headline is chosen from your own state in this round: how many are proven, PAY if you are a listed member who has not paid, PAID with the proof pending, PROVEN with the block, DEADLINE ATTESTED once the deadline plus a 64-block grace window is attested. The border turns amber within 20 blocks of the deadline, rose once the round can close, and mint once your own payment is in.',
  },
  {
    id: 'circle-ticks', tab: 'circle', route: '/circle/:latest', target: 'circle-ticks', placement: 'bottom',
    title: 'The round in Sepolia blocks',
    body: 'Forty-eight ticks (24 on a phone) from the block the round opened to its deadline block. Mint ticks are attested, amber ticks are mined on Sepolia but not yet attested, the tall white tick is the Sepolia head and the rose tick is the deadline. Time on this page is measured in blocks, never minutes.',
  },
  {
    id: 'circle-stats', tab: 'circle', route: '/circle/:latest', target: 'circle-stats', placement: 'bottom',
    title: 'Installment, pot, proven, deadline',
    body: 'Installment and deadline come from getCircle and deadlineHeight; the pot and the proven count come from getRound. The deadline card asks 0x0FD3 get_attestation_bounds which attestation covers the deadline block, or which is the latest below it.',
  },
  {
    id: 'circle-wheel', tab: 'circle', route: '/circle/:latest', target: 'circle-wheel', placement: 'right',
    title: 'The rotation wheel',
    body: 'Members around the ring, the pot in the middle and a mint arc on the member who receives this round. In fixed order the arc follows the member list; by Kitty Score it sits on the best proven record that has not received yet. Colours are the same ledger reads as the table: on time, late, paid with proof pending, missed.',
  },
  {
    id: 'circle-members', tab: 'circle', route: '/circle/:latest', target: 'circle-members', placement: 'left',
    title: 'Who is proven, at which block',
    body: 'Each row reads getContribution for this round, plus getRecord and creditScore for the member. The status tag names the Sepolia block the proof carried; five small bars are the on-time, late and missed history. "re-verify" fetches the payment\'s proof again and asks 0x0FD2.verify in the browser, then flips a byte to show the rejection.',
  },
  {
    id: 'circle-history', tab: 'circle', route: '/circle/:latest', target: 'circle-history', placement: 'top',
    title: 'Round history',
    body: 'One node per round from getRound: Open, Closed once every payment is proven or the deadline is attested, and Paid only after the Ethereum payout has itself been proven back through 0x0FD2. "show as list" adds the recipient and pot for each round.',
  },
  {
    id: 'circle-prove', tab: 'circle', route: '/circle/:latest', target: 'circle-prove', placement: 'top',
    title: 'Prove it yourself',
    body: 'Any wallet with a little tCTC can prove the round: 0x0FD3 says which attestation covers each payment, the Attestcoin Proof Builder returns one batch proof, the free view 0x0FD2.verify preflights it, then recordContributions is submitted. The ledger checks the proof, never the caller. This panel only appears while the round is open with unproven members.',
  },
  {
    id: 'circle-feed', tab: 'circle', route: '/circle/:latest', target: 'circle-feed', placement: 'top',
    title: 'The proof feed',
    body: 'Every KittyLedger event for this circle, newest first: batches verified, payments proven with their query id, misses with the attestation that proved the deadline, rounds closed and payouts proven. Each row links to the Creditcoin transaction, where the BatchVerified log from the precompile call can be found.',
  },
  {
    id: 'create-circle', tab: 'create', route: '/create', target: 'create-circle', placement: 'right',
    title: 'Name, members, installment, rotation',
    body: 'A listed circle names 2 to 10 members now; an open circle takes a member cap and fills through invites. The installment is the exact tUSD amount the vault must receive, the round length is in Sepolia blocks with the approximate time shown, and rotation is fixed order or by proven score. Every write is simulated first so a revert shows its decoded error before the wallet is asked.',
  },
  {
    id: 'create-chain', tab: 'create', route: '/create', target: 'create-chain', placement: 'left',
    title: 'Source chain and start height',
    body: 'The chain picker reads get_supported_chains from 0x0FD3 and greys out chains where the ledger does not trust the vault. The start height defaults to the latest attested Sepolia block plus 20 because the ledger refuses a circle whose first round would already be over on the attested frontier.',
  },
  {
    id: 'create-open', tab: 'create', route: '/create', target: 'create-open', placement: 'bottom',
    title: 'Invites and consent',
    body: 'In an open circle the organiser\'s circle page shows an Invites panel: the wallet signs the invite digest and produces a /join link that only the invited wallet can redeem, once. Listed members accept membership from the circle page instead. Only members who consented can ever be marked missed.',
  },
  {
    id: 'score-dial', tab: 'score', route: '/score/:member', target: 'score-dial', placement: 'right',
    title: 'What a lender sees',
    body: 'The dial reads creditScore(address) from KittyLedger: 500 base, plus 15 per on-time installment, minus 20 late, minus 120 missed, clamped to 300 to 850, with tiers D, C, B and A at 500, 600 and 700. Paste any address above, or connect a wallet to see your own.',
  },
  {
    id: 'score-breakdown', tab: 'score', route: '/score/:member', target: 'score-breakdown', placement: 'right',
    title: 'The counters behind the score',
    body: 'getRecord(address) returns on-time, late, missed, pots received and proven volume. Nothing here is self-reported: a counter moves only when 0x0FD2 verifies a payment or 0x0FD3 attests a deadline that passed without one.',
  },
  {
    id: 'score-sparkline', tab: 'score', route: '/score/:member', target: 'score-sparkline', placement: 'left',
    title: 'Score over time',
    body: 'The line replays every ContributionRecorded and ContributionMissed event for this address through the on-chain formula and ends at the live creditScore. With no scoring events yet the score sits at the 500 base.',
  },
  {
    id: 'score-lender', tab: 'score', route: '/score/:member', target: 'score-lender', placement: 'left',
    title: 'Lender view and proof bundle',
    body: 'The JSON is what any Creditcoin contract can read without trusting Kitty. "Proof bundle" downloads the same record with every history entry and the Creditcoin transaction that carried its Attestcoin proof, so a lender can re-check each row against the precompile.',
  },
  {
    id: 'score-badge', tab: 'score', route: '/score/:member', target: 'score-badge', placement: 'left',
    title: 'A soulbound badge',
    body: 'KittyBadge is an ERC-5192 token whose SVG is rendered on chain from the live ledger. A member with proven history claims it from their own wallet; it cannot be transferred and its picture changes as the score does.',
  },
  {
    id: 'score-history', tab: 'score', route: '/score/:member', target: 'score-history', placement: 'top',
    title: 'History with its evidence',
    body: 'Every row is a proof or an attested deadline: on time, late, missed, received pot, payout proven. A miss shows the deadline block and an "attested @" pill whose tooltip carries the attestation hash. The last column links the Creditcoin transaction.',
  },
  {
    id: 'borrow', tab: 'borrow', route: '/borrow', target: 'borrow-underwrite', placement: 'right',
    title: 'Credit underwritten from the score',
    body: 'KittyCreditLine.underwrite(address) reads the Kitty Score and turns it into a limit: tier A borrows 100% of proven contribution volume, B 50%, C 20%, D nothing, with the reason string from the contract. Without a wallet the page underwrites a member of the latest circle; paste any address for a read-only lookup. Borrow and Repay in the Pool card need the connected wallet.',
  },
  {
    id: 'steward-log', tab: 'steward', route: '/steward', target: 'steward-log', placement: 'right',
    title: 'The steward\'s decision log',
    body: 'The steward is an agent in three layers: the ledger has final say, deterministic policy decides only when to prove, and the model explains. Every entry is a decision (prove, wait, close, payout, confirm, skip) with evidence chips holding the chain state it saw, such as the attested height and the batch size, and the transactions it produced. With the lab API the log is live; otherwise it is the recorded CC3 Testnet log with explorer links.',
  },
  {
    id: 'steward-ask', tab: 'steward', route: '/steward', target: 'steward-ask', placement: 'left',
    title: 'Ask the steward',
    body: 'Layer 3 rewrites the log in plain language. Every figure in the answer must be cited and must appear in the log; the citation validator strips any sentence it cannot back and lists it under "stripped before display". Without an API key the deterministic Layer 2 sentence is shown instead.',
  },
  {
    id: 'lab', tab: 'lab', route: '/lab', target: 'lab-grid', placement: 'auto',
    title: 'Eight ways to cheat',
    body: 'Each card pushes a real transaction through proof, precompile and ledger: a replayed proof, a spoofed emitter, a wrong chain key, a reverted source transaction, a stolen steward key, a stranger submitting the proof, poisoned reasoning and a late payment. On the hosted build the cards show the run recorded on Sepolia and CC3 Testnet, and every transaction hash links to an explorer. With the local lab API each card runs live.',
  },
  {
    id: 'evidence', tab: 'evidence', route: '/evidence', target: 'evidence-table', placement: 'top',
    title: 'Every transaction, re-verified',
    body: 'All 128 on-chain steps of the testnet campaign, from docs/TESTNET_LOG.md: deployments, payments, batch proofs, closes, payouts and the attack scenarios, on both chains. CI re-reads every receipt and compares status and gas with the log; "Verify in this browser" does the same from your machine against the public RPCs. Filter by chain or kind, open any hash on an explorer.',
  },
  {
    id: 'arch-scene', tab: 'architecture', route: '/architecture', target: 'arch-scene', placement: 'bottom',
    title: 'The proof flow',
    body: 'Money on Ethereum, proof through Attestcoin, rules on Creditcoin. The scene is driven by the chain: a packet for each proven payment and a tick when the attested frontier moves. Without WebGL it shows the same flow as text.',
  },
  {
    id: 'arch-flow', tab: 'architecture', route: '/architecture', target: 'arch-flow', placement: 'auto',
    title: 'Verify, decode, bind, clock, score',
    body: 'Seven nodes follow one payment: pay on Sepolia, attest, one batch proof, verifyAndEmit on 0x0FD2, decode the receipt and bind emitter, sender, target, amount and round, deadlines from is_height_attested on 0x0FD3, then score and the payout proof. Each node links to the source file on GitHub.',
  },
  {
    id: 'present', tab: 'present', route: '/presentation', target: 'present-controls', placement: 'top',
    title: 'The deck',
    body: 'The submission deck as slides: arrow keys, Space and Enter move through them, and Print to PDF prints every slide. The live-circle slide reads circle 1 from the ledger, the steward slide shows the last recorded decisions, and the testnet slide lists real transactions with gas.',
  },
  {
    id: 'telegram', tab: 'telegram', route: '/presentation', target: 'telegram', placement: 'bottom',
    title: 'Kitty on Telegram',
    body: 'A circle lives in a group chat, so the bot does too. /circle and /score answer from chain reads only, /watch pushes every proof, miss, close and payout into the chat with its Creditcoin transaction, and the dashboard opens inside Telegram as a Mini App. The bot holds no key.',
  },
  {
    id: 'story', tab: 'story', route: '/story', target: '', placement: 'auto',
    title: 'The story, in three chapters',
    body: 'The 3D explainer that opens the demo video: the problem, the split between money on Ethereum and rules on Creditcoin, and what Creditcoin makes possible. Space plays and pauses, the arrow keys change chapter. That is the end of the tour; the Guide page keeps a written version of everything you just saw.',
  },
]

export const stepIndex = (id: string) => Math.max(0, STEPS.findIndex((s) => s.id === id))
export const firstStepOfTab = (tab: TourStep['tab']) => STEPS.find((s) => s.tab === tab)?.id ?? STEPS[0].id
