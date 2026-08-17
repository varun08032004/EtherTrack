import { SafeConfig, SafeTransaction, TimelockProposal } from "../generated/schema"
import { Governance, SafeRegistered, SafeUpdated, TransactionQueued, TransactionExecuted, TransactionConfirmed } from "../generated/Governance/Governance"
import { Bytes, BigInt } from "@graphprotocol/graph-ts"

export function handleSafeRegistered(event: SafeRegistered): void {
  let config = new SafeConfig(event.params.safeAddress.toHexString())
  config.label = event.params.label
  config.threshold = event.params.threshold
  config.owners = event.params.owners
  config.nonce = BigInt.fromI32(0)
  config.active = true
  config.createdAt = event.block.timestamp
  config.updatedAt = event.block.timestamp
  config.save()
}

export function handleSafeUpdated(event: SafeUpdated): void {
  let config = SafeConfig.load(event.params.safeAddress.toHexString())
  if (!config) return

  config.label = event.params.label
  config.active = event.params.active
  config.updatedAt = event.block.timestamp
  config.save()
}

export function handleTransactionQueued(event: TransactionQueued): void {
  let tx = new SafeTransaction(event.params.txId.toString())
  tx.safe = event.params.safeAddress.toHexString()
  tx.to = event.params.to
  tx.value = event.params.value
  // data would be passed in the actual event
  tx.timestamp = event.block.timestamp
  tx.executed = false
  tx.confirmations = BigInt.fromI32(0)
  tx.confirmers = []
  tx.save()
}

export function handleTransactionExecuted(event: TransactionExecuted): void {
  // This would be handled by the safe template
}

export function handleTransactionConfirmed(event: TransactionConfirmed): void {
  // This would be handled by the safe template
}