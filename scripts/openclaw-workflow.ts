import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArbBundle } from "../src/arb/buildArb";
import { runOpenClawTask, type OpenClawTaskType } from "../src/openclaw/openclawCopilot";

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

const parseTaskType = (raw: string | undefined): OpenClawTaskType => {
  const value = (raw || "explain").trim().toLowerCase();
  if (value === "explain") return "explain_recommendation";
  if (value === "compare") return "compare_bundles";
  if (value === "draft") return "draft_fee_update_commands";
  throw new Error("Unknown task. Use one of: explain, compare, draft.");
};

async function main(): Promise<void> {
  const taskType = parseTaskType(process.argv[2]);
  const currentArbPathArg = process.argv[3] || "artifacts/recommendation-bundle.arb.json";
  const previousArbPathArg = process.argv[4];
  const optionalTextArg = process.argv[5];
  const topRankedArg = process.argv[6];

  const currentArbPath = path.resolve(process.cwd(), currentArbPathArg);
  const previousArbPath = previousArbPathArg ? path.resolve(process.cwd(), previousArbPathArg) : undefined;

  const currentArb = JSON.parse(await readFile(currentArbPath, "utf8")) as ArbBundle;
  const previousArb = previousArbPath
    ? (JSON.parse(await readFile(previousArbPath, "utf8")) as ArbBundle)
    : undefined;

  const includeTopRanked = topRankedArg ? Number.parseInt(topRankedArg, 10) : undefined;
  const result = runOpenClawTask({
    taskType,
    currentArb,
    previousArb,
    question: optionalTextArg,
    includeTopRanked,
    devSigningKey: process.env.ARB_DEV_SIGNING_KEY?.trim(),
  });

  const outputPath = path.resolve(process.cwd(), "artifacts", "openclaw.workflow.json");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(sortObjectKeysDeep(result), null, 2)}\n`, "utf8");

  console.log(`OpenClaw task: ${taskType}`);
  console.log(`Current ARB: ${currentArbPath}`);
  if (previousArbPath) {
    console.log(`Previous ARB: ${previousArbPath}`);
  }
  console.log(`Saved workflow result: ${outputPath}`);
}

main().catch((error) => {
  console.error("OpenClaw workflow failed.", error);
  process.exitCode = 1;
});

