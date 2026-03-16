import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPrivacyPolicy } from "../privacy/applyPrivacyPolicy";
import type { NormalizedNodeState } from "../normalization/types";

export type RetentionMode = "none" | "feature_only_opt_in" | "banded_opt_in";

export interface RetentionSummary {
  schemaVersion: "api-retention-summary-v1";
  mode: RetentionMode;
  retained: boolean;
  retentionClass: "none" | "feature_only" | "banded";
  artifactPath: string | null;
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

const writeJsonDeterministic = async (outputPath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const payload = `${JSON.stringify(sortObjectKeysDeep(value), null, 2)}\n`;
  await writeFile(outputPath, payload, "utf8");
};

export const resolveRetentionMode = (value: unknown): RetentionMode => {
  if (typeof value !== "string") return "none";
  const normalized = value.trim().toLowerCase();
  if (normalized === "feature_only_opt_in") return "feature_only_opt_in";
  if (normalized === "banded_opt_in") return "banded_opt_in";
  return "none";
};

export const applyRetentionPolicy = async (input: {
  normalizedSnapshot: NormalizedNodeState;
  retentionMode: RetentionMode;
}): Promise<RetentionSummary> => {
  if (input.retentionMode === "none") {
    return {
      schemaVersion: "api-retention-summary-v1",
      mode: "none",
      retained: false,
      retentionClass: "none",
      artifactPath: null,
    };
  }

  if (input.retentionMode === "feature_only_opt_in") {
    const featureOnly = applyPrivacyPolicy(input.normalizedSnapshot, "feature_only");
    const artifactPath = path.resolve(process.cwd(), "artifacts", "retention", "node-state.feature-only.retained.json");
    await writeJsonDeterministic(artifactPath, featureOnly);
    return {
      schemaVersion: "api-retention-summary-v1",
      mode: "feature_only_opt_in",
      retained: true,
      retentionClass: "feature_only",
      artifactPath,
    };
  }

  const banded = applyPrivacyPolicy(input.normalizedSnapshot, "banded");
  const artifactPath = path.resolve(process.cwd(), "artifacts", "retention", "node-state.banded.retained.json");
  await writeJsonDeterministic(artifactPath, banded);
  return {
    schemaVersion: "api-retention-summary-v1",
    mode: "banded_opt_in",
    retained: true,
    retentionClass: "banded",
    artifactPath,
  };
};
