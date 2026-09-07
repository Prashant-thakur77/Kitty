// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSD
/// @notice 6-decimal stablecoin stand-in for the Sepolia demo. Anyone can mint (testnet only).
contract TestUSD is ERC20 {
    constructor() ERC20("Kitty Test USD", "tUSD") {
        _mint(msg.sender, 1_000_000 * 10 ** 6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Faucet mint for demo members.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
