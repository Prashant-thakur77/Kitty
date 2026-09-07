// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {KittyLedger} from "../src/asc/KittyLedger.sol";

/// forge script script/DeployCreditcoin.s.sol --rpc-url $CREDITCOIN_RPC_URL --broadcast --legacy
contract DeployCreditcoin is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint64 chainKey = uint64(vm.envOr("SOURCE_CHAIN_KEY", uint256(1)));
        vm.startBroadcast(pk);
        KittyLedger ledger = new KittyLedger(chainKey);
        vm.stopBroadcast();
        console.log("KITTY_LEDGER_ADDRESS=%s", address(ledger));
        console.log("SOURCE_CHAIN_KEY=%s", uint256(chainKey));
    }
}
