import type { LightningSnapshot } from "../../connectors/types";
import { generateSourceProvenanceReceipt, type SourceProvenanceReceipt } from "../provenance";
import type { PrivacyMode, PrivacyTransformedNodeState } from "../../privacy/applyPrivacyPolicy";
import type { NormalizedNodeState } from "../../normalization/types";
import type { RecommendationSetV1 } from "../../scoring/scoreNodeState";
import type { ArbBundle } from "../buildArb";
import { createHash } from "node:crypto";
import { evaluateKeyReleasePolicy, type KeyReleasePolicy } from "../keyReleasePolicy";
import {
  localEnclaveBoundaryAdapter,
  type EnclaveBoundaryAdapter,
  type NormalizeInBoundaryOutput,
  type PrivacyTransformBoundaryOutput,
  type ScoreBoundaryOutput,
  type SignArbBoundaryOutput,
} from "./localAdapter";
import { localDevEnclaveProvider, type EnclaveProvider } from "./provider";

export interface EnclavePipelineOptions {
  rawSnapshot: LightningSnapshot;
  privacyMode: PrivacyMode;
  devSigningKey: string;
  keyReleasePolicy?: KeyReleasePolicy;
  sourceProvenance?: SourceProvenanceReceipt;
  enclaveProvider?: EnclaveProvider;
  issuedAt?: string;
  ttlSeconds?: number;
  adapter?: EnclaveBoundaryAdapter;
}

export interface EnclavePipelineRunSummary {
  schemaVersion: "enclave-pipeline-run-summary-v1";
  moduleOrder: ["normalize_snapshot", "privacy_transform", "score_node_state", "arb_signer"];
  attestation: {
    providerId: string;
    executionMode: string;
    quoteHash: string;
    nonce: string;
  };
  keyRelease: {
    policyApplied: boolean;
    granted: boolean;
    keyId: string | null;
    errors: string[];
  };
  normalize: Pick<NormalizeInBoundaryOutput, "moduleId" | "normalizedSnapshotHash">;
  privacy: Pick<PrivacyTransformBoundaryOutput, "moduleId" | "privacyMode" | "privacyOutputHash">;
  score: Pick<ScoreBoundaryOutput, "moduleId" | "recommendationHash" | "modelVersion">;
  sign: Pick<SignArbBoundaryOutput, "moduleId" | "arbHash" | "signatureDigest">;
}

export interface EnclavePipelineResult {
  schemaVersion: "enclave-pipeline-result-v1";
  sourceProvenance: SourceProvenanceReceipt;
  normalizedSnapshot: NormalizedNodeState;
  privacyTransformedNodeState: PrivacyTransformedNodeState;
  recommendation: RecommendationSetV1;
  arb: ArbBundle;
  runSummary: EnclavePipelineRunSummary;
}

export async function runEnclaveBoundaryPipeline(
  options: EnclavePipelineOptions
): Promise<EnclavePipelineResult> {
  const adapter = options.adapter ?? localEnclaveBoundaryAdapter;
  const provider = options.enclaveProvider ?? localDevEnclaveProvider;

  const normalize = await adapter.normalizeSnapshot({
    rawSnapshot: options.rawSnapshot,
  });

  const privacy = await adapter.applyPrivacyTransform({
    normalizedSnapshot: normalize.normalizedSnapshot,
    privacyMode: options.privacyMode,
  });

  const modelPrivacyInput =
    options.privacyMode === "feature_only"
      ? privacy
      : await adapter.applyPrivacyTransform({
          normalizedSnapshot: normalize.normalizedSnapshot,
          privacyMode: "feature_only",
        });

  const score = await adapter.scoreNodeState({
    modelInput: modelPrivacyInput.privacyTransformedNodeState,
    metadata: {
      nodePubkey: normalize.normalizedSnapshot.nodePubkey,
      nodeAlias: normalize.normalizedSnapshot.nodeAlias,
      collectedAt: normalize.normalizedSnapshot.collectedAt,
    },
  });

  const issuedAt = options.issuedAt || score.recommendation.collectedAt;
  const nonce = createHash("sha256")
    .update(
      JSON.stringify({
        rawSnapshotHashSeed: normalize.normalizedSnapshotHash,
        recommendationHash: score.recommendationHash,
        privacyMode: options.privacyMode,
      })
    )
    .digest("hex");

  const attestation = await provider.attest({
    issuedAt,
    nonce,
    inputHash: modelPrivacyInput.privacyOutputHash,
    outputHash: score.recommendationHash,
    moduleOrder: ["normalize_snapshot", "privacy_transform", "score_node_state", "arb_signer"],
  });

  const keyReleaseDecision = options.keyReleasePolicy
    ? evaluateKeyReleasePolicy({
        policy: options.keyReleasePolicy,
        attestation,
      })
    : {
        ok: true,
        errors: [] as string[],
        warnings: [] as string[],
        keyId: null as string | null,
      };

  if (!keyReleaseDecision.ok) {
    throw new Error(`Key release denied: ${keyReleaseDecision.errors.join(" | ")}`);
  }

  const sourceProvenance =
    options.sourceProvenance ??
    generateSourceProvenanceReceipt(options.rawSnapshot, normalize.normalizedSnapshot, {
      executionMode:
        attestation.executionMode === "tee_verified"
          ? "tee_verified"
          : attestation.executionMode === "tee_simulated"
            ? "tee_candidate"
            : "host_local",
      enclaveProviderId: attestation.providerId,
      attestation,
      privacyTransformedSnapshot: modelPrivacyInput.privacyTransformedNodeState,
    });

  const sign = await adapter.signArb({
    recommendation: score.recommendation,
    sourceProvenance,
    privacyPolicyId: options.privacyMode,
    devSigningKey: options.devSigningKey,
    attestation,
    issuedAt: options.issuedAt,
    ttlSeconds: options.ttlSeconds,
  });

  return {
    schemaVersion: "enclave-pipeline-result-v1",
    sourceProvenance,
    normalizedSnapshot: normalize.normalizedSnapshot,
    privacyTransformedNodeState: privacy.privacyTransformedNodeState,
    recommendation: score.recommendation,
    arb: sign.arb,
    runSummary: {
      schemaVersion: "enclave-pipeline-run-summary-v1",
      moduleOrder: ["normalize_snapshot", "privacy_transform", "score_node_state", "arb_signer"],
      attestation: {
        providerId: attestation.providerId,
        executionMode: attestation.executionMode,
        quoteHash: attestation.quoteHash,
        nonce: attestation.nonce,
      },
      keyRelease: {
        policyApplied: Boolean(options.keyReleasePolicy),
        granted: keyReleaseDecision.ok,
        keyId: keyReleaseDecision.keyId,
        errors: keyReleaseDecision.errors,
      },
      normalize: {
        moduleId: normalize.moduleId,
        normalizedSnapshotHash: normalize.normalizedSnapshotHash,
      },
      privacy: {
        moduleId: privacy.moduleId,
        privacyMode: privacy.privacyMode,
        privacyOutputHash: privacy.privacyOutputHash,
      },
      score: {
        moduleId: score.moduleId,
        recommendationHash: score.recommendationHash,
        modelVersion: score.modelVersion,
      },
      sign: {
        moduleId: sign.moduleId,
        arbHash: sign.arbHash,
        signatureDigest: sign.signatureDigest,
      },
    },
  };
}
