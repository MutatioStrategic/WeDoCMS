import type { ResolutionStatus } from "../shared";

export type RightsReviewerRole = "editor" | "admin" | "service";

export type RightsTransitionInput = {
  from: ResolutionStatus;
  to: ResolutionStatus;
  actorId: string;
  actorRole: string;
  requesterId: string | null;
  assetOwnerId: string;
};

export type RightsTransitionDecision = {
  allowed: boolean;
  code?: "rights_invalid_transition" | "rights_actor_not_authorized";
};

const reviewerTransitions: Partial<Record<ResolutionStatus, ResolutionStatus[]>> = {
  lodged: ["under_review"],
  mediation: ["under_review"],
  under_review: ["mediation", "resolved", "appealed"],
  appealed: ["closed"],
};

/**
 * Conservative rights state machine. Keeping this decision pure makes the
 * route contract independently testable and prevents a UI from inventing a
 * transition that the Worker would not record.
 */
export function decideRightsTransition(input: RightsTransitionInput): RightsTransitionDecision {
  const reviewer = ["editor", "admin", "service"].includes(input.actorRole);
  if (reviewer) {
    return reviewerTransitions[input.from]?.includes(input.to)
      ? { allowed: true }
      : { allowed: false, code: "rights_invalid_transition" };
  }
  const requesterOrOwner = input.actorId === input.requesterId || input.actorId === input.assetOwnerId;
  if (requesterOrOwner && input.from === "resolved" && input.to === "appealed") return { allowed: true };
  return { allowed: false, code: requesterOrOwner ? "rights_invalid_transition" : "rights_actor_not_authorized" };
}

export function isRightsReviewer(role: string): role is RightsReviewerRole {
  return role === "editor" || role === "admin" || role === "service";
}
