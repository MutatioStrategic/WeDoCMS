import { bearerHeaders, readJson, type HttpClient } from "./http";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
};

export type EmailSendResult = {
  id: string;
  provider: string;
  accepted: boolean;
};

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** Native Cloudflare Email Service binding. The binding is preferred on Workers because it needs no API token. */
export class CloudflareEmailAdapter implements EmailProvider {
  readonly name = "cloudflare_email_service";

  constructor(private readonly binding: SendEmail, private readonly from: EmailAddress) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const result = await this.binding.send({
      to: message.to,
      from: this.from,
      subject: message.subject,
      text: message.text,
      html: `<p>${message.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "<br />")}</p>`,
      headers: { "X-Stockvel-Notification": message.idempotencyKey },
    });
    return { id: result.messageId ?? message.idempotencyKey, provider: this.name, accepted: true };
  }
}

type JsonEmailConfig = { provider: string; endpoint: string; token: string; from: string; fetcher?: HttpClient };
type JsonEmailResponse = { id?: string; messageId?: string; accepted?: boolean };

/** Generic HTTP-JSON email adapter. Swap the endpoint/token for the configured transactional provider. */
export class JsonEmailAdapter implements EmailProvider {
  readonly name: string;
  private readonly fetcher: HttpClient;

  constructor(private readonly config: JsonEmailConfig) {
    this.name = config.provider;
    this.fetcher = config.fetcher ?? fetch;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const response = await this.fetcher(this.config.endpoint, {
      method: "POST",
      headers: { ...bearerHeaders(this.config.token), "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey },
      body: JSON.stringify({ from: this.config.from, to: message.to, subject: message.subject, text: message.text }),
    });
    const body = await readJson<JsonEmailResponse>(response, this.name);
    return { id: body.id ?? body.messageId ?? message.idempotencyKey, provider: this.name, accepted: body.accepted ?? true };
  }
}

/** A single, best-effort email provider slot. Sending must never block the request that triggered it. */
export class EmailProviderRegistry {
  private provider: EmailProvider | null = null;

  register(provider: EmailProvider): void {
    this.provider = provider;
  }

  get(): EmailProvider | null {
    return this.provider;
  }
}
