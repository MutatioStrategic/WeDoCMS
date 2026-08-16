const externalLinks = {
  ccChooser: "https://creativecommons.org/choose/",
  ccLicences: "https://creativecommons.org/share-your-work/use-remix/cc-licenses/",
  cipcCopyright: "https://iponline.cipc.co.za/Copyright/CPInformation.aspx",
  saCopyrightAct: "https://www.gov.za/documents/copyright-act-16-apr-2015-0942",
};

type GuideStep = {
  number: string;
  title: string;
  detail: string;
  points: string[];
};

const guideSteps: GuideStep[] = [
  {
    number: "01",
    title: "Know what you control",
    detail: "Start with the original file and the people, places, brands or source material in it.",
    points: ["Keep the high-resolution original private.", "Confirm you own the work or have authority to license it.", "Get model, property or cultural permissions where the use needs them."],
  },
  {
    number: "02",
    title: "Choose your sharing lane",
    detail: "Free to use can still mean clear conditions. Pick the lane that matches your comfort level.",
    points: ["Open licence: standard public permission, such as CC BY or CC0.", "Custom licence: your own free or paid terms, agreed for a particular buyer.", "Permission required: keep it all rights reserved and invite a request."],
  },
  {
    number: "03",
    title: "Write the boundaries",
    detail: "Plain language is more useful than a vague label. Tell a buyer exactly what the permission covers.",
    points: ["State purpose, territory, duration and whether commercial use is allowed.", "Say whether cropping, remixing, resale, sublicensing or AI training is allowed.", "Include the credit line, restrictions and a contact for permission questions."],
  },
  {
    number: "04",
    title: "Post a protected preview",
    detail: "Let people discover the work without handing over the master file before the terms are clear.",
    points: ["Use a visible watermark and a web-sized preview when appropriate.", "Link the exact licence or terms version on the listing.", "Keep your original, release evidence and correspondence in your records."],
  },
  {
    number: "05",
    title: "Record the permission",
    detail: "A buyer should receive a licence record, not an ambiguous promise in a chat thread.",
    points: ["The creator keeps copyright; the buyer receives only the stated permission.", "For custom use, both parties can accept the displayed version before delivery.", "Veld records the terms, acceptance, payment and download trail for accountability."],
  },
];

const licenceLanes = [
  {
    tone: "green",
    label: "OPEN / FREE",
    title: "CC BY 4.0",
    body: "Others can reuse and adapt the work, including commercially, if they credit you and follow the licence.",
    link: externalLinks.ccLicences,
    linkLabel: "See the CC licence details ↗",
  },
  {
    tone: "sand",
    label: "OPEN / MORE CONTROL",
    title: "CC BY-NC-ND 4.0",
    body: "Others can share the original with credit, but not for commercial use or with adaptations.",
    link: externalLinks.ccLicences,
    linkLabel: "Compare the CC conditions ↗",
  },
  {
    tone: "dark",
    label: "CUSTOM / SIGNED",
    title: "Your own terms",
    body: "Grant a specific buyer a defined use, for free or for a fee, while keeping every right you did not grant.",
    link: "#rights-checklist",
    linkLabel: "Use the plain-language checklist ↓",
  },
];

export function RightsGuide() {
  return <main className="rights-guide-page">
    <section className="rights-guide-hero">
      <div className="eyebrow"><span className="pulse" /> A practical IP walkthrough</div>
      <h1>Share your work<br /><em>with confidence.</em></h1>
      <p>Copyright does not have to be a wall of legal language. This guide shows creators and buyers how to share photo and video with visible boundaries, useful links and a record of permission.</p>
      <div className="rights-guide-hero-actions"><a className="dark-button" href="#rights-walkthrough">Start the walkthrough <span>↓</span></a><a className="outline-button" href={externalLinks.ccChooser} target="_blank" rel="noreferrer">Open the CC chooser ↗</a></div>
      <p className="rights-disclaimer">Educational guide, not legal advice. If a work, person, property or commercial deal is high-risk, get advice for the specific situation.</p>
    </section>

    <section className="rights-principle" aria-label="The simple rule">
      <div className="rights-principle-mark">IP</div>
      <div><span className="section-kicker">THE SIMPLE RULE</span><h2>Free to discover is not the same as free to do anything with.</h2><p>A watermark helps people see who made the work. A licence tells them what they may do. A signed agreement proves which version both sides accepted.</p></div>
    </section>

    <section id="rights-walkthrough" className="rights-walkthrough" aria-labelledby="rights-walkthrough-title">
      <div className="section-heading"><div><span className="section-kicker">THE FIVE-MOVE WALKTHROUGH</span><h2 id="rights-walkthrough-title">From upload to <em>permission.</em></h2></div><p className="section-intro">Every step leaves a useful signal for the next person: who owns it, what is allowed, and what was agreed.</p></div>
      <div className="rights-steps">{guideSteps.map((step, index) => <article className="rights-step" key={step.number}><div className="rights-step-number">{step.number}<span>{index === guideSteps.length - 1 ? "✓" : "→"}</span></div><div><h3>{step.title}</h3><p>{step.detail}</p><ul>{step.points.map((point) => <li key={point}>{point}</li>)}</ul></div></article>)}</div>
    </section>

    <section className="rights-lanes" aria-labelledby="rights-lanes-title">
      <div className="section-heading"><div><span className="section-kicker">PICK YOUR COMFORT LEVEL</span><h2 id="rights-lanes-title">Three ways to <em>share.</em></h2></div><p className="section-intro">You do not need to give away your copyright to let someone use one image for one purpose.</p></div>
      <div className="rights-lane-grid">{licenceLanes.map((lane) => <article className={`rights-lane ${lane.tone}`} key={lane.title}><span className="section-kicker">{lane.label}</span><h3>{lane.title}</h3><p>{lane.body}</p><a href={lane.link} target={lane.link.startsWith("#") ? undefined : "_blank"} rel={lane.link.startsWith("#") ? undefined : "noreferrer"}>{lane.linkLabel}</a></article>)}</div>
      <div className="rights-warning"><strong>MIT is usually the wrong label for a photo or video.</strong><span>MIT is a software licence. For visual media, use a Creative Commons licence or write a custom image/video licence. If you want no one to use the work without asking, choose custom terms or “permission required”.</span></div>
    </section>

    <section id="rights-checklist" className="rights-checklist" aria-labelledby="rights-checklist-title">
      <div><span className="section-kicker">COPY-READY PROMPT</span><h2 id="rights-checklist-title">Make the terms <em>specific.</em></h2><p>When a buyer asks for permission, answer these questions. The resulting summary can become the listing terms and the signed licence record.</p></div>
      <div className="rights-question-grid"><div><b>Use</b><span>What exactly may they make with it?</span></div><div><b>Where</b><span>Which countries, channels or platforms?</span></div><div><b>When</b><span>For how long, and is renewal possible?</span></div><div><b>Credit</b><span>What name, link or notice must appear?</span></div><div><b>Changes</b><span>Can they crop, edit, remix or add text?</span></div><div><b>Limits</b><span>Resale, endorsement, sensitive use, AI training?</span></div></div>
      <div className="rights-example"><span className="section-kicker">EXAMPLE CUSTOM TERM</span><p>“You may use this photograph in one organic campaign on your own website and social channels in South Africa for 12 months. Credit ‘Name / Veld Archive’ where practical. No resale, sublicensing, paid advertising, AI training, endorsement implication or material edit without written permission.”</p><small>Example only — adapt it to the actual work and deal.</small></div>
    </section>

    <section className="rights-links" aria-labelledby="rights-links-title">
      <div className="section-heading"><div><span className="section-kicker">USEFUL STARTING POINTS</span><h2 id="rights-links-title">Go a little <em>deeper.</em></h2></div></div>
      <div className="rights-link-grid"><a href={externalLinks.ccChooser} target="_blank" rel="noreferrer"><span>01</span><strong>Creative Commons chooser ↗</strong><small>Pick conditions and get a shareable licence link.</small></a><a href={externalLinks.ccLicences} target="_blank" rel="noreferrer"><span>02</span><strong>Compare CC licences ↗</strong><small>Understand attribution, commercial use, remixing and share-alike.</small></a><a href={externalLinks.cipcCopyright} target="_blank" rel="noreferrer"><span>03</span><strong>CIPC copyright basics ↗</strong><small>South African official information on protected works and copyright.</small></a><a href={externalLinks.saCopyrightAct} target="_blank" rel="noreferrer"><span>04</span><strong>South African Copyright Act ↗</strong><small>Read the government-published Act 98 of 1978.</small></a></div>
    </section>

    <section className="rights-final-cta"><div><span className="section-kicker">READY WHEN YOU ARE</span><h2>Post the preview.<br /><em>Keep the control.</em></h2></div><p>Veld can show a watermarked discovery preview, publish the exact terms, and keep the buyer inside a clear permission flow before the original is delivered.</p></section>
  </main>;
}
