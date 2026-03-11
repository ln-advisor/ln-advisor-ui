export type EnclaveCandidateModuleId =
  | "normalize_snapshot"
  | "privacy_transform"
  | "score_node_state"
  | "arb_signer";

export type ContractFieldSensitivity = "public" | "operational_sensitive" | "secret";

export interface ContractFieldSpec {
  name: string;
  type: string;
  required: boolean;
  schemaVersion?: string;
  sensitivity: ContractFieldSensitivity;
  description: string;
}

export interface ContractHashRule {
  algorithm: "sha256";
  encoding: "hex_lower";
  canonicalization: "json_sorted_keys_deep";
}

export interface EnclaveModuleContract {
  moduleId: EnclaveCandidateModuleId;
  moduleLabel: string;
  currentEntrypoint: string;
  targetTrustBoundary: "tee_candidate";
  deterministic: true;
  inputs: ContractFieldSpec[];
  outputs: ContractFieldSpec[];
  hashRules: ContractHashRule[];
  notes: string[];
}

export interface EnclaveCandidateContractsDocument {
  schemaVersion: "enclave-candidate-contracts-v1";
  pipelineId: "props-local-pipeline-v1";
  generatedAt: string;
  generationMode: "deterministic";
  candidateModules: EnclaveModuleContract[];
}

export const ENCLAVE_CONTRACTS_GENERATED_AT = "2026-01-01T00:00:00.000Z";

export const ENCLAVE_CONTRACT_HASH_RULE: ContractHashRule = {
  algorithm: "sha256",
  encoding: "hex_lower",
  canonicalization: "json_sorted_keys_deep",
};
