import { createHash } from "node:crypto";
import type { ArbBundle } from "./buildArb";
import type { EnclaveExecutionMode } from "./attestation";
import type { SourceProvenanceReceipt } from "./provenance";

export interface AttestationPolicy {
  schemaVersion: "attestation-policy-v1";
  minExecutionMode: EnclaveExecutionMode;
  requireAttestation: boolean;
  allowedProviderIds?: string[];
}

export interface AttestationPolicyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
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

const canonicalJson = (value: unknown): string => JSON.stringify(sortObjectKeysDeep(value));

const sha256Hex = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

const modeRank = (mode: EnclaveExecutionMode): number => {
  if (mode === "local_dev") return 0;
  if (mode === "tee_simulated") return 1;
  return 2;
};

const expectedProvenanceMode = (
  mode: EnclaveExecutionMode
): SourceProvenanceReceipt["executionContext"]["executionMode"] => {
  if (mode === "tee_verified") return "tee_verified";
  if (mode === "tee_simulated") return "tee_candidate";
  return "host_local";
};

export function evaluateArbAttestationPolicy(input: {
  arb: ArbBundle;
  sourceProvenance?: SourceProvenanceReceipt;
  policy: AttestationPolicy;
}): AttestationPolicyResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { arb, sourceProvenance, policy } = input;
  const attestation = arb.attestation;
  const needsAttestation = policy.requireAttestation || modeRank(policy.minExecutionMode) > 0;

  if (!attestation) {
    if (needsAttestation) {
      errors.push("Attestation evidence is required by policy but missing from ARB.");
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  if (modeRank(attestation.executionMode) < modeRank(policy.minExecutionMode)) {
    errors.push(
      `Attestation execution mode ${attestation.executionMode} does not satisfy policy minimum ${policy.minExecutionMode}.`
    );
  }

  if (policy.allowedProviderIds && policy.allowedProviderIds.length > 0) {
    if (!policy.allowedProviderIds.includes(attestation.providerId)) {
      errors.push(`Attestation provider ${attestation.providerId} is not allowed by policy.`);
    }
  }

  const expectedQuoteHash = sha256Hex({ quote: attestation.quote });
  if (expectedQuoteHash !== attestation.quoteHash) {
    errors.push("Attestation quoteHash mismatch.");
  }

  if (!sourceProvenance) {
    warnings.push("Source provenance not provided for attestation policy linkage checks.");
    return { ok: errors.length === 0, errors, warnings };
  }

  if (sourceProvenance.executionContext.enclaveProviderId !== attestation.providerId) {
    errors.push("Provenance executionContext.enclaveProviderId does not match attestation.providerId.");
  }

  const requiredProvenanceMode = expectedProvenanceMode(attestation.executionMode);
  if (sourceProvenance.executionContext.executionMode !== requiredProvenanceMode) {
    errors.push(
      `Provenance execution mode ${sourceProvenance.executionContext.executionMode} does not match expected mode ${requiredProvenanceMode}.`
    );
  }

  const expectedAttestationHash = sha256Hex(attestation);
  if (sourceProvenance.executionContext.attestationHash !== expectedAttestationHash) {
    errors.push("Provenance executionContext.attestationHash mismatch.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
