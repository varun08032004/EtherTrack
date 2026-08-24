// API service for EtherTrack mobile app

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';
const REQUEST_TIMEOUT = 30000;

export interface ApiError extends Error {
  status?: number;
  data?: any;
}

class ApiErrorClass extends Error {
  status: number;
  data: any;

  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function getAuthToken(): string | null {
  // In production, would get from secure storage
  return '';
}

async function apiFetch(url: string, options: RequestInit = {}): Promise<any> {
  const token = getAuthToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (url !== '/api/auth/login' && url !== '/api/auth/register') {
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${BASE_URL}${url}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorData: any;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: response.statusText };
      }
      throw new ApiErrorClass(
        errorData?.message || `HTTP ${response.status}`,
        response.status,
        errorData
      );
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof ApiErrorClass) throw error;
    if (error.name === 'AbortError') {
      throw new ApiErrorClass('Request timeout', 408);
    }
    throw new ApiErrorClass(error.message || 'Network error', 0);
  }
}

export { apiFetch };

export const authAPI = {
  login: async (email: string, password: string) => {
    return apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  register: async (data: {
    email: string;
    password: string;
    full_name: string;
    company_name?: string;
    role?: string;
  }) => {
    return apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  logout: async () => {
    return apiFetch('/api/auth/logout', { method: 'POST' });
  },

  me: async () => {
    return apiFetch('/api/auth/me');
  },

  refresh: async () => {
    return apiFetch('/api/auth/refresh', { method: 'POST' });
  },

  forgotPassword: async (email: string) => {
    return apiFetch('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  resetPassword: async (token: string, password: string) => {
    return apiFetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  },
};