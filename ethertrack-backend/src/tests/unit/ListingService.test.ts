// Unit Tests - Listing Service (with mocked custody adapter)

import { ListingService } from '../../services/listing/ListingService.ts';
import { CustodyAdapterFactory } from '../../services/custody/index.ts';
import { CustodyType, Currency, OwnershipPosition, Listing, ListingStatus } from '../../domain/types.ts';
import { safeQuery as query, withTransaction } from '../../db/pool.ts';

// Mock the custody adapter factory and db pool in beforeAll
beforeAll(async () => {
  await jest.unstable_mockModule('../../services/custody/index.ts', () => ({
    CustodyAdapterFactory: {
      getAdapter: jest.fn()
    }
  }));

  await jest.unstable_mockModule('../../db/pool.ts', () => ({
    safeQuery: jest.fn(),
    withTransaction: jest.fn((fn) => fn({
      query: jest.fn()
    }))
  }));
});

describe('ListingService', () => {
  let listingService;
  let mockOnChainAdapter;
  let mockLedgerAdapter;

  beforeEach(() => {
    listingService = new ListingService();
    mockOnChainAdapter = {
      custodyType: 'onchain',
      reserveCredits: jest.fn().mockResolvedValue(undefined),
      releaseReservation: jest.fn().mockResolvedValue(undefined)
    };
    mockLedgerAdapter = {
      custodyType: 'ledger',
      reserveCredits: jest.fn().mockResolvedValue(undefined),
      releaseReservation: jest.fn().mockResolvedValue(undefined)
    };
    
    CustodyAdapterFactory.getAdapter.mockImplementation((type) => 
      type === 'onchain' ? mockOnChainAdapter : mockLedgerAdapter
    );
    
    jest.clearAllMocks();
  });

  describe('createListing', () => {
    it('should create listing and reserve credits via custody adapter', async () => {
      const mockPosition = {
        id: 'pos-123',
        userId: 'user-123',
        tokenId: 1,
        quantity: 100,
        custodyType: 'onchain' as CustodyType,
        isReserved: false
      };
      
      query.mockResolvedValueOnce({ rows: [mockPosition] });
      query.mockResolvedValueOnce({ rows: [{ id: 'listing-123', ...mockPosition, status: 'ACTIVE', price: 500, currency: 'INR', createdAt: new Date() }] });
      
      const listing = await listingService.createListing(
        'user-123',
        1,
        100,
        500,
        'INR' as Currency,
        'onchain' as CustodyType
      );
      
      expect(listing).toBeDefined();
      expect(listing.id).toBe('listing-123');
      expect(mockOnChainAdapter.reserveCredits).toHaveBeenCalledWith('user-123', 1, 100);
    });

    it('should throw error if position not found', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      
      await expect(listingService.createListing(
        'user-123',
        1,
        100,
        500,
        'INR' as Currency,
        'onchain' as CustodyType
      )).rejects.toThrow('Position not found');
    });

    it('should throw error if insufficient quantity', async () => {
      const mockPosition = {
        id: 'pos-123',
        userId: 'user-123',
        tokenId: 1,
        quantity: 50,
        custodyType: 'onchain' as CustodyType,
        isReserved: false
      };
      
      query.mockResolvedValueOnce({ rows: [mockPosition] });
      
      await expect(listingService.createListing(
        'user-123',
        1,
        100,
        500,
        'INR' as Currency,
        'onchain' as CustodyType
      )).rejects.toThrow('Insufficient quantity');
    });
  });

  describe('cancelListing', () => {
    it('should cancel listing and release reservation', async () => {
      const mockListing = {
        id: 'listing-123',
        userId: 'user-123',
        tokenId: 1,
        quantity: 100,
        custodyType: 'onchain' as CustodyType,
        status: 'ACTIVE',
        price: 500,
        currency: 'INR'
      };
      
      query.mockResolvedValueOnce({ rows: [mockListing] });
      query.mockResolvedValueOnce({ rows: [] });
      
      await listingService.cancelListing('listing-123', 'user-123');
      
      expect(mockOnChainAdapter.releaseReservation).toHaveBeenCalledWith('user-123', 1, 100);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('should throw error if listing not found', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      
      await expect(listingService.cancelListing('listing-123', 'user-123')).rejects.toThrow('Listing not found');
    });

    it('should throw error if not owner', async () => {
      const mockListing = {
        id: 'listing-123',
        userId: 'other-user',
        tokenId: 1,
        quantity: 100,
        custodyType: 'onchain' as CustodyType,
        status: 'ACTIVE',
        price: 500,
        currency: 'INR'
      };
      
      query.mockResolvedValueOnce({ rows: [mockListing] });
      
      await expect(listingService.cancelListing('listing-123', 'user-123')).rejects.toThrow('Not authorized');
    });

    it('should throw error if listing not active', async () => {
      const mockListing = {
        id: 'listing-123',
        userId: 'user-123',
        tokenId: 1,
        quantity: 100,
        custodyType: 'onchain' as CustodyType,
        status: 'SOLD',
        price: 500,
        currency: 'INR'
      };
      
      query.mockResolvedValueOnce({ rows: [mockListing] });
      
      await expect(listingService.cancelListing('listing-123', 'user-123')).rejects.toThrow('Listing not active');
    });
  });

  describe('getListing', () => {
    it('should return listing by id', async () => {
      const mockListing = {
        id: 'listing-123',
        userId: 'user-123',
        tokenId: 1,
        quantity: 100,
        custodyType: 'onchain' as CustodyType,
        status: 'ACTIVE',
        price: 500,
        currency: 'INR',
        createdAt: new Date()
      };
      
      query.mockResolvedValueOnce({ rows: [mockListing] });
      
      const listing = await listingService.getListing('listing-123');
      
      expect(listing).toEqual(mockListing);
    });

    it('should return null if listing not found', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      
      const listing = await listingService.getListing('listing-123');
      
      expect(listing).toBeNull();
    });
  });

  describe('getUserListings', () => {
    it('should return paginated listings for user', async () => {
      const mockListings = [
        { id: 'listing-1', userId: 'user-123', tokenId: 1, quantity: 100, custodyType: 'onchain' as CustodyType, status: 'ACTIVE', price: 500, currency: 'INR', createdAt: new Date() },
        { id: 'listing-2', userId: 'user-123', tokenId: 2, quantity: 200, custodyType: 'ledger' as CustodyType, status: 'ACTIVE', price: 600, currency: 'INR', createdAt: new Date() }
      ];
      
      query.mockResolvedValueOnce({ rows: mockListings });
      
      const result = await listingService.getUserListings('user-123', { page: 1, limit: 10 });
      
      expect(result.listings).toHaveLength(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
    });
  });

  describe('getMarketListings', () => {
    it('should return paginated market listings with filters', async () => {
      const mockListings = [
        { id: 'listing-1', userId: 'user-123', tokenId: 1, quantity: 100, custodyType: 'onchain' as CustodyType, status: 'ACTIVE', price: 500, currency: 'INR', createdAt: new Date() }
      ];
      
      query.mockResolvedValueOnce({ rows: mockListings });
      
      const result = await listingService.getMarketListings({ 
        custodyType: 'onchain', 
        minPrice: 400, 
        maxPrice: 600,
        page: 1, 
        limit: 10 
      });
      
      expect(result.listings).toHaveLength(1);
      expect(result.listings[0].custodyType).toBe('onchain');
    });
  });
});