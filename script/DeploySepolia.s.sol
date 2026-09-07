// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TestUSD} from "../src/source/TestUSD.sol";
import {KittyVault} from "../src/source/KittyVault.sol";

/// forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
contract DeploySepolia is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address operator = vm.envOr("OPERATOR_ADDRESS", vm.addr(pk));
        vm.startBroadcast(pk);
        TestUSD usd = new TestUSD();
        KittyVault vault = new KittyVault(usd, operator);
        vm.stopBroadcast();
        console.log("TEST_USD_ADDRESS=%s", address(usd));
        console.log("KITTY_VAULT_ADDRESS=%s", address(vault));
        console.log("OPERATOR=%s", operator);
    }
}
