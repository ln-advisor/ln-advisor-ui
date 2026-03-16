import type { ArbAttestationEvidence } from "../attestation";
import type { KeyReleasePolicy } from "../keyReleasePolicy";

export interface ReleasedSigningKey {
  keyId: string;
  keyMaterial: string;
  source: string;
}

export interface SigningKeyProvider {
  schemaVersion: "signing-key-provider-v1";
  providerId: string;
  releaseKey(input: {
    requestedKeyId: string;
    policy: KeyReleasePolicy;
    attestation: ArbAttestationEvidence;
  }): Promise<ReleasedSigningKey>;
}

export interface StaticKeyringSigningKeyProviderOptions {
  keyring: Record<string, string>;
  providerId?: string;
}

export class StaticKeyringSigningKeyProvider implements SigningKeyProvider {
  readonly schemaVersion = "signing-key-provider-v1" as const;
  readonly providerId: string;

  private readonly keyring: Record<string, string>;

  constructor(options: StaticKeyringSigningKeyProviderOptions) {
    this.providerId = options.providerId?.trim() || "static-keyring-signing-key-provider";
    this.keyring = { ...options.keyring };
  }

  async releaseKey(input: {
    requestedKeyId: string;
    policy: KeyReleasePolicy;
    attestation: ArbAttestationEvidence;
  }): Promise<ReleasedSigningKey> {
    const requestedKeyId = String(input.requestedKeyId || "").trim();
    if (!requestedKeyId) {
      throw new Error("Signing key release failed: requestedKeyId is required.");
    }

    const keyMaterial = this.keyring[requestedKeyId];
    if (!keyMaterial || !keyMaterial.trim()) {
      throw new Error(`Signing key release failed: keyId not found in provider keyring (${requestedKeyId}).`);
    }

    return {
      keyId: requestedKeyId,
      keyMaterial: keyMaterial.trim(),
      source: this.providerId,
    };
  }
}
