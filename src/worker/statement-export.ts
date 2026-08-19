type AnyStatement = Record<string, unknown>;

function object(value: unknown): AnyStatement { return value && typeof value === "object" ? value as AnyStatement : {}; }
function list(value: unknown): AnyStatement[] { return Array.isArray(value) ? value.map(object) : []; }
function text(value: unknown, fallback = ""): string { return value === null || value === undefined ? fallback : String(value); }
function cents(value: unknown): number { return Number(value ?? 0); }
function money(value: unknown): string { return `ZAR ${(cents(value) / 100).toFixed(2)}`; }
function csvCell(value: unknown): string { return `"${text(value).replaceAll("\"", "\"\"")}"`; }
function csvRow(values: unknown[]): string { return values.map(csvCell).join(","); }

export function buildStatementCsv(statement: AnyStatement): string {
  const custom = object(statement.customPricedLicences);
  const payout = object(statement.payoutPosition);
  const policy = object(statement.payoutPolicy);
  const payment = object(statement.paymentFlow);
  const performance = object(statement.performance);
  const rows: string[] = [
    csvRow(["VELD ARCHIVE SELLER STATEMENT"]),
    csvRow(["Generated", statement.generatedAt]),
    csvRow(["Currency", statement.currency]),
    csvRow(["Next payout", policy.nextScheduledPayoutDate]),
    csvRow(["Payout policy", `${policy.payoutDayOfMonth}th of each month / ${policy.method}`]),
    csvRow(["Expected lump sum", money(policy.amountExpectedCents)]),
    csvRow([]),
    csvRow(["SUMMARY"]),
    csvRow(["Custom licence purchase total", money(custom.purchaseCents)]),
    csvRow(["Posted contributor royalty", money(custom.royaltyCents)]),
    csvRow(["Paid out", money(payout.paidOutCents)]),
    csvRow(["In flight", money(payout.inFlightCents)]),
    csvRow(["Outstanding", money(payout.outstandingCents)]),
    csvRow(["Subscription royalty status", object(statement.veldSubscriptionRoyalty).status]),
    csvRow([]),
    csvRow(["MEDIA INVENTORY"]),
    csvRow(["Asset ID", "Title", "Media type", "Listing status", "Payment package", "Price"]),
  ];
  for (const item of list(object(statement.mediaInventory).results)) rows.push(csvRow([item.id, item.title, item.kind, item.status, item.monetizationModel, item.licensePriceCents === null ? "Quote" : money(item.licensePriceCents)]));
  rows.push(csvRow([]), csvRow(["PAYMENT STATUS"]), csvRow(["Status", "Transactions", "Amount"]));
  for (const item of list(payment.byStatus)) rows.push(csvRow([item.status, item.transactionCount, money(item.amountCents)]));
  rows.push(csvRow([]), csvRow(["LICENCE PACKAGES"]), csvRow(["Licence type", "Duration days", "Territory", "Transactions", "Purchases", "Royalty", "Refunded"]));
  for (const item of list(payment.packageMix)) rows.push(csvRow([item.licenceType, item.durationDays, item.territory, item.transactionCount, money(item.purchaseCents), money(item.royaltyCents), money(item.refundedCents)]));
  rows.push(csvRow([]), csvRow(["LICENCE TRANSACTIONS"]), csvRow(["Licence ID", "Buyer display name", "Asset", "Media type", "Licence", "Territory", "Purchase", "Royalty", "Refunded", "Status", "Paid at"]));
  for (const item of list(custom.results)) rows.push(csvRow([item.id, item.buyerName, item.assetTitle, item.kind, item.licenceType, item.territory, money(item.purchaseCents), money(item.royaltyCents), money(item.refundedCents), item.status, item.paidAt ?? item.createdAt]));
  rows.push(csvRow([]), csvRow(["PERFORMANCE PROXY / LAST 30 DAYS"]), csvRow(["Asset", "Media type", "Views", "Downloads", "Subscription downloads", "Licences", "Royalty", "Royalty per 1,000 views"]));
  for (const item of list(performance.assets)) rows.push(csvRow([item.title, item.kind, item.views, item.downloads ?? 0, item.subscriptionDownloads ?? 0, item.licenceCount, money(item.royaltyCents), item.royaltyPerThousandViewsCents === null ? "n/a" : money(item.royaltyPerThousandViewsCents)]));
  rows.push(csvRow([]), csvRow(["ROI NOTE", object(performance.summary).roiExplanation ?? "Seller costs are not recorded; royalty yield is a performance proxy, not literal ROI."]));
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

function pdfText(value: unknown): string {
  return text(value).normalize("NFKD").replace(/[^\x20-\x7E]/g, " ").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

class PdfPage {
  commands: string[] = [];
  y = 800;
  text(value: unknown, size = 10, x = 42, color = "0.13 0.18 0.14") {
    if (this.y < 44) return false;
    this.commands.push(`${color} rg BT /F1 ${size} Tf ${x} ${this.y} Td (${pdfText(value)}) Tj ET`);
    this.y -= size + 7;
    return true;
  }
  line() { this.commands.push("0.84 0.83 0.79 RG 0.6 w 42 " + this.y + " m 553 " + this.y + " l S"); this.y -= 12; }
  box(x: number, y: number, width: number, height: number, fill = "0.94 0.95 0.91") { this.commands.push(`${fill} rg ${x} ${y} ${width} ${height} re f`); }
  bar(x: number, y: number, width: number, height: number, fill = "0.48 0.21 0.14") { this.commands.push(`${fill} rg ${x} ${y} ${width} ${height} re f`); }
}

function wrap(value: unknown, width = 90): string[] {
  const source = pdfText(value);
  const words = source.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width && current) { lines.push(current); current = word; } else current = `${current} ${word}`.trim();
  }
  if (current) lines.push(current);
  return lines;
}

export function buildStatementPdf(statement: AnyStatement): Uint8Array {
  const pages: PdfPage[] = [];
  let page = new PdfPage();
  const nextPage = () => { pages.push(page); page = new PdfPage(); };
  const line = (value: unknown, size = 10, x = 42) => { if (!page.text(value, size, x)) { nextPage(); page.text(value, size, x); } };
  const section = (value: string) => { if (page.y < 80) nextPage(); page.y -= 3; line(value, 9, 42); page.line(); };
  const custom = object(statement.customPricedLicences);
  const payout = object(statement.payoutPosition);
  const policy = object(statement.payoutPolicy);
  const payment = object(statement.paymentFlow);
  const performance = object(statement.performance);

  line("VELD ARCHIVE", 10, 42);
  line("Seller royalty statement", 24, 42);
  line(`Generated ${text(statement.generatedAt)}  |  Currency ${text(statement.currency, "ZAR")}`, 9, 42);
  page.box(42, 670, 511, 64);
  page.text("NEXT LUMP-SUM PAYOUT", 8, 56, "0.48 0.21 0.14");
  page.text(`${money(policy.amountExpectedCents)} expected`, 17, 56, "0.13 0.18 0.14");
  page.text(`${text(policy.nextScheduledPayoutDate)} · ${text(policy.timeZone)} · ${text(policy.status).replaceAll("_", " ")}`, 9, 360, "0.31 0.36 0.31");
  page.y = 640;
  section("STATEMENT SUMMARY");
  line(`Custom licence purchases  ${money(custom.purchaseCents)}     Posted royalty  ${money(custom.royaltyCents)}`, 11);
  line(`Paid out  ${money(payout.paidOutCents)}     In flight  ${money(payout.inFlightCents)}     Outstanding  ${money(payout.outstandingCents)}`, 11);
  line(`Policy: ${text(policy.payoutDayOfMonth)}th of each month as one ${text(policy.method)}.`, 9);
  section("PAYMENT FLOW");
  for (const item of list(payment.byStatus)) line(`${text(item.status).padEnd(12)} ${String(item.transactionCount).padStart(4)} transactions    ${money(item.amountCents)}`, 9);
  section("LICENCE PACKAGES");
  line("Package                                      Transactions   Purchases       Royalty", 8);
  for (const item of list(payment.packageMix)) line(`${text(item.licenceType)} · ${text(item.durationDays)} days · ${text(item.territory)}   ${text(item.transactionCount)}              ${money(item.purchaseCents)}   ${money(item.royaltyCents)}`, 8);
  section("PERFORMANCE PROXY · LAST 30 DAYS");
  const performanceSummary = object(performance.summary);
  line(`Views ${text(performanceSummary.views, "0")} · Downloads ${text(performanceSummary.downloads, "0")} · Licensed assets ${text(performanceSummary.licensedAssets, "0")}`, 10);
  line("Royalty yield is shown because seller costs are not recorded; this is not literal ROI.", 8);
  const performanceRows = list(performance.assets).sort((a, b) => cents(b.views) - cents(a.views)).slice(0, 12);
  const maxViews = Math.max(1, ...performanceRows.map((item) => cents(item.views)));
  for (const item of performanceRows) {
    if (page.y < 80) nextPage();
    line(`${text(item.title).slice(0, 40)} · ${text(item.kind)} · ${text(item.views)} views · ${text(item.downloads, "0")} downloads · ${money(item.royaltyCents)}`, 8);
    page.bar(42, page.y + 3, Math.max(2, Math.round((cents(item.views) / maxViews) * 360)), 5, "0.48 0.21 0.14");
    page.y -= 4;
  }
  section("MEDIA INVENTORY");
  line("Title                                      Type       Package                 Price       Status", 8);
  for (const item of list(object(statement.mediaInventory).results)) {
    if (page.y < 65) nextPage();
    line(`${text(item.title).slice(0, 40)}   ${text(item.kind).padEnd(8)} ${text(item.monetizationModel).replaceAll("_", " ").slice(0, 20).padEnd(20)} ${item.licensePriceCents === null ? "Quote" : money(item.licensePriceCents)}   ${text(item.status)}`, 7);
  }
  section("LICENCE TRANSACTIONS");
  for (const item of list(custom.results)) {
    if (page.y < 65) nextPage();
    line(`${text(item.assetTitle).slice(0, 34)} · ${text(item.buyerName).slice(0, 24)} · ${text(item.licenceType)} · ${money(item.purchaseCents)} · ${text(item.status)}`, 7);
  }
  line("Privacy: buyer display names only. Emails, payment credentials, provider references, and bank details are excluded.", 8);
  pages.push(page);

  const encoder = new TextEncoder();
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  const contentObjectIds = pages.map((_, index) => 5 + index * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let index = 0; index < pages.length; index += 1) {
    const content = pages[index].commands.join("\n");
    objects[pageObjectIds[index] - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`;
    objects[contentObjectIds[index] - 1] = `<< /Length ${encoder.encode(content).byteLength} >>\nstream\n${content}\nendstream`;
  }
  let output = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n";
  const offsets: number[] = [0];
  for (let index = 0; index < objects.length; index += 1) { offsets.push(encoder.encode(output).byteLength); output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = encoder.encode(output).byteLength;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return encoder.encode(output);
}
