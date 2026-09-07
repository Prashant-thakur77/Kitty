// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";
import {
    INativeQueryVerifier,
    NativeQueryVerifierLib
} from "@gluwa/asc-contracts/contracts/write-ability/common/INativeQueryVerifier.sol";
import {IChainInfo, ChainInfoLib} from "../interfaces/IChainInfo.sol";

/// @title KittyLedger — proof-settled rotating savings circles on Creditcoin
/// @notice An Attestcoin Smart Contract (ASC). Every state change that involves money is driven by a
///         *proven* Ethereum transaction, never by an operator's word:
///
///           1. Members pay their installment into KittyVault on Ethereum (Sepolia).
///           2. The attestor network attests the Sepolia block on Creditcoin.
///           3. A worker fetches ONE batch proof for the whole round (up to 10 contributions sharing
///              a single continuity proof) and calls `recordContributions`.
///           4. This contract asks the block-prover precompile (0x0FD2) to verify inclusion +
///              continuity for all of them in a single call, decodes the `Contributed` logs with
///              EvmV1Decoder, checks the emitter is the registered vault, the amount is exact, the
///              member belongs to the circle, and the source-chain *block height* is on time.
///           5. The round closes when everyone has paid, or when the ChainInfo precompile (0x0FD3)
///              reports the round's deadline block as attested. Missed payments become permanent,
///              proof-backed credit history. The rotation recipient is chosen deterministically.
///           6. The vault operator pays out on Ethereum; that `PaidOut` tx is proven back here so the
///              ledger only shows "Paid" for money that verifiably moved.
///
/// @dev Why not inherit `ASCBase` from @gluwa/asc-contracts? Its `execute` drops `chainKey` and the
///      source `blockHeight` before calling app logic. Kitty needs both: the chain key to bind proofs
///      to Sepolia (a same-address contract on another supported chain must not count), and the
///      height to enforce deadlines from attested source-chain time. So this contract re-implements
///      the same verify → dedupe → act pipeline (query id derivation is identical to ASCBase) and
///      adds the batch entry point.
contract KittyLedger is Ownable {
    // ───────────────────────────── Types ─────────────────────────────

    enum CircleStatus {
        Active,
        Completed
    }

    enum RoundStatus {
        Open,
        Closed,
        Paid
    }

    struct Circle {
        string name;
        address[] members;
        uint256 contribution; // exact installment per member per round, in token units
        uint64 roundBlocks; // round length measured in SOURCE-chain blocks
        uint64 startHeight; // source-chain block at which round 0 opens
        uint32 currentRound;
        address sourceVault; // KittyVault on the source chain — the only accepted emitter
        CircleStatus status;
        address organiser; // msg.sender of createCircle / createOpenCircle; signs invites
        bool open; // invites still redeemable; must be closed before any contribution is recorded
        uint32 maxMembers; // cap for open circles (createOpenCircle); equals members.length otherwise
    }

    struct Round {
        RoundStatus status;
        uint32 contributions;
        uint256 pot;
        address recipient;
        bytes32 payoutQueryId;
    }

    struct Contribution {
        uint64 height; // source-chain block that contained the payment
        bytes32 queryId; // proof identity (chainKey, height, txIndex)
        bool onTime;
    }

    /// @notice Proof-backed credit history. Only ever written from verified transactions or from
    ///         attested deadlines — never from an operator input.
    struct MemberRecord {
        uint32 onTime;
        uint32 late;
        uint32 missed;
        uint32 received;
        uint256 volume;
    }

    // ───────────────────────────── Constants ─────────────────────────────

    /// @dev keccak256("Contributed(uint256,uint32,address,uint256)")
    bytes32 public constant CONTRIBUTED_SIG = keccak256("Contributed(uint256,uint32,address,uint256)");
    /// @dev keccak256("PaidOut(uint256,uint32,address,uint256)")
    bytes32 public constant PAIDOUT_SIG = keccak256("PaidOut(uint256,uint32,address,uint256)");

    /// @notice Attestcoin allows up to 10 queries to share one continuity proof.
    uint256 public constant MAX_BATCH = 10;
    uint256 public constant MAX_MEMBERS = 10;

    INativeQueryVerifier public immutable VERIFIER;
    IChainInfo public immutable CHAIN_INFO;
    uint64 public immutable SOURCE_CHAIN_KEY;

    // ───────────────────────────── Storage ─────────────────────────────

    uint256 public circleCount;
    mapping(uint256 => Circle) internal _circles;
    mapping(uint256 => mapping(uint32 => Round)) internal _rounds;
    mapping(uint256 => mapping(uint32 => mapping(address => Contribution))) internal _contributions;
    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(address => MemberRecord) internal _records;
    mapping(address => uint256[]) internal _memberCircles;

    /// @notice Invite replay protection: each (circle, nonce) signed by the organiser is redeemable once.
    mapping(uint256 => mapping(uint256 => bool)) public usedInviteNonces;

    /// @notice Replay protection: one proof, one effect. Same derivation as ASCBase.
    mapping(bytes32 => bool) public processedQueries;

    // ───────────────────────────── Events ─────────────────────────────

    event CircleCreated(
        uint256 indexed circleId,
        string name,
        address[] members,
        uint256 contribution,
        uint64 roundBlocks,
        uint64 startHeight,
        address sourceVault
    );
    event BatchVerified(uint64 indexed chainKey, uint64 fromHeight, uint64 toHeight, uint256 count);
    event ContributionRecorded(
        uint256 indexed circleId,
        uint32 indexed round,
        address indexed member,
        uint256 amount,
        uint64 sourceHeight,
        bool onTime,
        bytes32 queryId
    );
    event ContributionMissed(uint256 indexed circleId, uint32 indexed round, address indexed member, uint64 deadlineHeight);
    event RoundClosed(uint256 indexed circleId, uint32 indexed round, address indexed recipient, uint256 pot, uint32 missedCount);
    event RoundOpened(uint256 indexed circleId, uint32 indexed round, uint64 deadlineHeight);
    event CircleCompleted(uint256 indexed circleId);
    event PayoutConfirmed(uint256 indexed circleId, uint32 indexed round, address indexed recipient, uint256 amount, bytes32 queryId);
    event InviteRedeemed(uint256 indexed circleId, address indexed member, uint256 nonce);
    event InvitesClosed(uint256 indexed circleId, uint256 memberCount);

    // ───────────────────────────── Errors ─────────────────────────────

    error WrongChain(uint64 got, uint64 want);
    error EmptyBatch();
    error BatchTooLarge(uint256 n);
    error LengthMismatch();
    error QueryAlreadyProcessed(bytes32 queryId);
    error ProofRejected();
    error UnsupportedTxType(uint8 txType);
    error SourceTxFailed();
    error ExpectedExactlyOneLog(uint256 n);
    error BadLogShape();
    error UnknownCircle(uint256 circleId);
    error CircleNotActive(uint256 circleId);
    error WrongEmitter(address got, address want);
    error TxNotToVault(address got, address want);
    error SenderMismatch(address txFrom, address logMember);
    error NotAMember(uint256 circleId, address member);
    error WrongAmount(uint256 got, uint256 want);
    error RoundNotOpen(uint256 circleId, uint32 round);
    error NotCurrentRound(uint32 got, uint32 want);
    error AlreadyContributed(uint256 circleId, uint32 round, address member);
    error RoundStillOpenOnSource(uint64 deadlineHeight);
    error RoundNotClosed(uint256 circleId, uint32 round);
    error PayoutMismatch();
    error InvalidCircle(string reason);
    error CircleStillOpen(uint256 circleId);
    error CircleNotOpen(uint256 circleId);
    error NotOrganiser(uint256 circleId);
    error InviteAlreadyUsed(uint256 circleId, uint256 nonce);
    error InvalidInviteSigner(address got, address want);
    error AlreadyMember(uint256 circleId, address member);
    error CircleFull(uint256 circleId, uint32 maxMembers);
    error InvitesAlreadyClosed(uint256 circleId);

    // ───────────────────────────── Constructor ─────────────────────────────

    constructor(uint64 sourceChainKey) Ownable(msg.sender) {
        VERIFIER = NativeQueryVerifierLib.getVerifier();
        CHAIN_INFO = ChainInfoLib.chainInfo();
        SOURCE_CHAIN_KEY = sourceChainKey;
    }

    // ───────────────────────────── Circle lifecycle ─────────────────────────────

    /// @notice Open a circle. Permissionless: whoever organises the group creates it. Money never
    ///         touches this contract; the vault on the source chain holds escrow.
    function createCircle(
        string calldata name,
        address[] calldata members,
        uint256 contribution,
        uint64 roundBlocks,
        uint64 startHeight,
        address sourceVault
    ) external returns (uint256 circleId) {
        if (members.length < 2 || members.length > MAX_MEMBERS) revert InvalidCircle("2..10 members");
        circleId = _initCircle(name, contribution, roundBlocks, startHeight, sourceVault, uint32(members.length));
        Circle storage c = _circles[circleId];
        for (uint256 i; i < members.length; ++i) {
            address m = members[i];
            if (m == address(0) || isMember[circleId][m]) revert InvalidCircle("duplicate/zero member");
            _join(circleId, c, m);
        }
        emit CircleCreated(circleId, name, members, contribution, roundBlocks, startHeight, sourceVault);
        emit RoundOpened(circleId, 0, deadlineHeight(circleId, 0));
    }

    /// @notice Open a circle with only the organiser as member. Others join via `redeemInvite` using
    ///         an off-chain signature from the organiser; the organiser then calls `closeInvites`
    ///         before the first contribution can be recorded (rotation order = join order).
    function createOpenCircle(
        string calldata name,
        uint256 contribution,
        uint64 roundBlocks,
        uint64 startHeight,
        address sourceVault,
        uint32 maxMembers
    ) external returns (uint256 circleId) {
        if (maxMembers < 2 || maxMembers > MAX_MEMBERS) revert InvalidCircle("2..10 members");
        circleId = _initCircle(name, contribution, roundBlocks, startHeight, sourceVault, maxMembers);
        Circle storage c = _circles[circleId];
        c.open = true;
        _join(circleId, c, msg.sender);
        address[] memory members = new address[](1);
        members[0] = msg.sender;
        emit CircleCreated(circleId, name, members, contribution, roundBlocks, startHeight, sourceVault);
        emit RoundOpened(circleId, 0, deadlineHeight(circleId, 0));
    }

    /// @notice Join an open circle with an invite signed by its organiser (EIP-191 over
    ///         keccak256(abi.encodePacked(ledger, chainid, circleId, invitee, nonce))). Pattern after
    ///         Breadchain SavingCircles.redeemInvite (MIT), bound here to the invitee's address.
    function redeemInvite(uint256 circleId, uint256 nonce, bytes calldata sig) external {
        Circle storage c = _circle(circleId);
        if (!c.open) revert CircleNotOpen(circleId);
        if (usedInviteNonces[circleId][nonce]) revert InviteAlreadyUsed(circleId, nonce);
        if (isMember[circleId][msg.sender]) revert AlreadyMember(circleId, msg.sender);
        if (c.members.length >= c.maxMembers) revert CircleFull(circleId, c.maxMembers);
        if (c.currentRound != 0 || _rounds[circleId][0].contributions != 0) revert CircleStillOpen(circleId);

        address signer = ECDSA.recover(inviteDigest(circleId, msg.sender, nonce), sig);
        if (signer != c.organiser) revert InvalidInviteSigner(signer, c.organiser);

        usedInviteNonces[circleId][nonce] = true;
        _join(circleId, c, msg.sender);
        emit InviteRedeemed(circleId, msg.sender, nonce);
    }

    /// @notice Stop accepting invites. Required before contributions can be recorded so the member
    ///         list — and therefore the rotation order and per-round pot — is fixed.
    function closeInvites(uint256 circleId) external {
        Circle storage c = _circle(circleId);
        if (msg.sender != c.organiser) revert NotOrganiser(circleId);
        if (!c.open) revert InvitesAlreadyClosed(circleId);
        if (c.members.length < 2) revert InvalidCircle("2..10 members");
        c.open = false;
        c.maxMembers = uint32(c.members.length);
        emit InvitesClosed(circleId, c.members.length);
    }

    /// @notice The EIP-191 digest an organiser signs to invite `invitee` into `circleId`.
    function inviteDigest(uint256 circleId, address invitee, uint256 nonce) public view returns (bytes32) {
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(address(this), block.chainid, circleId, invitee, nonce))
        );
    }

    /// @notice Close the current round. Allowed when every member has a proven contribution, or when
    ///         the deadline block on the source chain has been attested on Creditcoin.
    function closeRound(uint256 circleId) external {
        Circle storage c = _circle(circleId);
        if (c.status != CircleStatus.Active) revert CircleNotActive(circleId);
        if (c.open) revert CircleStillOpen(circleId);
        uint32 r = c.currentRound;
        Round storage rd = _rounds[circleId][r];
        if (rd.status != RoundStatus.Open) revert RoundNotOpen(circleId, r);

        uint256 n = c.members.length;
        uint64 deadline = deadlineHeight(circleId, r);
        if (rd.contributions < n) {
            // Attested source-chain time is the only clock.
            if (!CHAIN_INFO.is_height_attested(SOURCE_CHAIN_KEY, deadline)) revert RoundStillOpenOnSource(deadline);
        }

        uint32 missed;
        for (uint256 i; i < n; ++i) {
            address m = c.members[i];
            if (_contributions[circleId][r][m].queryId == bytes32(0)) {
                _records[m].missed += 1;
                ++missed;
                emit ContributionMissed(circleId, r, m, deadline);
            }
        }

        address recipient = c.members[r]; // deterministic rotation
        rd.status = RoundStatus.Closed;
        rd.recipient = recipient;
        _records[recipient].received += 1;
        emit RoundClosed(circleId, r, recipient, rd.pot, missed);

        if (uint256(r) + 1 == n) {
            c.status = CircleStatus.Completed;
            emit CircleCompleted(circleId);
        } else {
            c.currentRound = r + 1;
            emit RoundOpened(circleId, r + 1, deadlineHeight(circleId, r + 1));
        }
    }

    // ───────────────────────────── Attestcoin entry points ─────────────────────────────

    /// @notice Record up to 10 proven `Contributed` transactions with ONE precompile call.
    /// @param chainKey      Source chain key on Creditcoin (Sepolia = 1 on CC3 Testnet).
    /// @param heights       Source block height of each transaction.
    /// @param encodedTxs    Prover `txBytes` (EvmV1 encoding) for each transaction.
    /// @param merkleProofs  Per-transaction inclusion proof against its block's Kitty-merkle root.
    /// @param continuity    Continuity proof shared by all heights in the batch.
    function recordContributions(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTxs,
        INativeQueryVerifier.MerkleProof[] calldata merkleProofs,
        INativeQueryVerifier.ContinuityProof calldata continuity
    ) external {
        if (chainKey != SOURCE_CHAIN_KEY) revert WrongChain(chainKey, SOURCE_CHAIN_KEY);
        uint256 n = heights.length;
        if (n == 0) revert EmptyBatch();
        if (n > MAX_BATCH) revert BatchTooLarge(n);
        if (encodedTxs.length != n || merkleProofs.length != n) revert LengthMismatch();

        bytes32[] memory queryIds = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            bytes32 qid = _computeQueryId(chainKey, heights[i], merkleProofs[i]);
            if (processedQueries[qid]) revert QueryAlreadyProcessed(qid);
            for (uint256 j; j < i; ++j) {
                if (queryIds[j] == qid) revert QueryAlreadyProcessed(qid);
            }
            queryIds[i] = qid;
        }

        bool ok = VERIFIER.verifyAndEmit(chainKey, heights, encodedTxs, merkleProofs, continuity);
        if (!ok) revert ProofRejected();

        uint64 lo = type(uint64).max;
        uint64 hi;
        for (uint256 i; i < n; ++i) {
            processedQueries[queryIds[i]] = true;
            _recordContribution(queryIds[i], heights[i], encodedTxs[i]);
            if (heights[i] < lo) lo = heights[i];
            if (heights[i] > hi) hi = heights[i];
        }
        emit BatchVerified(chainKey, lo, hi, n);
    }

    /// @notice Prove that the vault actually paid the round's recipient on the source chain.
    function confirmPayout(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTx,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuity
    ) external {
        if (chainKey != SOURCE_CHAIN_KEY) revert WrongChain(chainKey, SOURCE_CHAIN_KEY);
        bytes32 qid = _computeQueryId(chainKey, height, merkleProof);
        if (processedQueries[qid]) revert QueryAlreadyProcessed(qid);

        bool ok = VERIFIER.verifyAndEmit(chainKey, height, encodedTx, merkleProof, continuity);
        if (!ok) revert ProofRejected();
        processedQueries[qid] = true;

        EvmV1Decoder.LogEntry memory log = _singleLog(encodedTx, PAIDOUT_SIG);
        (uint256 circleId, uint32 round, address recipient, uint256 amount) = _decodeVaultLog(log);

        Circle storage c = _circle(circleId);
        if (log.address_ != c.sourceVault) revert WrongEmitter(log.address_, c.sourceVault);
        Round storage rd = _rounds[circleId][round];
        if (rd.status != RoundStatus.Closed) revert RoundNotClosed(circleId, round);
        if (recipient != rd.recipient || amount != rd.pot) revert PayoutMismatch();

        rd.status = RoundStatus.Paid;
        rd.payoutQueryId = qid;
        emit PayoutConfirmed(circleId, round, recipient, amount, qid);
    }

    // ───────────────────────────── Views ─────────────────────────────

    function getCircle(uint256 circleId) external view returns (Circle memory) {
        return _circle(circleId);
    }

    function getRound(uint256 circleId, uint32 round) external view returns (Round memory) {
        return _rounds[circleId][round];
    }

    function getContribution(uint256 circleId, uint32 round, address member) external view returns (Contribution memory) {
        return _contributions[circleId][round][member];
    }

    function getRecord(address member) external view returns (MemberRecord memory) {
        return _records[member];
    }

    /// @notice Every circle `member` belongs to, in join order.
    function getMemberCircles(address member) external view returns (uint256[] memory) {
        return _memberCircles[member];
    }

    /// @notice Source-chain block by which round `round` must be paid.
    function deadlineHeight(uint256 circleId, uint32 round) public view returns (uint64) {
        Circle storage c = _circles[circleId];
        return c.startHeight + (uint64(round) + 1) * c.roundBlocks;
    }

    /// @notice Kitty Score: a 300–850 style score derived purely from proven behaviour.
    ///         Base 500, +15 per on-time installment, −20 per late, −120 per missed.
    function creditScore(address member) public view returns (uint16 score, string memory tier) {
        MemberRecord storage r = _records[member];
        int256 s = 500 + int256(uint256(r.onTime)) * 15 - int256(uint256(r.late)) * 20 - int256(uint256(r.missed)) * 120;
        if (s < 300) s = 300;
        if (s > 850) s = 850;
        score = uint16(uint256(s));
        if (score >= 700) tier = "A";
        else if (score >= 600) tier = "B";
        else if (score >= 500) tier = "C";
        else tier = "D";
    }

    // ───────────────────────────── Internals ─────────────────────────────

    function _recordContribution(bytes32 qid, uint64 height, bytes calldata encodedTx) internal {
        EvmV1Decoder.LogEntry memory log = _singleLog(encodedTx, CONTRIBUTED_SIG);
        (uint256 circleId, uint32 round, address member, uint256 amount) = _decodeVaultLog(log);

        Circle storage c = _circle(circleId);
        if (c.status != CircleStatus.Active) revert CircleNotActive(circleId);
        if (c.open) revert CircleStillOpen(circleId);
        if (log.address_ != c.sourceVault) revert WrongEmitter(log.address_, c.sourceVault);

        // Defense in depth: the proven transaction itself must be a call *to* the vault *from* the member.
        EvmV1Decoder.CommonTxFields memory tx_ = EvmV1Decoder.decodeCommonTxFields(encodedTx);
        if (tx_.toIsNull || tx_.to != c.sourceVault) revert TxNotToVault(tx_.to, c.sourceVault);
        if (tx_.from != member) revert SenderMismatch(tx_.from, member);

        if (!isMember[circleId][member]) revert NotAMember(circleId, member);
        if (amount != c.contribution) revert WrongAmount(amount, c.contribution);
        if (round != c.currentRound) revert NotCurrentRound(round, c.currentRound);
        Round storage rd = _rounds[circleId][round];
        if (rd.status != RoundStatus.Open) revert RoundNotOpen(circleId, round);
        if (_contributions[circleId][round][member].queryId != bytes32(0)) revert AlreadyContributed(circleId, round, member);

        bool onTime = height <= deadlineHeight(circleId, round);
        _contributions[circleId][round][member] = Contribution({height: height, queryId: qid, onTime: onTime});
        rd.contributions += 1;
        rd.pot += amount;

        MemberRecord storage rec = _records[member];
        if (onTime) rec.onTime += 1;
        else rec.late += 1;
        rec.volume += amount;

        emit ContributionRecorded(circleId, round, member, amount, height, onTime, qid);
    }

    /// @dev Decode receipt, require success, require exactly one log with `sig`.
    function _singleLog(bytes calldata encodedTx, bytes32 sig) internal pure returns (EvmV1Decoder.LogEntry memory) {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTx);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTxType(txType);
        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTx);
        // The precompile proves inclusion, not success — a reverted tx is still "included".
        if (receipt.receiptStatus != 1) revert SourceTxFailed();
        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, sig);
        if (logs.length != 1) revert ExpectedExactlyOneLog(logs.length);
        return logs[0];
    }

    /// @dev Both vault events share the shape (uint256 indexed, uint32 indexed, address indexed, uint256 data).
    function _decodeVaultLog(EvmV1Decoder.LogEntry memory log)
        internal
        pure
        returns (uint256 circleId, uint32 round, address who, uint256 amount)
    {
        if (log.topics.length != 4 || log.data.length != 32) revert BadLogShape();
        circleId = uint256(log.topics[1]);
        uint256 rawRound = uint256(log.topics[2]);
        if (rawRound > type(uint32).max) revert BadLogShape();
        round = uint32(rawRound);
        who = address(uint160(uint256(log.topics[3])));
        amount = abi.decode(log.data, (uint256));
    }

    /// @dev Identical derivation to ASCBase: keccak(chainKey ‖ height ‖ txIndex).
    function _computeQueryId(uint64 chainKey, uint64 blockHeight, INativeQueryVerifier.MerkleProof calldata merkleProof)
        internal
        view
        returns (bytes32 queryId)
    {
        uint256 txIndex = VERIFIER.calculateTxIndex(merkleProof);
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, chainKey)
            mstore(add(ptr, 32), shl(192, blockHeight))
            mstore(add(ptr, 40), txIndex)
            queryId := keccak256(ptr, 72)
        }
    }

    function _initCircle(
        string calldata name,
        uint256 contribution,
        uint64 roundBlocks,
        uint64 startHeight,
        address sourceVault,
        uint32 maxMembers
    ) internal returns (uint256 circleId) {
        if (contribution == 0) revert InvalidCircle("contribution");
        if (roundBlocks == 0) revert InvalidCircle("roundBlocks");
        if (sourceVault == address(0)) revert InvalidCircle("vault");
        circleId = ++circleCount;
        Circle storage c = _circles[circleId];
        c.name = name;
        c.contribution = contribution;
        c.roundBlocks = roundBlocks;
        c.startHeight = startHeight;
        c.sourceVault = sourceVault;
        c.organiser = msg.sender;
        c.maxMembers = maxMembers;
    }

    function _join(uint256 circleId, Circle storage c, address m) internal {
        isMember[circleId][m] = true;
        c.members.push(m);
        _memberCircles[m].push(circleId);
    }

    function _circle(uint256 circleId) internal view returns (Circle storage c) {
        c = _circles[circleId];
        if (c.sourceVault == address(0)) revert UnknownCircle(circleId);
    }
}
