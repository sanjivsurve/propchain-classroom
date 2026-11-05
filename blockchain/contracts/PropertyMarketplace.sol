// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./PropertyToken.sol";

/**
 * Classroom marketplace:
 * - Instructor lists primary inventory.
 * - Students buy primary tokens using mock pUSD.
 * - Students can escrow tokens into a simple fixed-price resale listing.
 * - Instructor can distribute mock rental income pro-rata to supplied holders.
 *
 * This is intentionally simplified and is NOT suitable for real assets/funds.
 */
contract PropertyMarketplace is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable paymentToken;

    struct PropertyListing {
        string name;
        string location;
        address token;
        uint256 pricePerToken; // payment token base units; pUSD has 6 decimals
        bool active;
    }

    struct ResaleListing {
        address token;
        address seller;
        uint256 remaining;
        uint256 pricePerToken;
        bool active;
    }

    uint256 public nextResaleListingId = 1;
    mapping(address => PropertyListing) public properties;
    address[] public propertyTokens;
    mapping(uint256 => ResaleListing) public resaleListings;
    mapping(address => uint256) public rentalClaimable;

    event PropertyAdded(address indexed token, string name, uint256 pricePerToken);
    event PrimaryPurchased(address indexed buyer, address indexed token, uint256 amount, uint256 totalPrice);
    event ResaleCreated(uint256 indexed listingId, address indexed seller, address indexed token, uint256 amount, uint256 pricePerToken);
    event ResalePurchased(uint256 indexed listingId, address indexed buyer, uint256 amount, uint256 totalPrice);
    event RentalDistributed(address indexed token, uint256 totalAmount, uint256 holderCount);
    event RentalClaimed(address indexed holder, uint256 amount);

    constructor(address paymentToken_, address instructor_) Ownable(instructor_) {
        require(paymentToken_ != address(0), "Invalid payment token");
        paymentToken = IERC20(paymentToken_);
    }

    function addProperty(
        address token,
        string calldata name,
        string calldata location,
        uint256 pricePerToken
    ) external onlyOwner {
        require(token != address(0), "Invalid token");
        require(!properties[token].active, "Already listed");
        require(pricePerToken > 0, "Invalid price");
        properties[token] = PropertyListing(name, location, token, pricePerToken, true);
        propertyTokens.push(token);
        emit PropertyAdded(token, name, pricePerToken);
    }

    function getPropertyTokens() external view returns (address[] memory) {
        return propertyTokens;
    }

    function buyPrimary(address token, uint256 wholeTokenAmount) external {
        PropertyListing memory p = properties[token];
        require(p.active, "Property unavailable");
        require(wholeTokenAmount > 0, "Zero amount");

        uint256 tokenAmount = wholeTokenAmount * 10 ** 18;
        uint256 totalPrice = wholeTokenAmount * p.pricePerToken;

        IERC20(token).safeTransfer(msg.sender, tokenAmount);
        paymentToken.safeTransferFrom(msg.sender, owner(), totalPrice);

        emit PrimaryPurchased(msg.sender, token, tokenAmount, totalPrice);
    }

    function createResaleListing(address token, uint256 wholeTokenAmount, uint256 pricePerToken)
        external returns (uint256 listingId)
    {
        require(properties[token].active, "Unknown property");
        require(wholeTokenAmount > 0 && pricePerToken > 0, "Invalid listing");
        uint256 amount = wholeTokenAmount * 10 ** 18;

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        listingId = nextResaleListingId++;
        resaleListings[listingId] = ResaleListing(token, msg.sender, amount, pricePerToken, true);

        emit ResaleCreated(listingId, msg.sender, token, amount, pricePerToken);
    }

    function buyResale(uint256 listingId, uint256 wholeTokenAmount) external {
        ResaleListing storage listing = resaleListings[listingId];
        require(listing.active, "Listing inactive");
        require(wholeTokenAmount > 0, "Zero amount");

        uint256 amount = wholeTokenAmount * 10 ** 18;
        require(amount <= listing.remaining, "Insufficient listing quantity");

        uint256 totalPrice = wholeTokenAmount * listing.pricePerToken;
        listing.remaining -= amount;
        if (listing.remaining == 0) listing.active = false;

        paymentToken.safeTransferFrom(msg.sender, listing.seller, totalPrice);
        IERC20(listing.token).safeTransfer(msg.sender, amount);

        emit ResalePurchased(listingId, msg.sender, amount, totalPrice);
    }

    /**
     * Instructor supplies each eligible holder exactly once.
     * The amount is allocated pro-rata based on balances at this transaction.
     * Transfers after allocation do not move an already-created claim.
     */
    function distributeRental(
        address token,
        address[] calldata holders,
        uint256 totalAmount
    ) external onlyOwner {
        require(properties[token].active, "Unknown property");
        require(holders.length > 0, "No holders");
        require(totalAmount > 0, "Zero distribution");

        uint256 totalHeld;
        for (uint256 i = 0; i < holders.length; i++) {
            require(holders[i] != address(0), "Invalid holder");
            for (uint256 j = 0; j < i; j++) {
                require(holders[i] != holders[j], "Duplicate holder");
            }
            totalHeld += IERC20(token).balanceOf(holders[i]);
        }
        require(totalHeld > 0, "No tokens held");

        paymentToken.safeTransferFrom(msg.sender, address(this), totalAmount);

        for (uint256 i = 0; i < holders.length; i++) {
            uint256 holderBalance = IERC20(token).balanceOf(holders[i]);
            uint256 share = (totalAmount * holderBalance) / totalHeld;
            rentalClaimable[holders[i]] += share;
        }

        emit RentalDistributed(token, totalAmount, holders.length);
    }

    function claimRental() external {
        uint256 amount = rentalClaimable[msg.sender];
        require(amount > 0, "Nothing to claim");
        rentalClaimable[msg.sender] = 0;
        paymentToken.safeTransfer(msg.sender, amount);
        emit RentalClaimed(msg.sender, amount);
    }
}
