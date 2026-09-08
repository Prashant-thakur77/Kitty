// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Stand-in for the ChainInfo precompile (0x0FD3). Etched at that address in tests (and by
///      scripts/local-setup.sh via anvil_setCode), so it must work with *no* constructor: every
///      default below is derived, never written at deploy time.
///
///      Attestation model: one settable head per chain key. `attestedHeight[k] >= h` ⇔ h attested.
///      Registry model: an empty registry means "chainKey 1 (Sepolia) and chainKey 3 (Ethereum
///      mainnet) exist", matching CC3 Testnet, so a freshly etched mock supports circle creation
///      immediately. The moment `setChain` is called the explicit registry takes over completely.
contract MockChainInfo {
    mapping(uint64 => uint64) public attestedHeight;
    mapping(uint64 => uint64) public genesisHeight;

    struct HeightHash {
        uint64 height;
        bytes32 hash;
        bool isAttestation;
        bool exists;
    }

    struct BoundsCheck {
        uint64 parentHeight;
        bytes32 parentHash;
        bool parentIsAttestation;
        uint64 childHeight;
        bytes32 childHash;
        bool childIsAttestation;
        bool isAttested;
    }

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

    /// @notice Explicit supported-chain registry. Untouched (`!registrySet`) it reads as {1, 3}.
    bool public registrySet;
    uint64[] internal _keys;
    mapping(uint64 => ChainInfoData) internal _chains;
    mapping(uint64 => bool) internal _exists;
    mapping(uint64 => bool) internal _known; // key ever passed to setChain

    // ───────────── setters ─────────────

    function setAttestedHeight(uint64 chainKey, uint64 h) external {
        attestedHeight[chainKey] = h;
    }

    function setGenesisHeight(uint64 chainKey, uint64 h) external {
        genesisHeight[chainKey] = h;
    }

    /// @notice Register (or de-register) a source chain. The first call switches the mock off its
    ///         implicit {1, 3} default, so callers that want those must add them back — that is what
    ///         `initDefaultChains()` is for.
    function setChain(uint64 chainKey, uint64 chainId, string memory name, bool exists) public {
        registrySet = true;
        if (!_known[chainKey]) {
            _known[chainKey] = true;
            _keys.push(chainKey);
        }
        _chains[chainKey] = ChainInfoData({chainKey: chainKey, chainId: chainId, chainName: bytes(name), chainEncoding: 1});
        _exists[chainKey] = exists;
    }

    /// @notice CC3 Testnet's two source chains, written explicitly. Callable from a test `setUp`.
    function initDefaultChains() external {
        setChain(1, 11155111, "Ethereum Sepolia", true);
        setChain(3, 1, "Ethereum Mainnet", true);
    }

    // ───────────── precompile surface ─────────────

    function is_height_attested(uint64 chainKey, uint64 targetHeight) external view returns (bool) {
        return attestedHeight[chainKey] >= targetHeight;
    }

    function get_latest_attestation_height_and_hash(uint64 chainKey) external view returns (HeightHash memory) {
        uint64 h = attestedHeight[chainKey];
        return HeightHash({height: h, hash: _hash(chainKey, h), isAttestation: true, exists: h > 0});
    }

    /// @dev The attestation that makes `targetHeight` provable: the target itself once attested.
    function find_lowest_attested_after(uint64 chainKey, uint64 targetHeight) external view returns (HeightHash memory) {
        bool attested = attestedHeight[chainKey] >= targetHeight;
        if (!attested) return HeightHash({height: 0, hash: bytes32(0), isAttestation: false, exists: false});
        return HeightHash({height: targetHeight, hash: _hash(chainKey, targetHeight), isAttestation: true, exists: true});
    }

    function find_highest_attested_before(uint64 chainKey, uint64 targetHeight) external view returns (HeightHash memory) {
        uint64 head = attestedHeight[chainKey];
        if (head == 0) return HeightHash({height: 0, hash: bytes32(0), isAttestation: false, exists: false});
        uint64 h = head < targetHeight ? head : targetHeight;
        return HeightHash({height: h, hash: _hash(chainKey, h), isAttestation: true, exists: true});
    }

    function get_attestation_bounds(uint64 chainKey, uint64 targetHeight) external view returns (BoundsCheck memory) {
        uint64 head = attestedHeight[chainKey];
        bool attested = head >= targetHeight;
        uint64 parent = attested ? targetHeight : head;
        return BoundsCheck({
            parentHeight: parent,
            parentHash: _hash(chainKey, parent),
            parentIsAttestation: head > 0,
            childHeight: targetHeight,
            childHash: _hash(chainKey, targetHeight),
            childIsAttestation: attested,
            isAttested: attested
        });
    }

    function get_attestation_genesis_height(uint64 chainKey) external view returns (uint64) {
        return genesisHeight[chainKey];
    }

    function get_chain_by_key(uint64 chainKey) external view returns (ChainInfoResult memory) {
        if (!registrySet) {
            if (chainKey == 1) return ChainInfoResult(_default(1), true);
            if (chainKey == 3) return ChainInfoResult(_default(3), true);
            return ChainInfoResult(ChainInfoData(0, 0, "", 0), false);
        }
        if (!_exists[chainKey]) return ChainInfoResult(ChainInfoData(0, 0, "", 0), false);
        return ChainInfoResult(_chains[chainKey], true);
    }

    function get_supported_chains() external view returns (ChainInfoData[] memory chains) {
        if (!registrySet) {
            chains = new ChainInfoData[](2);
            chains[0] = _default(1);
            chains[1] = _default(3);
            return chains;
        }
        uint256 n;
        for (uint256 i; i < _keys.length; ++i) {
            if (_exists[_keys[i]]) ++n;
        }
        chains = new ChainInfoData[](n);
        uint256 j;
        for (uint256 i; i < _keys.length; ++i) {
            if (_exists[_keys[i]]) chains[j++] = _chains[_keys[i]];
        }
    }

    // ───────────── internals ─────────────

    function _default(uint64 chainKey) internal pure returns (ChainInfoData memory) {
        return chainKey == 1
            ? ChainInfoData({chainKey: 1, chainId: 11155111, chainName: "Ethereum Sepolia", chainEncoding: 1})
            : ChainInfoData({chainKey: 3, chainId: 1, chainName: "Ethereum Mainnet", chainEncoding: 1});
    }

    function _hash(uint64 chainKey, uint64 h) internal pure returns (bytes32) {
        return keccak256(abi.encode(chainKey, h));
    }
}
