import type { ReactNode } from "react";

type DiagramTone = "rust" | "green" | "blue" | "violet" | "sand" | "ink";

type FlowNodeProps = {
  title: string;
  detail?: string;
  tone?: DiagramTone;
  compact?: boolean;
};

function FlowNode({ title, detail, tone = "blue", compact = false }: FlowNodeProps) {
  return <div className={`stakeholder-node stakeholder-node-${tone}${compact ? " compact" : ""}`}>
    <strong>{title}</strong>
    {detail && <small>{detail}</small>}
  </div>;
}

function FlowArrow({ label }: { label?: string }) {
  return <div className="stakeholder-arrow" aria-hidden="true"><span>{label}</span><b>→</b></div>;
}

function DiagramCard({ number, kicker, title, description, children }: { number: string; kicker: string; title: string; description: string; children: ReactNode }) {
  return <section className="stakeholder-diagram-card">
    <div className="stakeholder-card-heading">
      <div className="stakeholder-card-number">{number}</div>
      <div><span className="section-kicker">{kicker}</span><h2>{title}</h2><p>{description}</p></div>
    </div>
    <div className="stakeholder-diagram-canvas">{children}</div>
  </section>;
}

export function StakeholderDiagrams() {
  return <main className="stakeholder-page">
    <section className="stakeholder-hero">
      <span className="section-kicker">STAKEHOLDER SYSTEM OVERVIEW</span>
      <h1>One trusted system.<br /><em>Many ways to win.</em></h1>
      <p>Veld connects sellers, buyers, editors and payment providers around a single promise: make visual media easier to find, safer to license and more valuable to the people who create it.</p>
      <div className="stakeholder-jump-list" aria-label="Diagram sections">
        <a href="#system-map">System map</a><a href="#seller-journey">Seller journey</a><a href="#buyer-flow">Buyer and payout</a><a href="#trust-layer">Trust layer</a><a href="#asset-flywheel">Asset flywheel</a>
      </div>
    </section>

    <div className="stakeholder-summary-strip">
      <div><strong>01</strong><span>Rights-aware marketplace</span></div>
      <div><strong>02</strong><span>Human-supervised intelligence</span></div>
      <div><strong>03</strong><span>Paystack split settlement</span></div>
      <div><strong>04</strong><span>Production-ready delivery</span></div>
    </div>

    <div className="stakeholder-diagram-list">
      <div id="system-map" className="stakeholder-anchor" />
      <DiagramCard number="01" kicker="THE PLATFORM AT A GLANCE" title="System map" description="Every workspace enters through the Cloudflare Worker, which coordinates discovery, media, rights, payments, campaigns and trust controls.">
        <div className="architecture-map">
          <div className="architecture-column">
            <span className="diagram-lane-label">PEOPLE AND WORKSPACES</span>
            <FlowNode title="Seller workspace" detail="List, license, earn" tone="rust" compact />
            <FlowNode title="Buyer workspace" detail="Search, select, use" tone="violet" compact />
            <FlowNode title="Curator workspace" detail="Review, govern, resolve" tone="green" compact />
          </div>
          <FlowArrow label="HTTPS" />
          <div className="architecture-column architecture-core">
            <span className="diagram-lane-label">CLOUDFLARE CORE</span>
            <FlowNode title="Worker API" detail="One secure orchestration layer" tone="ink" />
            <div className="architecture-service-grid">
              <FlowNode title="Discovery" detail="Keyword + semantic" tone="blue" compact />
              <FlowNode title="Rights + checkout" detail="Validate before payment" tone="blue" compact />
              <FlowNode title="Media + campaigns" detail="Originals to derivatives" tone="blue" compact />
              <FlowNode title="Trust + audit" detail="Evidence and resolution" tone="blue" compact />
            </div>
          </div>
          <FlowArrow label="Records + events" />
          <div className="architecture-column">
            <span className="diagram-lane-label">DATA AND PROVIDERS</span>
            <FlowNode title="D1 + R2" detail="Application data and private media" tone="sand" compact />
            <FlowNode title="Vectorize + queues" detail="AI search and async work" tone="sand" compact />
            <FlowNode title="Paystack + identity" detail="Settlement and sign-in" tone="green" compact />
            <FlowNode title="Stream + verification" detail="Video and seller checks" tone="green" compact />
          </div>
        </div>
      </DiagramCard>

      <div id="seller-journey" className="stakeholder-anchor" />
      <DiagramCard number="02" kicker="SELLER VALUE CHAIN" title="From rights to revenue" description="The seller keeps control of the work and its licence. The platform removes the operational friction around publishing, selling and tracking it.">
        <div className="stakeholder-flow stakeholder-flow-wrap">
          <FlowNode title="Verify" detail="Identity or business checks" tone="rust" />
          <FlowArrow />
          <FlowNode title="Set terms" detail="Licence, territory, duration" tone="rust" />
          <FlowArrow />
          <FlowNode title="Upload" detail="Private original + preview" tone="rust" />
          <FlowArrow />
          <FlowNode title="Enrich" detail="AI suggestions, human edits" tone="violet" />
          <FlowArrow />
          <FlowNode title="Publish" detail="Rights gate passed" tone="green" />
          <FlowArrow />
          <FlowNode title="Earn" detail="Paystack split + insights" tone="green" />
        </div>
        <div className="stakeholder-callout stakeholder-callout-blue"><strong>The important distinction:</strong><span>the seller remains the licensor; Veld is the listing, checkout, delivery and record-keeping intermediary.</span></div>
      </DiagramCard>

      <div id="buyer-flow" className="stakeholder-anchor" />
      <DiagramCard number="03" kicker="BUYER AND PAYMENT FLOW" title="Search, permission, settlement" description="The buyer sees evidence before paying. The licence only activates after Paystack’s signed payment event is reconciled by the platform.">
        <div className="stakeholder-flow stakeholder-flow-wrap">
          <FlowNode title="Describe the brief" detail="Natural-language search" tone="violet" />
          <FlowArrow />
          <FlowNode title="Inspect evidence" detail="Match signals + rights" tone="violet" />
          <FlowArrow />
          <FlowNode title="Validate licence" detail="Releases and scope" tone="sand" />
          <FlowArrow />
          <FlowNode title="Pay through Paystack" detail="Configured split at checkout" tone="green" />
          <FlowArrow />
          <FlowNode title="Signed webhook" detail="Reconcile, then activate" tone="green" />
        </div>
        <div className="stakeholder-split-row">
          <div><span>PAYSTACK SETTLEMENT</span><strong>Agreed seller share</strong><small>Paid to the verified seller subaccount</small></div>
          <div className="stakeholder-split-mark">+</div>
          <div><span>PLATFORM SETTLEMENT</span><strong>Agreed intermediary share</strong><small>Paid to the platform account</small></div>
        </div>
      </DiagramCard>

      <div id="trust-layer" className="stakeholder-anchor" />
      <DiagramCard number="04" kicker="WHY THE SYSTEM IS TRUSTWORTHY" title="Intelligence with guardrails" description="Automation accelerates the archive, but important decisions remain explainable, reviewable and reversible.">
        <div className="stakeholder-lane-grid">
          <div className="stakeholder-lane stakeholder-lane-violet"><span className="diagram-lane-label">INTELLIGENCE</span><FlowNode title="AI assist" detail="Metadata, OCR and embeddings" tone="violet" compact /><FlowNode title="Human review" detail="Correction before publication" tone="violet" compact /><FlowNode title="Explainable search" detail="Show the fields used" tone="violet" compact /></div>
          <div className="stakeholder-lane stakeholder-lane-blue"><span className="diagram-lane-label">RIGHTS AND TRUST</span><FlowNode title="Seller verification" detail="KYC or KYB as required" tone="blue" compact /><FlowNode title="Licence gate" detail="Releases and restrictions" tone="blue" compact /><FlowNode title="Signed audit trail" detail="Terms, payment and download" tone="blue" compact /><FlowNode title="Takedown and mediation" detail="Resolve problems visibly" tone="blue" compact /></div>
          <div className="stakeholder-lane stakeholder-lane-green"><span className="diagram-lane-label">RESILIENCE</span><FlowNode title="Retryable queues" detail="Keep async work moving" tone="green" compact /><FlowNode title="DR replication" detail="Protect media and backups" tone="green" compact /><FlowNode title="Observability" detail="Logs, traces and metrics" tone="green" compact /></div>
        </div>
      </DiagramCard>

      <div id="asset-flywheel" className="stakeholder-anchor" />
      <DiagramCard number="05" kicker="THE COMPOUNDING PRODUCT ADVANTAGE" title="One source asset. Many outcomes." description="The original stays protected while the system makes it more discoverable, more usable and more valuable across the full lifecycle.">
        <div className="stakeholder-flow stakeholder-flow-wrap stakeholder-flywheel">
          <FlowNode title="Protected source" detail="Original stays private" tone="blue" />
          <FlowArrow />
          <FlowNode title="Trusted discovery" detail="Preview, context and evidence" tone="violet" />
          <FlowArrow />
          <FlowNode title="Licensed selection" detail="Lightboxes and saved searches" tone="sand" />
          <FlowArrow />
          <FlowNode title="Campaign production" detail="Social, web and print derivatives" tone="rust" />
          <FlowArrow />
          <FlowNode title="Controlled delivery" detail="Bundle, attribution, expiry" tone="green" />
          <FlowArrow />
          <FlowNode title="Insights and reuse" detail="Better supply and discovery" tone="green" />
        </div>
        <div className="stakeholder-feature-chips"><span>Private originals</span><span>Human context</span><span>Rights certificates</span><span>Campaign bundles</span><span>Community collections</span><span>Seller insights</span></div>
      </DiagramCard>
    </div>

    <section className="stakeholder-footer-note"><span className="section-kicker">READ THIS WITH THE LEGAL SETUP</span><h2>Control stays with the creator.<br /><em>Confidence travels with the asset.</em></h2><p>These diagrams are a product-level explanation of the current system. Final marketplace terms, Paystack approval, settlement treatment and South African legal classification still require formal review before production launch.</p></section>
  </main>;
}
