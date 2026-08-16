export * from "./dam";
export * from "./http";
export * from "./payouts";
export * from "./payments";

import { PayFastPayoutAdapter, PayoutProviderRegistry, SouthAfricanBankPayoutAdapter, StripeConnectPayoutAdapter } from "./payouts";
import { JsonPaymentAdapter, PaymentProviderRegistry, PaystackPaymentAdapter } from "./payments";

/** The environment values needed to compose the available integrations. */
export type IntegrationEnvironment = {
  PAYMENT_PROVIDER?: string;
  PAYMENT_ENDPOINT?: string;
  PAYMENT_TOKEN?: string;
  STRIPE_SECRET_KEY?: string;
  PAYFAST_ENDPOINT?: string;
  PAYFAST_TOKEN?: string;
  ZA_BANK_ENDPOINT?: string;
  ZA_BANK_TOKEN?: string;
};

/**
 * Application integration container.
 *
 * Vendor construction belongs at this composition boundary. Route handlers
 * consume provider-neutral registries and do not need to know which adapter
 * classes or credentials are used for a deployment.
 */
export class IntegrationContainer {
  readonly payments: PaymentProviderRegistry;
  readonly payouts: PayoutProviderRegistry;

  constructor(environment: IntegrationEnvironment) {
    this.payments = new PaymentProviderRegistry();
    this.payouts = new PayoutProviderRegistry();

    if (environment.PAYMENT_PROVIDER && environment.PAYMENT_ENDPOINT && environment.PAYMENT_TOKEN) {
      if (environment.PAYMENT_PROVIDER.toLowerCase() === "paystack") {
        this.payments.register(new PaystackPaymentAdapter({ endpoint: environment.PAYMENT_ENDPOINT, secretKey: environment.PAYMENT_TOKEN }));
      } else {
        this.payments.register(new JsonPaymentAdapter({
          provider: environment.PAYMENT_PROVIDER,
          endpoint: environment.PAYMENT_ENDPOINT,
          token: environment.PAYMENT_TOKEN,
        }));
      }
    }
    if (environment.STRIPE_SECRET_KEY) {
      this.payouts.register(new StripeConnectPayoutAdapter({ secretKey: environment.STRIPE_SECRET_KEY }));
    }
    if (environment.PAYFAST_ENDPOINT && environment.PAYFAST_TOKEN) {
      this.payouts.register(new PayFastPayoutAdapter({ endpoint: environment.PAYFAST_ENDPOINT, token: environment.PAYFAST_TOKEN }));
    }
    if (environment.ZA_BANK_ENDPOINT && environment.ZA_BANK_TOKEN) {
      this.payouts.register(new SouthAfricanBankPayoutAdapter({ endpoint: environment.ZA_BANK_ENDPOINT, token: environment.ZA_BANK_TOKEN }));
    }
  }
}
