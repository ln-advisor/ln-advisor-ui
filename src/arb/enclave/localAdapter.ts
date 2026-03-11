import { createHash } from "node:crypto";
import type { LightningSnapshot } from "../../connectors/types";
import { normalizeSnapshot } from "../../normalization/normalizeSnapshot";
import type { NormalizedNodeState } from "../../normalization/types";
import { applyPrivacyPolicy, type PrivacyMode, type PrivacyTransformedNodeState } from "../../privacy/applyPrivacyPolicy";
import { scoreNodeState, type RecommendationSetV1 } from "../../scoring/scoreNodeState";
import { buildArb, type ArbBundle } from "../buildArb";
import type { ArbAttestationEvidence } from "../attestation";
import type { SourceProvenanceReceipt } from "../provenance";

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

const canonicalJson = (value: unknown): string => JSON.stringify(sortObjectKeysDeep(value));

const sha256Hex = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

export interface NormalizeInBoundaryInput {
  rawSnapshot: LightningSnapshot;
}

export interface NormalizeInBoundaryOutput {
  schemaVersion: "enclave-module-output-v1";
  moduleId: "normalize_snapshot";
  normalizedSnapshot: NormalizedNodeState;
  normalizedSnapshotHash: string;
}

export interface PrivacyTransformBoundaryInput {
  normalizedSnapshot: NormalizedNodeState;
  privacyMode: PrivacyMode;
}

export interface PrivacyTransformBoundaryOutput {
  schemaVersion: "enclave-module-output-v1";
  moduleId: "privacy_transform";
  privacyMode: PrivacyMode;
  privacyTransformedNodeState: PrivacyTransformedNodeState;
  privacyOutputHash: string;
}

export interface ScoreBoundaryInput {
  modelInput: NormalizedNodeState | PrivacyTransformedNodeState;
  metadata?: {
    nodePubkey?: string;
    nodeAlias?: string;
    collectedAt?: string;
  };
}

export interface ScoreBoundaryOutput {
  schemaVersion: "enclave-module-output-v1";
  moduleId: "score_node_state";
  recommendation: RecommendationSetV1;
  recommendationHash: string;
  modelVersion: string;
}

export interface SignArbBoundaryInput {
  recommendation: RecommendationSetV1;
  sourceProvenance: SourceProvenanceReceipt;
  privacyPolicyId: string;
  devSigningKey: string;
  attestation?: ArbAttestationEvidence;
  issuedAt?: string;
  ttlSeconds?: number;
}

export interface SignArbBoundaryOutput {
  schemaVersion: "enclave-module-output-v1";
  moduleId: "arb_signer";
  arb: ArbBundle;
  arbHash: string;
  signatureDigest: string;
}

export interface EnclaveBoundaryAdapter {
  normalizeSnapshot(input: NormalizeInBoundaryInput): Promise<NormalizeInBoundaryOutput>;
  applyPrivacyTransform(input: PrivacyTransformBoundaryInput): Promise<PrivacyTransformBoundaryOutput>;
  scoreNodeState(input: ScoreBoundaryInput): Promise<ScoreBoundaryOutput>;
  signArb(input: SignArbBoundaryInput): Promise<SignArbBoundaryOutput>;
}

export class LocalEnclaveBoundaryAdapter implements EnclaveBoundaryAdapter {
  async normalizeSnapshot(input: NormalizeInBoundaryInput): Promise<NormalizeInBoundaryOutput> {
    const normalizedSnapshot = normalizeSnapshot(input.rawSnapshot);
    return {
      schemaVersion: "enclave-module-output-v1",
      moduleId: "normalize_snapshot",
      normalizedSnapshot,
      normalizedSnapshotHash: sha256Hex(normalizedSnapshot),
    };
  }

  async applyPrivacyTransform(
    input: PrivacyTransformBoundaryInput
  ): Promise<PrivacyTransformBoundaryOutput> {
    const privacyTransformedNodeState = applyPrivacyPolicy(input.normalizedSnapshot, input.privacyMode);
    return {
      schemaVersion: "enclave-module-output-v1",
      moduleId: "privacy_transform",
      privacyMode: input.privacyMode,
      privacyTransformedNodeState,
      privacyOutputHash: sha256Hex(privacyTransformedNodeState),
    };
  }

  async scoreNodeState(input: ScoreBoundaryInput): Promise<ScoreBoundaryOutput> {
    const recommendation = scoreNodeState(input.modelInput as any, input.metadata);
    return {
      schemaVersion: "enclave-module-output-v1",
      moduleId: "score_node_state",
      recommendation,
      recommendationHash: sha256Hex(recommendation),
      modelVersion: recommendation.modelVersion,
    };
  }

  async signArb(input: SignArbBoundaryInput): Promise<SignArbBoundaryOutput> {
    const arb = buildArb({
      recommendation: input.recommendation,
      sourceProvenance: input.sourceProvenance,
      privacyPolicyId: input.privacyPolicyId,
      devSigningKey: input.devSigningKey,
      attestation: input.attestation,
      issuedAt: input.issuedAt,
      ttlSeconds: input.ttlSeconds,
    });

    return {
      schemaVersion: "enclave-module-output-v1",
      moduleId: "arb_signer",
      arb,
      arbHash: sha256Hex(arb),
      signatureDigest: arb.signature.digest,
    };
  }
}

export const localEnclaveBoundaryAdapter: EnclaveBoundaryAdapter = new LocalEnclaveBoundaryAdapter();
