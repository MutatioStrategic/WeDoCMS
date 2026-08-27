# WeDoCMS marketplace terms (approved for production)

**Document status:** approved for production use on 2026-08-27. The canonical, versioned text served by the application is in `src/legal/agreements.ts`. Live activation is pending production Worker secret provisioning; retain any legal and payment-provider sign-off evidence with the release record.

## Seller and artist agreement — `seller-marketplace-v1`

1. The artist, creator, owner or authorised representative is the seller and licensor. The seller retains copyright. WeDoCMS is a listing, discovery, checkout, delivery and record-keeping intermediary and does not acquire ownership.
2. Each listing must identify a written licence, version, URL or terms, effective date and restrictions. MIT is a software licence and is not a default photo licence; a Creative Commons or custom image licence is normally more appropriate.
3. The seller warrants ownership or authority, model/property/location/cultural permissions, lawful content and accurate disclosure of restrictions or AI-generated material. The seller handles claims arising from its rights or permissions, subject to mandatory law.
4. WeDoCMS receives only the operational permission needed to store, preview, market, moderate, deliver and audit a listing and completed transaction.
5. The buyer pays the displayed ZAR price through Paystack. For an approved seller with a verified Paystack subaccount, Paystack is configured to split the transaction at checkout: the seller receives the agreed percentage (for example 60%) and the balance is allocated to WeDoCMS as platform commission. Fees, taxes, refunds, chargebacks, reserves and provider settlement rules may change the amount available. This is not a promise of a later manual bank transfer.
6. The seller must complete provider identity, business, tax and risk checks and keep its Paystack account in good standing. WeDoCMS stores provider references and limited display details rather than raw banking credentials wherever possible.
7. WeDoCMS records purchases and downloads. It may disclose the minimum buyer and transaction information needed for a rights investigation or enforcement request, subject to applicable privacy law and a valid request. The seller may use it only for that purpose.
8. WeDoCMS may reject, unpublish, suspend, remove, refund or delay settlement when rights evidence is missing, a complaint is received, a provider or regulator requires action, or the agreement is breached.
9. The seller signs a versioned snapshot. WeDoCMS stores the version, content hash, acceptance timestamp, transaction references and download events.

## Buyer licence and payment terms — `buyer-marketplace-v1`

1. WeDoCMS is the marketplace intermediary. The seller retains copyright and is the licensor.
2. Successful payment grants only the rights in the selected licence, territory, duration, product restrictions and any custom schedule. It does not grant ownership, unrestricted resale, sublicensing or implied endorsement.
3. The buyer pays the displayed ZAR price through Paystack. Paystack may split settlement between the seller's verified subaccount and WeDoCMS according to the seller's published arrangement. The split does not increase the buyer's price or change the licence.
4. WeDoCMS records the licence, payment reference, buyer account, timestamp and download event. Download links and account credentials must not be shared.
5. The buyer must not resell, redistribute, train an AI model, imply endorsement, or use the media outside the selected licence or unlawfully.
6. The buyer agrees that minimum buyer, licence and download information may be disclosed to the seller for rights enforcement, subject to privacy law and the privacy notice.
7. A payment may be refunded or a download suspended after a reversal, verified rights problem, provider/regulator action or mandatory consumer-law requirement.
8. Continuing to checkout after accepting the displayed version confirms acceptance of these terms and the selected licence restrictions.

## Payment flow shown to both parties — `payment-split-v1`

1. Buyer -> Paystack hosted checkout -> signed Paystack webhook -> WeDoCMS reconciliation and licence activation.
2. Paystack split at checkout -> verified artist Paystack subaccount (configured percentage) + WeDoCMS platform account (remainder).
3. A provider rejection, reserve, refund, chargeback or settlement delay can prevent or reverse the seller allocation. WeDoCMS does not mark a licence paid without a valid signed webhook.

The separate payment-provider launch gate still requires written Paystack confirmation of the merchant/marketplace role, fee bearer, split basis (gross or net), tax invoices, refunds/chargebacks, reserves, KYC responsibilities and any PASA/FIC obligations.
