import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LightningSnapshot } from "../src/connectors/types";
import { normalizeSnapshot } from "../src/normalization/normalizeSnapshot";

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
  const inputPathArg = process.argv[2];
  const inputPath = inputPathArg
    ? path.resolve(process.cwd(), inputPathArg)
    : path.resolve(process.cwd(), "artifacts", "lightning-snapshot.raw.json");
  const outputPath = path.resolve(process.cwd(), "artifacts", "lightning-snapshot.normalized.json");

  const rawContent = await readFile(inputPath, "utf8");
  const snapshot = JSON.parse(rawContent) as LightningSnapshot;
  const normalized = normalizeSnapshot(snapshot);

  await mkdir(path.dirname(outputPath), { recursive: true });
  const deterministicPayload = JSON.stringify(sortObjectKeysDeep(normalized), null, 2);
  await writeFile(outputPath, `${deterministicPayload}\n`, "utf8");

  console.log(`Input snapshot: ${inputPath}`);
  console.log(`Saved normalized snapshot: ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to normalize Lightning snapshot.", error);
  process.exitCode = 1;
});

