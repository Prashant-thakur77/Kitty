// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title FakeVault — DEMO ONLY: a spoof emitter for the "wrong emitter" attack scenario
/// @notice Emits an event byte-for-byte compatible with KittyVault.Contributed (same signature,
///         same indexed layout) from an address that is NOT the circle's registered vault. Even with
///         a perfectly valid Attestcoin proof of this tx, KittyLedger rejects it with `WrongEmitter`
///         (and `TxNotToVault`), demonstrating that proofs are bound to the emitter, not the shape.
///         Holds no funds. Never deploy as part of the real flow.
contract FakeVault {
    /// @dev keccak256("Contributed(uint256,uint32,address,uint256)") — identical to KittyVault.
    event Contributed(uint256 indexed circleId, uint32 indexed round, address indexed member, uint256 amount);

    function emitContributed(uint256 circleId, uint32 round, address member, uint256 amount) external {
        emit Contributed(circleId, round, member, amount);
    }
}
