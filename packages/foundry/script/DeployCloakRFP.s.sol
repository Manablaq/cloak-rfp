// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {CloakRFP} from "../src/CloakRFP.sol";

contract DeployCloakRFP is Script {
    function run() external {
        vm.startBroadcast();

        CloakRFP cloakRFP = new CloakRFP();
        console.log("CloakRFP deployed at:", address(cloakRFP));

        vm.stopBroadcast();
    }
}
