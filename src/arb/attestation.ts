export type EnclaveExecutionMode = "local_dev" | "tee_simulated" | "tee_verified";
export type ArbAttestationQuoteFormat = "simulated_quote" | "tdx_quote";

export interface ArbAttestationEvidence {
  schemaVersion: "arb-attestation-evidence-v1";
  providerId: string;
  executionMode: EnclaveExecutionMode;
  quoteFormat: ArbAttestationQuoteFormat;
  quote: string;
  quoteHash: string;
  measurement: string;
  issuedAt: string;
  nonce: string;
}
