import { basicHeaders, bearerHeaders, idempotencyHeaders, IntegrationError, joinUrl, readJson, type HttpClient } from "./http";

export type PayoutRail = "stripe_connect" | "payfast" | "za_bank" | "mobile_money" | "sepa";
export type PayoutStatus = "pending" | "processing" | "paid" | "failed" | "cancelled";

export type Money = { amountMinor: number; currency: string };

export type PayoutRequest = {
  idempotencyKey: string;
  reference: string;
  recipient: {
    id: string;
    name: string;
    email?: string;
    country: string;
    bankAccount?: { accountNumber: string; branchCode?: string; bankName?: string };
    mobileNumber?: string;
    providerAccountId?: string;
    stripeAccountId?: string;
    iban?: string;
    bic?: string;
  };
  money: Money;
  description?: string;
  metadata?: Record<string, string>;
};

export type Payout = {
  id: string;
  provider: PayoutRail;
  status: PayoutStatus;
  reference: string;
  money: Money;
  providerReference?: string;
  failureReason?: string;
  raw?: unknown;
};

export interface PayoutProvider {
  readonly rail: PayoutRail;
  createPayout(request: PayoutRequest): Promise<Payout>;
  getPayout(providerReference: string): Promise<Payout>;
}

type StripePayoutResponse = { id: string; status: string; amount: number; currency: string; failure_message?: string; metadata?: Record<string, string> };

export class StripeConnectPayoutAdapter implements PayoutProvider {
  readonly rail = "stripe_connect" as const;
  private readonly fetcher: HttpClient;

  constructor(private readonly config: { secretKey: string; connectedAccountId?: string; apiBaseUrl?: string; fetcher?: HttpClient }) {
    this.fetcher = config.fetcher ?? fetch;
  }

  async createPayout(request: PayoutRequest): Promise<Payout> {
    if (!request.recipient.stripeAccountId) throw new IntegrationError(this.rail, "stripeAccountId is required");
    const body = new URLSearchParams({
      amount: String(request.money.amountMinor),
      currency: request.money.currency.toLowerCase(),
      ...(request.description ? { description: request.description } : {}),
    });
    Object.entries(request.metadata ?? {}).forEach(([key, value]) => body.set(`metadata[${key}]`, value));
    const response = await this.fetcher(joinUrl(this.config.apiBaseUrl ?? "https://api.stripe.com", "/v1/payouts"), {
      method: "POST",
      headers: { ...basicHeaders(this.config.secretKey), "Stripe-Account": request.recipient.stripeAccountId, ...idempotencyHeaders(request.idempotencyKey), "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return this.map(await readJson<StripePayoutResponse>(response, this.rail), request);
  }

  async getPayout(providerReference: string): Promise<Payout> {
    const response = await this.fetcher(joinUrl(this.config.apiBaseUrl ?? "https://api.stripe.com", `/v1/payouts/${encodeURIComponent(providerReference)}`), {
      headers: { ...basicHeaders(this.config.secretKey), ...(this.config.connectedAccountId ? { "Stripe-Account": this.config.connectedAccountId } : {}) },
    });
    return this.map(await readJson<StripePayoutResponse>(response, this.rail), { reference: providerReference, money: { amountMinor: 0, currency: "" } } as PayoutRequest);
  }

  private map(value: StripePayoutResponse, request: PayoutRequest): Payout {
    return { id: request.reference, provider: this.rail, status: normalizePayoutStatus(value.status), reference: request.reference, providerReference: value.id, money: { amountMinor: value.amount, currency: value.currency.toUpperCase() }, failureReason: value.failure_message, raw: value };
  }
}

type JsonPayoutConfig = { endpoint: string; token: string; fetcher?: HttpClient; headers?: Record<string, string> };
type JsonPayoutResponse = { id?: string; reference?: string; status?: string; state?: string; amount?: number; currency?: string; failureReason?: string; failure_reason?: string };

abstract class JsonPayoutAdapter implements PayoutProvider {
  abstract readonly rail: PayoutRail;
  protected readonly fetcher: HttpClient;

  constructor(protected readonly config: JsonPayoutConfig) { this.fetcher = config.fetcher ?? fetch; }

  protected abstract payload(request: PayoutRequest): Record<string, unknown>;

  async createPayout(request: PayoutRequest): Promise<Payout> {
    const response = await this.fetcher(this.config.endpoint, {
      method: "POST",
      headers: { ...bearerHeaders(this.config.token), "Content-Type": "application/json", ...this.config.headers, ...idempotencyHeaders(request.idempotencyKey) },
      body: JSON.stringify(this.payload(request)),
    });
    return this.map(await readJson<JsonPayoutResponse>(response, this.rail), request);
  }

  async getPayout(providerReference: string): Promise<Payout> {
    const response = await this.fetcher(`${this.config.endpoint.replace(/\/$/, "")}/${encodeURIComponent(providerReference)}`, { headers: { ...bearerHeaders(this.config.token), ...this.config.headers } });
    return this.map(await readJson<JsonPayoutResponse>(response, this.rail), { reference: providerReference, money: { amountMinor: 0, currency: "" } } as PayoutRequest);
  }

  private map(value: JsonPayoutResponse, request: PayoutRequest): Payout {
    return { id: request.reference, provider: this.rail, status: normalizePayoutStatus(value.status ?? value.state ?? "pending"), reference: request.reference, providerReference: value.id ?? value.reference, money: { amountMinor: value.amount ?? request.money.amountMinor, currency: (value.currency ?? request.money.currency).toUpperCase() }, failureReason: value.failureReason ?? value.failure_reason, raw: value };
  }
}

/** PayFast-compatible payout rail. Keep the endpoint configurable for the selected PSP or treasury service. */
export class PayFastPayoutAdapter extends JsonPayoutAdapter {
  readonly rail = "payfast" as const;
  protected payload(request: PayoutRequest) {
    if (!request.recipient.providerAccountId) throw new IntegrationError(this.rail, "providerAccountId is required");
    return { reference: request.reference, amount: request.money.amountMinor, currency: request.money.currency, recipient: { id: request.recipient.providerAccountId, name: request.recipient.name, email: request.recipient.email }, description: request.description, metadata: request.metadata };
  }
}

/** Configurable South African bank rail for FNB, Nedbank, Absa, Standard Bank, or an aggregator. */
export class SouthAfricanBankPayoutAdapter extends JsonPayoutAdapter {
  readonly rail = "za_bank" as const;
  protected payload(request: PayoutRequest) {
    if (!request.recipient.bankAccount) throw new IntegrationError(this.rail, "bankAccount is required");
    return { reference: request.reference, amount: request.money.amountMinor, currency: request.money.currency, beneficiary: { name: request.recipient.name, accountNumber: request.recipient.bankAccount.accountNumber, branchCode: request.recipient.bankAccount.branchCode, bankName: request.recipient.bankAccount.bankName }, description: request.description, metadata: request.metadata };
  }
}

/** Generic mobile-money rail; configure the endpoint for MTN MoMo, Vodacom, or another gateway. */
export class MobileMoneyPayoutAdapter extends JsonPayoutAdapter {
  readonly rail = "mobile_money" as const;
  protected payload(request: PayoutRequest) {
    if (!request.recipient.mobileNumber) throw new IntegrationError(this.rail, "mobileNumber is required");
    return { externalId: request.reference, amount: request.money.amountMinor, currency: request.money.currency, payee: { name: request.recipient.name, msisdn: request.recipient.mobileNumber }, description: request.description, metadata: request.metadata };
  }
}

/** SEPA credit-transfer rail; configure this with the bank/PSP's transfer endpoint. */
export class SepaTransferPayoutAdapter extends JsonPayoutAdapter {
  readonly rail = "sepa" as const;
  protected payload(request: PayoutRequest) {
    if (!request.recipient.iban) throw new IntegrationError(this.rail, "iban is required");
    if (request.money.currency.toUpperCase() !== "EUR") throw new IntegrationError(this.rail, "SEPA transfers must use EUR");
    return { endToEndId: request.reference, instructedAmount: { amount: (request.money.amountMinor / 100).toFixed(2), currency: request.money.currency.toUpperCase() }, debtorMessage: request.description, creditor: { name: request.recipient.name, iban: request.recipient.iban, bic: request.recipient.bic }, metadata: request.metadata };
  }
}

function normalizePayoutStatus(status: string): PayoutStatus {
  const value = status.toLowerCase();
  if (["paid", "succeeded", "completed", "success"].includes(value)) return "paid";
  if (["failed", "failure", "rejected", "error"].includes(value)) return "failed";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  if (["processing", "in_progress", "in-progress"].includes(value)) return "processing";
  return "pending";
}

export class PayoutProviderRegistry {
  private readonly providers = new Map<PayoutRail, PayoutProvider>();
  register(provider: PayoutProvider): this { this.providers.set(provider.rail, provider); return this; }
  get(rail: PayoutRail): PayoutProvider { const provider = this.providers.get(rail); if (!provider) throw new Error(`No payout provider registered for ${rail}`); return provider; }
}
