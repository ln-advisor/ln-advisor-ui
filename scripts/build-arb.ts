import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildArb } from "../src/arb/buildArb";
import type { SourceProvenanceReceipt } from "../src/arb/provenance";
import type { RecommendationSetV1 } from "../src/scoring/scoreNodeState";

const DEFAULT_DEV_SIGNING_KEY = "arb-dev-signing-key-insecure";

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeysDeep(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      sorted[key] = sortObjectKeysDeep(record[key]);
    }
    return sorted;
  }

  return value;
};

async function main(): Promise<void> {
  const recommendationPathArg = process.argv[2];
  const provenancePathArg = process.argv[3];
  const privacyPolicyArg = process.argv[4];

  const recommendationPath = recommendationPathArg
    ? path.resolve(process.cwd(), recommendationPathArg)
    : path.resolve(process.cwd(), "artifacts", "recommendations.v1.json");
  const provenancePath = provenancePathArg
    ? path.resolve(process.cwd(), provenancePathArg)
    : path.resolve(process.cwd(), "artifacts", "source-provenance.json");
  const outputPath = path.resolve(process.cwd(), "artifacts", "recommendation-bundle.arb.json");

  const recommendation = JSON.parse(await readFile(recommendationPath, "utf8")) as RecommendationSetV1;
  const provenance = JSON.parse(await readFile(provenancePath, "utf8")) as SourceProvenanceReceipt;

  const privacyPolicyId = (privacyPolicyArg || process.env.ARB_PRIVACY_POLICY_ID || "feature_only").trim();
  const devSigningKey = (process.env.ARB_DEV_SIGNING_KEY || DEFAULT_DEV_SIGNING_KEY).trim();
  const issuedAtOverride = process.env.ARB_ISSUED_AT?.trim() || new Date().toISOString();
  const ttlSecondsRaw = process.env.ARB_TTL_SECONDS?.trim();
  const ttlSecondsParsed = ttlSecondsRaw ? Number.parseInt(ttlSecondsRaw, 10) : undefined;

  if (devSigningKey === DEFAULT_DEV_SIGNING_KEY) {
    console.warn("Using default insecure dev signing key. Set ARB_DEV_SIGNING_KEY for local hardening.");
  }

  const arb = buildArb({
    recommendation,
    sourceProvenance: provenance,
    privacyPolicyId,
    devSigningKey,
    issuedAt: issuedAtOverride,
    ttlSeconds: Number.isFinite(ttlSecondsParsed) ? ttlSecondsParsed : undefined,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  const deterministicPayload = JSON.stringify(sortObjectKeysDeep(arb), null, 2);
  await writeFile(outputPath, `${deterministicPayload}\n`, "utf8");

  console.log(`Recommendations: ${recommendationPath}`);
  console.log(`Provenance: ${provenancePath}`);
  console.log(`Saved ARB: ${outputPath}`);
  console.log(`ARB modelVersion: ${arb.modelVersion}`);
  console.log(`ARB signature algorithm: ${arb.signature.algorithm}`);
}

main().catch((error) => {
  console.error("Failed to build ARB.", error);
  process.exitCode = 1;
});
