import { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '@/services/api';

interface MarketListing {
  listing_id: string;
  seller_id: string;
  asset_id: string;
  quantity: number;
  remaining_quantity: number;
  price_per_credit_inr: number;
  price_per_credit_usd: number;
  currency: string;
  buyer_fee_bps: number;
  seller_fee_bps: number;
  status: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  asset: {
    asset_id: string;
    project_name: string;
    standard: string;
    vintage: number;
    registry: string;
    ecs_score: number;
    ecs_grade: string;
    available_quantity: number;
  };
  seller: {
    id: string;
    full_name: string;
    company_name: string;
  };
}

interface MarketData {
  listings: MarketListing[];
  isLoading: boolean;
  refetch: () => Promise<void>;
  filters: MarketFilters;
  setFilters: (filters: Partial<MarketFilters>) => void;
}

interface MarketFilters {
  standard?: string;
  projectType?: string;
  vintage_min?: number;
  vintage_max?: number;
  price_min?: number;
  price_max?: number;
  registry?: string;
  min_ecs_score?: number;
  sort_by?: 'price_asc' | 'price_desc' | 'volume' | 'recent';
  limit?: number;
  offset?: number;
}

const MarketContext = createContext<MarketData | null>(null);

export const MarketProvider = ({ children }: { children: React.ReactNode }) => {
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filters, setFiltersState] = useState<MarketFilters>({});

  const fetchListings = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, String(value));
        }
      });
      const data = await apiFetch(`/api/market/listings?${params.toString()}`);
      setListings(data.listings || data);
    } catch (error) {
      console.error('Failed to fetch listings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const refetch = async () => {
    await fetchListings();
  };

  const updateFilters = (newFilters: Partial<MarketFilters>) => {
    setFiltersState(prev => ({ ...prev, ...newFilters }));
    fetchListings();
  };

  const clearFilters = () => {
    setFiltersState({});
  };

  useEffect(() => {
    fetchListings();
  }, []);

  return (
    <MarketContext.Provider value={{
      listings,
      isLoading,
      refetch,
      filters,
      setFilters: updateFilters,
      clearFilters,
    }}>
      {children}
    </MarketContext.Provider>
  );
};

export const useMarket = () => {
  const context = useContext(MarketContext);
  if (!context) {
    throw new Error('useMarket must be used within a MarketProvider');
  }
  return context;
};