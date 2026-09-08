import torchaudio as ta, json, os
from chatterbox.tts import ChatterboxTTS
OUT = os.path.dirname(os.path.abspath(__file__))
segments = [
 ("01_problem", "This is Amara's savings circle in Lagos. Ten friends, one hundred dollars a month, one of them takes the pot each month. It works until the treasurer runs, or a member stops paying and nobody outside the circle ever knows. Ten years of perfect payments. Zero credit history."),
 ("02_idea", "Kitty keeps the money on Ethereum, where members already hold stablecoins, and puts the rules on Creditcoin. Nobody trusts a treasurer, an oracle operator, or a bridge, because every payment is proven across chains by the Attestcoin Protocol."),
 ("03_circle", "Here is the circle on Creditcoin. Three members, one hundred test dollars per round. The deadline is a source chain block number, not a timestamp. The header shows the latest Sepolia block next to the latest block the attestor network has attested on Creditcoin."),
 ("04_pay", "A member pays. That is a plain escrow deposit on the source chain. Nothing else is required from her."),
 ("05_prove", "The worker waits for the attestation, then asks the Proof Builder for one batch proof covering every payment in the round. The ledger verifies all of them with a single call to the block prover precompile, decodes each receipt, and binds it to the vault, the member, the amount and the round."),
 ("06_close", "Round closed. Amara receives three hundred. The operator pays out on the source chain, and that payout is proven back. The round shows Paid only after the ledger has seen the money move."),
 ("07_miss", "Round two. One member does not pay. Nothing happens until the deadline block plus a grace window is attested on Creditcoin. The ChainInfo precompile is the only clock. Then the round closes, the missed payment is recorded, and the score drops to three ninety five."),
 ("08_attack", "Try to cheat it. Replay a proof: rejected, query already processed. A fake vault emitting a perfect event: rejected, wrong emitter. Same proof on another chain key: rejected. A reverted transaction with a valid proof: rejected, because the precompile proves inclusion, not success."),
 ("09_score", "Every number in this score is a proven transaction or an attested deadline. A lender on Creditcoin can underwrite against it, and Kitty's own credit line already does. Kitty. Savings circles where every payment is proven, not promised."),
]
model = ChatterboxTTS.from_pretrained(device="cuda")
durations = {}
for name, text in segments:
    wav = model.generate(text, audio_prompt_path="/home/prashant/Downloads/kristen.mp3")
    path = os.path.join(OUT, name + ".wav")
    ta.save(path, wav, model.sr)
    durations[name] = wav.shape[-1] / model.sr
    print(name, round(durations[name], 1), "s", flush=True)
json.dump(durations, open(os.path.join(OUT, "durations.json"), "w"), indent=1)
print("TTS_DONE")
