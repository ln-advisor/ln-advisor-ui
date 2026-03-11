import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import {
  snapshotToFrontendTelemetry,
  telemetryToLightningSnapshot,
} from "../src/connectors/frontendTelemetry";
import type { FrontendTelemetryEnvelope } from "../src/connectors/types";

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

const cliArgs = process.argv.slice(2);
const hasMockFlag = cliArgs.includes("--mock");
const inputArg = cliArgs.find((arg) => !arg.startsWith("--"));

async function main(): Promise<void> {
  const artifactDir = path.resolve(process.cwd(), "artifacts");
  await mkdir(artifactDir, { recursive: true });

  const telemetry: FrontendTelemetryEnvelope = hasMockFlag || !inputArg
    ? snapshotToFrontendTelemetry(getMockLightningSnapshot())
    : (JSON.parse(await readFile(path.resolve(process.cwd(), inputArg), "utf8")) as FrontendTelemetryEnvelope);

  const snapshot = telemetryToLightningSnapshot(telemetry);
  const telemetryPath = path.resolve(artifactDir, "frontend-telemetry.raw.json");
  const snapshotPath = path.resolve(artifactDir, "lightning-snapshot.raw.json");

  await writeFile(telemetryPath, stableJson(telemetry), "utf8");
  await writeFile(snapshotPath, stableJson(snapshot), "utf8");

  console.log(`Saved frontend telemetry artifact: ${telemetryPath}`);
  console.log(`Saved converted Lightning snapshot artifact: ${snapshotPath}`);
  console.log(`Telemetry schema: ${telemetry.schemaVersion}`);
  console.log(`Snapshot sourceType: ${snapshot.sourceType}`);
}

main().catch((error) => {
  console.error("Failed to validate frontend telemetry.", error);
  process.exitCode = 1;
});
