"""Chatterbox TTS narration for the Kitty demo video. One wav per segment + durations.json.
Run: ~/chatterbox-env/bin/python scripts/media/narrate.py [outdir]
Voice prompt: ~/Downloads/kristen.mp3 (calm, clear; exaggeration kept low for narration)."""
import torchaudio as ta, json, os, sys
from chatterbox.tts import ChatterboxTTS

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

segments = [
 ("01_hook", "What if a savings circle could prove every payment it ever received? Not promise it. Prove it. This is Kitty."),
 ("02_problem", "Hundreds of millions of people save in rotating circles. Chit funds in India. Susu in Ghana. Tandas in Mexico. Ten friends, one pot a month, and it all runs on trust in a treasurer. It fails two ways. The treasurer disappears with the pot, or a member stops paying and nobody outside the group ever knows. Ten years of perfect payments, and a bank still sees nothing."),
 ("03_solution", "Kitty splits the circle along its natural seam. The money stays on Ethereum, in stablecoins the members already hold, inside a vault so simple it does not even know what a circle is. The rules live on Creditcoin, in a ledger that acts on nothing but Ethereum transactions the Attestcoin Protocol has cryptographically proven. No treasurer. No oracle operator. No bridge."),
 ("04_circle", "Here is a live circle on Creditcoin. Three members, one hundred test dollars a round, rotation by proven score. Look at the deadline. It is not a date. It is a source chain block number, and the scale below shows exactly which of those blocks the attestor network has already attested."),
 ("05_pay", "Two members pay on the source chain. Watch what they actually do. An approval, then a plain deposit into the escrow vault, and an event. There is no membership check here, on purpose. The vault stays simple, and the ledger on Creditcoin decides what counts."),
 ("06_prove", "Now the steward goes to work. It waits for the attestor network to attest those blocks. It asks the Proof Builder for one batch proof covering every payment in the round. Before spending a single unit of gas, it asks the block prover precompile, as a free view call, whether that proof will verify. Then it submits. One call. The ledger verifies every payment, decodes every receipt, and binds each one to the vault, the member, the amount and the round."),
 ("07_close_a", "The third member pays, and now every member has paid. The steward records that last proof, and because the round is complete, it closes early. There is no waiting for a deadline when there is nothing left to wait for. Then, rotation. This circle runs by score, so the pot goes to the member with the best proven record who has not received yet. The members are tied, so the earliest wins."),
 ("07_close_b", "The vault pays out on Ethereum, and here is the part that matters. That payout transaction is itself proven back to Creditcoin. The round shows Paid only after the ledger has seen the money move. Not before."),
 ("08_miss", "Round three. Two members pay. One does not. Nothing can happen yet. The ledger will not close a round on a missing payment until the deadline block, plus a sixty four block grace window, has been attested on Creditcoin. The ChainInfo precompile is the only clock in the system. When it is attested, the round closes, the missed payment is recorded forever, and that member's score falls to four hundred and ten."),
 ("09_steward", "This is the steward's decision log. Every entry carries the chain state behind it. When it explains itself, every number it says must be cited from this log, and a validator strips any sentence it cannot back. The steward holds a key with no role, no ownership, and no allowance. Its entire power is to submit proofs."),
 ("10_attack_a", "So let us try to cheat it. Replay a proof that already counted. Rejected. Query already processed. A fake vault on Sepolia, emitting a byte for byte perfect Contributed event. Rejected. Wrong emitter, because the log address is bound to the trusted vault."),
 ("10_attack_b", "Now steal the steward's key. Try to take a pot. Try to trust a vault of your own. Try to close a round early. Every single attempt reverts on chain, with the reason decoded. And finally, fire the agent entirely. A stranger with no role, no membership and no history submits the round's proof, and the ledger accepts it. It checks the proof. It never checks the caller."),
 ("11_credit", "This is what a lender sees. A score built from nothing but proven payments and attested deadlines. And the score is used, not just displayed. Kitty's own credit line lends against it, and a soulbound badge renders it on chain. Miss a payment, and the credit disappears."),
 ("12_depth", "Under the hood, Kitty uses eight of the eleven functions on the ChainInfo precompile, batch verification across circles under one continuity proof, free preflight through the verifier's view overload, and per circle chain keys validated against the on chain registry. Before any of this was deployed, a real Sepolia proof was verified true by the live precompile on Creditcoin testnet, and a tampered one was rejected."),
 ("13_close", "Kitty. Savings circles where every payment is proven, not promised. Run by an agent whose only power is proof. Built for BUIDL CTC on Creditcoin, with the Attestcoin Protocol at its core."),
]

only = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None
model = ChatterboxTTS.from_pretrained(device="cuda")
durations = {}
prev = os.path.join(OUT, 'durations.json')
if only and os.path.exists(prev): durations = json.load(open(prev))['durations']
for name, text in segments:
    if only and name not in only: continue
    wav = model.generate(text, audio_prompt_path="/home/prashant/Downloads/kristen.mp3", exaggeration=0.45, cfg_weight=0.5)
    path = os.path.join(OUT, name + ".wav")
    ta.save(path, wav, model.sr)
    durations[name] = wav.shape[-1] / model.sr
    print(name, round(durations[name], 1), "s", flush=True)
json.dump({"durations": durations, "text": dict(segments)}, open(os.path.join(OUT, "durations.json"), "w"), indent=1)
print("TTS_DONE")
