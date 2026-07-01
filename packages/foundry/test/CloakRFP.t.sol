// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FhevmTest} from "forge-fhevm/FhevmTest.sol";
import {CloakRFP} from "../src/CloakRFP.sol";
import {ebool, euint128, externalEuint32} from "encrypted-types/EncryptedTypes.sol";

contract CloakRFPTest is FhevmTest {
    CloakRFP cloakRFP;
    address cloakRFPAddress;

    uint256 internal constant BUYER_PK = 0xB0B;
    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BRIAN_PK = 0xB21A;
    uint256 internal constant CAROL_PK = 0xCA20A;

    address buyer;
    address alice;
    address brian;
    address carol;

    function setUp() public override {
        super.setUp();
        cloakRFP = new CloakRFP();
        cloakRFPAddress = address(cloakRFP);

        buyer = vm.addr(BUYER_PK);
        alice = vm.addr(ALICE_PK);
        brian = vm.addr(BRIAN_PK);
        carol = vm.addr(CAROL_PK);
    }

    function test_createTenderStoresPublicMetadataAndWeights() public {
        CloakRFP.ScoringWeights memory weights =
            CloakRFP.ScoringWeights({price: 10, deliveryDays: 3, warrantyMonths: 1, quantity: 2});

        vm.prank(buyer);
        uint256 tenderId = cloakRFP.createTender("ipfs://rfp-1", weights);

        (
            address storedBuyer,
            string memory metadataURI,
            CloakRFP.ScoringWeights memory storedWeights,
            bool hasBest,
            bool closed,
            address bestVendor,
            euint128 bestScore,
            address pendingVendor
        ) = cloakRFP.getTender(tenderId);

        assertEq(storedBuyer, buyer);
        assertEq(metadataURI, "ipfs://rfp-1");
        assertEq(storedWeights.price, 10);
        assertEq(storedWeights.deliveryDays, 3);
        assertEq(storedWeights.warrantyMonths, 1);
        assertEq(storedWeights.quantity, 2);
        assertFalse(hasBest);
        assertFalse(closed);
        assertEq(bestVendor, address(0));
        assertEq(euint128.unwrap(bestScore), bytes32(0));
        assertEq(pendingVendor, address(0));
    }

    function test_createMultipleTendersAndReadEachTender() public {
        CloakRFP.ScoringWeights memory firstWeights =
            CloakRFP.ScoringWeights({price: 10, deliveryDays: 3, warrantyMonths: 1, quantity: 2});
        CloakRFP.ScoringWeights memory secondWeights =
            CloakRFP.ScoringWeights({price: 2, deliveryDays: 8, warrantyMonths: 0, quantity: 1});

        vm.prank(buyer);
        uint256 firstTenderId = cloakRFP.createTender("ipfs://rfp-1", firstWeights);

        vm.prank(carol);
        uint256 secondTenderId = cloakRFP.createTender("ipfs://rfp-2", secondWeights);

        assertEq(firstTenderId, 0);
        assertEq(secondTenderId, 1);
        assertEq(cloakRFP.nextTenderId(), 2);

        (address firstBuyer, string memory firstMetadata, CloakRFP.ScoringWeights memory storedFirstWeights,,,,,) =
            cloakRFP.getTender(firstTenderId);
        (address secondBuyer, string memory secondMetadata, CloakRFP.ScoringWeights memory storedSecondWeights,,,,,) =
            cloakRFP.getTender(secondTenderId);

        assertEq(firstBuyer, buyer);
        assertEq(firstMetadata, "ipfs://rfp-1");
        assertEq(storedFirstWeights.price, 10);
        assertEq(storedFirstWeights.deliveryDays, 3);
        assertEq(storedFirstWeights.warrantyMonths, 1);
        assertEq(storedFirstWeights.quantity, 2);

        assertEq(secondBuyer, carol);
        assertEq(secondMetadata, "ipfs://rfp-2");
        assertEq(storedSecondWeights.price, 2);
        assertEq(storedSecondWeights.deliveryDays, 8);
        assertEq(storedSecondWeights.warrantyMonths, 0);
        assertEq(storedSecondWeights.quantity, 1);
    }

    function test_submitEncryptedBidScoresAndSetsFirstBestVendor() public {
        uint256 tenderId = _createTender();

        _submitBid(tenderId, alice, 100, 5, 12, 20);

        (,,,,, address bestVendor, euint128 bestScore,) = cloakRFP.getTender(tenderId);
        assertEq(bestVendor, alice);
        assertEq(decrypt(bestScore), 165);
        assertEq(decrypt(cloakRFP.getBidScore(tenderId, alice)), 165);
    }

    function test_buyerCanCloseTenderAfterValidBid() public {
        uint256 tenderId = _createTender();
        _submitBid(tenderId, alice, 100, 5, 12, 20);

        vm.expectEmit(true, true, true, true);
        emit CloakRFP.TenderClosed(tenderId, buyer, alice);

        vm.prank(buyer);
        cloakRFP.closeTender(tenderId);

        (,,,, bool closed, address bestVendor,, address pendingVendor) = cloakRFP.getTender(tenderId);
        assertTrue(closed);
        assertEq(bestVendor, alice);
        assertEq(pendingVendor, address(0));
    }

    function test_cannotCloseTenderWithNoBids() public {
        uint256 tenderId = _createTender();

        vm.expectRevert(abi.encodeWithSelector(CloakRFP.NoBestVendor.selector, tenderId));
        vm.prank(buyer);
        cloakRFP.closeTender(tenderId);
    }

    function test_cannotCloseTenderThatDoesNotExist() public {
        vm.expectRevert(abi.encodeWithSelector(CloakRFP.TenderNotFound.selector, 0));
        vm.prank(buyer);
        cloakRFP.closeTender(0);
    }

    function test_cannotCloseTenderWhenPendingComparisonExists() public {
        uint256 tenderId = _createTender();
        _submitBid(tenderId, alice, 100, 5, 12, 20);
        _submitBid(tenderId, brian, 80, 4, 12, 20);

        vm.expectRevert(abi.encodeWithSelector(CloakRFP.PendingBestResolutionRequired.selector, tenderId, brian));
        vm.prank(buyer);
        cloakRFP.closeTender(tenderId);
    }

    function test_cannotCloseTenderTwice() public {
        uint256 tenderId = _createTender();
        _submitBid(tenderId, alice, 100, 5, 12, 20);

        vm.prank(buyer);
        cloakRFP.closeTender(tenderId);

        vm.expectRevert(abi.encodeWithSelector(CloakRFP.TenderAlreadyClosed.selector, tenderId));
        vm.prank(buyer);
        cloakRFP.closeTender(tenderId);
    }

    function test_nonBuyerCannotCloseTender() public {
        uint256 tenderId = _createTender();
        _submitBid(tenderId, alice, 100, 5, 12, 20);

        vm.expectRevert(abi.encodeWithSelector(CloakRFP.OnlyTenderBuyer.selector, tenderId, alice));
        vm.prank(alice);
        cloakRFP.closeTender(tenderId);
    }

    function test_cannotSubmitBidAfterTenderClosed() public {
        uint256 tenderId = _createTender();
        _submitBid(tenderId, alice, 100, 5, 12, 20);

        vm.prank(buyer);
        cloakRFP.closeTender(tenderId);

        vm.expectRevert(abi.encodeWithSelector(CloakRFP.TenderClosedForBids.selector, tenderId));
        _submitBid(tenderId, brian, 80, 4, 12, 20);
    }

    function test_getTenderExposesClosedState() public {
        uint256 tenderId = _createTender();

        (,,,, bool closedBefore,,,) = cloakRFP.getTender(tenderId);
        assertFalse(closedBefore);

        _submitBid(tenderId, alice, 100, 5, 12, 20);

        vm.prank(buyer);
        cloakRFP.closeTender(tenderId);

        (,,,, bool closedAfter,,,) = cloakRFP.getTender(tenderId);
        assertTrue(closedAfter);
    }

    function test_closingOneTenderDoesNotAffectAnotherTender() public {
        uint256 firstTenderId = _createTender();
        uint256 secondTenderId = _createTenderWithWeights(
            "ipfs://rfp-open", CloakRFP.ScoringWeights({price: 2, deliveryDays: 8, warrantyMonths: 0, quantity: 1})
        );

        _submitBid(firstTenderId, alice, 100, 5, 12, 20);
        _submitBid(secondTenderId, brian, 80, 4, 12, 20);

        vm.prank(buyer);
        cloakRFP.closeTender(firstTenderId);

        (,,,, bool firstClosed, address firstBestVendor,,) = cloakRFP.getTender(firstTenderId);
        (,,,, bool secondClosed, address secondBestVendor,, address secondPendingVendor) =
            cloakRFP.getTender(secondTenderId);

        assertTrue(firstClosed);
        assertEq(firstBestVendor, alice);
        assertFalse(secondClosed);
        assertEq(secondBestVendor, brian);
        assertEq(secondPendingVendor, address(0));

        _submitBid(secondTenderId, carol, 90, 4, 12, 20);
        (,,,,,,, address secondPendingAfter) = cloakRFP.getTender(secondTenderId);
        assertEq(secondPendingAfter, carol);
    }

    function test_submitBidAndResolvePendingComparisonForSelectedTender() public {
        uint256 firstTenderId = _createTender();
        uint256 secondTenderId = _createTenderWithWeights(
            "ipfs://rfp-selected", CloakRFP.ScoringWeights({price: 2, deliveryDays: 10, warrantyMonths: 1, quantity: 0})
        );

        _submitBid(firstTenderId, alice, 100, 5, 12, 20);
        _submitBid(secondTenderId, alice, 100, 5, 12, 20);
        _submitBid(secondTenderId, brian, 80, 3, 12, 20);

        (,,,,, address firstBestVendor, euint128 firstBestScore, address firstPendingVendor) =
            cloakRFP.getTender(firstTenderId);
        assertEq(firstBestVendor, alice);
        assertEq(decrypt(firstBestScore), 165);
        assertEq(firstPendingVendor, address(0));

        (,,,,, address secondBestVendorBefore,, address secondPendingVendor) = cloakRFP.getTender(secondTenderId);
        assertEq(secondBestVendorBefore, alice);
        assertEq(secondPendingVendor, brian);
        assertTrue(decrypt(cloakRFP.getPendingComparison(secondTenderId, brian)));

        _resolvePending(secondTenderId, brian);

        (,,,,, address secondBestVendor, euint128 secondBestScore, address secondPendingAfter) =
            cloakRFP.getTender(secondTenderId);
        assertEq(secondBestVendor, brian);
        assertEq(decrypt(secondBestScore), 202);
        assertEq(secondPendingAfter, address(0));
    }

    function test_resolvePendingBestUpdatesWhenLowerScoreWins() public {
        uint256 tenderId = _createTender();

        _submitBid(tenderId, alice, 100, 5, 12, 20);
        _submitBid(tenderId, brian, 80, 4, 12, 20);

        (,,,,, address bestVendorBefore,, address pendingVendor) = cloakRFP.getTender(tenderId);
        assertEq(bestVendorBefore, alice);
        assertEq(pendingVendor, brian);
        assertTrue(decrypt(cloakRFP.getPendingComparison(tenderId, brian)));

        _resolvePending(tenderId, brian);

        (,,,,, address bestVendor, euint128 bestScore, address pendingAfter) = cloakRFP.getTender(tenderId);
        assertEq(bestVendor, brian);
        assertEq(decrypt(bestScore), 140);
        assertEq(pendingAfter, address(0));
    }

    function test_resolvePendingBestKeepsBestWhenHigherScoreLoses() public {
        uint256 tenderId = _createTender();

        _submitBid(tenderId, alice, 100, 5, 12, 20);
        _submitBid(tenderId, carol, 130, 7, 12, 20);

        assertFalse(decrypt(cloakRFP.getPendingComparison(tenderId, carol)));

        _resolvePending(tenderId, carol);

        (,,,,, address bestVendor, euint128 bestScore, address pendingAfter) = cloakRFP.getTender(tenderId);
        assertEq(bestVendor, alice);
        assertEq(decrypt(bestScore), 165);
        assertEq(pendingAfter, address(0));
    }

    function test_repeatBidRevertsAndDoesNotChangeBest() public {
        uint256 tenderId = _createTender();

        _submitBid(tenderId, alice, 100, 5, 12, 20);
        (,,,,, address bestVendorBefore, euint128 bestScoreBefore, address pendingBefore) = cloakRFP.getTender(tenderId);

        vm.expectRevert(abi.encodeWithSelector(CloakRFP.BidAlreadySubmitted.selector, tenderId, alice));
        vm.prank(alice);
        cloakRFP.submitBid(
            tenderId,
            CloakRFP.EncryptedBid({
                price: externalEuint32.wrap(bytes32(0)),
                deliveryDays: externalEuint32.wrap(bytes32(0)),
                warrantyMonths: externalEuint32.wrap(bytes32(0)),
                quantity: externalEuint32.wrap(bytes32(0)),
                priceProof: "",
                deliveryDaysProof: "",
                warrantyMonthsProof: "",
                quantityProof: ""
            })
        );

        (,,,,, address bestVendorAfter, euint128 bestScoreAfter, address pendingAfter) = cloakRFP.getTender(tenderId);
        assertEq(bestVendorAfter, bestVendorBefore);
        assertEq(euint128.unwrap(bestScoreAfter), euint128.unwrap(bestScoreBefore));
        assertEq(decrypt(bestScoreAfter), 165);
        assertEq(pendingAfter, pendingBefore);
        assertEq(decrypt(cloakRFP.getBidScore(tenderId, alice)), 165);
    }

    function test_euint64OverflowScenarioDoesNotWrapIntoLowerWinningScore() public {
        uint32 high = 1 << 31;
        CloakRFP.ScoringWeights memory weights =
            CloakRFP.ScoringWeights({price: high, deliveryDays: high, warrantyMonths: high, quantity: high});

        vm.prank(buyer);
        uint256 tenderId = cloakRFP.createTender("ipfs://rfp-high-values", weights);

        _submitBid(tenderId, alice, 1, 0, 0, 0);
        _submitBid(tenderId, brian, high, high, high, high);

        assertFalse(decrypt(cloakRFP.getPendingComparison(tenderId, brian)));
        _resolvePending(tenderId, brian);

        (,,,,, address bestVendor, euint128 bestScore, address pendingAfter) = cloakRFP.getTender(tenderId);
        assertEq(bestVendor, alice);
        assertEq(decrypt(bestScore), high);
        assertEq(decrypt(cloakRFP.getBidScore(tenderId, brian)), uint128(1) << 64);
        assertEq(pendingAfter, address(0));
    }

    function test_aclAllowsContractReuseAndVendorUserDecryption() public {
        uint256 tenderId = _createTender();

        _submitBid(tenderId, alice, 100, 5, 12, 20);

        assertTrue(cloakRFP.isBidScoreAllowed(tenderId, alice, cloakRFPAddress));
        assertTrue(cloakRFP.isBidScoreAllowed(tenderId, alice, alice));
        assertTrue(cloakRFP.isBestScoreAllowed(tenderId, cloakRFPAddress));
        assertTrue(cloakRFP.isBestScoreAllowed(tenderId, alice));

        bytes memory signature = signUserDecrypt(ALICE_PK, cloakRFPAddress);
        uint256 clearScore =
            userDecrypt(euint128.unwrap(cloakRFP.getBidScore(tenderId, alice)), alice, cloakRFPAddress, signature);

        assertEq(clearScore, 165);
    }

    function test_tenderNotFoundStillReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CloakRFP.TenderNotFound.selector, 0));
        cloakRFP.getTender(0);

        uint256 tenderId = _createTender();
        assertEq(tenderId, 0);

        vm.expectRevert(abi.encodeWithSelector(CloakRFP.TenderNotFound.selector, 1));
        cloakRFP.getTender(1);

        vm.expectRevert(abi.encodeWithSelector(CloakRFP.TenderNotFound.selector, 1));
        vm.prank(alice);
        cloakRFP.submitBid(
            1,
            CloakRFP.EncryptedBid({
                price: externalEuint32.wrap(bytes32(0)),
                deliveryDays: externalEuint32.wrap(bytes32(0)),
                warrantyMonths: externalEuint32.wrap(bytes32(0)),
                quantity: externalEuint32.wrap(bytes32(0)),
                priceProof: "",
                deliveryDaysProof: "",
                warrantyMonthsProof: "",
                quantityProof: ""
            })
        );
    }

    function _createTender() internal returns (uint256 tenderId) {
        CloakRFP.ScoringWeights memory weights =
            CloakRFP.ScoringWeights({price: 1, deliveryDays: 5, warrantyMonths: 0, quantity: 2});

        tenderId = _createTenderWithWeights("ipfs://rfp-1", weights);
    }

    function _createTenderWithWeights(string memory metadataURI, CloakRFP.ScoringWeights memory weights)
        internal
        returns (uint256 tenderId)
    {
        vm.prank(buyer);
        tenderId = cloakRFP.createTender(metadataURI, weights);
    }

    function _submitBid(
        uint256 tenderId,
        address vendor,
        uint32 price,
        uint32 deliveryDays,
        uint32 warrantyMonths,
        uint32 quantity
    ) internal {
        (externalEuint32 encryptedPrice, bytes memory priceProof) = encryptUint32(price, vendor, cloakRFPAddress);
        (externalEuint32 encryptedDeliveryDays, bytes memory deliveryDaysProof) =
            encryptUint32(deliveryDays, vendor, cloakRFPAddress);
        (externalEuint32 encryptedWarrantyMonths, bytes memory warrantyMonthsProof) =
            encryptUint32(warrantyMonths, vendor, cloakRFPAddress);
        (externalEuint32 encryptedQuantity, bytes memory quantityProof) =
            encryptUint32(quantity, vendor, cloakRFPAddress);

        vm.prank(vendor);
        cloakRFP.submitBid(
            tenderId,
            CloakRFP.EncryptedBid({
                price: encryptedPrice,
                deliveryDays: encryptedDeliveryDays,
                warrantyMonths: encryptedWarrantyMonths,
                quantity: encryptedQuantity,
                priceProof: priceProof,
                deliveryDaysProof: deliveryDaysProof,
                warrantyMonthsProof: warrantyMonthsProof,
                quantityProof: quantityProof
            })
        );
    }

    function _resolvePending(uint256 tenderId, address pendingVendor) internal {
        ebool pendingComparison = cloakRFP.getPendingComparison(tenderId, pendingVendor);
        bytes32 handle = ebool.unwrap(pendingComparison);
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = handle;

        (uint256[] memory cleartexts,) = publicDecrypt(handles);
        uint256 cleartext = cleartexts[0];
        bytes memory decryptionProof = buildDecryptionProof(handle, abi.encode(cleartext));

        cloakRFP.resolvePendingBest(tenderId, cleartext, decryptionProof);
    }
}
