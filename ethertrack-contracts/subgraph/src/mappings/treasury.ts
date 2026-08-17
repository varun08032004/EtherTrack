import { MarketplaceStats } from "../generated/schema"
import { Treasury, FeeDeposited, FeeWithdrawn } from "../generated/Treasury/Treasury"
import { BigInt } from "@graphprotocol/graph-ts"

const STATS_ID = "global"

export function handleFeeDeposited(event: FeeDeposited): void {
  let stats = MarketplaceStats.load("global")
  if (!stats) {
    return
  }

  // Track fees by payment mode
  // event.params.mode: 0 = INR_WALLET, 1 = RAZORPAY, 2 = ETH
  if (event.params.mode.toI32() == 2) {
    // ETH
    // Assuming amount is in wei
    let ethFees = event.params.amount
    // Stats already tracks total fees
  } else {
    // INR payments
  }
}

export function handleFeeWithdrawn(event: FeeWithdrawn): void {
  // Track fee withdrawals to treasury
}