import { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '@/services/api';

interface PortfolioData {
  totalValue: number;
  totalCredits: number;
  change24h: number;
  holdings: Holding[];
  history: PortfolioHistoryPoint[];
  recentTransactions: Transaction[];
}

interface Holding {
  assetId: string;
  assetName: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  vintage: number;
  standard: string;
  projectName: string;
  registry: string;
}

interface PortfolioHistoryPoint {
  date: string;
  value: number;
}

interface Transaction {
  tradeId: string;
  type: 'buy' | 'sell';
  assetId: string;
  assetName: string;
  quantity: number;
  price: number;
  total: number;
  timestamp: string;
  status: string;
}

interface PortfolioData {
  totalValue: number;
  totalCredits: number;
  change24h: number;
  holdings: Holding[];
  history: PortfolioHistoryPoint[];
  recentTransactions: Transaction[];
}

const PortfolioContext = createContext<{
  portfolio: PortfolioData | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
} | null>(null);

export const PortfolioProvider = ({ children }: { children: React.ReactNode }) => {
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPortfolio = async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch('/api/portfolio/my-credits');
      setPortfolio(data);
    } catch (error) {
      console.error('Failed to fetch portfolio:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPortfolio();
  }, []);

  const refetch = async () => {
    await fetchPortfolio();
  };

  return (
    <PortfolioContext.Provider value={{ portfolio, isLoading, refetch }}>
      {children}
    </PortfolioContext.Provider>
  );
};

export const usePortfolio = () => {
  const context = useContext(PortfolioContext);
  if (!context) {
    throw new Error('usePortfolio must be used within a PortfolioProvider');
  }
  return context;
};