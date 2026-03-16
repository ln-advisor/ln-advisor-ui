import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createApiServer } from "../src/api/server";
import { snapshotToFrontendTelemetry } from "../src/connectors/frontendTelemetry";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step35.retention-policy.json");
const RETENTION_DIR = path.resolve(process.cwd(), "artifacts", "retention");
const PORT = 8797;
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";

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

const stableJson = (value: unknown): string => `${JSON.stringify(sortObjectKeysDeep(value), null, 2)}\n`;

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

async function postJson(
  url: string,
  payload: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const telemetry = snapshotToFrontendTelemetry(getMockLightningSnapshot());
  const server = createApiServer();
  await rm(RETENTION_DIR, { recursive: true, force: true });
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    const baseUrl = `http://127.0.0.1:${PORT}`;
    const noneResponse = await postJson(`${baseUrl}/api/recommend`, {
      telemetry,
      privacyMode: "feature_only",
      retentionMode: "none",
      issuedAt: FIXED_ISSUED_AT,
    });
    assert(noneResponse.status === 200, "Step35 failed: retention none request did not return 200.");
    assert(noneResponse.body.retention?.retained === false, "Step35 failed: default retention should not persist data.");

    const featureResponse = await postJson(`${baseUrl}/api/recommend`, {
      telemetry,
      privacyMode: "feature_only",
      retentionMode: "feature_only_opt_in",
      issuedAt: FIXED_ISSUED_AT,
    });
    assert(featureResponse.status === 200, "Step35 failed: feature_only retention request did not return 200.");
    const featurePath = String(featureResponse.body.retention?.artifactPath || "");
    assert(featureResponse.body.retention?.retained === true, "Step35 failed: feature-only retention should persist data.");
    assert(await fileExists(featurePath), "Step35 failed: feature-only retention artifact is missing.");
    const featurePayload = JSON.parse(await readFile(featurePath, "utf8")) as Record<string, unknown>;
    assert(featurePayload.privacyMode === "feature_only", "Step35 failed: retained feature-only payload has wrong privacyMode.");

    const bandedResponse = await postJson(`${baseUrl}/api/recommend`, {
      telemetry,
      privacyMode: "feature_only",
      retentionMode: "banded_opt_in",
      issuedAt: FIXED_ISSUED_AT,
    });
    assert(bandedResponse.status === 200, "Step35 failed: banded retention request did not return 200.");
    const bandedPath = String(bandedResponse.body.retention?.artifactPath || "");
    assert(bandedResponse.body.retention?.retained === true, "Step35 failed: banded retention should persist data.");
    assert(await fileExists(bandedPath), "Step35 failed: banded retention artifact is missing.");
    const bandedRaw = await readFile(bandedPath, "utf8");
    const bandedPayload = JSON.parse(bandedRaw) as Record<string, unknown>;
    assert(bandedPayload.privacyMode === "banded", "Step35 failed: retained banded payload has wrong privacyMode.");
    assert(!bandedRaw.includes("\"channelId\""), "Step35 failed: banded retention leaked exact channelId.");
    assert(!bandedRaw.includes("\"localBalanceSat\""), "Step35 failed: banded retention leaked exact localBalanceSat.");
    assert(!bandedRaw.includes("\"remoteBalanceSat\""), "Step35 failed: banded retention leaked exact remoteBalanceSat.");

    const artifact = {
      schemaVersion: "step35-retention-policy-v1",
      noneMode: noneResponse.body.retention,
      featureOnlyMode: featureResponse.body.retention,
      bandedMode: bandedResponse.body.retention,
      doneCondition:
        "API retention is off by default and opt-in modes only persist privacy-transformed feature_only or banded artifacts, never raw telemetry snapshots.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 35 artifact: ${ARTIFACT_PATH}`);
    console.log(`Default retention disabled: ${noneResponse.body.retention?.retained === false}`);
    console.log(`Feature-only retention persisted: ${featureResponse.body.retention?.retained === true}`);
    console.log(`Banded retention persisted: ${bandedResponse.body.retention?.retained === true}`);
    console.log("Step 35 retention policy test: PASS");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error("Step 35 retention policy test failed.", error);
  process.exitCode = 1;
});
