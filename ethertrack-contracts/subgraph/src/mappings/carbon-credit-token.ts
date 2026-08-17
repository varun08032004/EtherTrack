import { CarbonCredit, User, Standard } from "../generated/schema"
import { CarbonCreditToken, CreditMinted, CreditRetired, TransferSingle, TransferBatch } from "../generated/CarbonCreditToken/CarbonCreditToken"
import { Bytes, BigInt, log } from "@graphprotocol/graph-ts"

export function handleCreditMinted(event: CreditMinted): void {
  let token = new CarbonCredit(event.params.tokenId.toString())
  token.projectName = event.params.projectName
  token.location = event.params.location
  token.standard = Standard[Standard[event.params.standard.toString()]]
  token.totalSupply = event.params.amount
  token.totalRetired = BigInt.fromI32(0)
  token.totalListed = BigInt.fromI32(0)
  token.totalSold = BigInt.fromI32(0)
  token.active = true
  token.registeredBy = event.params.to
  token.registeredAt = event.block.timestamp
  token.createdAt = event.block.timestamp
  token.updatedAt = event.block.timestamp
  token.save()

  // Update user stats
  let user = User.load(event.params.to.toHexString())
  if (!user) {
    user = new User(event.params.to.toHexString())
    user.wallet = event.params.to
    user.kycVerified = true // mint requires KYC
    user.totalCreditsOwned = BigInt.fromI32(0)
    user.totalCreditsRetired = BigInt.fromI32(0)
    user.totalTrades = BigInt.fromI32(0)
    user.totalVolumeETH = BigInt.fromI32(0)
    user.totalVolumeINR = BigInt.fromI32(0)
    user.createdAt = event.block.timestamp
    user.updatedAt = event.block.timestamp
  }
  user.totalCreditsOwned = user.totalCreditsOwned.plus(event.params.amount)
  user.updatedAt = event.block.timestamp
  user.save()
}

export function handleCreditRetired(event: CreditRetired): void {
  let token = CarbonCredit.load(event.params.tokenId.toString())
  if (!token) return

  token.totalRetired = token.totalRetired.plus(event.params.amount)
  token.totalSupply = token.totalSupply.minus(event.params.amount)
  if (token.totalSupply.equals(BigInt.fromI32(0))) {
    token.active = false
  }
  token.updatedAt = event.block.timestamp
  token.save()

  // Update user stats
  let user = User.load(event.params.retiredBy.toHexString())
  if (user) {
    user.totalCreditsRetired = user.totalCreditsRetired.plus(event.params.amount)
    user.totalCreditsOwned = user.totalCreditsOwned.minus(event.params.amount)
    user.updatedAt = event.block.timestamp
    user.save()
  }
}

export function handleTransferSingle(event: TransferSingle): void {
  // from -> to transfer of single token
  let from = User.load(event.params.from.toHexString())
  let to = User.load(event.params.to.toHexString())
  let tokenId = event.params.id
  let amount = event.params.value

  if (from) {
    // Update sender balance
    // Note: In practice, you'd track per-token balances per user
    // This is a simplified version
    from.totalCreditsOwned = from.totalCreditsOwned.minus(amount)
    from.updatedAt = event.block.timestamp
    from.save()
  }

  if (to) {
    // Update receiver balance
    if (!to) {
      to = new User(event.params.to.toHexString())
      to.wallet = event.params.to
      to.totalCreditsOwned = BigInt.fromI32(0)
      to.totalCreditsRetired = BigInt.fromI32(0)
      to.totalTrades = BigInt.fromI32(0)
      to.totalVolumeETH = BigInt.fromI32(0)
      to.totalVolumeINR = BigInt.fromI32(0)
      to.createdAt = event.block.timestamp
      to.kycVerified = true
    }
    to.totalCreditsOwned = to.totalCreditsOwned.plus(amount)
    to.updatedAt = event.block.timestamp
    to.save()
  }
}

export function handleTransferBatch(event: TransferBatch): void {
  // Batch transfer - multiple tokens at once
  // Similar logic to handleTransferSingle but for arrays
  let from = User.load(event.params.from.toHexString())
  let to = User.load(event.params.to.toHexString())

  for (let i = 0; i < event.params.ids.length; i++) {
    let tokenId = event.params.ids[i]
    let amount = event.params.values[i]

    if (from) {
      // Update sender
      from.updatedAt = event.block.timestamp
      from.save()
    }

    if (to) {
      if (!to) {
        to = new User(event.params.to.toHexString())
        to.wallet = event.params.to
        to.totalCreditsOwned = BigInt.fromI32(0)
        to.totalCreditsRetired = BigInt.fromI32(0)
        to.totalTrades = BigInt.fromI32(0)
        to.totalVolumeETH = BigInt.fromI32(0)
        to.totalVolumeINR = BigInt.fromI32(0)
        to.createdAt = event.block.timestamp
        to.kycVerified = true
      }
      to.totalCreditsOwned = to.totalCreditsOwned.plus(amount)
      to.updatedAt = event.block.timestamp
      to.save()
    }
  }
}