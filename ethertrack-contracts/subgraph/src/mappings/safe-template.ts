import { SafeConfig, SafeTransaction } from "../generated/schema"
import { GnosisSafe, ExecutionSuccess, ExecutionFailure, Confirmation } from "../generated/GnosisSafe/GnosisSafe"
import { Bytes, BigInt } from "@graphprotocol/graph-ts"

export function handleExecutionSuccess(event: ExecutionSuccess): void {
  let tx = SafeTransaction.load(event.params.txId.toString())
  if (!tx) return

  tx.executed = true
  tx.save()

  // Update SafeConfig nonce
  let config = SafeConfig.load(event.address.toHexString())
  if (config) {
    config.nonce = config.nonce.plus(BigInt.fromI32(1))
    config.updatedAt = event.block.timestamp
    config.save()
  }
}

export function handleExecutionFailure(event: ExecutionFailure): void {
  let tx = SafeTransaction.load(event.params.txId.toString())
  if (!tx) return

  // Transaction failed but was attempted
  tx.confirmations = BigInt.fromI32(config.threshold) // Mark as failed by setting confirmations to threshold
  tx.save()
}

export function handleConfirmation(event: Confirmation): void {
  let tx = SafeTransaction.load(event.params.txId.toString())
  if (!tx) return

  // Add confirmer to list
  let confirmer = event.params.owner.toHexString()
  if (!tx.confirmers.includes(confirmer)) {
    let confirmers = tx.confirmers
    confirmers.push(event.params.owner)
    tx.confirmers = confirmers
    tx.confirmations = tx.confirmations.plus(BigInt.fromI32(1))
    tx.save()
  }
}