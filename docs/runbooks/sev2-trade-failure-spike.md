# RUNBOOK: SEV-2 Trade Failure Spike

**Severity:** SEV-2 (High)
**Target Resolution:** < 4 hours
**Escalation:** Engineering Lead, Platform Lead, Blockchain Lead

---

## Detection
- Alert: `TradeFailureRate > 10%` for 5 min
- Alert: `TradeFailureSpike > 10 failures` in 5 min
- User reports failed trades
- Support ticket spike

---

## Triage (0-10 minutes)

### 1. Check Trade Service
```bash
# Check trade engine logs
kubectl logs -l app=trade-engine -n production --tail=200

# Check for error patterns
kubectl logs -l app=trade-engine -n production | grep -i "error\|fail\|revert" | tail -50
```

### 2. Check Blockchain Status
```bash
# Gas price
curl https://api.etherscan.io/api?module=gastracker&action=gasoracle

# Current block
curl -X POST https://eth-mainnet.alchemyapi.io/v2/$KEY \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Pending transactions
kubectl exec -it trade-engine-0 -n production -- node scripts/check-nonce.js
```

### 3. Check Wallet Balances
```bash
# Check hot wallet balance
kubectl exec -it trade-engine-0 -n production -- node scripts/check-wallet-balance.js

# Check escrow balances
curl https://api.ethertrack.in/api/wallet/balance -H "Authorization: Bearer $TOKEN"
```

### 4. Check Smart Contract
```bash
# Contract paused?
cast call $CONTRACT "paused()(bool)" --rpc-url $RPC_URL

# Recent events
cast logs --from-block latest -100 --address $CONTRACT "TradeExecuted"
```

---

## Common Causes & Actions

### High Gas Prices
```bash
# If > 100 gwei
kubectl set env deployment/trade-engine -n production MAX_GAS_PRICE_GWEI=150
kubectl rollout restart deployment/trade-engine -n production
```

### Nonce Issues
```bash
# Check pending
kubectl exec -it trade-engine-0 -n production -- node scripts/check-nonce.js

# Reset if stuck
kubectl exec -it trade-engine-0 -n production -- node scripts/reset-nonce.js
```

### RPC Provider Issues
```bash
# Check Alchemy status
curl https://eth-mainnet.alchemyapi.io/v2/$KEY/health

# Failover to backup RPC
kubectl set env deployment/trade-engine -n production RPC_URL=https://backup-rpc.example.com
kubectl rollout restart deployment/trade-engine -n production
```

### Smart Contract Issues
```bash
# Check paused
cast call $CONTRACT "paused()(bool)" --rpc-url $RPC_URL

# If paused - check governance/emergency multisig
# If upgraded - verify new ABI deployed
```

---

## Containment
1. **Pause** new trade acceptance (feature flag):
   ```bash
   kubectl set env deployment/trade-engine -n production FEATURE_TRADING_ENABLED=false
   ```
2. **Queue** pending trades for retry
3. **Communicate** to users: "Trade processing temporarily delayed"

---

## Resolution
1. Fix root cause
2. Retry queued trades
3. Verify success rate > 99%
4. Re-enable trading

---

## Post-Incident
- Schedule RCA
- Write postmortem
- Create action items
- Update runbooks if needed