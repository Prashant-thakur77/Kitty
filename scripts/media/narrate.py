"""Chatterbox TTS narration for the Kitty demo video. One wav per segment + durations.json.
Run: ~/chatterbox-env/bin/python scripts/media/narrate.py [outdir]
Voice prompt: set VOICE_PROMPT to a short wav/mp3 of a voice you have the rights to use (exaggeration kept low for narration)."""
import torchaudio as ta, json, os, sys
from chatterbox.tts import ChatterboxTTS

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

segments = [
 ("01_hook", "What if a savings circle could prove every payment it ever received? Not promise it. Prove it. This is Kitty, live on Creditcoin."),
 ("02_problem_a", "Hundreds of millions of people save like this. Ten friends, one pot a month, and one of them takes it home. Chit funds in India. Susu in Ghana. Tandas in Mexico. It works because everyone watches everyone. And it runs on one thing. Trust in a treasurer."),
 ("02_problem_b", "It fails two ways. The treasurer disappears with the pot. Or a member stops paying, and nobody outside the group ever knows. Ten years of perfect payments, and the bank still sees nothing. No history. No credit. Nothing to build on."),
 ("03_split_a", "Kitty splits the circle along its natural seam. The money stays on Ethereum, in stablecoins the members already hold, inside a vault so simple it does not even know what a circle is. The rules live on Creditcoin, in a ledger that acts on nothing but proof."),
 ("03_split_b", "Every payment on Ethereum becomes a proof. The Attestcoin block prover precompile verifies it natively on Creditcoin. The only clock in the system is an attested block. No treasurer. No oracle operator. No bridge. And when the pot pays out, that payout is proven back too."),
 ("04_enable", "This is what Creditcoin makes possible. Every proven payment and every attested deadline becomes a score. A lender can read it and underwrite it. And the agent that runs the circle holds a key with no power at all. It can only submit proofs. Fire it, and a stranger's proof still settles the round."),
 ("05_live", "Here is the real thing, on Creditcoin testnet and Sepolia. Four circles have already run here. Let me connect a wallet and open a new one myself."),
 ("05b_create", "Creating a circle is one transaction on Creditcoin. Three members, one hundred test dollars a round, two hundred Sepolia blocks per round, rotation by proven score. The chain picker comes straight from the ChainInfo precompile's list of supported chains, and the start height sits just beyond the attested frontier, so a round can never be over before it opens. The dashboard simulates the call first. Then I sign."),
 ("06_circle", "Here is the circle we just opened. Look at the deadline. It is not a date. It is a Sepolia block number, and the scale shows exactly which of those blocks the attestor network has already attested on Creditcoin. The rotation runs by proven score, and every proof will show up in the history below."),
 ("07_pay", "I pay my installment. An approval, then a plain deposit into the escrow vault on Sepolia, and an event. There is no membership check here, on purpose. The vault stays simple. The ledger on Creditcoin decides what counts."),
 ("08_prove", "Now the payment has been attested, and I can prove it myself, from the browser, with no operator. The dashboard asks the ChainInfo precompile which attestation covers my block, fetches the proof from the Proof Builder, asks the block prover as a free view call whether it verifies, and then submits it. Verified on Creditcoin. The ledger checks the proof. It never checks who sent it."),
 ("09_steward", "Most of the time the steward does this work. This is its decision log, live from testnet. It pooled eight payments from two different circles into one precompile call. Every decision carries the chain state behind it, and when it explains itself, every figure must be cited from this log, or it is stripped."),
 ("10_attack", "So let us try to cheat it, against the real precompile. Replay a proof that already counted. Rejected. A fake vault with a byte for byte perfect event. Rejected, wrong emitter. A forged chain key. The precompile itself refuses the continuity proof. Steal the steward's key and try to take a pot. Every attempt reverts. Fire the agent, and a stranger's proof is accepted. Eight scenarios, all on chain, every hash on the explorer."),
 ("11_credit", "This is what a lender sees. A score built from nothing but proven payments and attested deadlines, replayed from the ledger's own events. Kitty's own credit line lends against it. A soulbound badge renders it on chain. Miss a payment, and the credit disappears."),
 ("12_telegram", "Members do not live in block explorers. They live in Telegram. This is the Kitty bot on a phone. The dashboard opens inside Telegram as a mini app, and the bot answers about any circle or member from chain reads alone. Watch a circle, and it tells you when your payment is proven, when a round closes, when your pot lands, and when a deadline is close."),
 ("13_depth", "Under the hood, Kitty uses six ChainInfo functions and the block prover's batch and view interfaces. Batches pool payments across circles under one continuity proof, preflight for free, and were measured twenty four percent cheaper than singles. Every one of these calls ran against the live precompile, and the transaction log has every hash."),
 ("14_close", "Kitty. Savings circles where every payment is proven, not promised. Run by an agent whose only power is proof. Built for BUIDL CTC on Creditcoin, with the Attestcoin Protocol at its core."),
]

only = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None
model = ChatterboxTTS.from_pretrained(device="cuda")
durations = {}
prev = os.path.join(OUT, 'durations.json')
if only and os.path.exists(prev): durations = json.load(open(prev))['durations']
for name, text in segments:
    if only and name not in only: continue
    wav = model.generate(text, audio_prompt_path=os.environ.get("VOICE_PROMPT"), exaggeration=0.45, cfg_weight=0.5)
    path = os.path.join(OUT, name + ".wav")
    ta.save(path, wav, model.sr)
    durations[name] = wav.shape[-1] / model.sr
    print(name, round(durations[name], 1), "s", flush=True)
json.dump({"durations": durations, "text": dict(segments)}, open(os.path.join(OUT, "durations.json"), "w"), indent=1)
print("TTS_DONE")
