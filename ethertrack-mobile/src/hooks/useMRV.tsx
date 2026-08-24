import { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '@/services/api';

interface MRVPlan {
  plan_id: string;
  user_id: string;
  org_id: string;
  plan_name: string;
  description: string;
  reporting_year: number;
  methodology_template: string;
  covers_scope_1: boolean;
  covers_scope_2: boolean;
  covers_scope_3: boolean;
  facility_ids: string[];
  asset_ids: string[];
  reporting_period_start: string;
  reporting_period_end: string;
  submission_deadline: string;
  verification_deadline: string;
  state: string;
  submitted_at: string;
  verified_at: string;
  approved_at: string;
  rejected_at: string;
  rejection_reason: string;
  submitted_by: string;
  verified_by: string;
  approved_by: string;
  assigned_verifier: string;
  created_at: string;
  updated_at: string;
}

interface MRVData {
  plans: MRVPlan[];
  isLoading: boolean;
  refetch: () => Promise<void>;
  createPlan: (data: any) => Promise<any>;
  submitPlan: (planId: string) => Promise<any>;
}

const MRVContext = createContext<MRVData | null>(null);

export const MRVProvider = ({ children }: { children: React.ReactNode }) => {
  const [plans, setPlans] = useState<MRVPlan[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPlans = async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch('/api/mrv/plans');
      setPlans(data.plans || data);
    } catch (error) {
      console.error('Failed to fetch MRV plans:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const createPlan = async (data: any) => {
    const result = await apiFetch('/api/mrv/plans', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    await fetchPlans();
    return result;
  };

  const submitPlan = async (planId: string) => {
    const result = await apiFetch(`/api/mrv/plans/${planId}/submit`, {
      method: 'POST',
    });
    await fetchPlans();
    return result;
  };

  const refetch = async () => {
    await fetchPlans();
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  return (
    <MRVContext.Provider value={{
      plans,
      isLoading,
      refetch,
      createPlan,
      submitPlan,
    }}>
      {children}
    </MRVContext.Provider>
  );
};

export const useMRV = () => {
  const context = useContext(MRVContext);
  if (!context) {
    throw new Error('useMRV must be used within an MRVProvider');
  }
  return context;
};