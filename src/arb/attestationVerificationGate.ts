import type { ArbAttestationEvidence } from "./attestation";
import type {
  PhalaAttestationVerificationSource,
  VerifyPhalaAttestationBySourceResult,
} from "../tee/phala/attestationSource";

export interface AttestationVerificationGatePolicy {
  schemaVersion: "attestation-verification-gate-policy-v1";
  requireSourceVerification: boolean;
  requireVerifiedQuote: boolean;
  allowedSources?: PhalaAttestationVerificationSource[];
  requireAppComposeBindingForAppSource: boolean;
  requireReportDataMatchWhenExpected: boolean;
}

export interface AttestationVerificationGateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface EvaluateAttestationVerificationGateInput {
  policy: AttestationVerificationGatePolicy;
  sourceVerification?: VerifyPhalaAttestationBySourceResult | null;
  arbAttestation?: ArbAttestationEvidence | null;
}

export const evaluateAttestationVerificationGate = (
  input: EvaluateAttestationVerificationGateInput
): AttestationVerificationGateResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { policy, sourceVerification, arbAttestation } = input;

  if (!sourceVerification) {
    if (policy.requireSourceVerification) {
      errors.push("Source attestation verification is required by policy but missing.");
    } else {
      warnings.push("Source attestation verification missing; policy allows bypass.");
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
    };
  }

  if (!sourceVerification.ok) {
    errors.push("Source attestation verification result is not ok.");
  }

  if (policy.allowedSources && policy.allowedSources.length > 0) {
    if (!policy.allowedSources.includes(sourceVerification.source)) {
      errors.push(`Source ${sourceVerification.source} is not allowed by attestation verification policy.`);
    }
  }

  if (policy.requireVerifiedQuote && sourceVerification.checks.quoteVerifiedByPhalaApi !== true) {
    errors.push("Quote must be verified by Phala API.");
  }

  if (
    policy.requireAppComposeBindingForAppSource &&
    sourceVerification.source === "app_http_attestation" &&
    sourceVerification.checks.composeHashMatchesRtmr3Event !== true
  ) {
    errors.push("App source requires compose hash RTMR3 binding, but compose check did not pass.");
  }

  if (
    policy.requireReportDataMatchWhenExpected &&
    sourceVerification.checks.reportDataMatchesExpected === false
  ) {
    errors.push("Expected reportData binding is present but failed.");
  }

  if (arbAttestation && sourceVerification.attestation.quoteFormat) {
    if (arbAttestation.quoteFormat !== sourceVerification.attestation.quoteFormat) {
      errors.push(
        `ARB attestation quote format ${arbAttestation.quoteFormat} does not match source verification quote format ${sourceVerification.attestation.quoteFormat}.`
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
};
