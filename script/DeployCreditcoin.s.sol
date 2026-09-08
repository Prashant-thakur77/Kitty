// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";
import {KittyViewer} from "../src/asc/KittyViewer.sol";
import {KittyUSD} from "../src/asc/KittyUSD.sol";
import {KittyCreditLine} from "../src/asc/KittyCreditLine.sol";
import {KittyBadge} from "../src/asc/KittyBadge.sol";

/// forge script script/DeployCreditcoin.s.sol --rpc-url $CREDITCOIN_RPC_URL --broadcast --legacy
contract DeployCreditcoin is Script {
    uint256 constant MINT = 100_000e6; // kUSD to the deployer
    uint256 constant SEED = 50_000e6; // of which this much goes into the credit pool

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint64 chainKey = uint64(vm.envOr("SOURCE_CHAIN_KEY", uint256(1)));
        vm.startBroadcast(pk);
        KittyLedger ledger = new KittyLedger(chainKey);
        address vault = vm.envOr("KITTY_VAULT_ADDRESS", address(0));
        if (vault != address(0)) ledger.setTrustedVault(chainKey, vault, true); // only events from this vault, on this chain, may feed the ledger
        KittyViewer viewer = new KittyViewer(ledger);
        KittyUSD usd = new KittyUSD();
        KittyCreditLine credit = new KittyCreditLine(ledger, IERC20(address(usd)));
        KittyBadge badge = new KittyBadge(ledger);
        usd.mint(vm.addr(pk), MINT);
        usd.approve(address(credit), SEED);
        credit.deposit(SEED);
        vm.stopBroadcast();
        console.log("KITTY_LEDGER_ADDRESS=%s", address(ledger));
        console.log("KITTY_VIEWER_ADDRESS=%s", address(viewer));
        console.log("KITTY_USD_ADDRESS=%s", address(usd));
        console.log("KITTY_CREDIT_ADDRESS=%s", address(credit));
        console.log("KITTY_BADGE_ADDRESS=%s", address(badge));
        console.log("SOURCE_CHAIN_KEY=%s", uint256(chainKey));
    }
}
