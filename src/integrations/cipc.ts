import type { HttpClient } from "./http";

export type CipcLookupResult = { registrationNumber: string; registeredName: string; status?: string; verified: boolean; providerReference?: string };

export class CipcLookupAdapter {
  private readonly fetcher: HttpClient;
  constructor(private readonly config: { endpoint: string; token: string; fetcher?: HttpClient }) { this.fetcher = config.fetcher ?? globalThis.fetch; }

  async lookup(registrationNumber: string): Promise<CipcLookupResult> {
    const response = await this.fetcher(this.config.endpoint, { method: "POST", headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ registrationNumber }), signal: AbortSignal.timeout(8_000) });
    const value = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || typeof value.registrationNumber !== "string" || typeof value.registeredName !== "string") throw new Error(`CIPC lookup failed (${response.status})`);
    return { registrationNumber: value.registrationNumber, registeredName: value.registeredName, status: typeof value.status === "string" ? value.status : undefined, verified: value.verified === true, providerReference: typeof value.providerReference === "string" ? value.providerReference : undefined };
  }
}
