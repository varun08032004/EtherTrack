import { User } from "../generated/schema"
import { KYCRegistry, KYCSubmitted, KYCApproved, KYCRejected, KYCRevoked } from "../generated/KYCRegistry/KYCRegistry"
import { Bytes, BigInt } from "@graphprotocol/graph-ts"

export function handleKYCSubmitted(event: KYCSubmitted): void {
  let user = User.load(event.params.user.toHexString())
  if (!user) {
    user = new User(event.params.user.toHexString())
    user.wallet = event.params.user
    user.kycVerified = false
    user.kycSubmittedAt = event.params.submittedAt
    user.createdAt = event.block.timestamp
  } else {
    user.kycSubmittedAt = event.params.submittedAt
  }
  user.updatedAt = event.block.timestamp
  user.save()
}

export function handleKYCApproved(event: KYCApproved): void {
  let user = User.load(event.params.user.toHexString())
  if (!user) {
    user = new User(event.params.user.toHexString())
    user.wallet = event.params.user
    user.kycSubmittedAt = event.params.submittedAt
    user.createdAt = event.block.timestamp
  }
  user.kycVerified = true
  user.kycApprovedAt = event.params.approvedAt
  user.updatedAt = event.block.timestamp
  user.save()
}

export function handleKYCRejected(event: KYCRejected): void {
  let user = User.load(event.params.user.toHexString())
  if (!user) {
    user = new User(event.params.user.toHexString())
    user.wallet = event.params.user
    user.createdAt = event.block.timestamp
  }
  user.kycVerified = false
  user.kycSubmittedAt = event.params.submittedAt
  user.updatedAt = event.block.timestamp
  user.save()
}

export function handleKYCRevoked(event: KYCRevoked): void {
  let user = User.load(event.params.user.toHexString())
  if (!user) {
    user = new User(event.params.user.toHexString())
    user.wallet = event.params.user
    user.createdAt = event.block.timestamp
  }
  user.kycVerified = false
  user.kycRevokedAt = event.block.timestamp
  user.updatedAt = event.block.timestamp
  user.save()
}