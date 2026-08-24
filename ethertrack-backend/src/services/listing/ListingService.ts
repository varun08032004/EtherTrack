// Listing Service - Manages listing lifecycle (create, update, cancel, query)

import { v4 as uuidv4 } from 'uuid';
import { withTransaction } from '../../../db/pool.js';
import { 
  Listing, 
  ListingStatus, 
  CustodyType, 
  Currency,
  MarketListingParams,
  PaginatedResponse,
  OwnershipPosition,
  validateListingInvariant,
  getAvailableQuantity
} from '../../domain/types';
import { CustodyAdapterFactory } from '../custody';

export class ListingService {
  async createListing(input: {
    sellerId: string;
    assetId: string;
    quantity: number;
    pricePerUnit: number;
    currency: Currency;
    buyerFeeBps?: number;
    sellerFeeBps?: number;
    durationDays?: number;
  }): Promise<Listing> {
    // Get seller's ownership position
    const position = await this.getOwnershipPosition(input.sellerId, input.assetId);
    if (!position) {
      throw new Error('No ownership position found for this asset');
    }

    const available = getAvailableQuantity(position);
    if (available < input.quantity) {
      throw new Error(`Insufficient available credits: ${available} available, ${input.quantity} requested`);
    }

    const custodyType = position.custodyType;
    const adapter = CustodyAdapterFactory.getAdapter(custodyType);

    // Reserve credits via custody adapter
    await adapter.reserveCredits(input.sellerId, input.assetId, input.quantity, 'pending');

    const listingId = uuidv4();
    const expiresAt = input.durationDays 
      ? new Date(Date.now() + input.durationDays * 24 * 60 * 60 * 1000)
      : null;

    const listing = await withTransaction(async (client) => {
      // Lock position
      await client.query(
        `SELECT * FROM ownership_positions WHERE position_id = $1 FOR UPDATE`,
        [position.positionId]
      );

      // Verify available again under lock
      const { rows: pos } = await client.query(
        `SELECT owned_quantity, reserved_quantity FROM ownership_positions WHERE position_id = $1`,
        [position.positionId]
      );
      const currentAvailable = Number(pos[0].owned_quantity) - Number(pos[0].reserved_quantity);
      if (currentAvailable < input.quantity) {
        throw new Error(`Insufficient available credits under lock: ${currentAvailable}`);
      }

      // Create listing
      const { rows } = await client.query(
        `INSERT INTO listings (
          listing_id, position_id, asset_id, seller_id, custody_type,
          quantity, remaining_quantity, price_per_unit, currency,
          buyer_fee_bps, seller_fee_bps, status, expires_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12)
        RETURNING *`,
        [
          listingId, position.positionId, input.assetId, input.sellerId, custodyType,
          input.quantity, input.quantity, input.pricePerUnit, input.currency,
          input.buyerFeeBps || 50, input.sellerFeeBps || 50, expiresAt
        ]
      );

      // Update position reserved quantity
      await client.query(
        `UPDATE ownership_positions 
         SET reserved_quantity = reserved_quantity + $1, updated_at = NOW()
         WHERE position_id = $2`,
        [input.quantity, position.positionId]
      );

      return rows[0];
    });

    return this.mapRowToListing(listing);
  }

  async cancelListing(listingId: string, sellerId: string): Promise<{ releasedQuantity: number }> {
    const result = await withTransaction(async (client) => {
      // Lock listing and position
      const { rows: listingRows } = await client.query(
        `SELECT l.*, op.position_id 
         FROM listings l
         JOIN ownership_positions op ON op.position_id = l.position_id
         WHERE l.listing_id = $1 AND l.seller_id = $2 AND l.status = 'active'
         FOR UPDATE`,
        [listingId, sellerId]
      );

      if (!listingRows.length) {
        throw new Error('Listing not found, not owned by seller, or not active');
      }

      const listing = listingRows[0];
      const releasedQuantity = Number(listing.remaining_quantity);

      // Release via custody adapter
      const adapter = CustodyAdapterFactory.getAdapter(listing.custody_type);
      await adapter.releaseReservation(listing.seller_id, listing.asset_id, releasedQuantity, listingId);

      // Update listing status
      await client.query(
        `UPDATE listings SET status = 'cancelled', updated_at = NOW() WHERE listing_id = $1`,
        [listingId]
      );

      // Update position reserved quantity
      await client.query(
        `UPDATE ownership_positions 
         SET reserved_quantity = reserved_quantity - $1, updated_at = NOW()
         WHERE position_id = $2`,
        [releasedQuantity, listing.position_id]
      );

      return { releasedQuantity };
    });

    return result;
  }

  async updateListingPrice(listingId: string, sellerId: string, newPricePerUnit: number): Promise<Listing> {
    const result = await withTransaction(async (client) => {
      const { rows: listingRows } = await client.query(
        `SELECT * FROM listings WHERE listing_id = $1 AND seller_id = $2 AND status = 'active' FOR UPDATE`,
        [listingId, sellerId]
      );

      if (!listingRows.length) {
        throw new Error('Listing not found or not editable');
      }

      if (newPricePerUnit <= 0) {
        throw new Error('Price must be positive');
      }

      await client.query(
        `UPDATE listings SET price_per_unit = $1, updated_at = NOW() WHERE listing_id = $2`,
        [newPricePerUnit, listingId]
      );

      // If on-chain, also update on-chain price
      if (listingRows[0].custody_type === 'onchain' && listingRows[0].onchain_listing_id) {
        const adapter = CustodyAdapterFactory.getAdapter('onchain');
        // Note: OnChainCustodyAdapter doesn't have updateListingPrice yet
        // Would need to call marketplace.updateListingPrice
      }

      const { rows } = await client.query('SELECT * FROM listings WHERE listing_id = $1', [listingId]);
      return rows[0];
    });

    return this.mapRowToListing(result);
  }

  async getListing(listingId: string): Promise<Listing | null> {
    const { rows } = await query(
      'SELECT * FROM listings WHERE listing_id = $1',
      [listingId]
    );
    return rows.length ? this.mapRowToListing(rows[0]) : null;
  }

  async getMarketListings(params: MarketListingParams = {}): Promise<PaginatedResponse<Listing>> {
    const { standard, projectType, custodyType, sortBy = 'priceAsc', cursor, limit = 20 } = params;
    
    let whereClause = `WHERE l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > NOW())`;
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (custodyType) {
      whereClause += ` AND l.custody_type = $${paramIndex++}`;
      queryParams.push(custodyType);
    }

    if (standard) {
      whereClause += ` AND ca.standard = $${paramIndex++}`;
      queryParams.push(standard);
    }

    if (projectType) {
      whereClause += ` AND ca.project_type = $${paramIndex++}`;
      queryParams.push(projectType);
    }

    // Cursor-based pagination
    if (cursor) {
      const [cursorPrice, cursorId] = cursor.split(':');
      if (sortBy === 'priceAsc') {
        whereClause += ` AND (l.price_per_unit > $${paramIndex} OR (l.price_per_unit = $${paramIndex} AND l.listing_id > $${paramIndex + 1}))`;
        queryParams.push(cursorPrice, cursorId);
        paramIndex += 2;
      } else if (sortBy === 'priceDesc') {
        whereClause += ` AND (l.price_per_unit < $${paramIndex} OR (l.price_per_unit = $${paramIndex} AND l.listing_id > $${paramIndex + 1}))`;
        queryParams.push(cursorPrice, cursorId);
        paramIndex += 2;
      }
    }

    let orderBy = 'l.price_per_unit ASC';
    if (sortBy === 'priceDesc') orderBy = 'l.price_per_unit DESC';
    else if (sortBy === 'amount') orderBy = 'l.remaining_quantity DESC';
    else if (sortBy === 'vintage') orderBy = 'ca.vintage DESC';
    else if (sortBy === 'name') orderBy = 'ca.project_name ASC';
    else if (sortBy === 'recent') orderBy = 'l.created_at DESC';

    queryParams.push(limit + 1);

    const { rows } = await query(
      `SELECT l.*, ca.project_name, ca.standard, ca.project_type, ca.vintage, ca.registry,
              u.wallet_address as seller_wallet
       FROM listings l
       JOIN carbon_assets ca ON ca.asset_id = l.asset_id
       JOIN users u ON u.id = l.seller_id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIndex}`,
      queryParams
    );

    const hasMore = rows.length > limit;
    const listings = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore 
      ? `${listings[listings.length - 1].price_per_unit}:${listings[listings.length - 1].listing_id}`
      : null;

    return {
      data: listings.map(this.mapRowToListing),
      nextCursor,
      hasMore
    };
  }

  async getSellerListings(sellerId: string, status?: ListingStatus): Promise<Listing[]> {
    let sql = 'SELECT * FROM listings WHERE seller_id = $1';
    const params = [sellerId];
    
    if (status) {
      sql += ' AND status = $2';
      params.push(status);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const { rows } = await query(sql, params);
    return rows.map(this.mapRowToListing);
  }

  async expireListings(): Promise<number> {
    const result = await withTransaction(async (client) => {
      const { rows: expired } = await client.query(
        `SELECT l.*, op.position_id
         FROM listings l
         JOIN ownership_positions op ON op.position_id = l.position_id
         WHERE l.status = 'active' 
           AND l.expires_at IS NOT NULL 
           AND l.expires_at <= NOW()
         FOR UPDATE`
      );

      let count = 0;
      for (const listing of expired) {
        const releasedQuantity = Number(listing.remaining_quantity);
        
        const adapter = CustodyAdapterFactory.getAdapter(listing.custody_type);
        await adapter.releaseReservation(listing.seller_id, listing.asset_id, releasedQuantity, listing.listing_id);
        
        await client.query(
          `UPDATE listings SET status = 'expired', updated_at = NOW() WHERE listing_id = $1`,
          [listing.listing_id]
        );
        
        await client.query(
          `UPDATE ownership_positions 
           SET reserved_quantity = reserved_quantity - $1, updated_at = NOW()
           WHERE position_id = $2`,
          [releasedQuantity, listing.position_id]
        );
        
        count++;
      }

      return { count };
    });

    return result.count || 0;
  }

  private async getOwnershipPosition(ownerId: string, assetId: string): Promise<OwnershipPosition | null> {
    const { rows } = await query(
      `SELECT * FROM ownership_positions WHERE owner_id = $1 AND asset_id = $2 AND status = 'active'`,
      [ownerId, assetId]
    );
    return rows.length ? this.mapRowToPosition(rows[0]) : null;
  }

  private mapRowToListing(row: any): Listing {
    return {
      listingId: row.listing_id,
      positionId: row.position_id,
      assetId: row.asset_id,
      sellerId: row.seller_id,
      custodyType: row.custody_type,
      quantity: Number(row.quantity),
      remainingQuantity: Number(row.remaining_quantity),
      pricePerUnit: Number(row.price_per_unit),
      currency: row.currency,
      buyerFeeBps: Number(row.buyer_fee_bps),
      sellerFeeBps: Number(row.seller_fee_bps),
      status: row.status,
      expiresAt: row.expires_at,
      onchainListingId: row.onchain_listing_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRowToPosition(row: any): OwnershipPosition {
    return {
      positionId: row.position_id,
      ownerId: row.owner_id,
      assetId: row.asset_id,
      custodyType: row.custody_type,
      ownedQuantity: Number(row.owned_quantity),
      reservedQuantity: Number(row.reserved_quantity),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

// Import query at top level
import { safeQuery as query } from '../../../db/pool.js';