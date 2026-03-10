import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NormalizedNodeState } from "../src/normalization/types";
import { scoreNodeState } from "../src/scoring/scoreNodeState";

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
    : path.resolve(process.cwd(), "artifacts", "lightning-snapshot.normalized.json");
  const outputPath = path.resolve(process.cwd(), "artifacts", "recommendations.v1.json");

  const normalized = JSON.parse(await readFile(inputPath, "utf8")) as NormalizedNodeState;
  const recommendations = scoreNodeState(normalized);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(sortObjectKeysDeep(recommendations), null, 2)}\n`, "utf8");

  console.log(`Input normalized snapshot: ${inputPath}`);
  console.log(`Saved recommendations: ${outputPath}`);
  console.log(`Model version: ${recommendations.modelVersion}`);
  console.log(
    `Fee actions: raise=${recommendations.feeRecommendations.filter((r) => r.action === "raise").length}, ` +
      `lower=${recommendations.feeRecommendations.filter((r) => r.action === "lower").length}, ` +
      `hold=${recommendations.feeRecommendations.filter((r) => r.action === "hold").length}`
  );
}

main().catch((error) => {
  console.error("Scoring v1 run failed.", error);
  process.exitCode = 1;
});

