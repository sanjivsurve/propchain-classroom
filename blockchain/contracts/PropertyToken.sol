// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * A fixed-supply educational token representing a fictional property's
 * illustrative economic units. It does NOT grant legal real-estate ownership.
 */
contract PropertyToken is ERC20, Ownable {
    uint256 public immutable propertyId;
    uint256 public immutable illustrativePropertyValueUSD;

    constructor(
        uint256 propertyId_,
        string memory name_,
        string memory symbol_,
        uint256 supplyWholeTokens_,
        uint256 illustrativePropertyValueUSD_,
        address marketplace_,
        address instructor_
    ) ERC20(name_, symbol_) Ownable(instructor_) {
        require(marketplace_ != address(0), "Invalid marketplace");
        require(supplyWholeTokens_ > 0, "Zero supply");
        propertyId = propertyId_;
        illustrativePropertyValueUSD = illustrativePropertyValueUSD_;
        _mint(marketplace_, supplyWholeTokens_ * 10 ** decimals());
    }

    function ownershipBasisPoints(address holder) external view returns (uint256) {
        return (balanceOf(holder) * 10_000) / totalSupply();
    }
}
