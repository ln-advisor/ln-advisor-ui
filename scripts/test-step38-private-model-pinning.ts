import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildArb } from "../src/arb/buildArb";
import { generateSourceProvenanceReceipt } from "../src/arb/provenance";
import { verifyArb } from "../src/arb/verifyArb";
import { getMockLightningSnapshot } from "../src/connectors/mockLightningSnapshot";
import { normalizeSnapshot } from "../src/normalization/normalizeSnapshot";
import { applyPrivacyPolicy } from "../src/privacy/applyPrivacyPolicy";
import { scoreNodeState } from "../src/scoring/scoreNodeState";
import {
  buildPrivateModelServiceManifest,
  getPinnedModelManifestHash,
} from "../src/scoring/modelManifest";

const ARTIFACT_PATH = path.resolve(process.cwd(), "artifacts", "step38.private-model-pinning.json");
const DOCKERFILE_PATH = path.resolve(process.cwd(), "deploy", "phala-props-service", "Dockerfile");
const COMPOSE_PATH = path.resolve(process.cwd(), "deploy", "phala-props-service", "docker-compose.yml");
const ENV_EXAMPLE_PATH = path.resolve(process.cwd(), "deploy", "phala-props-service", ".env.example");
const DEPLOY_SCRIPT_PATH = path.resolve(process.cwd(), "scripts", "phala-props-deploy.sh");
const FIXED_SIGNING_KEY = "step38-dev-signing-key";
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";

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

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const rawSnapshot = getMockLightningSnapshot();
  const normalized = normalizeSnapshot(rawSnapshot);
  const featureOnly = applyPrivacyPolicy(normalized, "feature_only");
  const recommendation = scoreNodeState(featureOnly, {
    nodePubkey: normalized.nodePubkey,
    nodeAlias: normalized.nodeAlias,
    collectedAt: normalized.collectedAt,
  });

  const privateManifest = buildPrivateModelServiceManifest({
    serviceLocator: "phala://ln-advisor-props-api",
    serviceIdentity: "phala-props-cvm-service-v1",
    environmentId: "ln-advisor-phala-cpu-cvm-v1",
  });
  const provenance = generateSourceProvenanceReceipt(rawSnapshot, normalized, {
    modelManifest: privateManifest,
    privacyTransformedSnapshot: featureOnly,
  });
  const arb = buildArb({
    recommendation,
    sourceProvenance: provenance,
    privacyPolicyId: "feature_only",
    devSigningKey: FIXED_SIGNING_KEY,
    modelManifest: privateManifest,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86400,
  });
  const verifyResult = verifyArb({
    arb,
    sourceProvenance: provenance,
    devSigningKey: FIXED_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });

  assert(verifyResult.ok, `Step38 failed: private-model ARB did not verify (${verifyResult.errors.join(" | ")})`);
  assert(
    arb.modelPinningMode === "service_pinned_private_model",
    "Step38 failed: ARB did not preserve service_pinned_private_model pinning mode."
  );

  const filesExist = {
    dockerfile: await exists(DOCKERFILE_PATH),
    compose: await exists(COMPOSE_PATH),
    envExample: await exists(ENV_EXAMPLE_PATH),
    deployScript: await exists(DEPLOY_SCRIPT_PATH),
  };
  assert(Object.values(filesExist).every(Boolean), "Step38 failed: Phala deploy scaffold files are missing.");

  const composeSource = await readFile(COMPOSE_PATH, "utf8");
  const deployScriptSource = await readFile(DEPLOY_SCRIPT_PATH, "utf8");
  assert(composeSource.includes("/var/run/dstack.sock"), "Step38 failed: compose file is missing dstack.sock mount.");
  assert(composeSource.includes("8787:8787"), "Step38 failed: compose file is missing API port mapping.");
  assert(deployScriptSource.includes("phala deploy"), "Step38 failed: deploy script does not call phala deploy.");

  const artifact = {
    schemaVersion: "step38-private-model-pinning-v1",
    privateManifest,
    modelManifestHash: getPinnedModelManifestHash(privateManifest),
    arb: {
      modelPinningMode: arb.modelPinningMode,
      modelManifestHash: arb.modelManifestHash,
    },
    verifyResult,
    deployScaffold: {
      filesExist,
      dockerfilePath: DOCKERFILE_PATH,
      composePath: COMPOSE_PATH,
      envExamplePath: ENV_EXAMPLE_PATH,
      deployScriptPath: DEPLOY_SCRIPT_PATH,
    },
    doneCondition:
      "The pipeline can bind outputs to service_pinned_private_model manifests and the repo contains a minimal Phala deploy scaffold for hosting the current API on a CPU CVM.",
  };

  await mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, stableJson(artifact), "utf8");

  console.log(`Saved Step 38 artifact: ${ARTIFACT_PATH}`);
  console.log(`Private model manifest hash: ${artifact.modelManifestHash}`);
  console.log(`Deploy scaffold ready: ${Object.values(filesExist).every(Boolean)}`);
  console.log("Step 38 private-model pinning test: PASS");
}

main().catch((error) => {
  console.error("Step 38 private-model pinning test failed.", error);
  process.exitCode = 1;
});
