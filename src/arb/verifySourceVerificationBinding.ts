import { createHash } from "node:crypto";
import type { SourceProvenanceReceipt } from "./provenance";
import type { VerifyPhalaAttestationBySourceResult } from "../tee/phala/attestationSource";

export interface VerifySourceVerificationBindingOptions {
  sourceProvenance: SourceProvenanceReceipt;
  sourceVerificationResult?: VerifyPhalaAttestationBySourceResult | null;
  requireSourceVerification?: boolean;
  requireSourceVerificationOk?: boolean;
}

export interface VerifySourceVerificationBindingResult {
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
const canonicalHash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

export function verifySourceVerificationBinding(
  options: VerifySourceVerificationBindingOptions
): VerifySourceVerificationBindingResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const requireSourceVerification = options.requireSourceVerification ?? false;
  const requireSourceVerificationOk = options.requireSourceVerificationOk ?? true;
  const ctx = options.sourceProvenance.executionContext;
  const sourceHash = ctx.sourceVerificationHash;
  const sourceKind = ctx.sourceVerificationSource;
  const provided = options.sourceVerificationResult;

  if ((sourceHash && !sourceKind) || (sourceKind && !sourceHash)) {
    errors.push(
      "sourceProvenance.executionContext source verification fields are inconsistent: source/hash must both be set or both be null."
    );
  }

  if (!provided) {
    if (requireSourceVerification) {
      errors.push("Source verification result is required but was not provided.");
    } else if (sourceHash || sourceKind) {
      warnings.push(
        "Provenance contains source verification binding but no source verification result was supplied for validation."
      );
    }

    return {
      ok: errors.length === 0,
      errors,
      warnings,
    };
  }

  if (requireSourceVerificationOk && !provided.ok) {
    errors.push("Provided source verification result is not ok.");
  }

  if (!sourceHash || !sourceKind) {
    errors.push("Provenance is missing source verification binding fields.");
    return {
      ok: false,
      errors,
      warnings,
    };
  }

  if (sourceKind !== provided.source) {
    errors.push(
      `Source verification source mismatch: provenance=${sourceKind} provided=${provided.source}.`
    );
  }

  const providedHash = canonicalHash(provided);
  if (sourceHash !== providedHash) {
    errors.push("Source verification hash mismatch against provided source verification result.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
