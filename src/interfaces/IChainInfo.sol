// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IChainInfo
/// @notice Subset of the Attestcoin ChainInfo precompile at `0x0FD3` (4051) used by Kitty.
/// @dev Function names are snake_case on the precompile; selectors derive from these exact names.
///      Mirrors the chain_info.json ABI shipped in the usc-sdk package. Struct *names* are local;
///      only the tuple layouts below are part of the ABI, and they match the precompile exactly:
///        HeightHash   ≙ HeightHashResult (uint64,bytes32,bool,bool)
///        BoundsCheck  ≙ BoundsCheckResult (uint64,bytes32,bool,uint64,bytes32,bool,bool)
///        ChainInfoData / ChainInfoResult as published.
interface IChainInfo {
    struct HeightHash {
        uint64 height;
        bytes32 hash;
        bool isAttestation;
        bool exists;
    }

    /// @notice The attested block *below* and the attested block *at/above* a target height, plus
    ///         whether the target itself is covered by an attestation.
    struct BoundsCheck {
        uint64 parentHeight;
        bytes32 parentHash;
        bool parentIsAttestation;
        uint64 childHeight;
        bytes32 childHash;
        bool childIsAttestation;
        bool isAttested;
    }

    /// @notice A source chain the attestor network supports, as published by the registry.
    struct ChainInfoData {
        uint64 chainKey;
        uint64 chainId;
        bytes chainName;
        uint8 chainEncoding;
    }

    struct ChainInfoResult {
        ChainInfoData info;
        bool exists;
    }

    /// @notice True once the attestor network has attested `targetHeight` on `chainKey`.
    ///         Kitty uses this as its only clock: a round can close early if everyone paid, or
    ///         after the round's deadline *source-chain block* is attested. No timestamps, no oracle.
    function is_height_attested(uint64 chainKey, uint64 targetHeight) external view returns (bool isAttested);

    function get_latest_attestation_height_and_hash(uint64 chainKey) external view returns (HeightHash memory result);

    /// @notice The first attested height at or after `targetHeight` — i.e. *which* attestation will
    ///         make a payment mined at `targetHeight` provable. `exists == false` while none has landed.
    function find_lowest_attested_after(uint64 chainKey, uint64 targetHeight)
        external
        view
        returns (HeightHash memory result);

    /// @notice The last attested height at or before `targetHeight`.
    function find_highest_attested_before(uint64 chainKey, uint64 targetHeight)
        external
        view
        returns (HeightHash memory result);

    /// @notice Both bounds around `targetHeight` in one call, with the exact "is it attested yet"
    ///         answer — the precise form of the "provable at" estimate Kitty used to do in arithmetic.
    function get_attestation_bounds(uint64 chainKey, uint64 targetHeight)
        external
        view
        returns (BoundsCheck memory result);

    /// @notice Lowest height on `chainKey` the attestor network can ever prove.
    function get_attestation_genesis_height(uint64 chainKey) external view returns (uint64 genesisHeight);

    /// @notice The registry entry for a chain key. `exists == false` means the network does not
    ///         attest that chain, so a circle must never be bound to it.
    function get_chain_by_key(uint64 chainKey) external view returns (ChainInfoResult memory result);

    /// @notice Every chain the attestor network supports, straight from the registry.
    function get_supported_chains() external view returns (ChainInfoData[] memory chains);
}

library ChainInfoLib {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000fD3;

    function chainInfo() internal pure returns (IChainInfo) {
        return IChainInfo(PRECOMPILE);
    }
}
