import { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '@/services/api';

interface EmissionsSummary {
  totalEmissions: number;
  scope1: number;
  scope2: number;
  scope3: number;
  netEmissions: number;
  totalOffset: number;
  change24h: number;
}

interface EmissionActivity {
  activity_id: string;
  date: string;
  activity: string;
  quantity: number;
  unit: string;
  scope: number;
  category: string;
  factor: number;
  co2e: number;
  notes: string;
  source: string;
  verified: boolean;
  ai_audit: string;
  created_at: string;
  updated_at: string;
  logged_at: string;
  approval_state: string;
}

interface EmissionsData {
  summary: EmissionsSummary;
  activities: EmissionActivity[];
  isLoading: boolean;
  refetch: () => Promise<void>;
  logActivity: (data: any) => Promise<any>;
  bulkImport: (records: any[]) => Promise<any>;
  deleteActivity: (id: string) => Promise<void>;
}

const EmissionsContext = createContext<EmissionsData | null>(null);

export const EmissionsProvider = ({ children }: { children: React.ReactNode }) => {
  const [summary, setSummary] = useState<EmissionsSummary | null>(null);
  const [activities, setActivities] = useState<EmissionActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSummary = async () => {
    try {
      const data = await apiFetch('/api/emissions/summary');
      setSummary(data);
    } catch (error) {
      console.error('Failed to fetch emissions summary:', error);
    }
  };

  const fetchActivities = async (params?: any) => {
    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams(params).toString();
      const data = await apiFetch(`/api/emissions/activities?${queryParams}`);
      setActivities(data.activities || data);
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const logActivity = async (data: any) => {
    const result = await apiFetch('/api/emissions/log', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await fetchSummary();
    await fetchActivities();
    return result;
  };

  const bulkImport = async (records: any[]) => {
    const result = await apiFetch('/api/emissions/bulk', {
      method: 'POST',
      body: JSON.stringify({ records }),
    });
    await fetchSummary();
    await fetchActivities();
    return result;
  };

  const deleteActivity = async (id: string) => {
    await apiFetch(`/api/emissions/activities/${id}`, {
      method: 'DELETE',
    });
    await fetchActivities();
  };

  useEffect(() => {
    fetchSummary();
    fetchActivities();
  }, []);

  const refetch = async () => {
    await fetchSummary();
    await fetchActivities();
  };

  return (
    <EmissionsContext.Provider value={{
      summary,
      activities,
      isLoading,
      refetch,
      logActivity,
      bulkImport,
      deleteActivity,
    }}>
      {children}
    </EmissionsContext.Provider>
  );
};

export const useEmissions = () => {
  const context = useContext(EmissionsContext);
  if (!context) {
    throw new Error('useEmissions must be used within an EmissionsProvider');
  }
  return context;
};