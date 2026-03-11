import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { ArbAttestationEvidence, EnclaveExecutionMode } from "../attestation";

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

export interface EnclaveAttestationRequest {
  issuedAt: string;
  nonce: string;
  inputHash: string;
  outputHash: string;
  moduleOrder: readonly string[];
}

export interface EnclaveProvider {
  schemaVersion: "enclave-provider-v1";
  providerId: string;
  executionMode: EnclaveExecutionMode;
  attest(input: EnclaveAttestationRequest): Promise<ArbAttestationEvidence>;
}

export class LocalDevEnclaveProvider implements EnclaveProvider {
  readonly schemaVersion = "enclave-provider-v1" as const;
  readonly providerId = "local-dev-enclave-provider";
  readonly executionMode = "local_dev" as const;

  async attest(input: EnclaveAttestationRequest): Promise<ArbAttestationEvidence> {
    const quotePayload = {
      providerId: this.providerId,
      executionMode: this.executionMode,
      issuedAt: input.issuedAt,
      nonce: input.nonce,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      moduleOrder: [...input.moduleOrder],
    };
    const quote = Buffer.from(canonicalJson(quotePayload), "utf8").toString("base64url");
    const quoteHash = sha256Hex({ quote });
    const measurement = sha256Hex({
      providerId: this.providerId,
      executionMode: this.executionMode,
    });

    return {
      schemaVersion: "arb-attestation-evidence-v1",
      providerId: this.providerId,
      executionMode: this.executionMode,
      quoteFormat: "simulated_quote",
      quote,
      quoteHash,
      measurement,
      issuedAt: input.issuedAt,
      nonce: input.nonce,
    };
  }
}

export const localDevEnclaveProvider: EnclaveProvider = new LocalDevEnclaveProvider();

export class SimulatedTeeEnclaveProvider implements EnclaveProvider {
  readonly schemaVersion = "enclave-provider-v1" as const;
  readonly providerId = "simulated-tee-enclave-provider";
  readonly executionMode = "tee_simulated" as const;

  async attest(input: EnclaveAttestationRequest): Promise<ArbAttestationEvidence> {
    const quotePayload = {
      providerId: this.providerId,
      executionMode: this.executionMode,
      issuedAt: input.issuedAt,
      nonce: input.nonce,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      moduleOrder: [...input.moduleOrder],
      teeProfile: "cpu-tee-sim-v1",
    };
    const quote = Buffer.from(canonicalJson(quotePayload), "utf8").toString("base64url");
    const quoteHash = sha256Hex({ quote });
    const measurement = sha256Hex({
      providerId: this.providerId,
      executionMode: this.executionMode,
      teeProfile: "cpu-tee-sim-v1",
    });

    return {
      schemaVersion: "arb-attestation-evidence-v1",
      providerId: this.providerId,
      executionMode: this.executionMode,
      quoteFormat: "simulated_quote",
      quote,
      quoteHash,
      measurement,
      issuedAt: input.issuedAt,
      nonce: input.nonce,
    };
  }
}

export const simulatedTeeEnclaveProvider: EnclaveProvider = new SimulatedTeeEnclaveProvider();

export class VerifiedTeeEnclaveProvider implements EnclaveProvider {
  readonly schemaVersion = "enclave-provider-v1" as const;
  readonly providerId = "verified-tee-enclave-provider";
  readonly executionMode = "tee_verified" as const;

  async attest(input: EnclaveAttestationRequest): Promise<ArbAttestationEvidence> {
    const quotePayload = {
      providerId: this.providerId,
      executionMode: this.executionMode,
      issuedAt: input.issuedAt,
      nonce: input.nonce,
      inputHash: input.inputHash,
      outputHash: input.outputHash,
      moduleOrder: [...input.moduleOrder],
      teeProfile: "cpu-tee-verified-v1",
    };
    const quote = Buffer.from(canonicalJson(quotePayload), "utf8").toString("base64url");
    const quoteHash = sha256Hex({ quote });
    const measurement = sha256Hex({
      providerId: this.providerId,
      executionMode: this.executionMode,
      teeProfile: "cpu-tee-verified-v1",
    });

    return {
      schemaVersion: "arb-attestation-evidence-v1",
      providerId: this.providerId,
      executionMode: this.executionMode,
      quoteFormat: "simulated_quote",
      quote,
      quoteHash,
      measurement,
      issuedAt: input.issuedAt,
      nonce: input.nonce,
    };
  }
}

export const verifiedTeeEnclaveProvider: EnclaveProvider = new VerifiedTeeEnclaveProvider();
