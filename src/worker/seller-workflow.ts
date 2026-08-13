export type SellerContractInput = {
  version: string;
  contributorId: string;
  signerName: string;
  signerEmail: string;
  signedAt: string;
  signatureMethod: "firma" | "manual";
  signatureReference: string;
  terms: string;
};

const encoder = new TextEncoder();

export function canonicalContract(input: SellerContractInput): string {
  return JSON.stringify({
    contributorId: input.contributorId,
    signatureMethod: input.signatureMethod,
    signatureReference: input.signatureReference,
    signedAt: input.signedAt,
    signerEmail: input.signerEmail.toLowerCase(),
    signerName: input.signerName.trim(),
    terms: input.terms,
    version: input.version,
  });
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Keep OCR useful for review without persisting full government or bank numbers. */
export function sanitizeOcrResult(value: unknown, documentType = "government_id"): Record<string, unknown> {
  const source = asRecord(value);
  const idNumber = typeof source.idNumber === "string" ? source.idNumber.replace(/\s+/g, "") : "";
  const accountNumber = typeof source.accountNumber === "string" ? source.accountNumber.replace(/\s+/g, "") : "";
  const common = {
    documentType: documentType.slice(0, 80),
    fullName: typeof source.fullName === "string" ? source.fullName.slice(0, 180) : null,
    idNumberLast4: idNumber ? idNumber.slice(-4) : (typeof source.idNumberLast4 === "string" ? source.idNumberLast4.slice(-4) : null),
    expiryDate: typeof source.expiryDate === "string" ? source.expiryDate.slice(0, 40) : null,
    issuedCountry: typeof source.issuedCountry === "string" ? source.issuedCountry.slice(0, 2).toUpperCase() : null,
    confidence: typeof source.confidence === "number" ? Math.max(0, Math.min(1, source.confidence)) : null,
  };
  if (documentType === "proof_of_address") return { ...common, address: typeof source.address === "string" ? source.address.slice(0, 300) : null, statementDate: typeof source.statementDate === "string" ? source.statementDate.slice(0, 40) : null };
  if (documentType === "business_registration") return { ...common, registeredName: typeof source.registeredName === "string" ? source.registeredName.slice(0, 180) : null, registrationNumberLast4: typeof source.registrationNumber === "string" ? source.registrationNumber.replace(/\s+/g, "").slice(-4) : null, registeredAddress: typeof source.registeredAddress === "string" ? source.registeredAddress.slice(0, 300) : null };
  if (documentType === "beneficial_owner_register") return { ...common, entityName: typeof source.entityName === "string" ? source.entityName.slice(0, 180) : null, ownerNames: Array.isArray(source.ownerNames) ? source.ownerNames.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 180)) : null, ownershipPercentages: Array.isArray(source.ownershipPercentages) ? source.ownershipPercentages.slice(0, 20) : null };
  if (documentType === "bank_account_proof") return { ...common, accountHolderName: typeof source.accountHolderName === "string" ? source.accountHolderName.slice(0, 180) : null, bankName: typeof source.bankName === "string" ? source.bankName.slice(0, 120) : null, accountLast4: accountNumber ? accountNumber.slice(-4) : (typeof source.accountLast4 === "string" ? source.accountLast4.slice(-4) : null), statementDate: typeof source.statementDate === "string" ? source.statementDate.slice(0, 40) : null };
  return common;
}

export function ocrValidation(result: Record<string, unknown>, documentType = "government_id"): Record<string, unknown> {
  const requiredByType: Record<string, string[]> = {
    government_id: ["fullName", "idNumberLast4"],
    proof_of_address: ["fullName", "address"],
    business_registration: ["registeredName", "registrationNumberLast4"],
    beneficial_owner_register: ["entityName", "ownerNames"],
    bank_account_proof: ["accountHolderName", "accountLast4"],
  };
  const required = requiredByType[documentType] ?? requiredByType.government_id;
  const missing = required.filter((field) => !result[field]);
  return { valid: missing.length === 0, missing, requiresHumanReview: true, automatedVerification: false };
}
