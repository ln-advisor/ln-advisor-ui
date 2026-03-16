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
import { evaluateAttestationVerificationGate } from "../src/arb/attestationVerificationGate";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step25.attestation-verification-gate.json");
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

const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const COMPOSE_HASH = sha256Hex(APP_COMPOSE);

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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

  const cloudSourceResult = await verifyPhalaAttestationBySource({
    source: "cloud_cvm_attestation",
    cloudClient,
    cvmId: CVM_ID,
    expectedReportDataHex: REPORT_DATA_HEX,
  });

  const appSourceResult = await verifyPhalaAttestationBySource({
    source: "app_http_attestation",
    cloudClient,
    appBaseUrl: MOCK_APP_BASE,
    expectedReportDataHex: REPORT_DATA_HEX,
    fetchImpl: mockFetch,
  });

  const appMismatchResult = await verifyPhalaAttestationBySource({
    source: "app_http_attestation",
    cloudClient,
    appBaseUrl: MOCK_APP_BASE,
    expectedReportDataHex: "00".repeat(32),
    fetchImpl: mockFetch,
  });

  const strictGatePolicy = {
    schemaVersion: "attestation-verification-gate-policy-v1" as const,
    requireSourceVerification: true,
    requireVerifiedQuote: true,
    allowedSources: ["cloud_cvm_attestation", "app_http_attestation"] as const,
    requireAppComposeBindingForAppSource: true,
    requireReportDataMatchWhenExpected: true,
  };

  const sampleArbAttestation = {
    schemaVersion: "arb-attestation-evidence-v1" as const,
    providerId: "phala-cli-enclave-provider",
    executionMode: "tee_verified" as const,
    quoteFormat: "tdx_quote" as const,
    quote: "q".repeat(10),
    quoteHash: "a".repeat(64),
    measurement: "b".repeat(64),
    issuedAt: "2026-01-01T00:00:00.000Z",
    nonce: "c".repeat(64),
  };

  const cloudGateResult = evaluateAttestationVerificationGate({
    policy: strictGatePolicy,
    sourceVerification: cloudSourceResult,
    arbAttestation: sampleArbAttestation,
  });
  assert(cloudGateResult.ok, `Step25 failed: cloud source gate should pass (${cloudGateResult.errors.join(" | ")})`);

  const appGateResult = evaluateAttestationVerificationGate({
    policy: strictGatePolicy,
    sourceVerification: appSourceResult,
    arbAttestation: sampleArbAttestation,
  });
  assert(appGateResult.ok, `Step25 failed: app source gate should pass (${appGateResult.errors.join(" | ")})`);

  const appMismatchGateResult = evaluateAttestationVerificationGate({
    policy: strictGatePolicy,
    sourceVerification: appMismatchResult,
    arbAttestation: sampleArbAttestation,
  });
  assert(!appMismatchGateResult.ok, "Step25 failed: reportData mismatch should fail verification gate.");

  const sourceRestrictedGateResult = evaluateAttestationVerificationGate({
    policy: {
      ...strictGatePolicy,
      allowedSources: ["cloud_cvm_attestation"],
    },
    sourceVerification: appSourceResult,
    arbAttestation: sampleArbAttestation,
  });
  assert(!sourceRestrictedGateResult.ok, "Step25 failed: source restriction should reject app source.");

  const quoteFormatMismatchGateResult = evaluateAttestationVerificationGate({
    policy: strictGatePolicy,
    sourceVerification: cloudSourceResult,
    arbAttestation: {
      ...sampleArbAttestation,
      quoteFormat: "simulated_quote",
    },
  });
  assert(!quoteFormatMismatchGateResult.ok, "Step25 failed: quote format mismatch should be rejected.");

  const cloudCalls = calls.filter((call) => call.path.startsWith("/cvms/") || call.path === PHALA_ENDPOINTS.verifyAttestation);
  for (const call of cloudCalls) {
    assert(
      call.headers[PHALA_API_VERSION_HEADER.toLowerCase()] === PHALA_DEFAULT_API_VERSION,
      `Step25 failed: missing ${PHALA_API_VERSION_HEADER} header on ${call.method} ${call.path}.`
    );
  }

  const artifact = {
    schemaVersion: "step25-attestation-verification-gate-v1",
    policy: strictGatePolicy,
    sourceVerification: {
      cloud: cloudSourceResult,
      app: appSourceResult,
      appMismatch: appMismatchResult,
    },
    gateResults: {
      cloud: cloudGateResult,
      app: appGateResult,
      appMismatch: appMismatchGateResult,
      sourceRestricted: sourceRestrictedGateResult,
      quoteFormatMismatch: quoteFormatMismatchGateResult,
    },
    doneCondition:
      "A strict verification gate now enforces selected attestation source checks before trust decisions: good source evidence passes, mismatched source/reportData/quote format is rejected.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved Step 25 artifact: ${ARTIFACT_PATH}`);
  console.log(`Cloud gate pass: ${cloudGateResult.ok}`);
  console.log(`App gate pass: ${appGateResult.ok}`);
  console.log(`App mismatch rejected: ${!appMismatchGateResult.ok}`);
  console.log("Step 25 attestation verification gate test: PASS");
}

main().catch((error) => {
  console.error("Step 25 attestation verification gate test failed.", error);
  process.exitCode = 1;
});
