const southAfricanMobilePattern = /^0(?:6\d|7\d|8[1-4])\d{7}$/;
const southAfricanE164Pattern = /^\+27(?:6\d|7\d|8[1-4])\d{7}$/;

/**
 * Converts the formats people commonly use in South Africa to the E.164
 * value required by Supabase and downstream verification providers.
 */
export function normalizeSouthAfricanPhone(input: string): string {
  const compact = input.trim().replace(/[\s().-]/g, "");
  if (!compact || !/^\+?\d+$/.test(compact)) throw new Error("Enter a valid South African mobile number, for example 073 712 3456.");

  const national = compact.startsWith("+27")
    ? `0${compact.slice(3)}`
    : compact.startsWith("0027")
      ? `0${compact.slice(4)}`
      : compact.startsWith("27")
        ? `0${compact.slice(2)}`
        : compact;

  if (!southAfricanMobilePattern.test(national)) throw new Error("Enter a valid South African mobile number, for example 073 712 3456.");
  return `+27${national.slice(1)}`;
}

export function isSouthAfricanPhone(phone: string): boolean {
  return southAfricanE164Pattern.test(phone);
}

export function friendlySupabasePhoneError(error: unknown, action: "send" | "verify"): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const message = raw.toLowerCase();
  if (message.includes("valid south african mobile")) return raw;
  if (message.includes("rate limit") || message.includes("too many") || message.includes("60 seconds") || message.includes("once every")) {
    return "Please wait about a minute before requesting another SMS code.";
  }
  if (action === "verify" && (message.includes("expired") || message.includes("invalid") || message.includes("token") || message.includes("otp"))) {
    return "That SMS code is incorrect or expired. Request a new code and try again.";
  }
  if (action === "send" && (message.includes("sms") || message.includes("provider") || message.includes("send") || message.includes("not enabled") || message.includes("not configured"))) {
    return "SMS delivery is not enabled for this archive yet. An administrator must enable Phone authentication and configure an SMS provider in Supabase before codes can be sent.";
  }
  return action === "send" ? "We could not send the SMS code. Check the number and try again." : "SMS verification failed. Check the code and try again.";
}
