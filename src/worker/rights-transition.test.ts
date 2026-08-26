import { describe, expect, it } from "vitest";
import { decideRightsTransition } from "./rights-transition";

const base = { actorId: "reviewer", actorRole: "editor", requesterId: "requester", assetOwnerId: "owner" };

describe("rights case state machine", () => {
  it.each([
    ["lodged", "under_review"],
    ["mediation", "under_review"],
    ["under_review", "mediation"],
    ["under_review", "resolved"],
    ["under_review", "appealed"],
    ["appealed", "closed"],
  ] as const)("allows reviewers to move %s to %s", (from, to) => {
    expect(decideRightsTransition({ ...base, from, to }).allowed).toBe(true);
  });
  it("allows only the requester or asset owner to appeal a resolved case", () => {
    expect(decideRightsTransition({ ...base, actorId: "requester", actorRole: "buyer", from: "resolved", to: "appealed" })).toEqual({ allowed: true });
    expect(decideRightsTransition({ ...base, actorId: "owner", actorRole: "contributor", from: "resolved", to: "appealed" })).toEqual({ allowed: true });
    expect(decideRightsTransition({ ...base, actorId: "other", actorRole: "buyer", from: "resolved", to: "appealed" })).toEqual({ allowed: false, code: "rights_actor_not_authorized" });
  });
  it("rejects every other transition", () => {
    expect(decideRightsTransition({ ...base, from: "lodged", to: "resolved" })).toEqual({ allowed: false, code: "rights_invalid_transition" });
    expect(decideRightsTransition({ ...base, from: "closed", to: "appealed" })).toEqual({ allowed: false, code: "rights_invalid_transition" });
  });
});
