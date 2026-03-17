import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPrivacyPolicy, type BandedNodeState } from "../src/privacy/applyPrivacyPolicy";
import type { NormalizedNodeState } from "../src/normalization/types";

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

const assert = (condition: unknown, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const DISALLOWED_BANDED_KEYS = new Set<string>([
  "channelId",
  "remotePubkey",
  "nodePubkey",
  "peerPubkey",
  "capacitySat",
  "localBalanceSat",
  "remoteBalanceSat",
  "totalCapacitySat",
  "totalLocalBalanceSat",
  "totalRemoteBalanceSat",
  "localBalanceRatio",
  "remoteBalanceRatio",
  "avgLocalBalanceRatio",
  "avgRemoteBalanceRatio",
]);

const validateNoSensitiveKeysInBanded = (value: unknown, pathParts: string[] = []): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoSensitiveKeysInBanded(item, [...pathParts, `[${index}]`]));
    return;
  }

  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (DISALLOWED_BANDED_KEYS.has(key)) {
      throw new Error(`Banded output contains disallowed sensitive key: ${[...pathParts, key].join(".")}`);
    }
    validateNoSensitiveKeysInBanded(record[key], [...pathParts, key]);
  }
};

const validateBandValues = (banded: BandedNodeState): void => {
  const allowed = new Set(["LOW", "MEDIUM", "HIGH"]);
  for (const channel of banded.channels) {
    assert(allowed.has(channel.liquidityBand), "Invalid liquidityBand value in banded channel output.");
    assert(
      allowed.has(channel.channelPerformanceBand),
      "Invalid channelPerformanceBand value in banded channel output."
    );
    assert(
      allowed.has(channel.feeCompetitivenessBand),
      "Invalid feeCompetitivenessBand value in banded channel output."
    );
  }
};

async function main(): Promise<void> {
  const inputPathArg = process.argv[2];
  const inputPath = inputPathArg
    ? path.resolve(process.cwd(), inputPathArg)
    : path.resolve(process.cwd(), "artifacts", "lightning-snapshot.normalized.json");
  const featureOnlyOutputPath = path.resolve(process.cwd(), "artifacts", "node-state.feature-only.json");
  const bandedOutputPath = path.resolve(process.cwd(), "artifacts", "node-state.banded.json");

  const normalized = JSON.parse(await readFile(inputPath, "utf8")) as NormalizedNodeState;

  const fullInternal = applyPrivacyPolicy(normalized, "full_internal");
  const featureOnly = applyPrivacyPolicy(normalized, "feature_only");
  const banded = applyPrivacyPolicy(normalized, "banded");

  assert(fullInternal.privacyMode === "full_internal", "full_internal mode returned unexpected privacyMode.");
  assert(featureOnly.privacyMode === "feature_only", "feature_only mode returned unexpected privacyMode.");
  assert(banded.privacyMode === "banded", "banded mode returned unexpected privacyMode.");
  assert(
    featureOnly.channels.length === normalized.channels.length,
    "feature_only output channel count does not match normalized input."
  );
  assert(
    banded.channels.length === normalized.channels.length,
    "banded output channel count does not match normalized input."
  );
  validateBandValues(banded);
  validateNoSensitiveKeysInBanded(banded);

  await mkdir(path.resolve(process.cwd(), "artifacts"), { recursive: true });
  await writeFile(
    featureOnlyOutputPath,
    `${JSON.stringify(sortObjectKeysDeep(featureOnly), null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    bandedOutputPath,
    `${JSON.stringify(sortObjectKeysDeep(banded), null, 2)}\n`,
    "utf8"
  );

  console.log(`Input normalized snapshot: ${inputPath}`);
  console.log(`Saved feature-only node state: ${featureOnlyOutputPath}`);
  console.log(`Saved banded node state: ${bandedOutputPath}`);
  console.log("Privacy mode validation passed for full_internal, feature_only, and banded.");
}

main().catch((error) => {
  console.error("Privacy Modes test failed.", error);
  process.exitCode = 1;
});

