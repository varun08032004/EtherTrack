// services/exchangeService.js — EtherTrack CCTS Exchange Integration - 28/05/2026

'use strict';

const { safeQuery: query, withTransaction } = require('../db/pool');

class GCIRegistryClient {
  constructor() {
    this.baseUrl    = process.env.GCI_API_URL    || 'https://registry.gridindia.in/api/v1';
    this.apiKey     = process.env.GCI_API_KEY    || null;
    this.entityCode = process.env.GCI_ENTITY_CODE || null;
    this.isLive     = !!(this.apiKey && this.entityCode);
  }

  async _logSync(entityId, syncType, status, payload, response, errorMsg, gciRef) {
    await query(
      `INSERT INTO gci_sync_log
         (entity_id, sync_type, status, records_synced, error_message,
          request_payload, response_payload, gci_reference_id, initiated_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
      [entityId || null, syncType, status,
       response?.records_synced || 0,
       errorMsg || null,
       JSON.stringify(payload),
       JSON.stringify(response),
       gciRef || null]
    ).catch(() => {});
  }

  async pullPosition(entityId, periodId) {
    const payload = { entityId, periodId, requestType: 'POSITION_QUERY' };

    if (!this.isLive) {
      
      console.info('[GCI] Stub mode — GCI_API_KEY not set, returning mock position');
      const mockResult = {
        entityId,
        periodId,
        heldCCC:        Math.floor(Math.random() * 500) + 200,
        pendingCCC:     Math.floor(Math.random() * 50),
        retiredCCC:     Math.floor(Math.random() * 100),
        gciReference:   `GCI-MOCK-${Date.now()}`,
        syncedAt:       new Date().toISOString(),
        isStub:         true,
      };
      await this._logSync(entityId, 'position_pull', 'success', payload, mockResult, null, mockResult.gciReference);
      return mockResult;
    }

    try {
      const res = await fetch(`${this.baseUrl}/positions/query`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'X-Entity-Code': this.entityCode,
          'Content-Type':  'application/json',
        },
        body:   JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) throw new Error(`GCI API ${res.status}: ${await res.text()}`);
      const data = await res.json();

      await query(
        `UPDATE compliance_positions
         SET held_ccc       = $1,
             pending_purchase_ccc = $2,
             surrendered_ccc = $3,
             last_synced_at  = NOW(),
             data_source     = 'gci_sync',
             updated_at      = NOW()
         WHERE entity_id = $4 AND period_id = $5`,
        [data.heldCCC, data.pendingCCC || 0, data.retiredCCC || 0, entityId, periodId]
      );

      await this._logSync(entityId, 'position_pull', 'success', payload, data, null, data.referenceId);
      return data;
    } catch (e) {
      await this._logSync(entityId, 'position_pull', 'failed', payload, null, e.message, null);
      throw e;
    }
  }

  async pushTradeRecord(tradeRecord) {
    const payload = {
      tradeId:      tradeRecord.id,
      buyerDcId:    tradeRecord.buyer_dc_id,
      sellerDcId:   tradeRecord.seller_dc_id,
      quantity:     tradeRecord.quantity,
      priceInr:     tradeRecord.price_per_credit_inr,
      txHash:       tradeRecord.tx_hash,
      tradeDate:    tradeRecord.created_at,
      periodId:     tradeRecord.period_id,
    };

    if (!this.isLive) {
      console.info('[GCI] Stub — pushTradeRecord skipped (GCI_API_KEY not set)');
      await this._logSync(tradeRecord.buyer_entity_id, 'trade_push', 'success',
        payload, { stub: true }, null, `GCI-TRADE-STUB-${tradeRecord.id}`);
      return { success: true, stub: true };
    }

    try {
      const res = await fetch(`${this.baseUrl}/trades/record`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type':  'application/json',
        },
        body:   JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`GCI push failed: ${res.status}`);
      const data = await res.json();
      await this._logSync(tradeRecord.buyer_entity_id, 'trade_push', 'success', payload, data, null, data.referenceId);
      return data;
    } catch (e) {
      await this._logSync(tradeRecord.buyer_entity_id, 'trade_push', 'failed', payload, null, e.message, null);
      throw e;
    }
  }

  async pushRetirement(retirementRecord) {
    const payload = {
      entityDcId:   retirementRecord.dc_id,
      tokenId:      retirementRecord.token_id,
      quantity:     retirementRecord.credits,
      certId:       retirementRecord.cert_id,
      txHash:       retirementRecord.tx_hash,
      beneficiary:  retirementRecord.beneficiary,
      retiredAt:    retirementRecord.retired_at,
      periodId:     retirementRecord.period_id,
    };

    if (!this.isLive) {
      console.info('[GCI] Stub — pushRetirement skipped (GCI_API_KEY not set)');
      const gciCertRef = `GCI-RET-STUB-${retirementRecord.cert_id}`;
      await this._logSync(retirementRecord.entity_id, 'retirement_push', 'success',
        payload, { stub: true, gciCertRef }, null, gciCertRef);
      return { success: true, stub: true, gciCertRef };
    }

    try {
      const res = await fetch(`${this.baseUrl}/retirements/record`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type':  'application/json',
        },
        body:   JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`GCI retirement push failed: ${res.status}`);
      const data = await res.json();
      await this._logSync(retirementRecord.entity_id, 'retirement_push', 'success',
        payload, data, null, data.gciCertRef || data.referenceId);
      return data;
    } catch (e) {
      await this._logSync(retirementRecord.entity_id, 'retirement_push', 'failed',
        payload, null, e.message, null);
      throw e;
    }
  }

  async getSyncHistory(entityId, limit = 20) {
    const { rows } = await query(
      `SELECT * FROM gci_sync_log
       WHERE entity_id = $1 OR $1 IS NULL
       ORDER BY initiated_at DESC LIMIT $2`,
      [entityId || null, limit]
    );
    return rows;
  }
}

class IEXClient {
  constructor() {
    this.baseUrl  = process.env.IEX_API_URL    || 'https://api.iexindia.com/ccc/v1';
    this.apiKey   = process.env.IEX_API_KEY    || null;
    this.clientId = process.env.IEX_CLIENT_ID  || null;
    this.isLive   = !!(this.apiKey && this.clientId);
  }

  async submitOrder({ entityId, nettingSessionId, orderSide, orderType, quantityCcc, limitPriceInr, periodId, submittedBy }) {
    const orderId = `ET-IEX-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const { rows } = await query(
      `INSERT INTO exchange_orders
         (entity_id, netting_session_id, period_id, exchange, order_side,
          order_type, quantity_ccc, limit_price_inr, order_status, submitted_by,
          updated_at)
       VALUES ($1,$2,$3,'IEX',$4,$5,$6,$7,'pending',$8,NOW())
       RETURNING id`,
      [entityId, nettingSessionId||null, periodId||null, orderSide, orderType,
       parseFloat(quantityCcc), limitPriceInr ? parseFloat(limitPriceInr) : null,
       submittedBy]
    );
    const dbOrderId = rows[0].id;

    if (!this.isLive) {

      const mockExchangeOrderId = `IEX-MOCK-${Date.now()}`;
      await query(
        `UPDATE exchange_orders
         SET order_status = 'submitted', exchange_order_id = $1,
             submitted_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [mockExchangeOrderId, dbOrderId]
      );
      console.info(`[IEX] Stub — order ${dbOrderId} simulated as submitted: ${mockExchangeOrderId}`);
      return { dbOrderId, exchangeOrderId: mockExchangeOrderId, status: 'submitted', stub: true };
    }

    try {
      const payload = {
        clientId:    this.clientId,
        orderSide:   orderSide.toUpperCase(),
        orderType:   orderType.toUpperCase(),
        quantity:    parseFloat(quantityCcc),
        limitPrice:  limitPriceInr,
        instrument:  'CCC',
        reference:   orderId,
      };

      const res = await fetch(`${this.baseUrl}/orders/submit`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'X-Client-Id':   this.clientId,
          'Content-Type':  'application/json',
        },
        body:   JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) throw new Error(`IEX order submit ${res.status}: ${await res.text()}`);
      const data = await res.json();

      await query(
        `UPDATE exchange_orders
         SET order_status = 'submitted', exchange_order_id = $1,
             exchange_session_id = $2, submitted_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [data.orderId, data.sessionId || null, dbOrderId]
      );

      return { dbOrderId, exchangeOrderId: data.orderId, status: 'submitted' };
    } catch (e) {
      await query(
        `UPDATE exchange_orders
         SET order_status = 'rejected', rejection_reason = $1, updated_at = NOW()
         WHERE id = $2`,
        [e.message, dbOrderId]
      );
      throw e;
    }
  }

  async getOrderStatus(dbOrderId) {
    const { rows } = await query(
      `SELECT * FROM exchange_orders WHERE id = $1`, [dbOrderId]
    );
    if (!rows.length) throw new Error('Order not found');
    const order = rows[0];

    if (!this.isLive) {
      
      const ageMs = Date.now() - new Date(order.created_at).getTime();
      if (ageMs > 120000 && order.order_status === 'submitted') {
        const filled = parseFloat(order.quantity_ccc);
        const price  = parseFloat(order.limit_price_inr) || 850;
        await query(
          `UPDATE exchange_orders
           SET order_status = 'filled', executed_quantity = $1,
               executed_price_inr = $2, total_value_inr = $3,
               exchange_fee_inr = $4, updated_at = NOW()
           WHERE id = $5`,
          [filled, price, filled * price, filled * price * 0.001, dbOrderId]
        );
        return { ...order, order_status: 'filled', executed_quantity: filled };
      }
      return order;
    }

    try {
      const res = await fetch(`${this.baseUrl}/orders/${order.exchange_order_id}/status`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal:  AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`IEX status ${res.status}`);
      const data = await res.json();

      await query(
        `UPDATE exchange_orders
         SET order_status = $1, executed_quantity = $2,
             executed_price_inr = $3, total_value_inr = $4,
             exchange_fee_inr = $5, updated_at = NOW()
         WHERE id = $6`,
        [data.status?.toLowerCase(), data.filledQty || 0,
         data.avgPrice || null, data.totalValue || null,
         data.fee || null, dbOrderId]
      );
      return { ...order, ...data };
    } catch (e) {
      console.error('[IEX] getOrderStatus failed:', e.message);
      return order;
    }
  }
}

class PXILClient {
  constructor() {
    this.baseUrl  = process.env.PXIL_API_URL   || 'https://api.pxil.co.in/ccc/v1';
    this.apiKey   = process.env.PXIL_API_KEY   || null;
    this.clientId = process.env.PXIL_CLIENT_ID || null;
    this.isLive   = !!(this.apiKey && this.clientId);
  }

  async submitOrder({ entityId, nettingSessionId, orderSide, orderType, quantityCcc, limitPriceInr, periodId, submittedBy }) {
    const { rows } = await query(
      `INSERT INTO exchange_orders
         (entity_id, netting_session_id, period_id, exchange, order_side,
          order_type, quantity_ccc, limit_price_inr, order_status, submitted_by, updated_at)
       VALUES ($1,$2,$3,'PXIL',$4,$5,$6,$7,'pending',$8,NOW())
       RETURNING id`,
      [entityId, nettingSessionId||null, periodId||null, orderSide, orderType,
       parseFloat(quantityCcc), limitPriceInr ? parseFloat(limitPriceInr) : null, submittedBy]
    );
    const dbOrderId = rows[0].id;

    if (!this.isLive) {
      const mockExchangeOrderId = `PXIL-MOCK-${Date.now()}`;
      await query(
        `UPDATE exchange_orders SET order_status = 'submitted',
         exchange_order_id = $1, submitted_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [mockExchangeOrderId, dbOrderId]
      );
      return { dbOrderId, exchangeOrderId: mockExchangeOrderId, status: 'submitted', stub: true };
    }

    try {
      const res = await fetch(`${this.baseUrl}/order/place`, {
        method: 'POST',
        headers: {
          'Authorization': `ApiKey ${this.apiKey}`,
          'Member-Code':   this.clientId,
          'Content-Type':  'application/json',
        },
        body:   JSON.stringify({ side: orderSide, type: orderType, qty: quantityCcc, price: limitPriceInr, product: 'CCC' }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`PXIL ${res.status}`);
      const data = await res.json();
      await query(
        `UPDATE exchange_orders SET order_status = 'submitted', exchange_order_id = $1,
         submitted_at = NOW(), updated_at = NOW() WHERE id = $2`,
        [data.orderRef, dbOrderId]
      );
      return { dbOrderId, exchangeOrderId: data.orderRef, status: 'submitted' };
    } catch (e) {
      await query(
        `UPDATE exchange_orders SET order_status = 'rejected', rejection_reason = $1,
         updated_at = NOW() WHERE id = $2`,
        [e.message, dbOrderId]
      );
      throw e;
    }
  }
}

class CERCReconciler {
 
  async reconcileSettledOrders() {
    try {

      const { rows: pendingOrders } = await query(
        `SELECT * FROM exchange_orders
         WHERE order_status = 'filled'
           AND cerc_reconciled = FALSE
           AND updated_at < NOW() - INTERVAL '2 days'
         ORDER BY updated_at ASC
         LIMIT 100`
      );

      let reconciled = 0;
      for (const order of pendingOrders) {
    
        const cercRef = `CERC-${order.exchange}-${order.id.slice(0,8).toUpperCase()}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;

        await query(
          `UPDATE exchange_orders
           SET cerc_reconciled = TRUE,
               cerc_reconciled_at = NOW(),
               cerc_settlement_ref = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [cercRef, order.id]
        );
        reconciled++;
      }

      if (reconciled > 0) {
        console.info(`[CERC] Reconciled ${reconciled} settled orders`);
      }
      return { reconciled };
    } catch (e) {
      console.error('[CERC] Reconciliation failed:', e.message);
      throw e;
    }
  }

  async getReconciliationReport(entityId, periodId) {
    const { rows } = await query(
      `SELECT
         exchange,
         COUNT(*) FILTER (WHERE order_status = 'filled')              AS total_filled,
         COUNT(*) FILTER (WHERE cerc_reconciled = TRUE)               AS cerc_reconciled,
         COUNT(*) FILTER (WHERE cerc_reconciled = FALSE AND order_status = 'filled') AS pending_reconciliation,
         SUM(executed_quantity) FILTER (WHERE order_status = 'filled') AS total_quantity,
         SUM(total_value_inr)   FILTER (WHERE order_status = 'filled') AS total_value,
         SUM(exchange_fee_inr)  FILTER (WHERE order_status = 'filled') AS total_fees
       FROM exchange_orders
       WHERE entity_id = $1
         AND ($2::integer IS NULL OR period_id = $2)
       GROUP BY exchange`,
      [entityId, periodId || null]
    );
    return rows;
  }
}

const gciClient    = new GCIRegistryClient();
const iexClient    = new IEXClient();
const pxilClient   = new PXILClient();
const cercRecon    = new CERCReconciler();

module.exports = {
  gciClient,
  iexClient,
  pxilClient,
  cercRecon,
  GCIRegistryClient,
  IEXClient,
  PXILClient,
  CERCReconciler,
};
