// Registry Adapters Base Class
export abstract class BaseRegistryAdapter {
    protected registryName: string;
    protected apiBaseUrl: string;
    protected apiKey: string | null;

    constructor(registryName: string, apiBaseUrl: string, apiKey?: string) {
        this.registryName = registryName;
        this.apiBaseUrl = apiBaseUrl;
        this.apiKey = apiKey || null;
    }

    abstract fetchAllProjects(): Promise<any[]>;
    abstract fetchProjectsSince(since: Date): Promise<any[]>;
    abstract fetchCreditsForProject(projectId: string): Promise<any[]>;
    abstract fetchProjectDetails(projectId: string): Promise<any>;

    protected async makeRequest(endpoint: string, params: Record<string, any> = {}): Promise<any> {
        const url = new URL(`${this.apiBaseUrl}${endpoint}`);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, String(value));
            }
        }

        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers,
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`${this.registryName} API error: ${response.status} - ${error}`);
        }

        return response.json();
    }

    protected normalizeProject(raw: any): any {
        return {
            registry_project_id: raw.id || raw.project_id || raw.serial_number,
            project_name: raw.name || raw.project_name || raw.title,
            project_type: raw.type || raw.project_type || raw.category,
            methodology: raw.methodology || raw.methodology_name || raw.standard,
            vintage: raw.vintage || raw.vintage_year || raw.year,
            geography_country: raw.country || raw.country_code || raw.location_country,
            geography_region: raw.region || raw.state || raw.province || null,
            geography_coordinates: raw.coordinates || raw.geometry || null,
            verification_body: raw.verifier || raw.verification_body || raw.auditor,
            verification_date: raw.verification_date || raw.validated_at || null,
            status: raw.status || 'active',
            registry_data: raw,
        };
    }

    protected normalizeCredit(raw: any, projectId: string): any {
        return {
            serial_number: raw.serial_number || raw.serial || raw.credit_id,
            vintage: raw.vintage || raw.vintage_year || raw.year,
            quantity: raw.quantity || raw.amount || raw.credits || 0,
            status: this.normalizeStatus(raw.status || raw.state),
            registry_serial: raw.serial_number || raw.serial || raw.credit_id,
            issuance_date: raw.issuance_date || raw.issued_at || raw.created_at,
            retirement_date: raw.retirement_date || raw.retired_at || null,
            retirement_reason: raw.retirement_reason || raw.retirement_reason || null,
            registry_data: raw,
        };
    }

    protected normalizeStatus(status: string): string {
        const status = status.toLowerCase();
        if (['active', 'issued', 'valid', 'live'].includes(status)) return 'active';
        if (['retired', 'cancelled', 'used', 'redeemed'].includes(status)) return 'retired';
        if (['pending', 'pending_issuance', 'draft'].includes(status)) return 'pending';
        if (['cancelled', 'cancelled', 'revoked'].includes(status)) return 'cancelled';
        return 'active';
    }

    protected async fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch(url, options);
                if (response.ok) return response;
                if (response.status === 429) {
                    await this.sleep(1000 * Math.pow(2, i));
                    continue;
                }
            } catch (error) {
                if (i === retries - 1) throw error;
                await this.sleep(1000 * Math.pow(2, i));
            }
        }
        throw new Error(`Failed after ${retries} retries`);
    }

    protected sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Verra Adapter
export class VerraAdapter {
    private baseUrl = 'https://api.verra.org/v1';
    private apiKey: string | null = null;

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.VERRA_API_KEY || null;
    }

    async fetchAllProjects(): Promise<any[]> {
        // Verra API pagination
        const allProjects: any[] = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const data = await this.makeRequest(`/projects`, { page, limit: 100 });
            allProjects.push(...data.projects || data.data || []);
            hasMore = data.has_more || (data.projects?.length === 100);
            page++;
        }

        return allProjects.map(p => this.normalizeProject(p));
    }

    async fetchProjectsSince(since: Date): Promise<any[]> {
        const params = { updated_since: since.toISOString(), limit: 100 };
        const data = await this.makeRequest('/projects', params);
        return (data.projects || data.data || []).map(p => this.normalizeProject(p));
    }

    async fetchCreditsForProject(projectId: string): Promise<any[]> {
        const data = await this.makeRequest(`/projects/${projectId}/credits`);
        return (data.credits || data.data || []).map(c => this.normalizeCredit(c, projectId));
    }

    async fetchProjectDetails(projectId: string): Promise<any> {
        const data = await this.makeRequest(`/projects/${projectId}`);
        return this.normalizeProject(data);
    }

    private async makeRequest(endpoint: string, params: Record<string, any> = {}): Promise<any> {
        const url = new URL(`${this.baseUrl}${endpoint}`);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) url.searchParams.append(key, String(value));
        });

        const headers: Record<string, string> = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await fetch(`${this.baseUrl}${endpoint}?${url.searchParams.toString()}`, {
            method: 'GET',
            headers,
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Verra API error: ${response.status} - ${error}`);
        }

        return response.json();
    }

    private normalizeProject(raw: any): any {
        return {
            registry_project_id: raw.id || raw.project_id || raw.serial_number,
            project_name: raw.name || raw.project_name || raw.title,
            project_type: raw.type || raw.project_type || raw.category,
            methodology: raw.methodology || raw.methodology_name || raw.standard,
            vintage: raw.vintage || raw.vintage_year || raw.year,
            geography_country: raw.country || raw.country_code || raw.location_country,
            geography_region: raw.region || raw.state || raw.province || null,
            geography_coordinates: raw.coordinates || raw.geometry || null,
            verification_body: raw.verifier || raw.verification_body || raw.auditor,
            verification_date: raw.verification_date || raw.validated_at || null,
            status: raw.status || 'active',
            registry_data: raw,
        };
    }

    private normalizeCredit(raw: any, projectId: string): any {
        return {
            serial_number: raw.serial_number || raw.serial || raw.credit_id,
            vintage: raw.vintage || raw.vintage_year || raw.year,
            quantity: raw.quantity || raw.amount || raw.credits || 0,
            status: this.normalizeStatus(raw.status || raw.state),
            registry_serial: raw.serial_number || raw.serial || raw.credit_id,
            issuance_date: raw.issuance_date || raw.issued_at || raw.created_at,
            retirement_date: raw.retirement_date || raw.retired_at || null,
            retirement_reason: raw.retirement_reason || raw.retirement_reason || null,
            registry_data: raw,
        };
    }

    private normalizeStatus(status: string): string {
        const status = status.toLowerCase();
        if (['active', 'issued', 'valid', 'live'].includes(status)) return 'active';
        if (['retired', 'cancelled', 'used', 'redeemed'].includes(status)) return 'retired';
        if (['pending', 'pending_issuance', 'draft'].includes(status)) return 'pending';
        if (['cancelled', 'cancelled', 'revoked'].includes(status)) return 'cancelled';
        return 'active';
    }
}

// Gold Standard Adapter
export class GoldStandardAdapter {
    private baseUrl = 'https://registry.goldstandard.org/api/v1';
    private apiKey: string | null = null;

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.GOLD_STANDARD_API_KEY || null;
    }

    async fetchAllProjects(): Promise<any[]> {
        // Similar structure to Verra
        return [];
    }

    async fetchProjectsSince(since: Date): Promise<any[]> {
        return [];
    }

    async fetchCreditsForProject(projectId: string): Promise<any[]> {
        return [];
    }

    async fetchProjectDetails(projectId: string): Promise<any> {
        return null;
    }
}

// CDM Adapter
export class CDMAdapter {
    private baseUrl = 'https://cdm.unfccc.int/api/v1';
    private apiKey: string | null = null;

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.CDM_API_KEY || null;
    }

    async fetchAllProjects(): Promise<any[]> { return []; }
    async fetchProjectsSince(since: Date): Promise<any[]> { return []; }
    async fetchCreditsForProject(projectId: string): Promise<any[]> { return []; }
    async fetchProjectDetails(projectId: string): Promise<any> { return null; }
}

// ACR Adapter
export class ACRAdapter {
    private baseUrl = 'https://acr2.apx.com/api/v1';
    private apiKey: string | null = null;

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.ACR_API_KEY || null;
    }

    async fetchAllProjects(): Promise<any[]> { return []; }
    async fetchProjectsSince(since: Date): Promise<any[]> { return []; }
    async fetchCreditsForProject(projectId: string): Promise<any[]> { return []; }
    async fetchProjectDetails(projectId: string): Promise<any> { return null; }
}

// ICM Adapter (India Carbon Market)
export class ICMAdapter {
    private baseUrl: string;
    private apiKey: string | null = null;

    constructor(apiKey?: string, baseUrl?: string) {
        this.apiKey = apiKey || process.env.ICM_API_KEY || null;
        this.baseUrl = baseUrl || process.env.ICM_API_URL || 'https://icm.gov.in/api/v1';
    }

    async fetchAllProjects(): Promise<any[]> { return []; }
    async fetchProjectsSince(since: Date): Promise<any[]> { return []; }
    async fetchCreditsForProject(projectId: string): Promise<any[]> { return []; }
    async fetchProjectDetails(projectId: string): Promise<any> { return null; }
}

// BEE Adapter (India Bureau of Energy Efficiency)
export class BEEAdapter {
    private baseUrl = 'https://beeindia.gov.in/api/v1';
    private apiKey: string | null = null;

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.BEE_API_KEY || null;
    }

    async fetchAllProjects(): Promise<any[]> { return []; }
    async fetchProjectsSince(since: Date): Promise<any[]> { return []; }
    async fetchCreditsForProject(projectId: string): Promise<any[]> { return []; }
    async fetchProjectDetails(projectId: string): Promise<any> { return null; }
}

// Factory function to get adapter by registry name
export function getRegistryAdapter(registry: string): any {
    const adapters: Record<string, any> = {
        'VERRA': new VerraAdapter(),
        'GOLD_STANDARD': new GoldStandardAdapter(),
        'CDM': new CDMAdapter(),
        'ACR': new ACRAdapter(),
        'ICM': new ICMAdapter(),
        'BEE': new BEEAdapter(),
    };

    const adapter = adapters[registry.toUpperCase()];
    if (!adapter) {
        throw new Error(`Unsupported registry: ${registry}`);
    }
    return adapter;
}

export {
    VerraAdapter,
    GoldStandardAdapter,
    CDMAdapter,
    ACRAdapter,
    ICMAdapter,
    BEEAdapter,
    BaseRegistryAdapter
};