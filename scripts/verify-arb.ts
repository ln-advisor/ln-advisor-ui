import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ArbBundle } from "../src/arb/buildArb";
import type { SourceProvenanceReceipt } from "../src/arb/provenance";
import { verifyArb } from "../src/arb/verifyArb";

const DEFAULT_ARB_PATH = path.resolve(process.cwd(), "artifacts", "recommendation-bundle.arb.json");

const parseArbPath = (): string => {
  const arbPathArg = process.argv[2];
  return arbPathArg ? path.resolve(process.cwd(), arbPathArg) : DEFAULT_ARB_PATH;
};

const parseProvenancePath = (): string | null => {
  const provenanceArg = process.argv[3];
  if (!provenanceArg) return null;
  return path.resolve(process.cwd(), provenanceArg);
};

async function main(): Promise<void> {
  const arbPath = parseArbPath();
  const provenancePath = parseProvenancePath();

  const arb = JSON.parse(await readFile(arbPath, "utf8")) as ArbBundle;
  const provenance = provenancePath
    ? (JSON.parse(await readFile(provenancePath, "utf8")) as SourceProvenanceReceipt)
    : undefined;

  const devSigningKey = process.env.ARB_DEV_SIGNING_KEY?.trim();
  const verifyNow = process.env.ARB_VERIFY_NOW?.trim();

  const result = verifyArb({
    arb,
    sourceProvenance: provenance,
    devSigningKey,
    now: verifyNow || undefined,
  });

  console.log(`ARB path: ${arbPath}`);
  if (provenancePath) {
    console.log(`Provenance path: ${provenancePath}`);
  }

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.warn(`WARNING: ${warning}`);
    }
  }

  if (result.ok) {
    console.log("ARB verification: PASS");
    return;
  }

  console.error("ARB verification: FAIL");
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Failed to verify ARB.", error);
  process.exitCode = 1;
});

