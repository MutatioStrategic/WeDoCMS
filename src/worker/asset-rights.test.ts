import { describe, expect, it } from "vitest";
import { sellerEvidenceUpdateAllowed } from "./asset-rights";

const pending = { rightsStatus: "pending" as const, modelReleaseStatus: "unknown" as const, propertyReleaseStatus: "unknown" as const };

describe("seller rights evidence boundaries", () => {
  it("keeps verification reviewer-owned for new or unresolved evidence", () => {
    expect(sellerEvidenceUpdateAllowed("contributor", pending, {
      rightsStatus: "verified",
      modelReleaseStatus: "verified",
      propertyReleaseStatus: "verified",
    })).toBe(false);
  });

  it("lets a seller preserve an existing verified state while editing metadata", () => {
    const verified = { rightsStatus: "verified" as const, modelReleaseStatus: "verified" as const, propertyReleaseStatus: "not_required" as const };
    expect(sellerEvidenceUpdateAllowed("contributor", verified, verified)).toBe(true);
  });

  it("allows editorial roles to record verification decisions", () => {
    expect(sellerEvidenceUpdateAllowed("editor", pending, {
      rightsStatus: "verified",
      modelReleaseStatus: "verified",
      propertyReleaseStatus: "verified",
    })).toBe(true);
  });
});
