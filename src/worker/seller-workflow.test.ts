import { describe, expect, it } from "vitest";
import { ocrValidation, sanitizeOcrResult } from "./seller-workflow";

describe("verification OCR safeguards", () => {
  it("masks full identity and bank numbers while keeping document-specific fields", () => {
    const identity = sanitizeOcrResult({ fullName: "A Person", idNumber: "8001015009087" }, "government_id");
    const bank = sanitizeOcrResult({ accountHolderName: "A Person", accountNumber: "1234567890", bankName: "Example Bank" }, "bank_account_proof");
    expect(identity).toMatchObject({ fullName: "A Person", idNumberLast4: "9087" });
    expect(identity).not.toHaveProperty("idNumber");
    expect(bank).toMatchObject({ accountHolderName: "A Person", accountLast4: "7890", bankName: "Example Bank" });
    expect(bank).not.toHaveProperty("accountNumber");
  });

  it("requires human review for every document type even when fields are present", () => {
    const result = ocrValidation({ fullName: "A Person", idNumberLast4: "9087" }, "government_id");
    expect(result).toEqual({ valid: true, missing: [], requiresHumanReview: true, automatedVerification: false });
  });
});
