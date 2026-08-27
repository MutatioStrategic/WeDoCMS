# WeDoCMS marketplace terms (approved for production)

**Document status:** approved for production use on 2026-08-27. The canonical, versioned text served by the application is in `src/legal/agreements.ts`. Live activation is pending production Worker secret provisioning; retain any legal and payment-provider sign-off evidence with the release record.

## Seller and artist agreement — `seller-marketplace-v2`

1. The artist, creator, owner or authorised representative is the seller and licensor. The seller retains copyright. WeDoCMS is a listing, discovery, checkout, delivery and record-keeping intermediary and does not acquire ownership.
2. Each listing must identify a written licence, version, URL or terms, effective date and restrictions. MIT is a software licence and is not a default photo licence; a Creative Commons or custom image licence is normally more appropriate.
3. The seller warrants ownership or authority, model/property/location/cultural permissions, lawful content and accurate disclosure of restrictions or AI-generated material. The seller handles claims arising from its rights or permissions, subject to mandatory law.
4. WeDoCMS receives only the operational permission needed to store, preview, market, moderate, deliver and audit a listing and completed transaction.
5. Sellers list standard media access in credits. They may also opt an asset into the Stockvel monthly membership, in which case an active member can use that asset without spending credits. Buyers without an eligible membership use the seller-listed credit amount. Custom buying is a separate opt-in listing mode and is also settled through credits; it is not a buyer-facing Rand offer.
6. The seller must complete provider identity, business, tax and risk checks and keep its Paystack account in good standing. WeDoCMS stores provider references and limited display details rather than raw banking credentials wherever possible.
7. WeDoCMS records purchases and downloads. It may disclose the minimum buyer and transaction information needed for a rights investigation or enforcement request, subject to applicable privacy law and a valid request. The seller may use it only for that purpose.
8. WeDoCMS may reject, unpublish, suspend, remove, refund or delay settlement when rights evidence is missing, a complaint is received, a provider or regulator requires action, or the agreement is breached.
9. The seller signs a versioned snapshot. WeDoCMS stores the version, content hash, acceptance timestamp, transaction references and download events.

## Buyer licence and payment terms — `buyer-marketplace-v2`

1. WeDoCMS is the marketplace intermediary. The seller retains copyright and is the licensor.
2. A recorded membership entitlement or successful credit purchase grants only the rights in the selected licence, territory, duration, product restrictions and any custom schedule. It does not grant ownership, unrestricted resale, sublicensing or implied endorsement.
3. The buyer-facing product is credits. A single currency amount may be shown only as an explicitly labelled display-only reference when enabled. It is not a second offer, a negotiated price, or a change to the credit requirement.
4. WeDoCMS records the licence, payment reference, buyer account, timestamp and download event. Download links and account credentials must not be shared.
5. The buyer must not resell, redistribute, train an AI model, imply endorsement, or use the media outside the selected licence or unlawfully.
6. The buyer agrees that minimum buyer, licence and download information may be disclosed to the seller for rights enforcement, subject to privacy law and the privacy notice.
7. A payment may be refunded or a download suspended after a reversal, verified rights problem, provider/regulator action or mandatory consumer-law requirement.
8. Continuing to checkout after accepting the displayed version confirms acceptance of these terms and the selected licence restrictions.

## Payment flow shown to both parties — `payment-split-v2`

1. Buyer -> Paystack hosted checkout for membership or credits -> signed Paystack webhook -> WeDoCMS reconciliation and entitlement activation.
2. Included membership media records access without a credit charge. Non-member media access atomically consumes the seller-listed credit amount after rights and terms checks pass.
3. Seller settlement, subscription revenue allocation, fees, taxes, refunds, chargebacks, reserves and provider rules are governed by the configured settlement policy and verified provider records. A provider rejection or reversal can prevent or reverse settlement; WeDoCMS does not add credits or mark an external payment paid without a valid signed webhook.

The separate payment-provider launch gate still requires written Paystack confirmation of the merchant/marketplace role, fee bearer, split basis (gross or net), tax invoices, refunds/chargebacks, reserves, KYC responsibilities and any PASA/FIC obligations.
