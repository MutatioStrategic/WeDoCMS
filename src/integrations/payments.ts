import { bearerHeaders, idempotencyHeaders, IntegrationError, readJson, type HttpClient } from "./http";

export type PaymentSessionRequest = {
  idempotencyKey: string;
  licenceId: string;
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
  providerReference?: string;
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
};

type PaystackInitializeResponse = {
  status?: boolean;
  message?: string;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  };
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
        reference: request.licenceId,
        amount: request.amountCents,
        currency: request.currency.toUpperCase(),
        buyer: request.buyer,
        successUrl: request.successUrl,
        cancelUrl: request.cancelUrl,
        metadata: request.metadata,
      }),
    });
    const value = await readJson<JsonPaymentResponse>(response, this.provider);
    const checkoutUrl = value.checkoutUrl ?? value.checkout_url ?? value.url;
    if (!value.id || !checkoutUrl) throw new IntegrationError(this.provider, "Provider returned no checkout session or hosted URL", { details: value });
    return {
      id: request.licenceId,
      provider: this.provider,
      status: value.status === "created" ? "created" : "pending",
      checkoutUrl,
      providerReference: value.paymentReference ?? value.payment_reference ?? value.id,
      raw: value,
    };
  }
}

/** Paystack hosted-checkout adapter using server-side transaction initialization. */
export class PaystackPaymentAdapter implements PaymentProvider {
  readonly provider = "paystack";
  private readonly fetcher: HttpClient;

  constructor(private readonly config: { endpoint: string; secretKey: string; fetcher?: HttpClient }) {
    this.fetcher = config.fetcher ?? fetch;
  }

  async createCheckoutSession(request: PaymentSessionRequest): Promise<PaymentSession> {
    const response = await this.fetcher(this.config.endpoint, {
      method: "POST",
      headers: {
        ...bearerHeaders(this.config.secretKey),
        "Content-Type": "application/json",
        ...idempotencyHeaders(request.idempotencyKey),
      },
      body: JSON.stringify({
        email: request.buyer.email,
        amount: String(request.amountCents),
        currency: request.currency.toUpperCase(),
        reference: request.licenceId,
        callback_url: request.successUrl,
        metadata: {
          ...request.metadata,
          licenceId: request.licenceId,
          buyerId: request.buyer.id,
          cancel_action: request.cancelUrl,
        },
      }),
    });
    const value = await readJson<PaystackInitializeResponse>(response, this.provider);
    const checkoutUrl = value.data?.authorization_url;
    const reference = value.data?.reference;
    if (value.status !== true || !checkoutUrl || !reference) {
      throw new IntegrationError(this.provider, "Paystack returned no authorization URL or transaction reference", { details: value });
    }
    return {
      id: value.data?.access_code ?? reference,
      provider: this.provider,
      status: "created",
      checkoutUrl,
      providerReference: reference,
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
