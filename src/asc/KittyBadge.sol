// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {KittyLedger} from "./KittyLedger.sol";

/// @dev ERC-5192 minimal soulbound interface.
interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);

    function locked(uint256 tokenId) external view returns (bool);
}

/// @title KittyBadge — soulbound "Kitty Score" badge on Creditcoin
/// @notice One badge per address, claimable only once the ledger holds proven history for the
///         caller. The token never leaves its owner (ERC-5192: `locked` is always true, transfers
///         revert). Its image and metadata are rendered on-chain from the *live* ledger, so the
///         badge changes as proofs land — it is a window onto `creditScore`, not a snapshot.
contract KittyBadge is ERC721, IERC5192 {
    using Strings for uint256;

    KittyLedger public immutable LEDGER;

    error NoProvenHistory(address member);
    error AlreadyClaimed(address member);
    error Soulbound();

    constructor(KittyLedger ledger) ERC721("Kitty Score", "KITTY") {
        LEDGER = ledger;
    }

    // ───────────────────────────── Claim ─────────────────────────────

    /// @notice Mint the caller's badge. tokenId = uint160(caller).
    function claim() external returns (uint256 tokenId) {
        KittyLedger.MemberRecord memory r = LEDGER.getRecord(msg.sender);
        if (uint256(r.onTime) + r.late + r.missed == 0) revert NoProvenHistory(msg.sender);
        tokenId = uint256(uint160(msg.sender));
        if (_ownerOf(tokenId) != address(0)) revert AlreadyClaimed(msg.sender);
        _mint(msg.sender, tokenId);
        emit Locked(tokenId);
    }

    function tokenIdOf(address member) external pure returns (uint256) {
        return uint256(uint160(member));
    }

    function hasClaimed(address member) external view returns (bool) {
        return _ownerOf(uint256(uint160(member))) != address(0);
    }

    // ───────────────────────────── ERC-5192 ─────────────────────────────

    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }

    /// @dev Mint is the only allowed state change: any transfer or burn reverts.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    // ───────────────────────────── Metadata (live from the ledger) ─────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat("data:application/json;base64,", Base64.encode(bytes(metadata(tokenId))));
    }

    /// @notice The JSON behind `tokenURI`, unencoded (handy for UIs and tests).
    function metadata(uint256 tokenId) public view returns (string memory) {
        address member = address(uint160(tokenId));
        (uint16 score, string memory tier) = LEDGER.creditScore(member);
        KittyLedger.MemberRecord memory r = LEDGER.getRecord(member);
        return string.concat(
            '{"name":"Kitty Score ',
            uint256(score).toString(),
            " (",
            tier,
            ')","description":"Soulbound Kitty Score for ',
            Strings.toHexString(member),
            '. Every input is a proven Ethereum transaction or an attested deadline, verified on Creditcoin via Attestcoin. Rendered live from KittyLedger.",',
            '"attributes":[{"trait_type":"score","value":',
            uint256(score).toString(),
            '},{"trait_type":"tier","value":"',
            tier,
            '"},{"trait_type":"on_time","value":',
            uint256(r.onTime).toString(),
            '},{"trait_type":"late","value":',
            uint256(r.late).toString(),
            '},{"trait_type":"missed","value":',
            uint256(r.missed).toString(),
            '},{"trait_type":"proven_volume_usd","value":',
            (r.volume / 1e6).toString(),
            '}],"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(image(tokenId))),
            '"}'
        );
    }

    /// @notice 400×240 on-chain SVG, unencoded.
    function image(uint256 tokenId) public view returns (string memory) {
        address member = address(uint160(tokenId));
        (uint16 score, string memory tier) = LEDGER.creditScore(member);
        KittyLedger.MemberRecord memory r = LEDGER.getRecord(member);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">',
            '<rect width="400" height="240" rx="16" fill="#0E1512"/>',
            '<rect x="0.5" y="0.5" width="399" height="239" rx="16" fill="none" stroke="#4FD1A3" stroke-opacity="0.35"/>',
            '<text x="24" y="40" font-family="ui-monospace,Menlo,monospace" font-size="13" letter-spacing="2" fill="#4FD1A3">KITTY SCORE</text>',
            '<text x="24" y="128" font-family="ui-sans-serif,Helvetica,Arial,sans-serif" font-size="84" font-weight="700" fill="#F3F7F5">',
            uint256(score).toString(),
            "</text>",
            '<rect x="300" y="24" width="76" height="30" rx="15" fill="#4FD1A3"/>',
            '<text x="338" y="45" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="15" font-weight="700" fill="#0E1512">TIER ',
            tier,
            "</text>",
            '<text x="24" y="166" font-family="ui-monospace,Menlo,monospace" font-size="14" fill="#9DB8AD">on-time ',
            uint256(r.onTime).toString(),
            "  /  late ",
            uint256(r.late).toString(),
            "  /  missed ",
            uint256(r.missed).toString(),
            "</text>",
            '<text x="24" y="190" font-family="ui-monospace,Menlo,monospace" font-size="12" fill="#5F7A70">',
            Strings.toHexString(member),
            "</text>",
            '<text x="24" y="218" font-family="ui-monospace,Menlo,monospace" font-size="12" fill="#4FD1A3">Kitty &#183; proven on Creditcoin via Attestcoin</text>',
            "</svg>"
        );
    }
}
