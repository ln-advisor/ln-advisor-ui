export type EnclaveExecutionMode = "local_dev" | "tee_simulated" | "tee_verified";

export interface ArbAttestationEvidence {
  schemaVersion: "arb-attestation-evidence-v1";
  providerId: string;
  executionMode: EnclaveExecutionMode;
  quoteFormat: "simulated_quote";
  quote: string;
  quoteHash: string;
  measurement: string;
  issuedAt: string;
  nonce: string;
}
