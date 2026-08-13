import { describe, expect, it } from "vitest";
import { decidePayoutBatch } from "./payout-decision";

describe("payout batch approval gate", () => {
  it("keeps a new batch in processing only after an explicit approval", () => {
    expect(decidePayoutBatch("draft", "approve", 12500)).toEqual({ status: "processing", idempotent: false });
    expect(decidePayoutBatch("draft", "reject", 12500)).toEqual({ status: "cancelled", idempotent: false });
  });

  it("makes repeated approval safe and blocks decisions on completed batches", () => {
    expect(decidePayoutBatch("processing", "approve", 12500)).toEqual({ status: "processing", idempotent: true });
    expect(decidePayoutBatch("paid", "reject", 12500)).toEqual({ error: "Payout batch is already paid", statusCode: 409 });
  });

  it("does not approve an empty batch", () => {
    expect(decidePayoutBatch("draft", "approve", 0)).toEqual({ error: "Cannot approve an empty payout batch", statusCode: 422 });
  });
});
