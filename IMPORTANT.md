# IMPORTANT: South African artist marketplace, verification and payouts

Status: approved product direction, pending written confirmation from the selected payment provider and a South African payments-law review.

## Correct business model

Artists retain copyright and advertise their photographs on WeDoCMS. WeDoCMS is not the owner or licensor of the photographs. The artist chooses the licence offered to the buyer and grants that licence directly through the buyer-facing transaction terms. WeDoCMS provides the listing, checkout, delivery record and marketplace/intermediary service.

The artist remains responsible for:

- owning or controlling the copyright and all permissions needed for the image;
- selecting a valid licence and supplying its exact terms, version or URL;
- model, property, trademark, privacy and other third-party releases where applicable;
- complying with the licence and marketplace rules; and
- resolving rights disputes, subject to WeDoCMS's takedown, suspension and cooperation process.

WeDoCMS must not describe itself as the copyright owner or licensor unless a separate written agreement says so. A contract allocating responsibility to the artist does not remove WeDoCMS's own POPIA, ECTA, consumer-protection, payment-provider or takedown duties.

MIT is a software licence and is not a good default for photographs. The product should offer established image/content licences (for example, the relevant Creative Commons licence) or a versioned custom commercial licence. Store the selected licence, its version or URL, a terms snapshot/hash, the artist's rights warranty, and the buyer's acceptance with the purchase record.

The buyer must agree that WeDoCMS may disclose the buyer's relevant download and transaction information to the artist when needed to investigate a suspected licence breach or enforce the licence. Disclosures must be limited to the agreed fields, purpose and retention period and must be covered by the privacy notice and buyer terms.

## Approved payment direction

Use Paystack South Africa's marketplace split-payment/subaccount flow, subject to Paystack approving this exact model in writing. At checkout, Paystack should split each buyer payment directly:

- the artist's agreed percentage goes to the artist's Paystack subaccount; and
- WeDoCMS's percentage goes to WeDoCMS's Paystack settlement account.

For example, if the buyer pays R100 and the artist share is 60%, the configured split is 60% to the artist subaccount and 40% to WeDoCMS, subject to the agreed treatment of Paystack fees, refunds and chargebacks.

Do not make WeDoCMS receive 100% and later transfer 60% to an artist as the normal flow. That makes WeDoCMS the party receiving and distributing money for third parties, which can create third-party payment-provider/money-or-value-transfer exposure and does not achieve the intended compliance reduction. A later transfer may be used only if Paystack and legal counsel confirm the funds-flow classification and payout controls.

Before production, obtain written Paystack answers to:

1. Is this artist marketplace and split-settlement model permitted?
2. Does Paystack perform the required KYC/KYB for each artist/subaccount, and what evidence must WeDoCMS collect?
3. Who is merchant of record for the buyer's licence, and who handles refunds, chargebacks and negative balances?
4. Can Paystack apply a reserve, delayed settlement or manual-release policy without WeDoCMS holding seller funds?
5. Does this arrangement keep WeDoCMS outside PASA third-party-payment-provider registration, or what registration is required?

Paystack's public documentation confirms that percentage and flat splits can be configured across a platform account and one or more subaccounts, including marketplace examples. Public documentation is not a substitute for approval of this specific business model.

## Seller verification policy

Full FICA-grade KYC is not required merely because a person lists photographs. The required level depends on the funds flow and risk assessment. The default onboarding policy is:

### Individual or sole proprietor

- legal name, verified email and phone, country and age confirmation;
- SA ID or passport through the payment provider or a hosted verification provider when risk requires it;
- artist rights warranty and versioned licence selection;
- payout account in the artist's name; and
- tax-responsibility acknowledgement.

South African sole proprietors do not have a separate CIPC legal entity. Do not block them for lacking a company registration number.

### Registered company

- registered name and CIPC registration number/status;
- authorised representative and authority to act;
- representative/director identity evidence when required by the provider;
- business payout account matching the registered entity; and
- beneficial-owner information only when required by the provider or applicable legal classification.

There is no "bank statement ID". A statement is supporting proof of address or account ownership, not identity verification. Prefer Paystack's South African Account Validation API. If a bank is unsupported, use a recent bank confirmation letter or a redacted statement as a manual exception.

### Verification vendors

- Didit may be used as an optional fraud layer: its current free tier provides 500 monthly document/liveness/face-match checks. It is EU-hosted by default and its general document check is not the same as a South African Home Affairs lookup.
- Paystack account validation is the preferred payout-account control; it is currently priced at R3 per successful South African check.
- A South African Home Affairs/CIPC provider may be added for high-risk or high-value sellers. There is no free authoritative public Home Affairs API; current private-user tariffs are R10 real-time or R1 per off-peak batch field.

## Required implementation changes

The existing repository already contains verification cases, document metadata, provider webhooks, seller contracts, payout wallets and an approval gate. Before production:

- implement a real Paystack split-payment/subaccount adapter and signed webhook reconciliation;
- store the Paystack subaccount/provider reference, split percentage and fee treatment, not raw bank credentials;
- remove or restrict manual wallet verification unless it is backed by provider evidence;
- prefer provider-hosted document capture and retain only the signed decision, provider reference and minimum matching metadata;
- separate KYC-document retention from audit retention and delete or de-identify documents when no longer necessary;
- make enhanced identity, sanctions, PEP, adverse-media and beneficial-owner checks risk-based;
- retain the artist's licence terms snapshot/hash, rights warranty, buyer acceptance, download event and permitted disclosure record;
- add takedown, suspension and rights-dispute workflows; and
- do not treat OCR as proof of identity, document authenticity, copyright ownership or licence validity.

## Compliance boundary

If WeDoCMS holds buyer funds or later distributes funds to multiple artists, obtain a written legal classification before launch. The FIC Act and PASA rules may then require additional registration and controls. If Paystack owns the regulated collection/split/payout flow, WeDoCMS still needs POPIA, ECTA, consumer, copyright, privacy-notice, disclosure and record-keeping controls, but should avoid unnecessarily collecting bank statements and identity documents itself.

This file records the product decision; it is not a legal opinion. Re-check provider terms, tariffs and South African law before production launch.

## Source links

- [PASA third-party payment provider registration](https://authorisation.pasa.org.za/so-and-tppp/tppp-registration/)
- [FIC Act and Schedule 1](https://www.fic.gov.za/wp-content/uploads/2024/05/2024.3-GN-FIC-Act-booklet.pdf)
- [Paystack South Africa terms](https://paystack.com/za/terms)
- [Paystack split payments](https://support.paystack.com/en/articles/2132802)
- [Paystack South African account validation](https://paystack.com/docs/identity-verification/verify-account-number/)
- [POPIA](https://www.justice.gov.za/legislation/acts/2013-004.pdf)
- [Electronic Communications and Transactions Act](https://www.gov.za/documents/electronic-communications-and-transactions-act)
- [SARS sole proprietorship guidance](https://www.sars.gov.za/businesses-and-employers/small-businesses-taxpayers/starting-a-business-and-tax/sole-proprietorship/)
