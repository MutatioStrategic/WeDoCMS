import { bearerHeaders, idempotencyHeaders, IntegrationError, readJson, type HttpClient } from "./http";

export type PaymentSessionRequest = {
  idempotencyKey: string;
  licenceId?: string;
  referenceId?: string;
  productType?: "licence" | "photographer_subscription" | "platform_subscription" | "credit_purchase";
  recurring?: { interval: "month"; billingDay: number; startDate: string };
  amountCents: number;
  currency: string;
  buyer: { id: string; email: string };
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
};

export type PaymentSession = {
  id: string;
  provider: string;
  status: "created" | "pending";
  checkoutUrl: string;
  checkoutForm?: { action: string; fields: Record<string, string> };
  providerReference?: string;
  providerSubscriptionReference?: string;
  raw?: unknown;
};

export interface PaymentProvider {
  readonly provider: string;
  createCheckoutSession(request: PaymentSessionRequest): Promise<PaymentSession>;
}

type JsonPaymentResponse = {
  id?: string;
  checkoutUrl?: string;
  checkout_url?: string;
  url?: string;
  status?: string;
  paymentReference?: string;
  payment_reference?: string;
  subscriptionReference?: string;
  subscription_reference?: string;
};

/**
 * Provider-neutral adapter for a PSP-owned checkout endpoint. The PSP must
 * return a hosted checkout URL and later call the signed payment webhook.
 */
export class JsonPaymentAdapter implements PaymentProvider {
  readonly provider: string;
  private readonly fetcher: HttpClient;

  constructor(private readonly config: { provider: string; endpoint: string; token: string; fetcher?: HttpClient; headers?: Record<string, string> }) {
    this.provider = config.provider;
    this.fetcher = config.fetcher ?? fetch;
  }

  async createCheckoutSession(request: PaymentSessionRequest): Promise<PaymentSession> {
    const response = await this.fetcher(this.config.endpoint, {
      method: "POST",
      headers: {
        ...bearerHeaders(this.config.token),
        "Content-Type": "application/json",
        ...this.config.headers,
        ...idempotencyHeaders(request.idempotencyKey),
      },
      body: JSON.stringify({
        reference: request.referenceId ?? request.licenceId,
        amount: request.amountCents,
        currency: request.currency.toUpperCase(),
        buyer: request.buyer,
        successUrl: request.successUrl,
        cancelUrl: request.cancelUrl,
        metadata: request.metadata,
        productType: request.productType ?? "licence",
        recurring: request.recurring,
      }),
    });
    const value = await readJson<JsonPaymentResponse>(response, this.provider);
    const checkoutUrl = value.checkoutUrl ?? value.checkout_url ?? value.url;
    if (!value.id || !checkoutUrl) throw new IntegrationError(this.provider, "Provider returned no checkout session or hosted URL", { details: value });
    return {
      id: request.referenceId ?? request.licenceId ?? request.idempotencyKey,
      provider: this.provider,
      status: value.status === "created" ? "created" : "pending",
      checkoutUrl,
      providerReference: value.paymentReference ?? value.payment_reference ?? value.id,
      providerSubscriptionReference: value.subscriptionReference ?? value.subscription_reference,
      raw: value,
    };
  }
}

export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProvider>();
  register(provider: PaymentProvider): this { this.providers.set(provider.provider, provider); return this; }
  get(provider: string): PaymentProvider {
    const value = this.providers.get(provider);
    if (!value) throw new Error(`No payment provider registered for ${provider}`);
    return value;
  }
}
