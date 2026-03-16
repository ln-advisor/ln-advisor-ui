import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PHALA_API_VERSION_HEADER,
  PHALA_DEFAULT_API_VERSION,
  PHALA_ENDPOINTS,
  PhalaCloudApiClient,
  verifyPhalaAttestationBySource,
} from "../src/tee/phala";
import { createPhalaCliEnclaveProviderFromArtifacts } from "../src/arb/enclave/phalaCliProvider";
import { runEnclaveBoundaryPipeline } from "../src/arb/enclave/pipeline";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { verifyArb } from "../src/arb/verifyArb";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step27.provenance-source-binding.json");
const DEFAULT_CVM_INFO_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.cvm.json");
const DEFAULT_CLI_ATTEST_PATH = path.resolve(process.cwd(), "artifacts", "phala-jupyter.attestation.cli.json");

const MOCK_API_BASE = "https://mock.phala.local/api/v1";
const MOCK_APP_BASE = "https://mock-cvm.local";
const MOCK_API_KEY = "mock-phala-api-key";
const CVM_ID = "cvm-001";
const QUOTE_HEX = "ab".repeat(256);
const REPORT_DATA_HEX = "cd".repeat(32);
const APP_COMPOSE = [
  "services:",
  "  adviser:",
  "    image: ghcr.io/phala-network/sample:latest",
  "    restart: unless-stopped",
].join("\n");

const FIXED_DEV_SIGNING_KEY = "step27-dev-signing-key";
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sha256HexFromUtf8 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const COMPOSE_HASH = sha256HexFromUtf8(APP_COMPOSE);

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => sortObjectKeysDeep(item));
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
const canonicalHash = (value: unknown): string => sha256HexFromUtf8(canonicalJson(value));

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

type MockCall = {
  method: string;
  path: string;
  headers: Record<string, string>;
};

const toHeaderRecord = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
};

async function main(): Promise<void> {
  const cvmInfoPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_CVM_INFO_PATH;
  const cliAttestationPath = process.argv[3]
    ? path.resolve(process.cwd(), process.argv[3])
    : DEFAULT_CLI_ATTEST_PATH;

  const enclaveProvider = await createPhalaCliEnclaveProviderFromArtifacts({
    cvmInfoPath,
    cliAttestationPath,
  });

  const calls: MockCall[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method || "GET").toUpperCase();
    const pathname = new URL(url).pathname;
    const apiBasePath = new URL(MOCK_API_BASE).pathname.replace(/\/+$/, "");
    const cloudPath = pathname.startsWith(apiBasePath) ? pathname.slice(apiBasePath.length) || "/" : pathname;
    const pathUsed = url.startsWith(MOCK_API_BASE) ? cloudPath : pathname;

    calls.push({
      method,
      path: pathUsed,
      headers: toHeaderRecord(new Headers(init?.headers)),
    });

    const json = (status: number, payload: unknown): Response =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url.startsWith(MOCK_APP_BASE)) {
      if (pathname === "/attestation") {
        return json(200, {
          quote: QUOTE_HEX,
          report_data: REPORT_DATA_HEX,
          event_log: [{ event: "compose-hash", digest: COMPOSE_HASH }],
        });
      }
      if (pathname === "/info") {
        return json(200, {
          tcb_info: {
            app_compose: APP_COMPOSE,
          },
        });
      }
      return json(404, { error: `Unknown app endpoint ${pathname}` });
    }

    if (cloudPath === PHALA_ENDPOINTS.getCvmAttestation(CVM_ID) && method === "GET") {
      return json(200, {
        is_online: true,
        app_certificates: [{ quote: QUOTE_HEX }],
        report_data: REPORT_DATA_HEX,
      });
    }

    if (cloudPath === PHALA_ENDPOINTS.verifyAttestation && method === "POST") {
      return json(200, {
        success: true,
        quote: {
          verified: true,
        },
      });
    }

    return json(404, { error: `Unknown endpoint ${method} ${pathUsed}` });
  };

  const cloudClient = new PhalaCloudApiClient({
    apiBaseUrl: MOCK_API_BASE,
    apiVersion: PHALA_DEFAULT_API_VERSION,
    apiKey: MOCK_API_KEY,
    fetchImpl: mockFetch,
  });

  const cloudSourceVerification = await verifyPhalaAttestationBySource({
    source: "cloud_cvm_attestation",
    cloudClient,
    cvmId: CVM_ID,
    expectedReportDataHex: REPORT_DATA_HEX,
  });
  const appSourceVerification = await verifyPhalaAttestationBySource({
    source: "app_http_attestation",
    cloudClient,
    appBaseUrl: MOCK_APP_BASE,
    expectedReportDataHex: REPORT_DATA_HEX,
    fetchImpl: mockFetch,
  });

  const sourceGatePolicy = {
    schemaVersion: "attestation-verification-gate-policy-v1" as const,
    requireSourceVerification: true,
    requireVerifiedQuote: true,
    allowedSources: ["cloud_cvm_attestation", "app_http_attestation"] as const,
    requireAppComposeBindingForAppSource: true,
    requireReportDataMatchWhenExpected: true,
  };

  const rawSnapshot = getMockLightningSnapshot();

  const cloudRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider,
    sourceVerificationResult: cloudSourceVerification,
    attestationVerificationGatePolicy: sourceGatePolicy,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });
  const appRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider,
    sourceVerificationResult: appSourceVerification,
    attestationVerificationGatePolicy: sourceGatePolicy,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });
  const cloudRunAgain = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider,
    sourceVerificationResult: cloudSourceVerification,
    attestationVerificationGatePolicy: sourceGatePolicy,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const cloudVerify = verifyArb({
    arb: cloudRun.arb,
    sourceProvenance: cloudRun.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  const appVerify = verifyArb({
    arb: appRun.arb,
    sourceProvenance: appRun.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  assert(cloudVerify.ok, `Step27 cloud ARB verify failed: ${cloudVerify.errors.join(" | ")}`);
  assert(appVerify.ok, `Step27 app ARB verify failed: ${appVerify.errors.join(" | ")}`);

  const expectedCloudSourceHash = canonicalHash(cloudSourceVerification);
  const expectedAppSourceHash = canonicalHash(appSourceVerification);
  const cloudCtx = cloudRun.sourceProvenance.executionContext;
  const appCtx = appRun.sourceProvenance.executionContext;

  assert(cloudCtx.sourceVerificationSource === "cloud_cvm_attestation", "Step27 failed: cloud source label mismatch.");
  assert(appCtx.sourceVerificationSource === "app_http_attestation", "Step27 failed: app source label mismatch.");
  assert(cloudCtx.sourceVerificationHash === expectedCloudSourceHash, "Step27 failed: cloud source hash mismatch.");
  assert(appCtx.sourceVerificationHash === expectedAppSourceHash, "Step27 failed: app source hash mismatch.");

  assert(
    cloudRun.sourceProvenance.executionContext.sourceVerificationHash !==
      appRun.sourceProvenance.executionContext.sourceVerificationHash,
    "Step27 failed: source verification hash should differ between cloud and app source receipts."
  );
  assert(
    cloudRun.arb.sourceProvenanceHash !== appRun.arb.sourceProvenanceHash,
    "Step27 failed: sourceProvenanceHash should change when source verification receipt changes."
  );

  const deterministic = canonicalJson(cloudRun.arb) === canonicalJson(cloudRunAgain.arb);
  assert(deterministic, "Step27 failed: cloud-bound ARB output is not deterministic for fixed inputs.");

  const cloudCalls = calls.filter((call) => call.path.startsWith("/cvms/") || call.path === PHALA_ENDPOINTS.verifyAttestation);
  for (const call of cloudCalls) {
    assert(
      call.headers[PHALA_API_VERSION_HEADER.toLowerCase()] === PHALA_DEFAULT_API_VERSION,
      `Step27 failed: missing ${PHALA_API_VERSION_HEADER} header on ${call.method} ${call.path}.`
    );
  }

  const artifact = {
    schemaVersion: "step27-provenance-source-binding-v1",
    inputs: {
      cvmInfoPath,
      cliAttestationPath,
    },
    cloudRun: {
      source: cloudCtx.sourceVerificationSource,
      sourceVerificationHash: cloudCtx.sourceVerificationHash,
      sourceProvenanceHash: cloudRun.arb.sourceProvenanceHash,
      verifyArb: cloudVerify,
    },
    appRun: {
      source: appCtx.sourceVerificationSource,
      sourceVerificationHash: appCtx.sourceVerificationHash,
      sourceProvenanceHash: appRun.arb.sourceProvenanceHash,
      verifyArb: appVerify,
    },
    deterministic,
    doneCondition:
      "Source verification receipt is cryptographically bound into provenance: provenance and ARB sourceProvenanceHash change with source evidence while remaining deterministic for fixed inputs.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`CVM info: ${cvmInfoPath}`);
  console.log(`CLI attestation: ${cliAttestationPath}`);
  console.log(`Saved Step 27 artifact: ${ARTIFACT_PATH}`);
  console.log(`Cloud source hash bound: ${Boolean(cloudCtx.sourceVerificationHash)}`);
  console.log(`App source hash bound: ${Boolean(appCtx.sourceVerificationHash)}`);
  console.log(`Source provenance hash differs by source: ${cloudRun.arb.sourceProvenanceHash !== appRun.arb.sourceProvenanceHash}`);
  console.log("Step 27 provenance source-binding test: PASS");
}

main().catch((error) => {
  console.error("Step 27 provenance source-binding test failed.", error);
  process.exitCode = 1;
});
