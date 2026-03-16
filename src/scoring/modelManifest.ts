import { createHash } from "node:crypto";

export type ModelPinningMode = "exact_manifest_pinned" | "service_pinned_private_model";

export interface PinnedModelManifest {
  schemaVersion: "pinned-model-manifest-v1";
  modelId: "ln-advisor-fee-forward";
  modelVersion: "fee-forward-v1";
  modelPinningMode: ModelPinningMode;
  sourceSchemaVersion: "privacy-node-state-v1";
  recommendedPrivacyPolicyId: "feature_only";
  preprocessing: {
    normalizerId: "normalize-snapshot-v1";
    privacyTransformId: "apply-privacy-policy-v1";
    scoringInputPrivacyMode: "feature_only";
  };
  postprocessing: {
    recommendationType: "fee_forward";
    deterministic: true;
  };
  execution: {
    runtimeClass: "node-deterministic-rules" | "remote-private-model-service";
    environmentId: string;
    serviceLocator?: string;
    serviceIdentity?: string;
  };
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeysDeep(item));
  }
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

export const canonicalJson = (value: unknown): string => JSON.stringify(sortObjectKeysDeep(value));

export const hashCanonicalJson = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

export const buildPinnedModelManifest = (
  overrides?: Partial<PinnedModelManifest["execution"]> & {
    modelPinningMode?: ModelPinningMode;
  }
): PinnedModelManifest => ({
  schemaVersion: "pinned-model-manifest-v1",
  modelId: "ln-advisor-fee-forward",
  modelVersion: "fee-forward-v1",
  modelPinningMode: overrides?.modelPinningMode || "exact_manifest_pinned",
  sourceSchemaVersion: "privacy-node-state-v1",
  recommendedPrivacyPolicyId: "feature_only",
  preprocessing: {
    normalizerId: "normalize-snapshot-v1",
    privacyTransformId: "apply-privacy-policy-v1",
    scoringInputPrivacyMode: "feature_only",
  },
  postprocessing: {
    recommendationType: "fee_forward",
    deterministic: true,
  },
  execution: {
    runtimeClass: overrides?.runtimeClass || "node-deterministic-rules",
    environmentId: overrides?.environmentId?.trim() || "ln-advisor-local-rules-runtime-v1",
    ...(overrides?.serviceLocator?.trim() ? { serviceLocator: overrides.serviceLocator.trim() } : {}),
    ...(overrides?.serviceIdentity?.trim() ? { serviceIdentity: overrides.serviceIdentity.trim() } : {}),
  },
});

export const buildPrivateModelServiceManifest = (
  overrides?: Partial<PinnedModelManifest["execution"]>
): PinnedModelManifest =>
  buildPinnedModelManifest({
    modelPinningMode: "service_pinned_private_model",
    runtimeClass: "remote-private-model-service",
    environmentId: overrides?.environmentId?.trim() || "ln-advisor-phala-props-service-v1",
    serviceLocator: overrides?.serviceLocator?.trim() || "phala://ln-advisor-props-api",
    serviceIdentity: overrides?.serviceIdentity?.trim() || "phala-props-service-identity-v1",
  });

export const getPinnedModelManifestHash = (manifest: PinnedModelManifest): string =>
  hashCanonicalJson(manifest);

export const DEFAULT_PINNED_MODEL_MANIFEST: PinnedModelManifest = buildPinnedModelManifest();
