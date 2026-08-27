import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { buildAuthEmails, type SendEmailHookPayload, sendViaCloudflareEmail } from "./email.ts";

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function webhookSecret(value: string): string {
  return value.replace(/^v1,whsec_/, "").replace(/^whsec_/, "");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const configuredSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET")?.trim();
  if (!configuredSecret) return json({ error: { http_code: 503, message: "Send Email hook is not configured." } }, 503);

  let payload: SendEmailHookPayload;
  try {
    const body = await request.text();
    const verifier = new Webhook(webhookSecret(configuredSecret));
    payload = await verifier.verify(body, Object.fromEntries(request.headers.entries())) as SendEmailHookPayload;
  } catch {
    return json({ error: { http_code: 401, message: "Invalid Send Email hook signature." } }, 401);
  }

  try {
    const emails = buildAuthEmails(payload);
    const emailEnvironment = {
      CLOUDFLARE_ACCOUNT_ID: Deno.env.get("CLOUDFLARE_ACCOUNT_ID"),
      CLOUDFLARE_EMAIL_API_TOKEN: Deno.env.get("CLOUDFLARE_EMAIL_API_TOKEN"),
      EMAIL_FROM: Deno.env.get("EMAIL_FROM"),
      EMAIL_FROM_NAME: Deno.env.get("EMAIL_FROM_NAME"),
    };
    for (const email of emails) await sendViaCloudflareEmail(email, emailEnvironment);
    return json({}, 200);
  } catch {
    // Never log the signed payload, token, recipient, or provider response.
    return json({ error: { http_code: 503, message: "Authentication email could not be delivered." } }, 503);
  }
});
