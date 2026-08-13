export type PayoutBatchStatus = "draft" | "processing" | "paid" | "failed" | "cancelled";
export type PayoutDecision = "approve" | "reject";

export type PayoutDecisionResult =
  | { status: "processing" | "cancelled"; idempotent: boolean }
  | { error: string; statusCode: 409 | 422 };

export function decidePayoutBatch(status: PayoutBatchStatus, decision: PayoutDecision, totalCents: number): PayoutDecisionResult {
  if (decision === "approve" && status === "processing") return { status, idempotent: true };
  if (decision === "reject" && status === "cancelled") return { status, idempotent: true };
  if (status !== "draft") return { error: `Payout batch is already ${status}`, statusCode: 409 };
  if (decision === "approve" && totalCents <= 0) return { error: "Cannot approve an empty payout batch", statusCode: 422 };
  return { status: decision === "approve" ? "processing" : "cancelled", idempotent: false };
}
