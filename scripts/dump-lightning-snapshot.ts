import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLightningSnapshot } from "../src/connectors/lightningSnapshot";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeysDeep(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      sorted[key] = sortObjectKeysDeep(record[key]);
    }
    return sorted;
  }

  return value;
};

async function main(): Promise<void> {
  const mockMode =
    process.argv.includes("--mock") ||
    process.env.LIGHTNING_SNAPSHOT_MODE?.trim().toLowerCase() === "mock";
  const snapshot = mockMode ? getMockLightningSnapshot() : await getLightningSnapshot();
  const outputPath = path.resolve(process.cwd(), "artifacts", "lightning-snapshot.raw.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const deterministicPayload = JSON.stringify(sortObjectKeysDeep(snapshot), null, 2);
  await writeFile(outputPath, `${deterministicPayload}\n`, "utf8");
  console.log(`Saved Lightning snapshot (${mockMode ? "mock" : "lnc"}): ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to dump Lightning snapshot.", error);
  process.exitCode = 1;
});
