// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICarbonPerpetual {
    // Market management
    function createMarket(
        address underlyingAsset,
        uint256 assetId,
        address quoteAsset,
        uint256 fundingRateCap,
        uint256 fundingInterval,
        uint256 markPriceSource,
        address oracle,
        uint256 twapWindow,
        uint256 maintenanceMarginRatio,
        uint256 initialMarginRatio,
        uint256 maxLeverage,
        uint256 tickSize,
        uint256 lotSize,
        uint256 makerFeeBps,
        uint256 takerFeeBps,
        address insuranceFund,
        bool autoDeleveragingEnabled
    ) external returns (uint256);

    function updateMarket(uint256 marketId, uint256 fundingRateCap, uint256 maintenanceMarginRatio, uint256 initialMarginRatio, uint256 maxLeverage, bool active) external;

    // Position management
    function openPosition(uint256 marketId, bool isLong, uint256 size, uint256 margin, uint256 leverage) external returns (uint256);
    function closePosition(uint256 positionId) external;
    function addMargin(uint256 positionId, uint256 amount) external;

    // Order management
    function placeOrder(
        uint256 marketId,
        bool isBuy,
        uint8 orderType,
        uint256 size,
        uint256 price,
        uint256 stopPrice,
        bool reduceOnly,
        bool postOnly,
        uint8 timeInForce
    ) external returns (uint256);

    function cancelOrder(uint256 orderId) external;

    // Funding rates
    function updateFundingRate(uint256 marketId) external;
    function settleFunding(uint256 positionId) external;

    // Liquidation
    function liquidate(uint256 positionId) external;
    function autoDeleverage(uint256 marketId) external;

    // Price updates
    function updateMarkPrice(uint256 marketId, uint256 markPrice, uint256 indexPrice) external;

    // Insurance fund
    function depositToInsuranceFund(uint256 marketId, uint256 amount) external;
    function withdrawFromInsuranceFund(uint256 marketId, uint256 amount) external;

    // View functions
    function getMarket(uint256 marketId) external view returns (
        uint256 marketId,
        address underlyingAsset,
        uint256 assetId,
        address quoteAsset,
        uint256 fundingRateCap,
        uint256 fundingInterval,
        uint256 markPriceSource,
        address oracle,
        uint256 twapWindow,
        uint256 maintenanceMarginRatio,
        uint256 initialMarginRatio,
        uint256 maxLeverage,
        uint256 tickSize,
        uint256 lotSize,
        uint256 makerFeeBps,
        uint256 takerFeeBps,
        address insuranceFund,
        bool autoDeleveragingEnabled,
        bool active,
        uint256 createdAt
    );

    function getMarkets() external view returns (tuple(
        uint256 marketId,
        address underlyingAsset,
        uint256 assetId,
        address quoteAsset,
        uint256 fundingRateCap,
        uint256 fundingInterval,
        uint256 markPriceSource,
        address oracle,
        uint256 twapWindow,
        uint256 maintenanceMarginRatio,
        uint256 initialMarginRatio,
        uint256 maxLeverage,
        uint256 tickSize,
        uint256 lotSize,
        uint256 makerFeeBps,
        uint256 takerFeeBps,
        address insuranceFund,
        bool autoDeleveragingEnabled,
        bool active,
        uint256 createdAt
    )[] memory);

    function getPosition(uint256 positionId) external view returns (
        uint256 positionId,
        address trader,
        uint256 marketId,
        bool isLong,
        uint256 size,
        uint256 entryPrice,
        uint256 markPrice,
        int256 unrealizedPnl,
        int256 realizedPnl,
        uint256 margin,
        uint256 leverage,
        uint256 liquidationPrice,
        int256 fundingPaid,
        uint256 lastFundingTime,
        uint256 openedAt,
        uint256 updatedAt,
        uint8 status
    );

    function getTraderPositions(address trader) external view returns (uint256[] memory);

    function getOrder(uint256 orderId) external view returns (
        uint256 orderId,
        address trader,
        uint256 marketId,
        bool isBuy,
        uint8 orderType,
        uint256 size,
        uint256 price,
        uint256 stopPrice,
        bool reduceOnly,
        bool postOnly,
        uint8 timeInForce,
        uint8 status,
        uint256 filledSize,
        uint256 avgFillPrice,
        uint256 feePaid,
        uint256 createdAt,
        uint256 updatedAt
    );

    function getTraderOrders(address trader) external view returns (uint256[] memory);

    function getFundingHistory(uint256 marketId, uint256 limit) external view returns (
        uint256 marketId,
        uint256 timestamp,
        int256 fundingRate,
        uint256 markPrice,
        uint256 indexPrice,
        int256 premiumIndex,
        uint256 nextFundingTime
    )[] memory;

    function getMarkPrice(uint256 marketId) external view returns (uint256);
    function getIndexPrice(uint256 marketId) external view returns (uint256);
}

interface ICarbonOptions {
    // Market management
    function createMarket(
        address underlyingAsset,
        uint256 assetId,
        address quoteAsset,
        bool optionStyle,
        bool settlementType,
        uint256 minOrderSize,
        uint256 tickSize,
        uint256 makerFeeBps,
        uint256 takerFeeBps,
        uint256 exerciseFeeBps
    ) external returns (uint256);

    function createSeries(
        uint256 marketId,
        bool isCall,
        uint256 strikePrice,
        uint256 expiry
    ) external returns (uint256);

    // Position management
    function openPosition(uint256 seriesId, bool isLong, uint256 size, uint256 premium) external returns (uint256);
    function closePosition(uint256 positionId) external;

    // Order management
    function placeOrder(
        uint256 seriesId,
        bool isBuy,
        uint8 orderType,
        uint256 size,
        uint256 price,
        bool reduceOnly
    ) external returns (uint256);

    function cancelOrder(uint256 orderId) external;

    // Exercise
    function exerciseOption(uint256 seriesId, uint256 size) external returns (uint256);
    function processPhysicalExercise(uint256 requestId) external;

    // Price & Greeks updates
    function updateUnderlyingPrice(uint256 seriesId, uint256 price) external;
    function updateSeriesPremium(uint256 seriesId, uint256 premium, uint256 impliedVol) external;

    // Expiry
    function expireSeries(uint256 seriesId) external;

    // View functions
    function getMarket(uint256 marketId) external view returns (
        uint256 marketId,
        address underlyingAsset,
        uint256 assetId,
        address quoteAsset,
        bool optionStyle,
        bool settlementType,
        uint256 minOrderSize,
        uint256 tickSize,
        uint256 makerFeeBps,
        uint256 takerFeeBps,
        uint256 exerciseFeeBps,
        bool active,
        uint256 createdAt
    );

    function getSeries(uint256 seriesId) external view returns (
        uint256 seriesId,
        uint256 marketId,
        bool isCall,
        uint256 strikePrice,
        uint256 expiry,
        uint256 size,
        uint256 premium,
        uint256 impliedVolatility,
        int256 delta,
        int256 gamma,
        int256 theta,
        int256 vega,
        int256 rho,
        uint256 underlyingPrice,
        uint8 status,
        uint256 createdAt
    );

    function getMarketSeries(uint256 marketId) external view returns (uint256[] memory);

    function getPosition(uint256 positionId) external view returns (
        uint256 positionId,
        address trader,
        uint256 seriesId,
        bool isLong,
        uint256 size,
        uint256 entryPremium,
        uint256 currentPremium,
        int256 unrealizedPnl,
        int256 deltaExposure,
        int256 gammaExposure,
        int256 vegaExposure,
        uint256 openedAt,
        uint256 updatedAt
    );

    function getTraderPositions(address trader) external view returns (uint256[] memory);

    function getOrder(uint256 orderId) external view returns (
        uint256 orderId,
        address trader,
        uint256 seriesId,
        bool isBuy,
        uint8 orderType,
        uint256 size,
        uint256 price,
        bool reduceOnly,
        uint8 status,
        uint256 filledSize,
        uint256 avgFillPrice,
        uint256 feePaid,
        uint256 createdAt,
        uint256 updatedAt
    );

    function getTraderOrders(address trader) external view returns (uint256[] memory);

    function getUnderlyingPrice(uint256 seriesId) external view returns (uint256);
    function getExerciseRequest(uint256 requestId) external view returns (
        uint256 requestId,
        address holder,
        uint256 seriesId,
        uint256 size,
        uint256 timestamp,
        uint8 status
    );
}

interface IStructuredProduct {
    // Product management
    function createProduct(
        string memory name,
        string memory description,
        uint8 productType,
        address[] memory underlyingAssets,
        uint256[] memory assetIds,
        uint256[] memory weights,
        address quoteAsset,
        uint256 maturity,
        uint256 capitalProtection,
        uint256 participationRate,
        uint256 couponRate,
        uint256 barrierLevel,
        uint8 barrierType,
        uint256 autocallTrigger,
        uint256 autocallFrequency,
        bool earlyRedemptionEnabled,
        uint256 managementFeeBps,
        uint256 performanceFeeBps,
        uint256 minInvestment,
        uint256 maxInvestment,
        uint256 subscriptionStart,
        uint256 subscriptionEnd,
        address feeRecipient
    ) external returns (uint256);

    function openProduct(uint256 productId) external;
    function closeProduct(uint256 productId) external;

    // Subscription
    function subscribe(uint256 productId, uint256 amount) external returns (uint256);
    function redeem(uint256 subscriptionId) external;

    // NAV
    function updateNAV(uint256 productId) external;
    function getCurrentNAV(uint256 productId) external view returns (uint256);

    // Price updates
    function updateUnderlyingPrice(address asset, uint256 assetId, uint256 price) external;

    // Maturity
    function matureProduct(uint256 productId) external;

    // View functions
    function getProduct(uint256 productId) external view returns (
        uint256 productId,
        string memory name,
        string memory description,
        uint8 productType,
        address[] memory underlyingAssets,
        uint256[] memory assetIds,
        uint256[] memory weights,
        address quoteAsset,
        uint256 maturity,
        uint256 capitalProtection,
        uint256 participationRate,
        uint256 couponRate,
        uint256 barrierLevel,
        uint8 barrierType,
        uint256 autocallTrigger,
        uint256 autocallFrequency,
        bool earlyRedemptionEnabled,
        uint256 managementFeeBps,
        uint256 performanceFeeBps,
        uint256 minInvestment,
        uint256 maxInvestment,
        uint256 subscriptionStart,
        uint256 subscriptionEnd,
        uint8 status,
        uint256 initialNav,
        uint256 totalSubscriptions,
        address feeRecipient,
        uint256 createdAt
    );

    function getProducts() external view returns (
        tuple(
            uint256 productId,
            string memory name,
            string memory description,
            uint8 productType,
            address[] memory underlyingAssets,
            uint256[] memory assetIds,
            uint256[] memory weights,
            address quoteAsset,
            uint256 maturity,
            uint256 capitalProtection,
            uint256 participationRate,
            uint256 couponRate,
            uint256 barrierLevel,
            uint8 barrierType,
            uint256 autocallTrigger,
            uint256 autocallFrequency,
            bool earlyRedemptionEnabled,
            uint256 managementFeeBps,
            uint256 performanceFeeBps,
            uint256 minInvestment,
            uint256 maxInvestment,
            uint256 subscriptionStart,
            uint256 subscriptionEnd,
            uint8 status,
            uint256 initialNav,
            uint256 totalSubscriptions,
            address feeRecipient,
            uint256 createdAt
        )[] memory
    );

    function getSubscription(uint256 subscriptionId) external view returns (
        uint256 subscriptionId,
        address investor,
        uint256 productId,
        uint256 investmentAmount,
        uint256 units,
        uint256 entryNav,
        uint256 currentNav,
        int256 unrealizedPnl,
        uint256 accruedCoupon,
        uint8 status,
        uint256 subscribedAt,
        uint256 updatedAt
    );

    function getInvestorSubscriptions(address investor) external view returns (uint256[] memory);

    function getNAVHistory(uint256 productId, uint256 limit) external view returns (
        uint256 productId,
        uint256 timestamp,
        uint256 nav,
        uint256[] memory underlyingPrices,
        uint256 totalAssets,
        uint256 totalLiabilities,
        uint256 sharesOutstanding
    )[] memory;

    function getProductUnderlyings(uint256 productId) external view returns (
        address[] memory assets,
        uint256[] memory assetIds,
        uint256[] memory weights,
        uint256[] memory initialPrices,
        uint256[] memory currentPrices,
        bool[] memory barrierHits
    );
}

interface ICarbonInsurance {
    // Pool management
    function createPool(
        string memory name,
        string memory description,
        uint8[] memory coveredRisks,
        address[] memory coveredAssets,
        uint256[] memory assetIds,
        string[] memory registries,
        address quoteAsset,
        uint256 premiumRateBps,
        uint256 coverageLimit,
        uint256 deductible,
        uint256 policyDuration,
        uint256 claimWindow,
        uint256 assessmentPeriod,
        address payoutCurrency,
        address governanceToken,
        uint256 capitalRequirement,
        bool reinsuranceEnabled,
        uint256 reinsuranceThreshold
    ) external returns (uint256);

    function updatePool(uint256 poolId, uint256 premiumRateBps, uint256 coverageLimit, uint256 capitalRequirement, bool active) external;

    // Capital management
    function depositCapital(uint256 poolId, uint256 amount) external;
    function withdrawCapital(uint256 poolId, uint256 amount) external;
    function getPoolSolvency(uint256 poolId) external view returns (uint256);

    // Reinsurance
    function addReinsuranceContract(
        uint256 poolId,
        address reinsurer,
        uint256 maxCoverage,
        uint256 premiumShare,
        uint256 attachmentPoint,
        uint256 exhaustionPoint
    ) external returns (uint256);

    // Policy management
    function createPolicy(
        uint256 poolId,
        address coveredAsset,
        uint256 assetId,
        uint256 coverageAmount,
        uint256 deductible
    ) external returns (uint256);

    function payPremium(uint256 policyId) external;
    function cancelPolicy(uint256 policyId) external;

    // Claims
    function submitClaim(
        uint256 policyId,
        uint8 eventType,
        string memory eventDescription,
        uint256 eventDate,
        uint256 affectedAmount,
        uint256 claimedAmount,
        string[] memory evidence
    ) external returns (uint256);

    function assessClaim(uint256 claimId, uint8 status, string memory notes, uint256 payoutAmount) external;
    function payClaim(uint256 claimId) external;
    function disputeClaim(uint256 claimId) external;

    // View functions
    function getPool(uint256 poolId) external view returns (
        uint256 poolId,
        string memory name,
        string memory description,
        uint8[] memory coveredRisks,
        address[] memory coveredAssets,
        uint256[] memory assetIds,
        string[] memory registries,
        address quoteAsset,
        uint256 premiumRateBps,
        uint256 coverageLimit,
        uint256 deductible,
        uint256 policyDuration,
        uint256 claimWindow,
        uint256 assessmentPeriod,
        address payoutCurrency,
        address governanceToken,
        uint256 capitalRequirement,
        bool reinsuranceEnabled,
        uint256 reinsuranceThreshold,
        uint256 totalCapital,
        uint256 availableCapital,
        uint256 reservedCapital,
        uint256 totalPremiumsCollected,
        uint256 totalClaimsPaid,
        uint256 activePolicies,
        uint256 totalCoverage,
        bool active,
        uint256 createdAt
    );

    function getPools() external view returns (
        tuple(
            uint256 poolId,
            string memory name,
            string memory description,
            uint8[] memory coveredRisks,
            address[] memory coveredAssets,
            uint256[] memory assetIds,
            string[] memory registries,
            address quoteAsset,
            uint256 premiumRateBps,
            uint256 coverageLimit,
            uint256 deductible,
            uint256 policyDuration,
            uint256 claimWindow,
            uint256 assessmentPeriod,
            address payoutCurrency,
            address governanceToken,
            uint256 capitalRequirement,
            bool reinsuranceEnabled,
            uint256 reinsuranceThreshold,
            uint256 totalCapital,
            uint256 availableCapital,
            uint256 reservedCapital,
            uint256 totalPremiumsCollected,
            uint256 totalClaimsPaid,
            uint256 activePolicies,
            uint256 totalCoverage,
            bool active,
            uint256 createdAt
        )[] memory
    );

    function getPolicy(uint256 policyId) external view returns (
        uint256 policyId,
        uint256 poolId,
        address policyholder,
        address coveredAsset,
        uint256 assetId,
        uint256 coverageAmount,
        uint256 premium,
        bool premiumPaid,
        uint256 startDate,
        uint256 endDate,
        uint256 deductible,
        uint8 status,
        uint256 createdAt,
        uint256 updatedAt
    );

    function getPolicyholderPolicies(address policyholder) external view returns (uint256[] memory);

    function getClaim(uint256 claimId) external view returns (
        uint256 claimId,
        uint256 policyId,
        address claimant,
        uint8 eventType,
        string memory eventDescription,
        uint256 eventDate,
        uint256 affectedAmount,
        uint256 claimedAmount,
        string[] memory evidence,
        uint8 status,
        address assessor,
        string memory assessmentNotes,
        uint256 payoutAmount,
        bytes32 payoutTxHash,
        uint256 submittedAt,
        uint256 assessedAt,
        uint256 paidAt
    );

    function getClaimantClaims(address claimant) external view returns (uint256[] memory);

    function getReinsuranceContracts(uint256 poolId) external view returns (
        uint256 contractId,
        address reinsurer,
        uint256 poolId,
        uint256 maxCoverage,
        uint256 premiumShare,
        uint256 attachmentPoint,
        uint256 exhaustionPoint,
        bool active,
        uint256 createdAt
    )[] memory;

    function calculatePremium(uint256 poolId, uint256 coverageAmount, uint256 duration) external view returns (uint256);
}