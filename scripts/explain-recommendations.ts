import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArbBundle } from "../src/arb/buildArb";
import { explainRecommendations } from "../src/scoring/explainRecommendations";

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
  const arbPathArg = process.argv[2];
  const questionArg = process.argv[3];
  const topRankedArg = process.argv[4];

  const arbPath = arbPathArg
    ? path.resolve(process.cwd(), arbPathArg)
    : path.resolve(process.cwd(), "artifacts", "recommendation-bundle.arb.json");
  const outputPath = path.resolve(process.cwd(), "artifacts", "recommendations.explained.json");

  const arb = JSON.parse(await readFile(arbPath, "utf8")) as ArbBundle;
  const includeTopRanked = topRankedArg ? Number.parseInt(topRankedArg, 10) : undefined;
  const explained = explainRecommendations(arb, {
    question: questionArg,
    includeTopRanked,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  const deterministicPayload = JSON.stringify(sortObjectKeysDeep(explained), null, 2);
  await writeFile(outputPath, `${deterministicPayload}\n`, "utf8");

  console.log(`Input ARB: ${arbPath}`);
  console.log(`Saved explanation: ${outputPath}`);
  console.log(`Explained fee recommendations: ${explained.feeRecommendationExplanations.length}`);
  console.log(`Explained ranked channels: ${explained.forwardRankingExplanations.length}`);
}

main().catch((error) => {
  console.error("Failed to explain recommendations.", error);
  process.exitCode = 1;
});

