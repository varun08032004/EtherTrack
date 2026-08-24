import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiFetch } from '@/services/api';

interface User {
  id: string;
  email: string;
  full_name: string;
  company_name?: string;
  role: string;
  kyc_status: string;
  subscription_plan: string;
  wallet_address?: string;
  inr_balance: number;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

interface RegisterData {
  email: string;
  password: string;
  full_name: string;
  company_name?: string;
  role?: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

const authAPI = {
  login: async (credentials: { email: string; password: string }) => {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    return response;
  },
  register: async (registerData: any) => {
    const response = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(registerData),
    });
    return response;
  },
  logout: async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  },
  me: async () => {
    return await apiFetch('/api/auth/me');
  },
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const userData = await authAPI.me();
      setUser(userData);
    } catch (error) {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
    const data = await authAPI.login({ email, password });
    if (data?.user) {
      setUser(data.user);
    }
  };

  const register = async (data: RegisterData) => {
    const result = await authAPI.register(data);
    if (result?.user) {
      setUser(result.user);
    }
  };

  const logout = async () => {
    await authAPI.logout();
    setUser(null);
  };

  const value = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};