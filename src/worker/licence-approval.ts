export const AUTO_APPROVAL_TERMS_VERSION = "licence-auto-approval-v1";
export const AUTO_APPROVAL_SCOPE = "validated_paid_licence_requests";

export type BuyerLicenceApprovalPreference = {
  enabled: boolean;
  termsVersion: string;
  signedAt: string | null;
  signedBy: string | null;
};

export function autoApprovalIsActive(preference: BuyerLicenceApprovalPreference | null): boolean {
  return Boolean(
    preference?.enabled
      && preference.termsVersion === AUTO_APPROVAL_TERMS_VERSION
      && preference.signedAt
      && preference.signedBy,
  );
}

export function licenceApprovalStatus(autoApprovalEnabled: boolean): "pending" | "auto_approved" {
  return autoApprovalEnabled ? "auto_approved" : "pending";
}
