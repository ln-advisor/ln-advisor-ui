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

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step23.attestation-source-selection.json");

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
        quote: QUOTE_HEX,
        quote_format: "tdx_quote",
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

  const appSourceMismatchResult = await verifyPhalaAttestationBySource({
    source: "app_http_attestation",
    cloudClient,
    appBaseUrl: MOCK_APP_BASE,
    expectedReportDataHex: "00".repeat(32),
    fetchImpl: mockFetch,
  });

  assert(cloudSourceResult.ok, "Step23 failed: cloud source verification should pass.");
  assert(cloudSourceResult.checks.composeHashMatchesRtmr3Event === null, "Step23 failed: cloud compose check should be null.");
  assert(appSourceResult.ok, "Step23 failed: app source verification should pass.");
  assert(
    appSourceResult.checks.composeHashMatchesRtmr3Event === true,
    "Step23 failed: app source compose check should pass."
  );
  assert(!appSourceMismatchResult.ok, "Step23 failed: mismatched report data should fail app source.");

  const cloudCalls = calls.filter((call) => call.path.startsWith("/cvms/") || call.path === PHALA_ENDPOINTS.verifyAttestation);
  for (const call of cloudCalls) {
    assert(
      call.headers[PHALA_API_VERSION_HEADER.toLowerCase()] === PHALA_DEFAULT_API_VERSION,
      `Step23 failed: missing ${PHALA_API_VERSION_HEADER} on ${call.method} ${call.path}.`
    );
  }

  const artifact = {
    schemaVersion: "step23-attestation-source-selection-v1",
    sources: {
      cloud: cloudSourceResult,
      app: appSourceResult,
      appMismatch: appSourceMismatchResult,
    },
    apiCalls: cloudCalls.map((call) => `${call.method} ${call.path}`),
    doneCondition:
      "Attestation verification source is explicitly selectable: cloud CVM quote path and app HTTP path both work, with source-specific checks and expected mismatch failures.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved Step 23 artifact: ${ARTIFACT_PATH}`);
  console.log(`Cloud source verification: ${cloudSourceResult.ok ? "PASS" : "FAIL"}`);
  console.log(`App source verification: ${appSourceResult.ok ? "PASS" : "FAIL"}`);
  console.log(`App mismatch rejected: ${!appSourceMismatchResult.ok}`);
  console.log("Step 23 attestation source selection test: PASS");
}

main().catch((error) => {
  console.error("Step 23 attestation source selection test failed.", error);
  process.exitCode = 1;
});
