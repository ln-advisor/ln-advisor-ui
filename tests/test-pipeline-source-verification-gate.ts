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

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "pipeline-source-verification-gate.json");
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

const FIXED_DEV_SIGNING_KEY = "pipeline-source-verification-gate-dev-signing-key";
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";

const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const COMPOSE_HASH = sha256Hex(APP_COMPOSE);

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
    allowedSources: ["cloud_cvm_attestation"] as const,
    requireAppComposeBindingForAppSource: true,
    requireReportDataMatchWhenExpected: true,
  };

  const rawSnapshot = getMockLightningSnapshot();

  const passRun = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider,
    sourceVerificationResult: cloudSourceVerification,
    attestationVerificationGatePolicy: sourceGatePolicy,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });

  const verifyPassRun = verifyArb({
    arb: passRun.arb,
    sourceProvenance: passRun.sourceProvenance,
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });
  assert(verifyPassRun.ok, `Pipeline Source Verification Gate verifyArb failed: ${verifyPassRun.errors.join(" | ")}`);
  assert(passRun.runSummary.sourceVerificationGate.policyApplied, "Pipeline Source Verification Gate failed: gate should be policy-applied.");
  assert(passRun.runSummary.sourceVerificationGate.verified, "Pipeline Source Verification Gate failed: gate should be verified.");

  const passRunAgain = await runEnclaveBoundaryPipeline({
    rawSnapshot,
    privacyMode: "feature_only",
    devSigningKey: FIXED_DEV_SIGNING_KEY,
    enclaveProvider,
    sourceVerificationResult: cloudSourceVerification,
    attestationVerificationGatePolicy: sourceGatePolicy,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });
  const deterministic = canonicalJson(passRun.arb) === canonicalJson(passRunAgain.arb);
  assert(deterministic, "Pipeline Source Verification Gate failed: gated pipeline output is not deterministic for fixed inputs.");

  let missingSourceError = "";
  try {
    await runEnclaveBoundaryPipeline({
      rawSnapshot,
      privacyMode: "feature_only",
      devSigningKey: FIXED_DEV_SIGNING_KEY,
      enclaveProvider,
      attestationVerificationGatePolicy: sourceGatePolicy,
      issuedAt: FIXED_ISSUED_AT,
      ttlSeconds: 86_400,
    });
  } catch (error) {
    missingSourceError = error instanceof Error ? error.message : String(error);
  }
  assert(
    missingSourceError.includes("Source verification gate denied:"),
    "Pipeline Source Verification Gate failed: missing source verification should be rejected."
  );

  let disallowedSourceError = "";
  try {
    await runEnclaveBoundaryPipeline({
      rawSnapshot,
      privacyMode: "feature_only",
      devSigningKey: FIXED_DEV_SIGNING_KEY,
      enclaveProvider,
      sourceVerificationResult: appSourceVerification,
      attestationVerificationGatePolicy: sourceGatePolicy,
      issuedAt: FIXED_ISSUED_AT,
      ttlSeconds: 86_400,
    });
  } catch (error) {
    disallowedSourceError = error instanceof Error ? error.message : String(error);
  }
  assert(
    disallowedSourceError.includes("Source verification gate denied:"),
    "Pipeline Source Verification Gate failed: disallowed verification source should be rejected."
  );

  const cloudCalls = calls.filter((call) => call.path.startsWith("/cvms/") || call.path === PHALA_ENDPOINTS.verifyAttestation);
  for (const call of cloudCalls) {
    assert(
      call.headers[PHALA_API_VERSION_HEADER.toLowerCase()] === PHALA_DEFAULT_API_VERSION,
      `Pipeline Source Verification Gate failed: missing ${PHALA_API_VERSION_HEADER} header on ${call.method} ${call.path}.`
    );
  }

  const artifact = {
    schemaVersion: "pipeline-source-verification-gate-v1",
    inputs: {
      cvmInfoPath,
      cliAttestationPath,
    },
    sourceGatePolicy,
    passRun: {
      source: passRun.runSummary.sourceVerificationGate.source,
      sourceGate: passRun.runSummary.sourceVerificationGate,
      verifyArb: verifyPassRun,
    },
    rejectedRuns: {
      missingSource: {
        rejected: missingSourceError.includes("Source verification gate denied:"),
        error: missingSourceError || null,
      },
      disallowedSource: {
        rejected: disallowedSourceError.includes("Source verification gate denied:"),
        error: disallowedSourceError || null,
      },
    },
    deterministic,
    doneCondition:
      "Enclave pipeline enforces source attestation verification gate before signing: allowed verified source passes, missing or disallowed source is rejected.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`CVM info: ${cvmInfoPath}`);
  console.log(`CLI attestation: ${cliAttestationPath}`);
  console.log(`Saved Pipeline Source Verification Gate artifact: ${ARTIFACT_PATH}`);
  console.log(`Pass source gate: ${passRun.runSummary.sourceVerificationGate.verified}`);
  console.log(`Missing source rejected: ${missingSourceError.includes("Source verification gate denied:")}`);
  console.log(`Disallowed source rejected: ${disallowedSourceError.includes("Source verification gate denied:")}`);
  console.log("Pipeline Source Verification Gate test: PASS");
}

main().catch((error) => {
  console.error("Pipeline Source Verification Gate test failed.", error);
  process.exitCode = 1;
});


