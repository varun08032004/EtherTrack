import React, { ReactNode } from 'react';
import { AuthProvider } from '@/hooks/useAuth';
import { MarketProvider } from '@/hooks/useMarket';
import { PortfolioProvider } from '@/hooks/usePortfolio';
import { MRVProvider } from '@/hooks/useMRV';
import { EmissionsProvider } from '@/hooks/useEmissions';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <MarketProvider>
        <PortfolioProvider>
          <MRVProvider>
            <EmissionsProvider>
              {children}
            </EmissionsProvider>
          </MRVProvider>
        </PortfolioProvider>
      </MarketProvider>
    </AuthProvider>
  );
}