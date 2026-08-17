import { Listing, BuyOrder, Trade, INRTradeLog, User, UserTokenBalance, MarketplaceStats } from "../generated/schema"
import { Marketplace, CreditListed, ListingCancelled, ListingUpdated, BuyOrderPlaced, BuyOrderCancelled, BuyOrderFilled, CreditTraded, INRTradeLogged, MatchExecuted } from "../generated/Marketplace/Marketplace"
import { Bytes, BigInt, log } from "@graphprotocol/graph-ts"

const STATS_ID = "global"

export function handleCreditListed(event: CreditListed): void {
  let listing = new Listing(event.params.listingId.toString())
  listing.seller = event.params.seller
  listing.token = event.params.tokenId.toString()
  listing.amount = event.params.amount
  listing.amountRemaining = event.params.amount
  listing.pricePerUnitETH = event.params.pricePerUnit
  listing.pricePerUnitINR = event.params.pricePerUnitINR
  listing.listedAt = event.params.listedAt
  listing.expiresAt = event.block.timestamp.plus(BigInt.fromI32(30 * 24 * 60 * 60)) // 30 days default
  listing.active = true
  listing.createdAt = event.block.timestamp
  listing.updatedAt = event.block.timestamp
  listing.save()

  // Update stats
  let stats = MarketplaceStats.load(STATS_ID)
  if (!stats) {
    stats = new MarketplaceStats(STATS_ID)
    stats.totalVolumeETH = BigInt.fromI32(0)
    stats.totalVolumeINR = BigInt.fromI32(0)
    stats.totalTrades = BigInt.fromI32(0)
    stats.totalListings = BigInt.fromI32(0)
    stats.activeListings = BigInt.fromI32(0)
    stats.totalUsers = BigInt.fromI32(0)
    stats.kycVerifiedUsers = BigInt.fromI32(0)
    stats.totalCreditsMinted = BigInt.fromI32(0)
    stats.totalCreditsRetired = BigInt.fromI32(0)
    stats.totalFeesCollectedETH = BigInt.fromI32(0)
    stats.totalFeesCollectedINR = BigInt.fromI32(0)
  }
  stats.totalListings = stats.totalListings.plus(BigInt.fromI32(1))
  stats.activeListings = stats.activeListings.plus(BigInt.fromI32(1))
  stats.updatedAt = event.block.timestamp
  stats.save()
}

export function handleListingCancelled(event: ListingCancelled): void {
  let listing = Listing.load(event.params.listingId.toString())
  if (!listing) return

  listing.active = false
  listing.updatedAt = event.block.timestamp
  listing.save()

  let stats = MarketplaceStats.load(STATS_ID)
  if (stats) {
    stats.activeListings = stats.activeListings.minus(BigInt.fromI32(1))
    stats.updatedAt = event.block.timestamp
    stats.save()
  }
}

export function handleListingUpdated(event: ListingUpdated): void {
  let listing = Listing.load(event.params.listingId.toString())
  if (!listing) return

  listing.pricePerUnitETH = event.params.newPrice
  listing.pricePerUnitINR = event.params.newPriceINR
  listing.updatedAt = event.block.timestamp
  listing.save()
}

export function handleBuyOrderPlaced(event: BuyOrderPlaced): void {
  let order = new BuyOrder(event.params.orderId.toString())
  order.buyer = event.params.buyer
  order.token = event.params.tokenId.toString()
  order.amount = event.params.amount
  order.amountFilled = BigInt.fromI32(0)
  order.limitPrice = event.params.limitPrice
  order.ethEscrowed = event.params.ethEscrowed
  order.status = "OPEN"
  order.createdAt = event.block.timestamp
  order.expiresAt = event.block.timestamp.plus(BigInt.fromI32(7 * 24 * 60 * 60)) // 7 days default
  order.updatedAt = event.block.timestamp
  order.save()

  // Update buyer stats
  let buyer = User.load(event.params.buyer.toHexString())
  if (!buyer) {
    buyer = new User(event.params.buyer.toHexString())
    buyer.wallet = event.params.buyer
    buyer.kycVerified = true
    buyer.totalCreditsOwned = BigInt.fromI32(0)
    buyer.totalCreditsRetired = BigInt.fromI32(0)
    buyer.totalTrades = BigInt.fromI32(0)
    buyer.totalVolumeETH = BigInt.fromI32(0)
    buyer.totalVolumeINR = BigInt.fromI32(0)
    buyer.createdAt = event.block.timestamp
  }
  buyer.totalTrades = buyer.totalTrades.plus(BigInt.fromI32(1))
  buyer.totalVolumeETH = buyer.totalVolumeETH.plus(event.params.ethEscrowed)
  buyer.updatedAt = event.block.timestamp
  buyer.save()
}

export function handleBuyOrderCancelled(event: BuyOrderCancelled): void {
  let order = BuyOrder.load(event.params.orderId.toString())
  if (!order) return

  order.status = "CANCELLED"
  order.updatedAt = event.block.timestamp
  order.save()

  // Refund logic handled by contract, we just track the cancellation
}

export function handleBuyOrderFilled(event: BuyOrderFilled): void {
  let order = BuyOrder.load(event.params.orderId.toString())
  if (!order) return

  order.amountFilled = event.params.amountFilled
  order.amountRemaining = order.amount.minus(event.params.amountFilled)
  order.status = event.params.amountFilled >= order.amount ? "FILLED" : "PARTIALLY_FILLED"
  order.updatedAt = event.block.timestamp
  order.save()
}

export function handleCreditTraded(event: CreditTraded): void {
  let trade = new Trade(event.params.tradeId.toString())
  trade.listing = event.params.listingId.toString()
  trade.buyOrder = event.params.buyOrderId.toString()
  trade.buyer = event.params.buyer
  trade.seller = event.params.seller
  trade.token = event.params.tokenId.toString()
  trade.amount = event.params.amount
  trade.pricePerUnitETH = event.params.pricePerUnit
  trade.pricePerUnitINR = event.params.pricePerUnitINR
  trade.totalPriceETH = event.params.totalPrice
  trade.priceINR = event.params.pricePerUnitINR
  trade.buyerFee = event.params.buyerFee
  trade.sellerFee = event.params.sellerFee
  trade.totalFee = event.params.totalFee
  trade.tradedAt = event.block.timestamp
  trade.isAMM = event.params.isAMM
  trade.transactionHash = event.transaction.hash
  trade.blockNumber = event.block.number
  trade.logIndex = BigInt.fromI32(event.logIndex)
  trade.save()

  // Update buyer
  let buyer = User.load(event.params.buyer.toHexString())
  if (!buyer) {
    buyer = new User(event.params.buyer.toHexString())
    buyer.wallet = event.params.buyer
    buyer.kycVerified = true
    buyer.totalCreditsOwned = BigInt.fromI32(0)
    buyer.totalCreditsRetired = BigInt.fromI32(0)
    buyer.totalTrades = BigInt.fromI32(0)
    buyer.totalVolumeETH = BigInt.fromI32(0)
    buyer.totalVolumeINR = BigInt.fromI32(0)
    buyer.createdAt = event.block.timestamp
  }
  buyer.totalCreditsOwned = buyer.totalCreditsOwned.plus(event.params.amount)
  buyer.totalTrades = buyer.totalTrades.plus(BigInt.fromI32(1))
  buyer.totalVolumeETH = buyer.totalVolumeETH.plus(event.params.totalPrice)
  buyer.totalVolumeINR = buyer.totalVolumeINR.plus(event.params.pricePerUnitINR.times(event.params.amount))
  buyer.updatedAt = event.block.timestamp
  buyer.save()

  // Update seller
  let seller = User.load(event.params.seller.toHexString())
  if (!seller) {
    seller = new User(event.params.seller.toHexString())
    seller.wallet = event.params.seller
    seller.kycVerified = true
    seller.totalCreditsOwned = BigInt.fromI32(0)
    seller.totalCreditsRetired = BigInt.fromI32(0)
    seller.totalTrades = BigInt.fromI32(0)
    seller.totalVolumeETH = BigInt.fromI32(0)
    seller.totalVolumeINR = BigInt.fromI32(0)
    seller.createdAt = event.block.timestamp
  }
  seller.totalCreditsOwned = seller.totalCreditsOwned.minus(event.params.amount)
  seller.totalTrades = seller.totalTrades.plus(BigInt.fromI32(1))
  seller.totalVolumeETH = seller.totalVolumeETH.plus(event.params.totalPrice.minus(event.params.sellerFee))
  seller.totalVolumeINR = seller.totalVolumeINR.plus(event.params.pricePerUnitINR.times(event.params.amount).minus(event.params.sellerFee))
  seller.updatedAt = event.block.timestamp
  seller.save()

  // Update user token balances
  let buyerBalance = UserTokenBalance.load(event.params.buyer.toHexString() + "-" + event.params.tokenId.toString())
  if (!buyerBalance) {
    buyerBalance = new UserTokenBalance(event.params.buyer.toHexString() + "-" + event.params.tokenId.toString())
    buyerBalance.user = event.params.buyer.toHexString()
    buyerBalance.token = event.params.tokenId.toString()
    buyerBalance.balance = BigInt.fromI32(0)
    buyerBalance.retired = BigInt.fromI32(0)
  }
  buyerBalance.balance = buyerBalance.balance.plus(event.params.amount)
  buyerBalance.updatedAt = event.block.timestamp
  buyerBalance.save()

  let sellerBalance = UserTokenBalance.load(event.params.seller.toHexString() + "-" + event.params.tokenId.toString())
  if (!sellerBalance) {
    sellerBalance = new UserTokenBalance(event.params.seller.toHexString() + "-" + event.params.tokenId.toString())
    sellerBalance.user = event.params.seller.toHexString()
    sellerBalance.token = event.params.tokenId.toString()
    sellerBalance.balance = BigInt.fromI32(0)
    sellerBalance.retired = BigInt.fromI32(0)
  }
  sellerBalance.balance = sellerBalance.balance.minus(event.params.amount)
  sellerBalance.updatedAt = event.block.timestamp
  sellerBalance.save()

  // Update global stats
  let stats = MarketplaceStats.load(STATS_ID)
  if (stats) {
    stats.totalVolumeETH = stats.totalVolumeETH.plus(event.params.totalPrice)
    stats.totalVolumeINR = stats.totalVolumeINR.plus(event.params.pricePerUnitINR.times(event.params.amount))
    stats.totalTrades = stats.totalTrades.plus(BigInt.fromI32(1))
    stats.totalFeesCollectedETH = stats.totalFeesCollectedETH.plus(event.params.totalFee)
    stats.totalFeesCollectedINR = stats.totalFeesCollectedINR.plus(event.params.buyerFee.plus(event.params.sellerFee))
    stats.lastTradeAt = event.block.timestamp
    stats.updatedAt = event.block.timestamp
    stats.save()
  }
}

export function handleINRTradeLogged(event: INRTradeLogged): void {
  let inrTrade = new INRTradeLog(event.params.tradeId.toHexString())
  inrTrade.token = event.params.tokenId.toString()
  inrTrade.quantity = event.params.quantity
  inrTrade.priceINR = event.params.priceINR
  inrTrade.payMode = event.params.payMode.toI32() == 0 ? "INR_WALLET" : "RAZORPAY"
  inrTrade.buyer = event.params.buyer
  inrTrade.seller = event.params.seller
  inrTrade.timestamp = event.params.timestamp
  inrTrade.tradeHash = event.params.tradeHash
  inrTrade.blockLogged = event.params.blockLogged
  inrTrade.transactionHash = event.transaction.hash
  inrTrade.blockNumber = event.block.number
  inrTrade.logIndex = BigInt.fromI32(event.logIndex)
  inrTrade.save()

  // Update stats
  let stats = MarketplaceStats.load(STATS_ID)
  if (stats) {
    stats.totalVolumeINR = stats.totalVolumeINR.plus(event.params.priceINR.times(event.params.quantity))
    stats.totalTrades = stats.totalTrades.plus(BigInt.fromI32(1))
    stats.lastTradeAt = event.block.timestamp
    stats.updatedAt = event.block.timestamp
    stats.save()
  }
}

export function handleMatchExecuted(event: MatchExecuted): void {
  // This is emitted when AMM matches an order
  // Similar to CreditTraded but for AMM matches
  log.info("Match executed: listing {}, order {}, amount {}, price {}", [
    event.params.listingId.toString(),
    event.params.buyOrderId.toString(),
    event.params.amount.toString(),
    event.params.price.toString()
  ])
}