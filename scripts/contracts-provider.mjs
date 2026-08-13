import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Verifier } from "@pact-foundation/pact";

const pactDir = fileURLToPath(new URL("../contracts/pacts/", import.meta.url));
const reportDir = fileURLToPath(new URL("../contracts/reports/", import.meta.url));
const providerBaseUrl = process.env.CONTRACT_PROVIDER_URL ?? "http://127.0.0.1:8787";
const pactFiles = (await readdir(pactDir))
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => `${pactDir}/${name}`);
if (!pactFiles.length) throw new Error(`No Pact JSON found in ${pactDir}. Run a consumer contract test first.`);

for (const pactFile of pactFiles) {
  try {
    await access(pactFile);
  } catch {
    throw new Error(`Consumer pact is not readable at ${pactFile}.`);
  }
}

await mkdir(reportDir, { recursive: true });

try {
  const result = await new Verifier({
    provider: "Veld Archive API",
    providerBaseUrl,
    pactUrls: pactFiles,
    providerVersion: process.env.GITHUB_SHA ?? "local",
    publishVerificationResult: false,
    logLevel: process.env.PACT_LOG_LEVEL ?? "info",
  }).verifyProvider();
  await writeFile(`${reportDir}/provider-verification.txt`, result, "utf8");
  console.log(result);
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("Pact provider verification failed. The Pact mismatch diff is included below:");
  console.error(message);
  process.exitCode = 1;
}
