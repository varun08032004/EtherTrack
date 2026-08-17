import { User, UserTokenBalance } from "../generated/schema"
import { CreditLedger, OwnershipLogged, CreditRetiredLogged } from "../generated/CreditLedger/CreditLedger"
import { Bytes, BigInt } from "@graphprotocol/graph-ts"

export function handleOwnershipLogged(event: OwnershipLogged): void {
  // Update user token balance
  let user = User.load(event.params.userId.toHexString())
  if (!user) {
    user = new User(event.params.userId.toHexString())
    user.wallet = Bytes.fromHexString("0x") // Will be updated when wallet is linked
    user.kycVerified = false
    user.createdAt = event.params.loggedAt
  }

  let balanceId = event.params.userId.toHexString() + "-" + event.params.tokenId.toString()
  let balance = UserTokenBalance.load(balanceId)
  if (!balance) {
    balance = new UserTokenBalance(balanceId)
    balance.user = event.params.userId.toHexString()
    balance.token = event.params.tokenId.toString()
    balance.balance = BigInt.fromI32(0)
    balance.retired = BigInt.fromI32(0)
  }

  if (event.params.amountDelta > BigInt.fromI32(0)) {
    balance.balance = balance.balance.plus(BigInt.fromI32(event.params.amountDelta.toI32()))
  } else {
    balance.balance = balance.balance.minus(BigInt.fromI32((-event.params.amountDelta).toI32()))
  }

  balance.updatedAt = event.params.loggedAt
  balance.save()

  // Update user stats
  let user = User.load(event.params.userId.toHexString())
  if (user) {
    user.updatedAt = event.params.loggedAt
    user.save()
  }
}

export function handleCreditRetiredLogged(event: CreditRetiredLogged): void {
  // Update user retired credits
  let user = User.load(event.params.userId.toHexString())
  if (user) {
    user.totalCreditsRetired = user.totalCreditsRetired.plus(event.params.amount)
    user.totalCreditsOwned = user.totalCreditsOwned.minus(event.params.amount)
    user.updatedAt = event.block.timestamp
    user.save()
  }
}