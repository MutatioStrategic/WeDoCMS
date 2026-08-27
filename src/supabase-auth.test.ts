import { describe, expect, it, vi } from "vitest";
import { buildAuthEmails, sendViaCloudflareEmail } from "../supabase/functions/send-email/email";
import { friendlyIdentityExchangeError, friendlySupabaseAuthError, isSupabaseEmailRateLimited } from "./supabase-auth";

describe("Supabase auth recovery", () => {
  it("turns the Supabase email rate limit into a useful recovery message", () => {
    const error = { code: "over_email_send_rate_limit", status: 429, message: "Email rate limit exceeded" };
    expect(isSupabaseEmailRateLimited(error)).toBe(true);
    expect(friendlySupabaseAuthError(error, "signup")).toContain("rate-limiting email delivery");
  });

  it("explains an unconfirmed account instead of showing the provider error verbatim", () => {
    expect(friendlySupabaseAuthError({ code: "email_not_confirmed", message: "Email not confirmed" }, "signin"))
      .toBe("Your email is not confirmed yet. Check your inbox or use Resend confirmation email.");
  });

  it("keeps organisation provisioning distinct from JWT verification", () => {
    expect(friendlyIdentityExchangeError(new Error("Organization is not provisioned")))
      .toContain("has not connected it to an organisation");
    expect(friendlyIdentityExchangeError(new Error("Verified identity token required")))
      .toContain("could not verify the session");
  });
});

describe("Supabase Send Email hook payload", () => {
  const payload = {
    user: { email: "person@example.com" },
    email_data: {
      email_action_type: "signup",
      token: "12345678",
      token_hash: "signed-token-hash",
      site_url: "https://example.supabase.co",
      redirect_to: "https://veld-archive.pages.dev",
    },
  };

  it("builds a Supabase verification link without exposing the token hash in client code", () => {
    const [email] = buildAuthEmails(payload);
    expect(email.to).toBe("person@example.com");
    expect(email.subject).toBe("Confirm your Veld Archive account");
    expect(email.html).toContain("https://example.supabase.co/auth/v1/verify");
    expect(email.html).toContain("token=signed-token-hash");
    expect(email.text).toContain("Open this link to continue");
  });

  it("sends the rendered message through Cloudflare Email Service", async () => {
    const [email] = buildAuthEmails(payload);
    const fetcher = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify({ success: true }), { status: 200 }));
    await sendViaCloudflareEmail(email, {
      CLOUDFLARE_ACCOUNT_ID: "account-id",
      CLOUDFLARE_EMAIL_API_TOKEN: "scoped-token",
      EMAIL_FROM: "noreply@example.com",
      EMAIL_FROM_NAME: "Veld Archive",
    }, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account-id/email/sending/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer scoped-token" }),
        body: expect.stringContaining('"person@example.com"'),
      }),
    );
  });

  it("keeps Supabase's reversed email-change hash mapping intact", () => {
    const [currentEmail, newEmail] = buildAuthEmails({
      user: { email: "old@example.com", new_email: "new@example.com" },
      email_data: {
        email_action_type: "email_change",
        token: "11111111",
        token_hash: "new-email-hash",
        token_new: "22222222",
        token_hash_new: "current-email-hash",
        site_url: "https://example.supabase.co",
      },
    });
    expect(currentEmail?.to).toBe("old@example.com");
    expect(currentEmail?.html).toContain("token=current-email-hash");
    expect(newEmail?.to).toBe("new@example.com");
    expect(newEmail?.html).toContain("token=new-email-hash");
  });
});
