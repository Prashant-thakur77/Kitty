# Static analysis (Slither)

Run on 12 September 2026 with Slither 0.11.6 against the deployed sources (`src/`), medium and high severity, informational and low excluded. Reproduce with:

```bash
python3 -m venv .slither && .slither/bin/pip install slither-analyzer
.slither/bin/slither . --config-file slither.config.json
```

Result: 40 contracts, 64 detectors, 12 findings in three families. None required a code change; each is triaged below with the reason, so a reviewer can disagree with the reasoning rather than wonder whether it was seen.

## 1. `reentrancy-no-eth` on `recordContributions`, `confirmPayout`, `confirmPayouts` (3 findings, medium)

The pattern flagged: `processedQueries[qid] = true` is written after the external call `VERIFIER.verifyAndEmit(...)`.

Assessment: not exploitable. `VERIFIER` is the Attestcoin block-prover precompile at the fixed address `0x0000000000000000000000000000000000000FD2`; a precompile executes native runtime code, holds no contract code, and cannot call back into the ledger, so there is no re-entrancy path. The query ids are computed and checked against `processedQueries` in `_prepareBatch` before the call, and a revert inside the precompile unwinds the entire transaction, so the checks-effects ordering cannot be exploited by a failing verification either. The same structure appears in the protocol's own `ASCBase.execute`.

Why it is not restructured anyway: the deployed ledger (`0xC2A1583F9a469EE98f2A1acF6297a0d6A073F276`) is the code in this repository, and the invariant suite (`test/invariant/`) drives exactly these entry points, including an attacker target that attempts replay. Moving the write before the call would be harmless but would make the repository diverge from the audited-by-tests bytecode that is live.

## 2. `incorrect-equality` in `KittyCreditLine.deposit` and `entitlement` (3 findings, medium)

The pattern flagged: strict comparisons `totalDeposits == 0`, `value == 0`, `units == 0`.

Assessment: intended. These are first-deposit and empty-pool branches, not comparisons against balances an attacker can nudge by sending tokens: `totalDeposits` is the contract's own accounting of share units and `value` is derived from it. `units == 0` rejects a deposit too small to mint a share unit, which is the desired behaviour (`test/KittyCreditLine.t.sol`).

## 3. `uninitialized-local` (6 findings, medium)

`bestScore`, `hi`, `found`, `missed`, `usedFallback` in `KittyLedger`.

Assessment: Solidity zero-initialises local variables; each of these relies on the zero default deliberately (`found = false`, counters at 0, `hi = 0` as the running maximum). Left as is to keep the runtime under the 24 KB limit (the contract is at 22.3 KB); explicit initialisers would be a readability change only.

## What Slither did not find

No high-severity findings; no arbitrary sends, no unchecked low-level calls, no tx.origin, no delegatecall, no unprotected initialisers, no shadowing. Access control is `Ownable` (OpenZeppelin) for the vault allowlist and the vault operator; everything else is callable by anyone by design (see `docs/THREAT_MODEL.md`).
