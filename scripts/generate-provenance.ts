import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LightningSnapshot } from "../src/connectors/types";
import type { NormalizedNodeState } from "../src/normalization/types";
import { generateSourceProvenanceReceipt } from "../src/arb/provenance";

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
  const rawPathArg = process.argv[2];
  const normalizedPathArg = process.argv[3];
  const privacyPathArg = process.argv[4];

  const rawSnapshotPath = rawPathArg
    ? path.resolve(process.cwd(), rawPathArg)
    : path.resolve(process.cwd(), "artifacts", "lightning-snapshot.raw.json");
  const normalizedSnapshotPath = normalizedPathArg
    ? path.resolve(process.cwd(), normalizedPathArg)
    : path.resolve(process.cwd(), "artifacts", "lightning-snapshot.normalized.json");
  const outputPath = path.resolve(process.cwd(), "artifacts", "source-provenance.json");
  const privacySnapshotPath = privacyPathArg
    ? path.resolve(process.cwd(), privacyPathArg)
    : path.resolve(process.cwd(), "artifacts", "node-state.feature-only.json");

  const rawSnapshot = JSON.parse(await readFile(rawSnapshotPath, "utf8")) as LightningSnapshot;
  const normalizedSnapshot = JSON.parse(await readFile(normalizedSnapshotPath, "utf8")) as NormalizedNodeState;
  let privacySnapshot: unknown = null;
  try {
    privacySnapshot = JSON.parse(await readFile(privacySnapshotPath, "utf8"));
  } catch {
    privacySnapshot = null;
  }
  const receipt = generateSourceProvenanceReceipt(rawSnapshot, normalizedSnapshot, {
    privacyTransformedSnapshot: privacySnapshot || undefined,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  const deterministicPayload = JSON.stringify(sortObjectKeysDeep(receipt), null, 2);
  await writeFile(outputPath, `${deterministicPayload}\n`, "utf8");

  console.log(`Raw snapshot: ${rawSnapshotPath}`);
  console.log(`Normalized snapshot: ${normalizedSnapshotPath}`);
  if (privacySnapshot) {
    console.log(`Privacy snapshot: ${privacySnapshotPath}`);
  }
  console.log(`Saved provenance receipt: ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to generate provenance receipt.", error);
  process.exitCode = 1;
});
