import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourceProvenanceReceipt } from "../arb/provenance";
import type { RetentionSummary } from "./retention";

export interface TrainingContributionReceipt {
  schemaVersion: "training-contribution-receipt-v1";
  contributedAt: string;
  consentMode: string;
  retentionClass: string;
  privacyMode: string;
  featurePayloadHash: string;
  sourceProvenanceHash: string;
  modelManifestHash: string;
  sourceType: string;
  artifactPath: string;
  receiptPath: string;
}

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
const sha256Hex = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

export const createTrainingContributionReceipt = async (input: {
  retention: RetentionSummary;
  sourceProvenance: SourceProvenanceReceipt;
  modelManifestHash: string;
  contributedAt?: string;
}): Promise<TrainingContributionReceipt | null> => {
  if (!input.retention.retained || !input.retention.artifactPath) {
    return null;
  }

  const artifactPath = path.resolve(input.retention.artifactPath);
  const payload = JSON.parse(await readFile(artifactPath, "utf8")) as Record<string, unknown>;
  const privacyMode = String(payload.privacyMode || "").trim();
  if (!privacyMode) {
    throw new Error("Retained contribution artifact is missing privacyMode.");
  }

  const sourceProvenanceHash = sha256Hex(input.sourceProvenance);
  const featurePayloadHash = sha256Hex(payload);
  const receiptPath = path.resolve(
    process.cwd(),
    "artifacts",
    "retention",
    `training-contribution.${privacyMode}.receipt.json`
  );

  const receipt: TrainingContributionReceipt = {
    schemaVersion: "training-contribution-receipt-v1",
    contributedAt: input.contributedAt || input.sourceProvenance.snapshotTimestamp,
    consentMode: input.retention.mode,
    retentionClass: input.retention.retentionClass,
    privacyMode,
    featurePayloadHash,
    sourceProvenanceHash,
    modelManifestHash: input.modelManifestHash,
    sourceType: input.sourceProvenance.sourceType,
    artifactPath,
    receiptPath,
  };

  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(sortObjectKeysDeep(receipt), null, 2)}\n`, "utf8");
  return receipt;
};
