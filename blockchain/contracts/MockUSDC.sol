// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * Classroom-only mock stablecoin. This is NOT USDC and has no monetary value.
 * Anyone may request a capped amount to make student exercises easy.
 */
contract MockUSDC is ERC20 {
    uint256 public constant MAX_FAUCET_AMOUNT = 10_000 * 10 ** 6;

    constructor() ERC20("PropChain Demo Dollar", "pUSD") {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet(uint256 amount) external {
        require(amount > 0 && amount <= MAX_FAUCET_AMOUNT, "Faucet limit");
        _mint(msg.sender, amount);
    }
}
