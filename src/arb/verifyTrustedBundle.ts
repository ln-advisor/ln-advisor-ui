import type { AttestationPolicy, AttestationPolicyResult } from "./attestationPolicy";
import { evaluateArbAttestationPolicy } from "./attestationPolicy";
import type { VerifyArbOptions, VerifyArbResult } from "./verifyArb";
import { verifyArb } from "./verifyArb";
import type { VerifySourceVerificationBindingResult } from "./verifySourceVerificationBinding";
import { verifySourceVerificationBinding } from "./verifySourceVerificationBinding";
import type { VerifyPhalaAttestationBySourceResult } from "../tee/phala";

export interface VerifyTrustedBundleOptions extends VerifyArbOptions {
  sourceVerificationResult?: VerifyPhalaAttestationBySourceResult | null;
  attestationPolicy?: AttestationPolicy;
  requireSourceVerification?: boolean;
  requireSourceVerificationOk?: boolean;
}

export interface VerifyTrustedBundleResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checks: {
    arb: VerifyArbResult;
    attestationPolicy: {
      applied: boolean;
      result: AttestationPolicyResult | null;
    };
    sourceBinding: {
      applied: boolean;
      result: VerifySourceVerificationBindingResult | null;
    };
  };
}

export const verifyTrustedBundle = (
  options: VerifyTrustedBundleOptions
): VerifyTrustedBundleResult => {
  const arbResult = verifyArb(options);
  const errors = [...arbResult.errors];
  const warnings = [...arbResult.warnings];

  const attestationPolicyResult = options.attestationPolicy
    ? evaluateArbAttestationPolicy({
        arb: options.arb,
        sourceProvenance: options.sourceProvenance,
        policy: options.attestationPolicy,
      })
    : null;

  if (attestationPolicyResult) {
    errors.push(...attestationPolicyResult.errors);
    warnings.push(...attestationPolicyResult.warnings);
  }

  const sourceBindingApplied =
    options.requireSourceVerification === true ||
    options.requireSourceVerificationOk === true ||
    Boolean(options.sourceVerificationResult);

  const sourceBindingResult =
    sourceBindingApplied && options.sourceProvenance
      ? verifySourceVerificationBinding({
          sourceProvenance: options.sourceProvenance,
          sourceVerificationResult: options.sourceVerificationResult,
          requireSourceVerification: options.requireSourceVerification,
          requireSourceVerificationOk: options.requireSourceVerificationOk,
        })
      : sourceBindingApplied
        ? {
            ok: false,
            errors: ["Source provenance is required for source verification binding checks."],
            warnings: [],
          }
        : null;

  if (sourceBindingResult) {
    errors.push(...sourceBindingResult.errors);
    warnings.push(...sourceBindingResult.warnings);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checks: {
      arb: arbResult,
      attestationPolicy: {
        applied: Boolean(options.attestationPolicy),
        result: attestationPolicyResult,
      },
      sourceBinding: {
        applied: sourceBindingApplied,
        result: sourceBindingResult,
      },
    },
  };
};
