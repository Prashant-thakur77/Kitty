// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {FakeVault} from "../src/source/FakeVault.sol";

/// Deploys ONLY the demo spoof emitter. TestUSD + KittyVault are already live on Sepolia.
/// forge script script/DeployFakeVault.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
contract DeployFakeVault is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        FakeVault fake = new FakeVault();
        vm.stopBroadcast();
        console.log("FAKE_VAULT_ADDRESS=%s", address(fake));
    }
}
