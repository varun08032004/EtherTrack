// Type declarations for db/pool.js (CommonJS module)

export interface PoolClient {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>;
  release: () => void;
}

export interface Pool {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>;
  connect: () => Promise<PoolClient>;
  end: () => Promise<void>;
  on: (event: string, listener: (...args: any[]) => void) => void;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export interface HealthCheckResult {
  ok: boolean;
  latencyMs?: number;
  readLatencyMs?: number;
  poolTotal: number;
  poolIdle: number;
  poolWaiting: number;
  readPool?: {
    total: number;
    idle: number;
    waiting: number;
    ok: boolean;
  } | null;
  error?: string;
}

export const safeQuery: (text: string, params?: any[], retries?: number) => Promise<{ rows: any[]; rowCount: number }>;
export const withTransaction: <T>(callback: (client: PoolClient) => Promise<T>) => Promise<T>;
export const healthCheck: () => Promise<HealthCheckResult>;
export const shutdown: () => Promise<void>;
export const pool: Pool;
export const readPool: Pool | null;