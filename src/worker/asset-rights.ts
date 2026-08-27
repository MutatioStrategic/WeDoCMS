import type { Asset } from "../shared";

type EvidenceStatuses = Pick<Asset, "rightsStatus" | "modelReleaseStatus" | "propertyReleaseStatus">;

/**
 * Sellers can describe unresolved rights evidence, but only editorial roles
 * can promote an asset to a verified rights/release state. A seller may send
 * an existing verified value back unchanged while editing other metadata.
 */
export function sellerEvidenceUpdateAllowed(actorRole: string, current: EvidenceStatuses, next: Partial<EvidenceStatuses>): boolean {
  if (actorRole !== "contributor") return true;
  return (next.rightsStatus !== "verified" || current.rightsStatus === "verified")
    && (next.modelReleaseStatus !== "verified" || current.modelReleaseStatus === "verified")
    && (next.propertyReleaseStatus !== "verified" || current.propertyReleaseStatus === "verified");
}
