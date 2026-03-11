import type { ArbAttestationEvidence, EnclaveExecutionMode } from "./attestation";

export interface KeyReleasePolicy {
  schemaVersion: "key-release-policy-v1";
  keyId: string;
  minExecutionMode: EnclaveExecutionMode;
  requireAttestation: boolean;
  allowedProviderIds?: string[];
  allowedMeasurements?: string[];
  allowedQuoteFormats?: Array<ArbAttestationEvidence["quoteFormat"]>;
}

export interface KeyReleaseDecision {
  ok: boolean;
  errors: string[];
  warnings: string[];
  keyId: string | null;
}

const modeRank = (mode: EnclaveExecutionMode): number => {
  if (mode === "local_dev") return 0;
  if (mode === "tee_simulated") return 1;
  return 2;
};

export function evaluateKeyReleasePolicy(input: {
  policy: KeyReleasePolicy;
  attestation?: ArbAttestationEvidence | null;
}): KeyReleaseDecision {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { policy, attestation } = input;

  if (!attestation) {
    if (policy.requireAttestation || modeRank(policy.minExecutionMode) > 0) {
      errors.push("Attestation evidence is required for key release but missing.");
    } else {
      warnings.push("Key release granted without attestation due to policy configuration.");
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      keyId: errors.length === 0 ? policy.keyId : null,
    };
  }

  if (modeRank(attestation.executionMode) < modeRank(policy.minExecutionMode)) {
    errors.push(
      `Execution mode ${attestation.executionMode} does not satisfy minimum ${policy.minExecutionMode} for key release.`
    );
  }

  if (policy.allowedProviderIds && policy.allowedProviderIds.length > 0) {
    if (!policy.allowedProviderIds.includes(attestation.providerId)) {
      errors.push(`Provider ${attestation.providerId} is not allowed for key release.`);
    }
  }

  if (policy.allowedMeasurements && policy.allowedMeasurements.length > 0) {
    if (!policy.allowedMeasurements.includes(attestation.measurement)) {
      errors.push("Attestation measurement is not allowed for key release.");
    }
  }

  if (policy.allowedQuoteFormats && policy.allowedQuoteFormats.length > 0) {
    if (!policy.allowedQuoteFormats.includes(attestation.quoteFormat)) {
      errors.push(`Quote format ${attestation.quoteFormat} is not allowed for key release.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    keyId: errors.length === 0 ? policy.keyId : null,
  };
}
