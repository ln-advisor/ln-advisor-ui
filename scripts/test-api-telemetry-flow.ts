import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createApiServer } from "../src/api/server";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { snapshotToFrontendTelemetry } from "../src/connectors/frontendTelemetry";

const OUT_DIR = path.resolve(process.cwd(), "artifacts", "api");

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

async function postJson(url: string, payload: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const server = createApiServer();
  const port = 8789;
  await new Promise<void>((resolve) => server.listen(port, resolve));

  try {
    const telemetry = snapshotToFrontendTelemetry(getMockLightningSnapshot());
    const baseUrl = `http://127.0.0.1:${port}`;

    const snapshotResponse = await postJson(`${baseUrl}/api/snapshot`, {
      telemetry,
    });
    const recommendResponse = await postJson(`${baseUrl}/api/recommend`, {
      telemetry,
      privacyMode: "feature_only",
    });
    const verifyResponse = await postJson(`${baseUrl}/api/verify`, {
      arbPath: "artifacts/recommendation-bundle.arb.json",
      sourceProvenancePath: "artifacts/source-provenance.json",
    });

    await writeFile(path.resolve(OUT_DIR, "snapshot.json"), stableJson(snapshotResponse), "utf8");
    await writeFile(path.resolve(OUT_DIR, "recommend.json"), stableJson(recommendResponse), "utf8");
    await writeFile(path.resolve(OUT_DIR, "verify.json"), stableJson(verifyResponse), "utf8");

    console.log(`Saved API outputs:`);
    console.log(`- ${path.resolve(OUT_DIR, "snapshot.json")}`);
    console.log(`- ${path.resolve(OUT_DIR, "recommend.json")}`);
    console.log(`- ${path.resolve(OUT_DIR, "verify.json")}`);
    console.log("Telemetry API flow test: PASS");
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error("Telemetry API flow test failed.", error);
  process.exitCode = 1;
});
