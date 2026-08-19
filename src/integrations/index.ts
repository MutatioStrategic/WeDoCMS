export * from "./dam";
export * from "./http";
export * from "./payouts";
export * from "./payments";
export * from "./email";
export * from "./payfast";
export * from "./paystack-splits";
export * from "./paystack-webhooks";
export * from "./didit";
export * from "./cipc";
export * from "./zoho";

import { PayFastPayoutAdapter, PayoutProviderRegistry, SouthAfricanBankPayoutAdapter, StripeConnectPayoutAdapter } from "./payouts";
import { JsonPaymentAdapter, PaymentProviderRegistry, PaystackPaymentAdapter } from "./payments";
import { PayFastPaymentAdapter } from "./payfast";
import { ZohoIntegration, type ZohoIntegrationEnvironment } from "./zoho";
import { CloudflareEmailAdapter, EmailProviderRegistry, JsonEmailAdapter } from "./email";
import { DiditVerificationAdapter } from "./didit";
import { CipcLookupAdapter } from "./cipc";

/** The environment values needed to compose the available integrations. */
export type IntegrationEnvironment = {
  PAYMENT_PROVIDER?: string;
  PAYMENT_ENDPOINT?: string;
  PAYMENT_TOKEN?: string;
  PAYFAST_MERCHANT_ID?: string;
  PAYFAST_MERCHANT_KEY?: string;
  PAYFAST_PASSPHRASE?: string;
  PAYFAST_NOTIFY_URL?: string;
  PAYFAST_PAYMENT_ENDPOINT?: string;
  STRIPE_SECRET_KEY?: string;
  PAYFAST_ENDPOINT?: string;
  PAYFAST_TOKEN?: string;
  ZA_BANK_ENDPOINT?: string;
  ZA_BANK_TOKEN?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_ENDPOINT?: string;
  EMAIL_TOKEN?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL?: SendEmail;
  DIDIT_API_KEY?: string;
  DIDIT_KYC_WORKFLOW_ID?: string;
  DIDIT_KYB_WORKFLOW_ID?: string;
  DIDIT_API_URL?: string;
  CIPC_LOOKUP_URL?: string;
  CIPC_API_TOKEN?: string;
} & ZohoIntegrationEnvironment;

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
  readonly zoho: ZohoIntegration;
  readonly email: EmailProviderRegistry;
  readonly didit?: DiditVerificationAdapter;
  readonly cipc?: CipcLookupAdapter;

  constructor(environment: IntegrationEnvironment) {
    this.payments = new PaymentProviderRegistry();
    this.payouts = new PayoutProviderRegistry();
    this.zoho = new ZohoIntegration(environment);
    this.email = new EmailProviderRegistry();
    if (environment.DIDIT_API_KEY && environment.DIDIT_KYC_WORKFLOW_ID && environment.DIDIT_KYB_WORKFLOW_ID) this.didit = new DiditVerificationAdapter({ apiKey: environment.DIDIT_API_KEY, kycWorkflowId: environment.DIDIT_KYC_WORKFLOW_ID, kybWorkflowId: environment.DIDIT_KYB_WORKFLOW_ID, endpoint: environment.DIDIT_API_URL });
    if (environment.CIPC_LOOKUP_URL && environment.CIPC_API_TOKEN) this.cipc = new CipcLookupAdapter({ endpoint: environment.CIPC_LOOKUP_URL, token: environment.CIPC_API_TOKEN });

    if (environment.PAYMENT_PROVIDER === "payfast" && environment.PAYFAST_MERCHANT_ID && environment.PAYFAST_MERCHANT_KEY && environment.PAYFAST_NOTIFY_URL) {
      this.payments.register(new PayFastPaymentAdapter({
        merchantId: environment.PAYFAST_MERCHANT_ID,
        merchantKey: environment.PAYFAST_MERCHANT_KEY,
        passphrase: environment.PAYFAST_PASSPHRASE,
        notifyUrl: environment.PAYFAST_NOTIFY_URL,
        endpoint: environment.PAYFAST_PAYMENT_ENDPOINT,
      }));
    } else if (environment.PAYMENT_PROVIDER && environment.PAYMENT_ENDPOINT && environment.PAYMENT_TOKEN) {
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
    if (environment.EMAIL && environment.EMAIL_FROM) {
      this.email.register(new CloudflareEmailAdapter(environment.EMAIL, { email: environment.EMAIL_FROM, name: environment.EMAIL_FROM_NAME ?? "Veld Archive" }));
    } else if (environment.EMAIL_PROVIDER && environment.EMAIL_ENDPOINT && environment.EMAIL_TOKEN && environment.EMAIL_FROM) {
      this.email.register(new JsonEmailAdapter({
        provider: environment.EMAIL_PROVIDER,
        endpoint: environment.EMAIL_ENDPOINT,
        token: environment.EMAIL_TOKEN,
        from: environment.EMAIL_FROM,
      }));
    }
  }
}
