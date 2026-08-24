import { Database } from '@nozbe/watermelondb';
import { synchronize } from '@nozbe/watermelondb/sync';
import database from '@/database';
import { apiFetch } from '@/services/api';

// Sync configuration
const SYNC_CONFIG = {
  pullBatchSize: 100,
  pushBatchSize: 50,
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 30000,
};

interface SyncResult {
  success: boolean;
  pulled: number;
  pushed: number;
  conflicts: number;
  errors: string[];
  lastSync: number;
}

interface SyncOptions {
  fullSync?: boolean;
  tables?: string[];
  onProgress?: (progress: { stage: string; progress: number }) => void;
}

class SyncEngine {
  private isSyncing = false;
  private abortController: AbortController | null = null;

  async sync(options: SyncOptions = {}): Promise<SyncResult> {
    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }

    this.isSyncing = true;
    this.abortController = new AbortController();

    try {
      const optionsWithDefaults = {
        fullSync: false,
        tables: ['users', 'emission_activities', 'carbon_assets', 'mrv_plans', 'evidence', 'trades'],
        onProgress: () => {},
        ...options,
      };

      const result: SyncResult = {
        success: false,
        pulled: 0,
        pushed: 0,
        conflicts: 0,
        errors: [],
        lastSync: Date.now(),
      };

      optionsWithDefaults.onProgress({ stage: 'preparing', progress: 0 });

      // Check network connectivity
      const isOnline = await this.checkConnectivity();
      if (!isOnline) {
        throw new Error('Device is offline');
      }

      optionsWithDefaults.onProgress({ stage: 'syncing', progress: 0.1 });

      // Get last sync timestamp
      const lastSync = await this.getLastSyncTimestamp();

      // Perform sync
      const syncResult = await synchronize({
        database: database as any,
        pullChanges: async ({ lastPulledAt, schemaVersion }) => {
          optionsWithDefaults.onProgress?.({ stage: 'pulling', progress: 0.3 });
          return await this.pullChanges(lastSync, optionsWithDefaults.tables);
        },
        pushChanges: async ({ changes, lastPulledAt }) => {
          optionsWithDefaults.onProgress?.({ stage: 'pushing', progress: 0.6 });
          return await this.pushChanges(changes, lastSync);
        },
        sendCreatedAsUpdated: true,
      });

      optionsWithDefaults.onProgress?.({ stage: 'finalizing', progress: 0.9 });

      // Update last sync timestamp
      await this.updateLastSyncTimestamp();

      result.success = true;
      result.lastSync = Date.now();
      optionsWithDefaults.onProgress?.({ stage: 'complete', progress: 1 });

      return result;
    } catch (error) {
      console.error('Sync failed:', error);
      return {
        success: false,
        pulled: 0,
        pushed: 0,
        conflicts: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        lastSync: Date.now(),
      };
    } finally {
      this.isSyncing = false;
      this.abortController = null;
    }
  }

  private async checkConnectivity(): Promise<boolean> {
    try {
      const response = await fetch(`${process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8001'}/health`, {
        method: 'GET',
        signal: this.abortController?.signal,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async getLastSyncTimestamp(): Promise<number> {
    // In production, store this in AsyncStorage or WatermelonDB
    try {
      const { AsyncStorage } = await import('@react-native-async-storage/async-storage');
      const timestamp = await AsyncStorage.getItem('last_sync_timestamp');
      return timestamp ? parseInt(timestamp, 10) : 0;
    } catch {
      return 0;
    }
  }

  private async updateLastSyncTimestamp(): Promise<void> {
    try {
      const { AsyncStorage } = await import('@react-native-async-storage/async-storage');
      await AsyncStorage.setItem('last_sync_timestamp', Date.now().toString());
    } catch (error) {
      console.error('Failed to update last sync timestamp:', error);
    }
  }

  private async pullChanges(lastSync: number, tables?: string[]): Promise<{ changes: any[]; timestamp: number }> {
    // In production, this would call the backend API
    // For now, return empty changes
    return { changes: [], timestamp: Date.now() };
  }

  private async pushChanges(changes: any[], lastSync: number): Promise<void> {
    // In production, would push local changes to server
    // For now, just log
    console.log('Pushing changes:', changes.length);
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  get isSyncingState(): boolean {
    return this.isSyncing;
  }
}

export const syncEngine = new SyncEngine();

// Auto-sync interval (every 5 minutes when online)
export const startAutoSync = (intervalMs = 5 * 60 * 1000) => {
  return setInterval(() => {
    if (syncEngine.isSyncingState) return;
    syncEngine.sync().catch(console.error);
  }, intervalMs);
};

export const stopAutoSync = (intervalId: ReturnType<typeof setInterval>) => {
  clearInterval(intervalId);
};