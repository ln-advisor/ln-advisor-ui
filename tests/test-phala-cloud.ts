import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PHALA_API_VERSION_HEADER,
  PHALA_DEFAULT_API_VERSION,
  PHALA_DOC_LINKS,
  PHALA_ENDPOINTS,
  PhalaCloudApiClient,
  deriveX25519PublicKeyHex,
  verifyPhalaApplicationAttestation,
} from "../src/tee/phala";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "phala-cloud.json");

const MOCK_API_BASE = "https://mock.phala.local/api/v1";
const MOCK_APP_BASE = "https://mock-cvm.local";
const MOCK_API_KEY = "mock-phala-api-key";
const RECIPIENT_PRIVATE_KEY_HEX = "11".repeat(32);

const FIXED_ENCRYPTION_INPUT = {
  deterministic: {
    ephemeralPrivateKeyHex: "22".repeat(32),
    saltHex: "33".repeat(32),
    ivHex: "44".repeat(12),
  },
} as const;

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

const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

type MockCall = {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};

const toHeaderRecord = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
};

async function main(): Promise<void> {
  const composeContent = [
    "services:",
    "  adviser:",
    "    image: ghcr.io/phala-network/sample:latest",
    "    restart: unless-stopped",
  ].join("\n");
  const composeHash = sha256Hex(composeContent);
  const quoteHex = "ab".repeat(256);
  const reportDataHex = "cd".repeat(32);
  const recipientPublicKeyHex = deriveX25519PublicKeyHex(RECIPIENT_PRIVATE_KEY_HEX);

  const mockCalls: MockCall[] = [];

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init?.method || "GET").toUpperCase();
    const reqHeaders = new Headers(init?.headers);
    const headers = toHeaderRecord(reqHeaders);
    const bodyText =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof Uint8Array
          ? Buffer.from(init.body).toString("utf8")
          : "";
    const body = bodyText ? JSON.parse(bodyText) : null;
    const pathname = new URL(url).pathname;
    const apiBasePath = new URL(MOCK_API_BASE).pathname.replace(/\/+$/, "");
    const cloudPath = pathname.startsWith(apiBasePath) ? pathname.slice(apiBasePath.length) || "/" : pathname;

    mockCalls.push({
      method,
      url,
      path: url.startsWith(MOCK_API_BASE) ? cloudPath : pathname,
      headers,
      body,
    });

    const json = (status: number, payload: unknown): Response =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url.startsWith(MOCK_APP_BASE)) {
      if (pathname === "/attestation") {
        return json(200, {
          quote: quoteHex,
          report_data: reportDataHex,
          event_log: [{ event: "compose-hash", digest: composeHash }],
        });
      }
      if (pathname === "/info") {
        return json(200, {
          tcb_info: {
            app_compose: composeContent,
          },
        });
      }
      return json(404, { error: `Unknown mock app endpoint ${pathname}` });
    }

    if (!url.startsWith(MOCK_API_BASE)) {
      return json(404, { error: `Unknown base URL ${url}` });
    }

    if (cloudPath === PHALA_ENDPOINTS.getCurrentUser && method === "GET") {
      return json(200, {
        user: { id: "user-001", email: "operator@example.com", wallet_address: "0x1234abcd" },
        workspace: { id: "workspace-001", name: "LN Ops" },
        credits: { balance: "120.50" },
      });
    }

    if (cloudPath === PHALA_ENDPOINTS.provisionCvm && method === "POST") {
      return json(200, {
        id: "cvm-draft-001",
        status: "provisioned",
        requestEcho: body,
      });
    }

    if (cloudPath === PHALA_ENDPOINTS.commitCvmProvision && method === "POST") {
      return json(200, {
        id: "cvm-001",
        status: "running",
        requestEcho: body,
      });
    }

    if (cloudPath === PHALA_ENDPOINTS.getCvmInfo("cvm-001") && method === "GET") {
      return json(200, {
        id: "cvm-001",
        name: "ln-advisor-cvm",
        status: "running",
        app_id: "app-001",
        kms: "kms-main",
        image: "ghcr.io/phala-network/sample:latest",
        compose_hash: composeHash,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:05:00.000Z",
      });
    }

    if (cloudPath === PHALA_ENDPOINTS.getKmsAppEnvEncryptPubKey("kms-main", "app-001") && method === "GET") {
      return json(200, {
        kms: "kms-main",
        app_id: "app-001",
        public_key: recipientPublicKeyHex,
      });
    }

    if (cloudPath === PHALA_ENDPOINTS.updateCvmEnvs("cvm-001") && method === "PATCH") {
      return json(200, {
        id: "cvm-001",
        status: "env-updated",
        accepted: Boolean(body && typeof body === "object" && "encrypted_env" in body),
      });
    }

    if (cloudPath === PHALA_ENDPOINTS.updateDockerCompose("cvm-001") && method === "PATCH") {
      return json(200, {
        id: "cvm-001",
        status: "compose-updated",
        compose_hash: composeHash,
      });
    }

    if (cloudPath === PHALA_ENDPOINTS.getCvmAttestation("cvm-001") && method === "GET") {
      return json(200, {
        quote: quoteHex,
        quote_format: "tdx_quote",
        report_data: reportDataHex,
        event_log: [{ event: "compose-hash", digest: composeHash }],
      });
    }

    if (cloudPath === PHALA_ENDPOINTS.verifyAttestation && method === "POST") {
      return json(200, {
        success: true,
        quote: {
          verified: true,
          quote_size: quoteHex.length / 2,
        },
      });
    }

    return json(404, { error: `Unknown mock cloud endpoint ${method} ${cloudPath}` });
  };

  const client = new PhalaCloudApiClient({
    apiBaseUrl: MOCK_API_BASE,
    apiVersion: PHALA_DEFAULT_API_VERSION,
    apiKey: MOCK_API_KEY,
    fetchImpl: mockFetch,
  });

  const user = await client.getCurrentUserV20260121();
  const provision = await client.provisionCvm({
    name: "ln-advisor-cvm",
    app_id: "app-001",
    compose_file: composeContent,
  });
  const commit = await client.commitCvmProvision({
    id: "cvm-001",
    source_provision_id: provision.data.id,
  });
  const cvmInfo = await client.getCvmInfoV20260121("cvm-001");
  const encryptedEnvUpdate = await client.updateEncryptedEnvs({
    cvmId: "cvm-001",
    kms: "kms-main",
    appId: "app-001",
    env: {
      ARB_SIGNING_KEY_REF: "kms://keys/arb-signer-v1",
      MODEL_VERSION: "fee-forward-v1",
    },
    deterministic: FIXED_ENCRYPTION_INPUT.deterministic,
  });
  const composeUpdate = await client.updateCvmDockerCompose("cvm-001", {
    docker_compose: composeContent,
  });
  const cvmAttestation = await client.getCvmAttestation("cvm-001");

  const verifierResult = await verifyPhalaApplicationAttestation({
    appBaseUrl: MOCK_APP_BASE,
    cloudClient: client,
    expectedReportDataHex: reportDataHex,
    fetchImpl: mockFetch,
  });

  assert(user.data.schemaVersion === "current-user-v20260121", "Phala Cloud failed: current-user schema parse mismatch.");
  assert(cvmInfo.data.schemaVersion === "cvm-info-v20260121", "Phala Cloud failed: cvm-info schema parse mismatch.");
  assert(Boolean(commit.data.id), "Phala Cloud failed: commit flow did not return cvm id.");
  assert(
    encryptedEnvUpdate.data.encryptedEnvBundle.schemaVersion === "phala-encrypted-env-v1",
    "Phala Cloud failed: encrypted env bundle schema mismatch."
  );
  assert(!!composeUpdate.data, "Phala Cloud failed: compose update response missing.");
  assert(cvmAttestation.data.quote === quoteHex, "Phala Cloud failed: CVM attestation quote mismatch.");
  assert(verifierResult.ok, "Phala Cloud failed: external verifier returned not-ok.");

  const cloudCalls = mockCalls.filter((call) => call.url.startsWith(MOCK_API_BASE));
  for (const call of cloudCalls) {
    assert(
      call.headers[PHALA_API_VERSION_HEADER.toLowerCase()] === PHALA_DEFAULT_API_VERSION,
      `Phala Cloud failed: missing ${PHALA_API_VERSION_HEADER} header on ${call.method} ${call.path}.`
    );
  }

  const calledPaths = cloudCalls.map((call) => `${call.method} ${call.path}`);
  const expectedFlow = [
    `POST ${PHALA_ENDPOINTS.provisionCvm}`,
    `POST ${PHALA_ENDPOINTS.commitCvmProvision}`,
    `PATCH ${PHALA_ENDPOINTS.updateCvmEnvs("cvm-001")}`,
    `PATCH ${PHALA_ENDPOINTS.updateDockerCompose("cvm-001")}`,
    `GET ${PHALA_ENDPOINTS.getCvmAttestation("cvm-001")}`,
    `POST ${PHALA_ENDPOINTS.verifyAttestation}`,
  ];

  for (const required of expectedFlow) {
    assert(calledPaths.includes(required), `Phala Cloud failed: missing expected API call ${required}.`);
  }

  const artifact = {
    schemaVersion: "phala-cloud-v1",
    api: {
      baseUrl: MOCK_API_BASE,
      versionHeader: PHALA_API_VERSION_HEADER,
      defaultVersion: PHALA_DEFAULT_API_VERSION,
      calledPaths,
      twoPhaseProvisionFlow: [
        `POST ${PHALA_ENDPOINTS.provisionCvm}`,
        `POST ${PHALA_ENDPOINTS.commitCvmProvision}`,
      ],
      composeUpdateFlow: [`PATCH ${PHALA_ENDPOINTS.updateDockerCompose("cvm-001")}`],
      encryptedEnvFlow: [
        `GET ${PHALA_ENDPOINTS.getKmsAppEnvEncryptPubKey("kms-main", "app-001")}`,
        `PATCH ${PHALA_ENDPOINTS.updateCvmEnvs("cvm-001")}`,
      ],
    },
    schemaParsers: {
      currentUser: user.data.schemaVersion,
      cvmInfo: cvmInfo.data.schemaVersion,
    },
    attestationVerifier: {
      result: verifierResult,
      cvmAttestationQuoteFormat: cvmAttestation.data.quoteFormat,
    },
    docs: {
      sdkApiVersioning: PHALA_DOC_LINKS.cloudSdkApiVersioning,
      secureEnvs: PHALA_DOC_LINKS.secureEnvVars,
      verifyApplication: PHALA_DOC_LINKS.attestationVerifyApp,
      verifyPlatform: PHALA_DOC_LINKS.attestationVerifyPlatform,
      gpuDeployVerify: PHALA_DOC_LINKS.confidentialGpuDeployVerify,
    },
    doneCondition:
      "Phala bootstrap covers versioned API calls, two-phase provision/commit, encrypted env update, compose update, and external attestation verification with deterministic local test evidence.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(sortObjectKeysDeep(artifact), null, 2)}\n`, "utf8");

  console.log(`Saved Phala Cloud artifact: ${ARTIFACT_PATH}`);
  console.log(`API calls captured: ${calledPaths.length}`);
  console.log(`Verifier status: ${verifierResult.ok ? "PASS" : "FAIL"}`);
  console.log("Phala Cloud test: PASS");
}

main().catch((error) => {
  console.error("Phala Cloud test failed.", error);
  process.exitCode = 1;
});

