// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IChainInfo
/// @notice Subset of the Attestcoin ChainInfo precompile at `0x0FD3` (4051) used by Kitty.
/// @dev Function names are snake_case on the precompile; selectors derive from these exact names.
///      Mirrors the chain_info.json ABI shipped in the usc-sdk package.
interface IChainInfo {
    struct HeightHash {
        uint64 height;
        bytes32 hash;
        bool isAttestation;
        bool exists;
    }

    /// @notice True once the attestor network has attested `targetHeight` on `chainKey`.
    ///         Kitty uses this as its only clock: a round can close early if everyone paid, or
    ///         after the round's deadline *source-chain block* is attested. No timestamps, no oracle.
    function is_height_attested(uint64 chainKey, uint64 targetHeight) external view returns (bool isAttested);

    function get_latest_attestation_height_and_hash(uint64 chainKey) external view returns (HeightHash memory result);
}

library ChainInfoLib {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000fD3;

    function chainInfo() internal pure returns (IChainInfo) {
        return IChainInfo(PRECOMPILE);
    }
}
