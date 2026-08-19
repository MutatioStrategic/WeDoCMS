/**
 * Versioned marketplace disclosures. These are product copy drafts, not a
 * substitute for South African legal advice. A production release must have
 * counsel approve the text and the payment provider confirm the settlement
 * model before changing the version identifiers below.
 */

export type MarketplaceAgreementType = "seller" | "buyer" | "payment";

export type MarketplaceAgreement = {
  type: MarketplaceAgreementType;
  version: string;
  title: string;
  audience: "seller" | "buyer" | "both";
  effectiveDate: string;
  draft: true;
  sections: Array<{ heading: string; body: string }>;
};

const effectiveDate = "2026-08-16";

export const sellerAgreement: MarketplaceAgreement = {
  type: "seller",
  version: "seller-marketplace-v1",
  title: "WeDoCMS Seller and Artist Marketplace Agreement",
  audience: "seller",
  effectiveDate,
  draft: true,
  sections: [
    { heading: "1. Parties and marketplace role", body: "You are the artist, creator, owner or authorised representative offering media through WeDoCMS (you, the Seller). WeDoCMS provides a listing, discovery, checkout, delivery and record-keeping service. You retain copyright and other intellectual-property rights. WeDoCMS does not acquire ownership of your media and is not the licensor of the buyer's use rights." },
    { heading: "2. Your licence choice", body: "You must select a written licence for each listing and keep its version, URL or terms, effective date and any usage restrictions accurate. The selected licence controls the buyer's permitted use. MIT is a software licence and is not a suitable default for photographs; if you choose it, you confirm that it is intentional and appropriate. Creative Commons or a custom image licence is normally more suitable. A listing without a valid licence cannot be published or paid for." },
    { heading: "3. Rights, releases and lawful content", body: "You represent and warrant that you own or control the rights needed to advertise the media and grant the selected licence, and that you have all required model, property, trade-mark, location, cultural-heritage and contributor permissions. You must disclose restrictions, synthetic or AI-generated content, and any third-party material. You must not upload unlawful, defamatory, infringing, exploitative or misleading content. You are responsible for claims arising from your rights or permissions, subject to mandatory law." },
    { heading: "4. WeDoCMS service permission", body: "You grant WeDoCMS a non-exclusive, worldwide, royalty-free operational permission to store, reproduce as necessary, display previews, market, moderate, deliver and keep audit records for your listing and completed transactions. This permission is limited to operating and protecting the marketplace and does not transfer copyright or give WeDoCMS a separate right to license the work outside a buyer transaction." },
    { heading: "5. Price, Paystack split and your share", body: "The buyer pays the listing price in South African rand through the Paystack checkout shown by WeDoCMS. Subject to Paystack approval and the applicable provider terms, WeDoCMS uses a Paystack marketplace split so your verified Paystack subaccount is allocated the agreed percentage (for example 60%) at the transaction, while the balance is allocated to WeDoCMS for its platform commission. The percentage is applied to the agreed split basis shown at checkout; payment-provider fees, taxes, refunds, chargebacks, reserves and currency rules may affect the amount actually available. WeDoCMS does not promise a payout until Paystack settles it and may suspend a listing or payout where the provider, law or a dispute requires it. WeDoCMS will not represent that a later manual bank transfer is the normal settlement method." },
    { heading: "6. Seller account and verification", body: "You must maintain an account with the payment provider, provide truthful identity, business and tax information, and complete any provider or risk checks required for settlement. WeDoCMS stores provider references and limited display details rather than raw banking credentials wherever possible. A pending, restricted or rejected provider account prevents publication or settlement. You remain responsible for your own tax filings and records." },
    { heading: "7. Buyer information and enforcement disclosure", body: "WeDoCMS records licence purchases and downloads. Where necessary to investigate misuse, respond to a rights complaint or enforce the selected licence, you authorise WeDoCMS to disclose the minimum buyer and transaction information reasonably required, subject to applicable privacy law, a valid legal request and our privacy notice. You must use that information only for the stated enforcement purpose and must not harass, profile or sell it." },
    { heading: "8. Takedown, suspension and disputes", body: "WeDoCMS may reject, unpublish, restrict, suspend or remove a listing, and may delay or reverse a settlement, when rights evidence is missing, a complaint is received, the listing breaches this agreement, or a provider or regulator requires action. You must cooperate with notices, evidence requests, refunds and chargebacks. A buyer's licence remains governed by its written terms and mandatory consumer law." },
    { heading: "9. Records, privacy and acceptance", body: "WeDoCMS keeps a versioned snapshot and hash of the agreement you accept, the payment split terms, listing licence terms, transaction reference and download events. The privacy notice explains purposes, retention, access and deletion rights. By signing, you confirm that you read this version, had an opportunity to obtain advice, and agree to be bound by it for listings submitted after acceptance." },
  ],
};

export const buyerAgreement: MarketplaceAgreement = {
  type: "buyer",
  version: "buyer-marketplace-v1",
  title: "WeDoCMS Buyer Licence and Payment Terms",
  audience: "buyer",
  effectiveDate,
  draft: true,
  sections: [
    { heading: "1. Marketplace role", body: "WeDoCMS operates a marketplace and delivery service. The Seller retains copyright and is the licensor. WeDoCMS does not sell or transfer copyright unless a listing expressly says otherwise." },
    { heading: "2. Licence you receive", body: "After successful payment, you receive only the usage rights described by the listing's selected licence, territory, duration, product restrictions and any custom schedule. You do not receive ownership, an unrestricted resale right, a right to sublicense, or a right to remove attribution unless the selected licence expressly grants it." },
    { heading: "3. Payment destination and price", body: "You pay the price shown at checkout in South African rand through Paystack. Paystack processes the payment and, where enabled, splits the settlement between the Seller's verified Paystack account and WeDoCMS's platform account according to the Seller's published marketplace arrangement. The split does not increase the price you see and does not change the licence you receive. Provider fees, tax treatment, refunds, chargebacks and settlement timing are handled under the applicable provider and platform rules." },
    { heading: "4. Download and records", body: "WeDoCMS may require an authenticated account before delivery. We record the licence, payment reference, buyer account, timestamp and download event so that the licence can be proved and misuse investigated. Do not share account credentials or download links." },
    { heading: "5. Your responsibilities", body: "Use the media only within the selected licence. Do not resell, redistribute, train an AI model, imply endorsement, use a person's image unlawfully, or use the media in a prohibited or defamatory context. You are responsible for checking the licence and obtaining any additional permissions your campaign requires." },
    { heading: "6. Enforcement disclosure", body: "By accepting these terms, you agree that WeDoCMS may disclose the minimum buyer, licence and download information reasonably necessary to the Seller for a rights investigation or enforcement request, subject to applicable privacy law and our privacy notice. The Seller may use it only for that purpose." },
    { heading: "7. Refunds, takedowns and limits", body: "A payment may be refunded or a download suspended where a transaction is reversed, a rights problem is verified, a provider or regulator requires action, or mandatory consumer law applies. A takedown does not automatically expand your licence or create a right to continue using disputed media. Questions and complaints should be sent through the support channel shown at checkout." },
    { heading: "8. Acceptance", body: "By checking the acceptance box and continuing to payment, you confirm that you read this version, understand that the Seller is the licensor, agree to the payment and enforcement disclosures, and accept the selected licence and product restrictions." },
  ],
};

export const paymentDisclosure: MarketplaceAgreement = {
  type: "payment",
  version: "payment-split-v1",
  title: "WeDoCMS Payment and Paystack Split Disclosure",
  audience: "both",
  effectiveDate,
  draft: true,
  sections: [
    { heading: "Buyer money flow", body: "The buyer pays the displayed price to the Paystack checkout initiated by WeDoCMS. Paystack processes the payment. A successful transaction is recorded against the licence only after a signed provider webhook is reconciled." },
    { heading: "Seller money flow", body: "For an approved Seller with a verified Paystack subaccount, the configured Paystack split allocates the agreed percentage (for example 60%) to that subaccount and the remainder to WeDoCMS's platform account. This is a provider-managed split at checkout, not a promise that WeDoCMS will hold the Seller's money and later transfer it manually." },
    { heading: "Important exceptions", body: "Paystack may reject, delay, reserve, reverse or charge back a transaction. Provider fees, tax, refunds, disputes and settlement timing are applied under the provider terms and the accepted Seller agreement. WeDoCMS will reconcile provider references and ledger entries and will not silently mark a licence paid without a valid webhook." },
  ],
};

export const marketplaceAgreements: Record<MarketplaceAgreementType, MarketplaceAgreement> = {
  seller: sellerAgreement,
  buyer: buyerAgreement,
  payment: paymentDisclosure,
};

export function getMarketplaceAgreement(type: MarketplaceAgreementType): MarketplaceAgreement {
  return marketplaceAgreements[type];
}

export function agreementText(document: MarketplaceAgreement): string {
  return [document.title, `Version: ${document.version}`, `Effective: ${document.effectiveDate}`, ...document.sections.flatMap((section) => [section.heading, section.body])].join("\n\n");
}
