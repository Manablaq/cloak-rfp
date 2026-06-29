// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint32, euint128, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title CloakRFP
/// @notice Minimal confidential tender flow for encrypted vendor bid scoring.
contract CloakRFP is ZamaEthereumConfig {
    struct ScoringWeights {
        uint32 price;
        uint32 deliveryDays;
        uint32 warrantyMonths;
        uint32 quantity;
    }

    struct EncryptedBid {
        externalEuint32 price;
        externalEuint32 deliveryDays;
        externalEuint32 warrantyMonths;
        externalEuint32 quantity;
        bytes priceProof;
        bytes deliveryDaysProof;
        bytes warrantyMonthsProof;
        bytes quantityProof;
    }

    struct Tender {
        address buyer;
        string metadataURI;
        ScoringWeights weights;
        bool exists;
        bool hasBest;
        address bestVendor;
        euint128 bestScore;
        address pendingVendor;
    }

    struct Bid {
        bool exists;
        euint128 score;
        ebool pendingIsBetter;
    }

    uint256 public nextTenderId;

    mapping(uint256 tenderId => Tender tender) private _tenders;
    mapping(uint256 tenderId => mapping(address vendor => Bid bid)) private _bids;

    event TenderCreated(uint256 indexed tenderId, address indexed buyer, string metadataURI);
    event BidSubmitted(uint256 indexed tenderId, address indexed vendor);
    event PendingBestResolved(uint256 indexed tenderId, address indexed vendor, bool isBetter);

    error TenderNotFound(uint256 tenderId);
    error PendingBestResolutionRequired(uint256 tenderId, address pendingVendor);
    error BidAlreadySubmitted(uint256 tenderId, address vendor);
    error NoPendingBest(uint256 tenderId);
    error InvalidDecryptionResult();

    function createTender(string calldata metadataURI, ScoringWeights calldata weights)
        external
        returns (uint256 tenderId)
    {
        tenderId = nextTenderId++;

        Tender storage tender = _tenders[tenderId];
        tender.buyer = msg.sender;
        tender.metadataURI = metadataURI;
        tender.weights = weights;
        tender.exists = true;

        emit TenderCreated(tenderId, msg.sender, metadataURI);
    }

    function submitBid(uint256 tenderId, EncryptedBid calldata encryptedBid) external {
        Tender storage tender = _getTender(tenderId);
        if (tender.pendingVendor != address(0)) {
            revert PendingBestResolutionRequired(tenderId, tender.pendingVendor);
        }
        if (_bids[tenderId][msg.sender].exists) {
            revert BidAlreadySubmitted(tenderId, msg.sender);
        }

        euint128 score = _scoreBid(
            tender.weights,
            FHE.fromExternal(encryptedBid.price, encryptedBid.priceProof),
            FHE.fromExternal(encryptedBid.deliveryDays, encryptedBid.deliveryDaysProof),
            FHE.fromExternal(encryptedBid.warrantyMonths, encryptedBid.warrantyMonthsProof),
            FHE.fromExternal(encryptedBid.quantity, encryptedBid.quantityProof)
        );

        Bid storage bid = _bids[tenderId][msg.sender];
        bid.exists = true;
        bid.score = score;
        FHE.allowThis(score);
        FHE.allow(score, msg.sender);

        if (!tender.hasBest) {
            tender.hasBest = true;
            tender.bestVendor = msg.sender;
            tender.bestScore = score;
            FHE.allowThis(tender.bestScore);
            FHE.allow(tender.bestScore, msg.sender);
        } else {
            ebool isBetter = FHE.lt(score, tender.bestScore);
            bid.pendingIsBetter = isBetter;
            tender.pendingVendor = msg.sender;

            FHE.allowThis(isBetter);
            FHE.allow(isBetter, msg.sender);
            FHE.makePubliclyDecryptable(isBetter);
        }

        emit BidSubmitted(tenderId, msg.sender);
    }

    function resolvePendingBest(uint256 tenderId, uint256[] calldata cleartexts, bytes calldata decryptionProof)
        external
    {
        Tender storage tender = _getTender(tenderId);
        address pendingVendor = tender.pendingVendor;
        if (pendingVendor == address(0)) revert NoPendingBest(tenderId);
        if (cleartexts.length != 1 || cleartexts[0] > 1) revert InvalidDecryptionResult();

        Bid storage bid = _bids[tenderId][pendingVendor];
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = ebool.unwrap(bid.pendingIsBetter);
        FHE.checkSignatures(handles, abi.encode(cleartexts), decryptionProof);

        bool isBetter = cleartexts[0] == 1;
        if (isBetter) {
            tender.bestVendor = pendingVendor;
            tender.bestScore = bid.score;
            FHE.allowThis(tender.bestScore);
            FHE.allow(tender.bestScore, pendingVendor);
        }

        tender.pendingVendor = address(0);
        emit PendingBestResolved(tenderId, pendingVendor, isBetter);
    }

    function getTender(uint256 tenderId)
        external
        view
        returns (
            address buyer,
            string memory metadataURI,
            ScoringWeights memory weights,
            bool hasBest,
            address bestVendor,
            euint128 bestScore,
            address pendingVendor
        )
    {
        Tender storage tender = _getTender(tenderId);
        return (
            tender.buyer,
            tender.metadataURI,
            tender.weights,
            tender.hasBest,
            tender.bestVendor,
            tender.bestScore,
            tender.pendingVendor
        );
    }

    function getBidScore(uint256 tenderId, address vendor) external view returns (euint128) {
        return _bids[tenderId][vendor].score;
    }

    function getPendingComparison(uint256 tenderId, address vendor) external view returns (ebool) {
        return _bids[tenderId][vendor].pendingIsBetter;
    }

    function isBidScoreAllowed(uint256 tenderId, address vendor, address account) external view returns (bool) {
        return FHE.isAllowed(_bids[tenderId][vendor].score, account);
    }

    function isBestScoreAllowed(uint256 tenderId, address account) external view returns (bool) {
        return FHE.isAllowed(_getTender(tenderId).bestScore, account);
    }

    function _getTender(uint256 tenderId) private view returns (Tender storage tender) {
        tender = _tenders[tenderId];
        if (!tender.exists) revert TenderNotFound(tenderId);
    }

    function _scoreBid(
        ScoringWeights memory weights,
        euint32 price,
        euint32 deliveryDays,
        euint32 warrantyMonths,
        euint32 quantity
    ) private returns (euint128 score) {
        score = FHE.mul(FHE.asEuint128(price), uint128(weights.price));
        score = FHE.add(score, FHE.mul(FHE.asEuint128(deliveryDays), uint128(weights.deliveryDays)));
        score = FHE.add(score, FHE.mul(FHE.asEuint128(warrantyMonths), uint128(weights.warrantyMonths)));
        score = FHE.add(score, FHE.mul(FHE.asEuint128(quantity), uint128(weights.quantity)));
    }
}
