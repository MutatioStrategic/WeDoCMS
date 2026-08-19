import { describe, expect, it } from "vitest";
import { AUTO_APPROVAL_TERMS_VERSION, autoApprovalIsActive, licenceApprovalStatus } from "./licence-approval";

describe("buyer licence auto-approval", () => {
  it("only activates with an enabled preference signed against the current terms", () => {
    expect(autoApprovalIsActive(null)).toBe(false);
    expect(autoApprovalIsActive({ enabled: true, termsVersion: AUTO_APPROVAL_TERMS_VERSION, signedAt: null, signedBy: "buyer-1" })).toBe(false);
    expect(autoApprovalIsActive({ enabled: true, termsVersion: "old-version", signedAt: "2026-08-14T10:00:00.000Z", signedBy: "buyer-1" })).toBe(false);
    expect(autoApprovalIsActive({ enabled: true, termsVersion: AUTO_APPROVAL_TERMS_VERSION, signedAt: "2026-08-14T10:00:00.000Z", signedBy: "buyer-1" })).toBe(true);
  });

  it("does not confuse auto-approval with payment", () => {
    expect(licenceApprovalStatus(true)).toBe("auto_approved");
    expect(licenceApprovalStatus(false)).toBe("pending");
  });
});
