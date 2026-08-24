// Registry Sync Service
// Orchestrates syncing with external carbon registries (Verra, Gold Standard, CDM, ACR, ICM)

import { safeQuery as query, withTransaction } from '../../db/pool.js';

export interface RegistryProject {
    project_id: string;
    registry: string;
    registry_project_id: string;
    project_name: string;
    project_type: string;
    methodology: string;
    vintage: number;
    geography_country: string;
    geography_region: string | null;
    verification_body: string | null;
    verification_date: string | null;
    status: string;
    registry_data: any;
    last_synced_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface RegistryCredit {
    credit_id: string;
    project_id: string;
    serial_number: string;
    vintage: number;
    quantity: number;
    status: string;
    registry_serial: string | null;
    issuance_date: string | null;
    retirement_date: string | null;
    retirement_reason: string | null;
    registry_data: any;
    last_synced_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface SyncJob {
    job_id: string;
    registry: string;
    job_type: string;
    state: string;
    started_at: string | null;
    completed_at: string | null;
    total_records: number;
    processed_records: number;
    failed_records: number;
    last_error: string | null;
    error_details: any;
    triggered_by: string | null;
    created_at: string;
    updated_at: string;
}

export interface SyncConflict {
    conflict_id: string;
    job_id: string;
    entity_type: string;
    entity_id: string;
    registry_data: any;
    local_data: any;
    resolution: string;
    resolved_by: string | null;
    resolved_at: string | null;
    resolution_notes: string | null;
    created_at: string;
    resolved_at: string | null;
}

export class RegistrySyncService {
    private static readonly REGISTRIES = ['VERRA', 'GOLD_STANDARD', 'CDM', 'ACR', 'ICM', 'BEE'] as const;
    private static readonly SYNC_INTERVAL_HOURS = 24;

    /**
     * Trigger a full sync for a specific registry
     */
    static async triggerFullSync(registry: string, triggeredBy: string): Promise<{ job_id: string }> {
        if (!this.REGISTRIES.includes(registry)) {
            throw new Error(`Unsupported registry: ${registry}`);
        }

        const { rows } = await query(
            `INSERT INTO sync_jobs (registry, job_type, triggered_by, state)
             VALUES ($1, 'full', $2, 'PENDING')
             RETURNING job_id`,
            [registry, triggeredBy]
        );

        const jobId = rows[0].job_id;

        // Start sync asynchronously
        this.runSyncJob(jobId).catch(e => console.error(`Sync job ${jobId} failed:`, e));

        return { job_id: jobId };
    }

    /**
     * Trigger an incremental sync for a specific registry
     */
    static async triggerIncrementalSync(registry: string, triggeredBy: string): Promise<{ job_id: string }> {
        if (!this.REGISTRIES.includes(registry)) {
            throw new Error(`Unsupported registry: ${registry}`);
        }

        const { rows } = await query(
            `INSERT INTO sync_jobs (registry, job_type, triggered_by, state)
             VALUES ($1, 'incremental', $2, 'PENDING')
             RETURNING job_id`,
            [registry, triggeredBy]
        );

        const jobId = rows[0].job_id;
        this.runSyncJob(jobId).catch(e => console.error(`Sync job ${jobId} failed:`, e));

        return { job_id: jobId };
    }

    /**
     * Get sync job status
     */
    static async getSyncJobStatus(jobId: string) {
        const { rows } = await query(
            `SELECT * FROM sync_jobs WHERE job_id = $1`,
            [jobId]
        );
        return rows[0] || null;
    }

    /**
     * Get sync history for a registry
     */
    static async getSyncHistory(registry: string, limit = 50, offset = 0) {
        const { rows } = await query(
            `SELECT * FROM sync_jobs 
             WHERE registry = $1 
             ORDER BY created_at DESC 
             LIMIT $2 OFFSET $3`,
            [registry, limit, offset]
        );
        return rows;
    }

    /**
     * Run the sync job (called asynchronously)
     */
    private static async runSyncJob(jobId: string): Promise<void> {
        const { rows: jobRows } = await query(
            `SELECT * FROM sync_jobs WHERE job_id = $1`,
            [jobId]
        );

        if (!jobRows.length) return;

        const job = jobRows[0];

        try {
            await query(
                `UPDATE sync_jobs SET state = 'RUNNING', started_at = NOW() WHERE job_id = $1`,
                [jobId]
            );

            let result: { processed: number; failed: number };

            if (job.job_type === 'full') {
                result = await this.runFullSync(job.registry, jobId);
            } else {
                result = await this.runIncrementalSync(job.registry, jobId);
            }

            await query(
                `UPDATE sync_jobs 
                 SET state = $1, completed_at = NOW(), processed_records = $2, failed_records = $3, updated_at = NOW()
                 WHERE job_id = $4`,
                [result.failed > 0 ? 'FAILED' : 'COMPLETED', result.processed, result.failed, jobId]
            );
        } catch (error) {
            await query(
                `UPDATE sync_jobs 
                 SET state = 'FAILED', completed_at = NOW(), last_error = $1, error_details = $2, updated_at = NOW()
                 WHERE job_id = $1`,
                [error.message, JSON.stringify({ stack: error.stack }), jobId]
            );
        }
    }

    /**
     * Run a full sync for a registry
     */
    private static async runFullSync(registry: string, jobId: string): Promise<{ processed: number; failed: number }> {
        const adapter = this.getAdapter(registry);
        
        // Fetch all projects from registry
        const projects = await adapter.fetchAllProjects();
        
        let processed = 0;
        let failed = 0;

        for (const project of projects) {
            try {
                await this.upsertProject(registry, project);
                processed++;
            } catch (error) {
                failed++;
                await this.logConflict(jobId, 'project', project.registry_project_id, project, null, error.message);
            }
        }

        // Sync credits for each project
        const { rows: projects } = await query(
            `SELECT project_id FROM registry_projects WHERE registry = $1`,
            [registry]
        );

        for (const project of projects) {
            try {
                const credits = await adapter.fetchCreditsForProject(project.project_id);
                for (const credit of credits) {
                    await this.upsertCredit(project.project_id, credit);
                    processed++;
                }
            } catch (error) {
                failed++;
                await this.logConflict(jobId, 'credit', project.project_id, null, null, error.message);
            }
        }

        return { processed, failed };
    }

    /**
     * Run an incremental sync for a registry
     */
    private static async runIncrementalSync(registry: string, jobId: string): Promise<{ processed: number; failed: number }> {
        const adapter = this.getAdapter(registry);
        const { rows } = await query(
            `SELECT last_synced_at FROM sync_jobs WHERE registry = $1 AND state = 'COMPLETED' ORDER BY completed_at DESC LIMIT 1`,
            [registry]
        );

        const since = rows[0]?.last_synced_at || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default to 7 days ago

        const projects = await adapter.fetchProjectsSince(since);
        
        let processed = 0;
        let failed = 0;

        for (const project of projects) {
            try {
                await this.upsertProject(registry, project);
                processed++;
            } catch (error) {
                failed++;
                await this.logConflict(jobId, 'project', project.registry_project_id, project, null, error.message);
            }
        }

        return { processed, failed };
    }

    /**
     * Upsert a project from registry
     */
    private static async upsertProject(registry: string, project: any): Promise<void> {
        await query(
            `INSERT INTO registry_projects (
                registry, registry_project_id, project_name, project_type,
                methodology, vintage, geography_country, geography_region,
                verification_body, verification_date, status, registry_data,
                last_synced_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
            ON CONFLICT (registry, registry_project_id) DO UPDATE SET
                project_name = EXCLUDED.project_name,
                project_type = EXCLUDED.project_type,
                methodology = EXCLUDED.methodology,
                vintage = EXCLUDED.vintage,
                geography_country = EXCLUDED.geography_country,
                geography_region = EXCLUDED.geography_region,
                verification_body = EXCLUDED.verification_body,
                verification_date = EXCLUDED.verification_date,
                status = EXCLUDED.status,
                registry_data = EXCLUDED.registry_data,
                last_synced_at = NOW(),
                updated_at = NOW()`,
            [
                registry,
                project.registry_project_id,
                project.project_name,
                project.project_type,
                project.methodology,
                project.vintage,
                project.geography_country,
                project.geography_region || null,
                project.verification_body || null,
                project.verification_date || null,
                project.status || 'active',
                JSON.stringify(project.registry_data || project),
            ]
        );
    }

    /**
     * Upsert a credit from registry
     */
    private static async upsertCredit(projectId: string, credit: any): Promise<void> {
        await query(
            `INSERT INTO registry_credits (
                project_id, serial_number, vintage, quantity, status,
                registry_serial, issuance_date, retirement_date, retirement_reason,
                registry_data, last_synced_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
            ON CONFLICT (project_id, serial_number) DO UPDATE SET
                quantity = EXCLUDED.quantity,
                status = EXCLUDED.status,
                retirement_date = EXCLUDED.retirement_date,
                retirement_reason = EXCLUDED.retirement_reason,
                registry_data = EXCLUDED.registry_data,
                last_synced_at = NOW(),
                updated_at = NOW()`,
            [
                projectId,
                credit.serial_number,
                credit.vintage,
                credit.quantity,
                credit.status || 'active',
                credit.registry_serial || null,
                credit.issuance_date || null,
                credit.retirement_date || null,
                credit.retirement_reason || null,
                JSON.stringify(credit.registry_data || credit)
            ]
        );
    }

    /**
     * Log a sync conflict for manual resolution
     */
    private static async logConflict(
        jobId: string,
        entityType: string,
        entityId: string,
        registryData: any,
        localData: any,
        error: string
    ): Promise<void> {
        await query(
            `INSERT INTO sync_conflicts (
                job_id, entity_type, entity_id, registry_data, local_data, resolution
            ) VALUES ($1,$2,$3,$4,$5,'pending')`,
            [jobId, entityType, entityId, JSON.stringify(registryData), JSON.stringify(localData)]
        );
    }

    /**
     * Get the appropriate adapter for a registry
     */
    private static getAdapter(registry: string) {
        switch (registry) {
            case 'VERRA':
                return new VerraAdapter();
            case 'GOLD_STANDARD':
                return new GoldStandardAdapter();
            case 'CDM':
                return new CDMAdapter();
            case 'ACR':
                return new ACRAdapter();
            case 'ICM':
                return new ICMAdapter();
            case 'BEE':
                return new BEEAdapter();
            default:
                throw new Error(`Unsupported registry: ${registry}`);
        }
    }

    /**
     * Get sync job status
     */
    static async getSyncJobStatus(jobId: string) {
        const { rows } = await query(
            `SELECT * FROM sync_jobs WHERE job_id = $1`,
            [jobId]
        );
        return rows[0] || null;
    }

    /**
     * Get sync history for a registry
     */
    static async getSyncHistory(registry: string, limit = 50, offset = 0) {
        const { rows } = await query(
            `SELECT * FROM sync_jobs 
             WHERE registry = $1 
             ORDER BY created_at DESC 
             LIMIT $2 OFFSET $3`,
            [registry, limit, offset]
        );
        return rows;
    }

    /**
     * Get conflicts for a job
     */
    static async getConflicts(jobId: string) {
        const { rows } = await query(
            `SELECT * FROM sync_conflicts WHERE job_id = $1 ORDER BY created_at DESC`,
            [jobId]
        );
        return rows;
    }

    /**
     * Resolve a conflict
     */
    static async resolveConflict(conflictId: string, resolution: 'registry_wins' | 'local_wins' | 'merged', resolvedBy: string, notes?: string): Promise<void> {
        await query(
            `UPDATE sync_conflicts 
             SET resolution = $1, resolved_by = $2, resolved_at = NOW(), resolution_notes = $3
             WHERE conflict_id = $1`,
            [conflictId, resolution, resolvedBy, notes || null]
        );
    }

    /**
     * Schedule periodic sync for all registries
     */
    static schedulePeriodicSync(): void {
        // In production, use a proper job scheduler like node-cron or bull
        setInterval(async () => {
            for (const registry of this.REGISTRIES) {
                try {
                    await this.triggerIncrementalSync(registry, 'system');
                } catch (error) {
                    console.error(`Failed to schedule sync for ${registry}:`, error);
                }
            }
        }, this.SYNC_INTERVAL_HOURS * 60 * 60 * 1000);
    }
}

// Registry Adapters (to be implemented)
class VerraAdapter {
    async fetchAllProjects(): Promise<any[]> {
        // TODO: Implement Verra API integration
        console.log('Fetching all projects from Verra...');
        return [];
    }

    async fetchProjectsSince(since: Date): Promise<any[]> {
        console.log(`Fetching Verra projects since ${since.toISOString()}`);
        return [];
    }

    async fetchCreditsForProject(projectId: string): Promise<any[]> {
        return [];
    }
}

class GoldStandardAdapter {
    async fetchAllProjects(): Promise<any[]> { return []; }
    async fetchProjectsSince(since: Date): Promise<any[]> { return []; }
    async fetchCreditsForProject(projectId: string): Promise<any[]> { return []; }
}

class CDMAdapter {
    async fetchAllProjects(): Promise<any[]> { return []; }
    async fetchProjectsSince(since: Date): Promise<any[]> { return []; }
    async fetchCreditsForProject(projectId: string): Promise<any[]> { return []; }
}

class ACRAdapter {
    async fetchAllProjects(): Promise<any[]> { return []; }
    async fetchProjectsSince(since: Date): Promise<any[]> { return []; }
    async fetchCreditsForProject(projectId: string): Promise<any[]> { return []; }
}

class ICMAdapter {
    async fetchAllProjects(): Promise<any[]> { return []; }
    async fetchProjectsSince(since: Date): Promise<any[]> { return []; }
    async fetchCreditsForProject(projectId: string): Promise<any[]> { return []; }
}

class BEEAdapter {
    async fetchAllProjects(): Promise<any[]> { return []; }
    async fetchProjectsSince(since: Date): Promise<any[]> { return []; }
    async fetchCreditsForProject(projectId: string): Promise<any[]> { return []; }
}

export default RegistrySyncService;