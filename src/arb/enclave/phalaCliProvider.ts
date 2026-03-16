import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import type { ArbAttestationEvidence } from "../attestation";
import type { EnclaveAttestationRequest, EnclaveProvider } from "./provider";

type JsonObject = Record<string, unknown>;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeysDeep(item));
  }
  if (value && typeof value === "object") {
    const record = value as JsonObject;
    const sorted: JsonObject = {};
    for (const key of Object.keys(record).sort(compareText)) {
      sorted[key] = sortObjectKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
};

const canonicalJson = (value: unknown): string => JSON.stringify(sortObjectKeysDeep(value));

const sha256Hex = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

const asObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const pickString = (record: JsonObject, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  return null;
};

const parseJsonFile = async (filePath: string): Promise<JsonObject> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return asObject(parsed);
};

const extractQuoteHex = (cliAttestation: JsonObject): string | null => {
  const directQuote = pickString(cliAttestation, ["quote", "quote_hex", "quoteHex"]);
  if (directQuote) return directQuote.toLowerCase();

  const certs = asArray(cliAttestation.app_certificates);
  for (const cert of certs) {
    const certRecord = asObject(cert);
    const quote = pickString(certRecord, ["quote", "quote_hex", "quoteHex"]);
    if (quote) return quote.toLowerCase();
  }
  return null;
};

const resolveQuoteFormat = (
  cliAttestation: JsonObject,
  quoteHex: string | null
): ArbAttestationEvidence["quoteFormat"] => {
  const explicitFormat = pickString(cliAttestation, ["quote_format", "quoteFormat"]);
  if (explicitFormat === "tdx_quote" || explicitFormat === "simulated_quote") {
    return explicitFormat;
  }
  if (quoteHex) return "tdx_quote";
  return "simulated_quote";
};

export interface PhalaCliProviderSourceSummary {
  appId: string | null;
  cvmId: string | null;
  vmUuid: string | null;
  composeHash: string | null;
  osImageHash: string | null;
  nodeDeviceId: string | null;
  attestationSuccess: boolean | null;
  attestationOnline: boolean | null;
  attestationPublic: boolean | null;
  attestationError: string | null;
  mrtd: string | null;
  rtmr0: string | null;
  rtmr1: string | null;
  rtmr2: string | null;
  rtmr3: string | null;
  quoteHexPresent: boolean;
  quoteFormat: ArbAttestationEvidence["quoteFormat"];
}

const buildSourceSummary = (input: {
  cvmInfo: JsonObject;
  cliAttestation: JsonObject;
}): PhalaCliProviderSourceSummary => {
  const cvmInfo = input.cvmInfo;
  const cliAttestation = input.cliAttestation;
  const tcbInfo = asObject(cliAttestation.tcb_info);
  const os = asObject(cvmInfo.os);
  const nodeInfo = asObject(cvmInfo.node_info);
  const quoteHex = extractQuoteHex(cliAttestation);

  return {
    appId: pickString(cvmInfo, ["app_id", "appId"]),
    cvmId: pickString(cvmInfo, ["id", "cvm_id", "cvmId"]),
    vmUuid: pickString(cvmInfo, ["vm_uuid", "vmUuid"]),
    composeHash: pickString(cvmInfo, ["compose_hash", "composeHash"]),
    osImageHash: pickString(os, ["os_image_hash", "osImageHash"]),
    nodeDeviceId: pickString(nodeInfo, ["device_id", "deviceId"]),
    attestationSuccess: toBoolean(cliAttestation.success),
    attestationOnline: toBoolean(cliAttestation.is_online),
    attestationPublic: toBoolean(cliAttestation.is_public),
    attestationError: pickString(cliAttestation, ["error"]),
    mrtd: pickString(tcbInfo, ["mrtd"]),
    rtmr0: pickString(tcbInfo, ["rtmr0"]),
    rtmr1: pickString(tcbInfo, ["rtmr1"]),
    rtmr2: pickString(tcbInfo, ["rtmr2"]),
    rtmr3: pickString(tcbInfo, ["rtmr3"]),
    quoteHexPresent: Boolean(quoteHex),
    quoteFormat: resolveQuoteFormat(cliAttestation, quoteHex),
  };
};

const buildMeasurement = (summary: PhalaCliProviderSourceSummary): string =>
  sha256Hex({
    appId: summary.appId,
    cvmId: summary.cvmId,
    vmUuid: summary.vmUuid,
    composeHash: summary.composeHash,
    osImageHash: summary.osImageHash,
    nodeDeviceId: summary.nodeDeviceId,
    mrtd: summary.mrtd,
    rtmr0: summary.rtmr0,
    rtmr1: summary.rtmr1,
    rtmr2: summary.rtmr2,
    rtmr3: summary.rtmr3,
  });

export interface PhalaCliEnclaveProviderOptions {
  cvmInfo: JsonObject;
  cliAttestation: JsonObject;
  providerId?: string;
}

export class PhalaCliEnclaveProvider implements EnclaveProvider {
  readonly schemaVersion = "enclave-provider-v1" as const;
  readonly providerId: string;
  readonly executionMode = "tee_verified" as const;
  readonly sourceSummary: PhalaCliProviderSourceSummary;
  readonly quoteFormat: ArbAttestationEvidence["quoteFormat"];

  private readonly quoteHex: string | null;

  constructor(options: PhalaCliEnclaveProviderOptions) {
    this.providerId = options.providerId?.trim() || "phala-cli-enclave-provider";
    this.sourceSummary = buildSourceSummary({
      cvmInfo: options.cvmInfo,
      cliAttestation: options.cliAttestation,
    });
    this.quoteFormat = this.sourceSummary.quoteFormat;
    this.quoteHex = extractQuoteHex(options.cliAttestation);

    if (this.sourceSummary.attestationSuccess !== true) {
      throw new Error("Phala CLI attestation artifact is not successful (success !== true).");
    }
    if (!this.sourceSummary.appId && !this.sourceSummary.cvmId && !this.sourceSummary.vmUuid) {
      throw new Error("Phala CLI artifacts are missing app/cvm identity fields.");
    }
  }

  async attest(input: EnclaveAttestationRequest): Promise<ArbAttestationEvidence> {
    const quoteEnvelope = {
      sourceType: "phala-cli-artifact-v1",
      providerId: this.providerId,
      executionMode: this.executionMode,
      sourceSummary: this.sourceSummary,
      phalaQuoteHex: this.quoteHex,
      requestBinding: {
        issuedAt: input.issuedAt,
        nonce: input.nonce,
        inputHash: input.inputHash,
        outputHash: input.outputHash,
        moduleOrder: [...input.moduleOrder],
      },
    };

    const quote = Buffer.from(canonicalJson(quoteEnvelope), "utf8").toString("base64url");
    const quoteHash = sha256Hex({ quote });
    const measurement = buildMeasurement(this.sourceSummary);

    return {
      schemaVersion: "arb-attestation-evidence-v1",
      providerId: this.providerId,
      executionMode: this.executionMode,
      quoteFormat: this.quoteFormat,
      quote,
      quoteHash,
      measurement,
      issuedAt: input.issuedAt,
      nonce: input.nonce,
    };
  }
}

export interface CreatePhalaCliProviderFromArtifactsOptions {
  cvmInfoPath: string;
  cliAttestationPath: string;
  providerId?: string;
}

export async function createPhalaCliEnclaveProviderFromArtifacts(
  options: CreatePhalaCliProviderFromArtifactsOptions
): Promise<PhalaCliEnclaveProvider> {
  const [cvmInfo, cliAttestation] = await Promise.all([
    parseJsonFile(options.cvmInfoPath),
    parseJsonFile(options.cliAttestationPath),
  ]);

  return new PhalaCliEnclaveProvider({
    cvmInfo,
    cliAttestation,
    providerId: options.providerId,
  });
}
