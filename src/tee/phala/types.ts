import { PHALA_DEFAULT_API_VERSION, PHALA_LEGACY_API_VERSION } from "./constants";

export type PhalaApiVersion = typeof PHALA_DEFAULT_API_VERSION | typeof PHALA_LEGACY_API_VERSION;

export interface CurrentUserV20260121 {
  schemaVersion: "current-user-v20260121";
  userId: string;
  email: string | null;
  walletAddress: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  creditBalance: string | null;
  raw: Record<string, unknown>;
}

export interface CvmInfoV20260121 {
  schemaVersion: "cvm-info-v20260121";
  cvmId: string;
  name: string | null;
  status: string | null;
  appId: string | null;
  kms: string | null;
  image: string | null;
  composeHash: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  raw: Record<string, unknown>;
}

export interface PhalaProvisionResponse {
  id: string | null;
  status: string | null;
  raw: Record<string, unknown>;
}

export interface PhalaCommitResponse {
  id: string | null;
  status: string | null;
  raw: Record<string, unknown>;
}

export interface PhalaKmsPubKeyResponse {
  kms: string | null;
  appId: string | null;
  publicKey: string;
  raw: Record<string, unknown>;
}

export interface PhalaCvmAttestationResponse {
  quote: string;
  quoteFormat: string | null;
  reportData: string | null;
  eventLog: unknown;
  raw: Record<string, unknown>;
}

export interface PhalaAttestationVerifyResponse {
  success: boolean;
  quoteVerified: boolean;
  raw: Record<string, unknown>;
}

export interface PhalaApiRequestOptions {
  signal?: AbortSignal;
  extraHeaders?: Record<string, string>;
}

export interface PhalaClientResponseMeta {
  status: number;
  apiVersion: PhalaApiVersion;
}

export interface PhalaClientResponse<T> {
  data: T;
  meta: PhalaClientResponseMeta;
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const asStringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const pickFirstString = (record: Record<string, unknown>, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return null;
};

export const parseCurrentUserV20260121 = (value: unknown): CurrentUserV20260121 => {
  const root = asRecord(value);
  const user = asRecord(root.user);
  const workspace = asRecord(root.workspace);
  const credits = asRecord(root.credits);

  return {
    schemaVersion: "current-user-v20260121",
    userId: pickFirstString(root, ["id", "userId"]) || pickFirstString(user, ["id", "userId"]) || "unknown-user",
    email: pickFirstString(root, ["email"]) || pickFirstString(user, ["email"]),
    walletAddress:
      pickFirstString(root, ["walletAddress", "wallet_address"]) ||
      pickFirstString(user, ["walletAddress", "wallet_address"]),
    workspaceId:
      pickFirstString(root, ["workspaceId", "workspace_id"]) ||
      pickFirstString(workspace, ["id", "workspaceId", "workspace_id"]),
    workspaceName: pickFirstString(workspace, ["name", "workspaceName"]),
    creditBalance:
      pickFirstString(credits, ["balance", "creditBalance", "remaining"]) ||
      pickFirstString(root, ["creditBalance", "credits"]),
    raw: root,
  };
};

export const parseCvmInfoV20260121 = (value: unknown): CvmInfoV20260121 => {
  const root = asRecord(value);
  const app = asRecord(root.app);
  const dockerCompose = asRecord(root.dockerCompose);

  return {
    schemaVersion: "cvm-info-v20260121",
    cvmId: pickFirstString(root, ["id", "cvmId", "cvm_id"]) || "unknown-cvm",
    name: pickFirstString(root, ["name"]),
    status: pickFirstString(root, ["status", "state"]),
    appId: pickFirstString(root, ["appId", "app_id"]) || pickFirstString(app, ["id", "appId", "app_id"]),
    kms: pickFirstString(root, ["kms", "kmsId", "kms_id"]),
    image: pickFirstString(root, ["image"]) || pickFirstString(dockerCompose, ["image"]),
    composeHash:
      pickFirstString(root, ["composeHash", "compose_hash"]) ||
      pickFirstString(dockerCompose, ["composeHash", "compose_hash"]),
    createdAt: pickFirstString(root, ["createdAt", "created_at"]),
    updatedAt: pickFirstString(root, ["updatedAt", "updated_at"]),
    raw: root,
  };
};

export const parseProvisionResponse = (value: unknown): PhalaProvisionResponse => {
  const root = asRecord(value);
  return {
    id: pickFirstString(root, ["id", "cvmId", "cvm_id", "taskId", "task_id"]),
    status: pickFirstString(root, ["status", "state"]),
    raw: root,
  };
};

export const parseCommitResponse = (value: unknown): PhalaCommitResponse => {
  const root = asRecord(value);
  return {
    id: pickFirstString(root, ["id", "cvmId", "cvm_id"]),
    status: pickFirstString(root, ["status", "state"]),
    raw: root,
  };
};

export const parseKmsPubKeyResponse = (value: unknown): PhalaKmsPubKeyResponse => {
  const root = asRecord(value);
  const publicKey =
    pickFirstString(root, ["publicKey", "public_key", "pubkey"]) ||
    // TODO(phala): confirm final field name from live Cloud API response.
    pickFirstString(root, ["key"]);

  if (!publicKey) {
    throw new Error("Phala KMS pubkey response is missing a public key field.");
  }

  return {
    kms: pickFirstString(root, ["kms", "kmsId", "kms_id"]),
    appId: pickFirstString(root, ["appId", "app_id"]),
    publicKey,
    raw: root,
  };
};

export const parseCvmAttestationResponse = (value: unknown): PhalaCvmAttestationResponse => {
  const root = asRecord(value);
  let quote = pickFirstString(root, ["quote", "quoteHex", "quote_hex"]);
  if (!quote) {
    const appCertificates = asArray(root.app_certificates);
    for (const cert of appCertificates) {
      const certRecord = asRecord(cert);
      const certQuote = pickFirstString(certRecord, ["quote", "quoteHex", "quote_hex"]);
      if (certQuote) {
        quote = certQuote;
        break;
      }
    }
  }
  if (!quote) {
    throw new Error("Phala CVM attestation response is missing quote data.");
  }

  const resolvedQuoteFormat =
    pickFirstString(root, ["quoteFormat", "quote_format"]) ||
    // TODO(phala): confirm if API will emit explicit quote format for certificate-chain responses.
    "tdx_quote";

  return {
    quote,
    quoteFormat: resolvedQuoteFormat,
    reportData:
      pickFirstString(root, ["reportData", "report_data"]) ||
      // TODO(phala): some responses may nest reportData under `quote`.
      asStringOrNull(asRecord(root.quote)["reportData"]),
    eventLog: root.eventLog ?? root.event_log ?? null,
    raw: root,
  };
};

export const parseAttestationVerifyResponse = (value: unknown): PhalaAttestationVerifyResponse => {
  const root = asRecord(value);
  const quote = asRecord(root.quote);
  const success = root.success === true || root.ok === true;
  const quoteVerified = quote.verified === true || root.verified === true;

  return {
    success,
    quoteVerified,
    raw: root,
  };
};
