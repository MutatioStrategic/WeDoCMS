export type SupabaseAuthError = {
  code?: string | null;
  status?: number | null;
  message?: string | null;
};

function errorRecord(value: unknown): SupabaseAuthError | null {
  return value && typeof value === "object" ? value as SupabaseAuthError : null;
}

export function supabaseErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  const record = errorRecord(error);
  if (record?.message && record.message.trim()) return record.message.trim();
  return fallback;
}

function errorCode(error: unknown): string {
  const record = errorRecord(error);
  return `${record?.code ?? ""} ${record?.message ?? ""}`.toLowerCase();
}

export function isSupabaseEmailRateLimited(error: unknown): boolean {
  const record = errorRecord(error);
  const details = errorCode(error);
  return record?.status === 429
    || details.includes("over_email_send_rate_limit")
    || details.includes("over_request_rate_limit")
    || /rate limit|too many requests|email.{0,30}limit/.test(details);
}

export function friendlySupabaseAuthError(
  error: unknown,
  action: "signup" | "signin" | "resend" | "reset" | "verify" = "signin",
): string {
  const fallback = action === "resend"
    ? "The confirmation email could not be resent."
    : action === "reset"
      ? "The password reset email could not be sent."
      : action === "signup"
        ? "Account creation failed."
        : action === "verify"
          ? "The confirmation could not be completed."
          : "Sign-in failed.";
  const message = supabaseErrorMessage(error, fallback);
  const details = errorCode(error);

  if (isSupabaseEmailRateLimited(error)) {
    return "Supabase is temporarily rate-limiting email delivery. Wait a minute, then try again; repeated failures mean the Send Email hook or custom SMTP still needs to be configured.";
  }
  if (/only.*team|not authorized to use|email.*not authorized|default.*email service|smtp/.test(details)) {
    return "Supabase is still using its limited default email service. Configure the Veld Archive Send Email hook before retrying.";
  }
  if (/email.?not.?confirmed|not confirmed|confirm your email/.test(details)) {
    return "Your email is not confirmed yet. Check your inbox or use Resend confirmation email.";
  }
  if (/invalid login credentials|invalid.*credentials/.test(details)) {
    return "Email or password is incorrect.";
  }
  if (/user already registered|already registered|already exists/.test(details)) {
    return "An account already uses this email. Sign in or use Forgot password.";
  }
  return message;
}

export function friendlyIdentityExchangeError(error: unknown): string {
  const message = supabaseErrorMessage(error, "Identity exchange failed.");
  const details = message.toLowerCase();
  if (/organization|organisation|membership|provisioned/.test(details)) {
    return "Your Supabase identity is verified, but Veld has not connected it to an organisation yet. Ask an administrator to provision your account.";
  }
  if (/verified identity token|identity token required|jwt|token/.test(details)) {
    return "Supabase signed you in, but Veld could not verify the session. Refresh and try again; if it persists, check the Supabase and Worker JWT configuration.";
  }
  return "Supabase signed you in, but Veld could not create an application session. Try again, and contact an administrator if the problem continues.";
}
