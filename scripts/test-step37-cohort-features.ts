import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { normalizeSnapshot } from "../src/normalization/normalizeSnapshot";
import { applyPrivacyPolicy } from "../src/privacy/applyPrivacyPolicy";
import { buildCohortFeatures } from "../src/scoring/cohortFeatures";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step37.cohort-features.json");

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => sortObjectKeysDeep(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(compareText)) {
      sorted[key] = sortObjectKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
};

const canonicalJson = (value: unknown): string => JSON.stringify(sortObjectKeysDeep(value));
const stableJson = (value: unknown): string => `${JSON.stringify(sortObjectKeysDeep(value), null, 2)}\n`;

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

async function main(): Promise<void> {
  const normalized = normalizeSnapshot(getMockLightningSnapshot());
  const featureOnly = applyPrivacyPolicy(normalized, "feature_only");
  const first = buildCohortFeatures(featureOnly);
  const second = buildCohortFeatures(featureOnly);

  const deterministic = canonicalJson(first) === canonicalJson(second);
  assert(deterministic, "Step37 failed: cohort feature export is not deterministic.");
  assert(first.derivedFromPrivacyMode === "feature_only", "Step37 failed: derivedFromPrivacyMode mismatch.");
  assert(first.channels.length === featureOnly.channels.length, "Step37 failed: channel count mismatch.");
  assert(first.peers.length === featureOnly.peers.length, "Step37 failed: peer count mismatch.");

  const serialized = stableJson(first);
  assert(!serialized.includes("\"outboundFeePpm\""), "Step37 failed: cohort export leaked exact outboundFeePpm.");
  assert(!serialized.includes("\"revenueSat\""), "Step37 failed: cohort export leaked exact revenueSat.");
  assert(!serialized.includes("\"localBalanceRatio\""), "Step37 failed: cohort export leaked exact localBalanceRatio.");
  assert(serialized.includes("\"channelRef\""), "Step37 failed: cohort export should retain channelRef.");
  assert(serialized.includes("\"peerRef\""), "Step37 failed: cohort export should retain peerRef.");

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, serialized, "utf8");
  const reread = await readFile(ARTIFACT_PATH, "utf8");
  assert(reread === serialized, "Step37 failed: saved artifact did not match generated payload.");

  console.log(`Saved Step 37 artifact: ${ARTIFACT_PATH}`);
  console.log(`Deterministic export: ${deterministic}`);
  console.log(`Channels exported: ${first.channels.length}`);
  console.log(`Peers exported: ${first.peers.length}`);
  console.log("Step 37 cohort features test: PASS");
}

main().catch((error) => {
  console.error("Step 37 cohort features test failed.", error);
  process.exitCode = 1;
});
