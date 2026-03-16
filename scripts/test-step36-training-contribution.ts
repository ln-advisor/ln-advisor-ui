import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createApiServer } from "../src/api/server";
import { snapshotToFrontendTelemetry } from "../src/connectors/frontendTelemetry";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step36.training-contribution.json");
const PORT = 8798;
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

const canonicalJson = (value: unknown): string => JSON.stringify(sortObjectKeysDeep(value));
const sha256Hex = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
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

async function main(): Promise<void> {
  const telemetry = snapshotToFrontendTelemetry(getMockLightningSnapshot());
  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    const baseUrl = `http://127.0.0.1:${PORT}`;
    const noneResponse = await postJson(`${baseUrl}/api/recommend`, {
      telemetry,
      privacyMode: "feature_only",
      retentionMode: "none",
      issuedAt: FIXED_ISSUED_AT,
    });
    assert(noneResponse.status === 200, "Step36 failed: retention none request did not return 200.");
    assert(
      noneResponse.body.trainingContribution === null,
      "Step36 failed: training contribution receipt should be null when retention is disabled."
    );

    const featureResponse = await postJson(`${baseUrl}/api/recommend`, {
      telemetry,
      privacyMode: "feature_only",
      retentionMode: "feature_only_opt_in",
      issuedAt: FIXED_ISSUED_AT,
    });
    assert(featureResponse.status === 200, "Step36 failed: feature_only retention request did not return 200.");
    const featureReceipt = featureResponse.body.trainingContribution as Record<string, unknown> | null;
    assert(featureReceipt, "Step36 failed: feature-only receipt is missing.");

    const featureArtifact = JSON.parse(await readFile(String(featureReceipt?.artifactPath || ""), "utf8"));
    const featureReceiptFile = JSON.parse(await readFile(String(featureReceipt?.receiptPath || ""), "utf8"));
    assert(
      featureReceipt?.featurePayloadHash === sha256Hex(featureArtifact),
      "Step36 failed: feature-only receipt payload hash mismatch."
    );
    assert(
      featureReceipt?.sourceProvenanceHash === sha256Hex(featureResponse.body.sourceProvenance),
      "Step36 failed: feature-only receipt provenance hash mismatch."
    );
    assert(
      featureReceiptFile?.privacyMode === "feature_only",
      "Step36 failed: feature-only receipt file has wrong privacyMode."
    );

    const bandedResponse = await postJson(`${baseUrl}/api/recommend`, {
      telemetry,
      privacyMode: "feature_only",
      retentionMode: "banded_opt_in",
      issuedAt: FIXED_ISSUED_AT,
    });
    assert(bandedResponse.status === 200, "Step36 failed: banded retention request did not return 200.");
    const bandedReceipt = bandedResponse.body.trainingContribution as Record<string, unknown> | null;
    assert(bandedReceipt, "Step36 failed: banded receipt is missing.");
    const bandedReceiptFile = JSON.parse(await readFile(String(bandedReceipt?.receiptPath || ""), "utf8"));
    assert(
      bandedReceiptFile?.privacyMode === "banded",
      "Step36 failed: banded receipt file has wrong privacyMode."
    );

    const artifact = {
      schemaVersion: "step36-training-contribution-v1",
      noneModeReceipt: noneResponse.body.trainingContribution,
      featureOnlyReceipt: featureReceipt,
      bandedReceipt,
      doneCondition:
        "Opt-in retained contributions now produce a hashed contribution receipt bound to provenance and model manifest, while no-retention mode produces no receipt.",
    };

    await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

    console.log(`Saved Step 36 artifact: ${ARTIFACT_PATH}`);
    console.log(`No-retention receipt omitted: ${noneResponse.body.trainingContribution === null}`);
    console.log(`Feature-only receipt created: ${Boolean(featureReceipt)}`);
    console.log(`Banded receipt created: ${Boolean(bandedReceipt)}`);
    console.log("Step 36 training contribution test: PASS");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error("Step 36 training contribution test failed.", error);
  process.exitCode = 1;
});
