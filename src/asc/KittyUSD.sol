// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title KittyUSD — demo liquidity token on Creditcoin
/// @notice 6-decimal stablecoin stand-in that KittyCreditLine lends out. Open mint: testnet only.
contract KittyUSD is ERC20 {
    constructor() ERC20("Kitty USD", "kUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Faucet mint for demo liquidity providers and borrowers.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
