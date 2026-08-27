export type SendEmailHookPayload = {
  user?: {
    email?: string | null;
    new_email?: string | null;
    [key: string]: unknown;
  };
  email_data?: {
    email_action_type?: string | null;
    token?: string | null;
    token_hash?: string | null;
    token_new?: string | null;
    token_hash_new?: string | null;
    redirect_to?: string | null;
    site_url?: string | null;
    [key: string]: unknown;
  };
};

export type AuthEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type CloudflareEmailEnvironment = {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_EMAIL_API_TOKEN?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
};

const actionCopy: Record<string, { subject: string; title: string; intro: string }> = {
  signup: {
    subject: "Confirm your Stockvel account",
    title: "Confirm your Stockvel account",
    intro: "Finish creating your Stockvel account by confirming this email address.",
  },
  recovery: {
    subject: "Reset your Stockvel password",
    title: "Reset your Stockvel password",
    intro: "Use the secure link below to choose a new Stockvel password.",
  },
  email_change: {
    subject: "Confirm your new Stockvel email",
    title: "Confirm your new email address",
    intro: "Confirm this address to finish changing the email on your Stockvel account.",
  },
  invite: {
    subject: "You are invited to Stockvel",
    title: "You are invited to Stockvel",
    intro: "Use the secure link below to accept your Stockvel invitation.",
  },
  magiclink: {
    subject: "Your Stockvel sign-in link",
    title: "Sign in to Stockvel",
    intro: "Use the secure link below to sign in to Stockvel.",
  },
  reauthentication: {
    subject: "Your Stockvel verification code",
    title: "Confirm it is you",
    intro: "Use this one-time code to continue your Stockvel action.",
  },
};

function requiredEmail(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || !value.includes("@")) throw new Error(`Authentication email payload has no valid ${field}.`);
  return value.trim();
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function verificationType(action: string): string {
  return action === "signup" ? "email" : action;
}

function verificationUrl(siteUrl: string, tokenHash: string, action: string, redirectTo: string): string {
  const url = new URL("/auth/v1/verify", siteUrl);
  url.searchParams.set("token", tokenHash);
  url.searchParams.set("type", verificationType(action));
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);
  return url.toString();
}

function copyFor(action: string): { subject: string; title: string; intro: string } {
  return actionCopy[action] ?? {
    subject: "A Stockvel account action needs your attention",
    title: "Stockvel account action",
    intro: "Use the secure link below to continue your Stockvel account action.",
  };
}

function renderEmail(action: string, to: string, token: string, tokenHash: string, siteUrl: string, redirectTo: string): AuthEmail {
  const copy = copyFor(action);
  const link = tokenHash && siteUrl ? verificationUrl(siteUrl, tokenHash, action, redirectTo) : "";
  const safeLink = htmlEscape(link);
  const safeToken = htmlEscape(token);
  const actionLine = link
    ? `Open this link to continue:\n${link}`
    : token
      ? `Your one-time code is: ${token}`
      : "No further action is required unless you initiated this account request.";
  const htmlAction = link
    ? `<p><a href="${safeLink}" style="background:#187a58;color:#ffffff;display:inline-block;padding:12px 18px;text-decoration:none;border-radius:6px">Continue securely</a></p><p>If the button does not work, copy this link into your browser:</p><p style="word-break:break-all">${safeLink}</p>`
    : token
      ? `<p>Your one-time code is <strong style="font-size:1.35em;letter-spacing:.12em">${safeToken}</strong></p>`
      : "";
  const text = `${copy.intro}\n\n${actionLine}\n\nIf you did not request this, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#17201d;max-width:560px"><h2>${htmlEscape(copy.title)}</h2><p>${htmlEscape(copy.intro)}</p>${htmlAction}<p style="color:#68716d">If you did not request this, you can ignore this email.</p></div>`;
  return { to, subject: copy.subject, text, html };
}

export function buildAuthEmails(payload: SendEmailHookPayload): AuthEmail[] {
  const user = payload.user ?? {};
  const emailData = payload.email_data ?? {};
  const action = textValue(emailData.email_action_type).toLowerCase() || "account";
  const token = textValue(emailData.token);
  const tokenHash = textValue(emailData.token_hash);
  const tokenNew = textValue(emailData.token_new);
  const tokenHashNew = textValue(emailData.token_hash_new);
  const siteUrl = textValue(emailData.site_url);
  const redirectTo = textValue(emailData.redirect_to);
  const requiresVerification = ["signup", "recovery", "email_change", "invite", "magiclink", "reauthentication"].includes(action);

  if (requiresVerification && !token && !(tokenHash && siteUrl) && !(tokenHashNew && siteUrl)) throw new Error("Authentication email payload has no usable verification token.");

  const primaryEmail = requiredEmail(user.email, "recipient email");
  const emails: AuthEmail[] = [];
  if (action === "email_change") {
    // Supabase retains the historical, counterintuitive hash mapping:
    // token_hash_new belongs to the current address, while token_hash belongs
    // to the new address.
    if (tokenHashNew && siteUrl) emails.push(renderEmail(action, primaryEmail, token, tokenHashNew, siteUrl, redirectTo));
    if (tokenHash && siteUrl) {
      const recipient = user.new_email ? requiredEmail(user.new_email, "new recipient email") : primaryEmail;
      emails.push(renderEmail(action, recipient, tokenNew || token, tokenHash, siteUrl, redirectTo));
    }
  } else if (!requiresVerification || token || tokenHash && siteUrl) {
    emails.push(renderEmail(action, primaryEmail, token, tokenHash, siteUrl, redirectTo));
  }
  if (requiresVerification && !emails.length) throw new Error("Authentication email payload has no usable recipient or verification token.");
  return emails;
}

export async function sendViaCloudflareEmail(
  email: AuthEmail,
  env: CloudflareEmailEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const accountId = textValue(env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = textValue(env.CLOUDFLARE_EMAIL_API_TOKEN);
  const from = textValue(env.EMAIL_FROM);
  if (!accountId || !apiToken || !from) throw new Error("Cloudflare Email Service is not configured.");

  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: [email.to],
      from: { address: from, ...(textValue(env.EMAIL_FROM_NAME) ? { name: textValue(env.EMAIL_FROM_NAME) } : {}) },
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });
  let body: { success?: boolean; result?: { permanent_bounces?: string[] } } | null = null;
  try { body = await response.json() as { success?: boolean; result?: { permanent_bounces?: string[] } }; } catch { /* the HTTP status remains authoritative */ }
  const bounced = body?.result?.permanent_bounces?.some((recipient) => recipient.toLowerCase() === email.to.toLowerCase()) ?? false;
  if (!response.ok || body?.success === false || bounced) throw new Error("Cloudflare Email Service rejected the authentication email.");
}
