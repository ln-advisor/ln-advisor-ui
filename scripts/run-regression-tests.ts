import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LightningSnapshot } from "../src/connectors/types";
import { normalizeSnapshot } from "../src/normalization/normalizeSnapshot";
import { applyPrivacyPolicy } from "../src/privacy/applyPrivacyPolicy";
import { scoreNodeState } from "../src/scoring/scoreNodeState";
import { generateSourceProvenanceReceipt } from "../src/arb/provenance";
import { buildArb } from "../src/arb/buildArb";
import { verifyArb } from "../src/arb/verifyArb";

type JsonObject = Record<string, unknown>;

const FIXTURE_ROOT = path.resolve(process.cwd(), "tests", "fixtures");
const SCENARIOS = ["small-node", "medium-node", "noisy-node", "imbalanced-node"] as const;
const DEV_SIGNING_KEY = "fixture-dev-signing-key";
const FIXED_ISSUED_AT = "2026-01-01T00:00:00.000Z";
const FIXED_VERIFY_NOW = "2026-01-01T12:00:00.000Z";

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortObjectKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeysDeep(item));
  }
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

const canonicalJson = (value: unknown): string => JSON.stringify(sortObjectKeysDeep(value));

const readJsonFile = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, "utf8")) as T;

const assertCanonicalEqual = (name: string, actual: unknown, expected: unknown): void => {
  const actualCanonical = canonicalJson(actual);
  const expectedCanonical = canonicalJson(expected);
  if (actualCanonical !== expectedCanonical) {
    throw new Error(
      `${name} mismatch.\nExpected:\n${JSON.stringify(sortObjectKeysDeep(expected), null, 2)}\n\nActual:\n${JSON.stringify(
        sortObjectKeysDeep(actual),
        null,
        2
      )}`
    );
  }
};

const buildNormalizedProjection = (normalized: ReturnType<typeof normalizeSnapshot>): JsonObject => ({
  schemaVersion: "expected-normalized-v1",
  channelCount: normalized.channelCount,
  totals: normalized.totals,
  channels: [...normalized.channels]
    .sort((a, b) => compareText(a.channelId, b.channelId))
    .map((channel) => ({
      channelId: channel.channelId,
      active: channel.active,
      localBalanceRatio: channel.localBalanceRatio,
      remoteBalanceRatio: channel.remoteBalanceRatio,
      outboundFeePpm: channel.outboundFeePpm,
      inboundFeePpm: channel.inboundFeePpm,
      forwardCountTotal: channel.forwardCountTotal,
      revenueSat: channel.revenueSat,
      failedForwardCount: channel.failedForwardCount,
      lastActivityTimestamp: channel.lastActivityTimestamp,
    })),
  peers: [...normalized.peers]
    .sort((a, b) => compareText(a.peerPubkey, b.peerPubkey))
    .map((peer) => ({
      peerPubkey: peer.peerPubkey,
      channelCount: peer.channelCount,
      avgLocalBalanceRatio: peer.avgLocalBalanceRatio,
      avgRemoteBalanceRatio: peer.avgRemoteBalanceRatio,
      avgOutboundFeePpm: peer.avgOutboundFeePpm,
      totalForwardCount: peer.totalForwardCount,
      totalRevenueSat: peer.totalRevenueSat,
      totalFailedForwardCount: peer.totalFailedForwardCount,
      lastActivityTimestamp: peer.lastActivityTimestamp,
    })),
});

const buildFeatureProjection = (
  featureOnly: ReturnType<typeof applyPrivacyPolicy>
): JsonObject => {
  if (featureOnly.privacyMode !== "feature_only") {
    throw new Error(`Expected feature_only mode in feature projection, got: ${featureOnly.privacyMode}`);
  }

  return {
    schemaVersion: "expected-privacy-feature-v1",
    privacyMode: featureOnly.privacyMode,
    channelCount: featureOnly.channelCount,
    totals: featureOnly.totals,
    channels: [...featureOnly.channels]
      .sort((a, b) => compareText(a.channelRef, b.channelRef))
      .map((channel) => ({
        channelRef: channel.channelRef,
        peerRef: channel.peerRef,
        active: channel.active,
        localBalanceRatio: channel.localBalanceRatio,
        remoteBalanceRatio: channel.remoteBalanceRatio,
        outboundFeePpm: channel.outboundFeePpm,
        inboundFeePpm: channel.inboundFeePpm,
        forwardCountTotal: channel.forwardCountTotal,
        revenueSat: channel.revenueSat,
        failedForwardCount: channel.failedForwardCount,
      })),
    peers: [...featureOnly.peers]
      .sort((a, b) => compareText(a.peerRef, b.peerRef))
      .map((peer) => ({
        peerRef: peer.peerRef,
        channelCount: peer.channelCount,
        avgLocalBalanceRatio: peer.avgLocalBalanceRatio,
        avgRemoteBalanceRatio: peer.avgRemoteBalanceRatio,
        avgOutboundFeePpm: peer.avgOutboundFeePpm,
        totalForwardCount: peer.totalForwardCount,
        totalRevenueSat: peer.totalRevenueSat,
        totalFailedForwardCount: peer.totalFailedForwardCount,
      })),
  };
};

const buildBandedProjection = (banded: ReturnType<typeof applyPrivacyPolicy>): JsonObject => {
  if (banded.privacyMode !== "banded") {
    throw new Error(`Expected banded mode in banded projection, got: ${banded.privacyMode}`);
  }

  return {
    schemaVersion: "expected-privacy-banded-v1",
    privacyMode: banded.privacyMode,
    channelCount: banded.channelCount,
    totals: banded.totals,
    channels: [...banded.channels]
      .sort((a, b) => compareText(a.channelRef, b.channelRef))
      .map((channel) => ({
        channelRef: channel.channelRef,
        peerRef: channel.peerRef,
        active: channel.active,
        liquidityBand: channel.liquidityBand,
        channelPerformanceBand: channel.channelPerformanceBand,
        feeCompetitivenessBand: channel.feeCompetitivenessBand,
        failedForwardPressure: channel.failedForwardPressure,
      })),
    peers: [...banded.peers]
      .sort((a, b) => compareText(a.peerRef, b.peerRef))
      .map((peer) => ({
        peerRef: peer.peerRef,
        channelCount: peer.channelCount,
        activeChannelCount: peer.activeChannelCount,
        liquidityBand: peer.liquidityBand,
        channelPerformanceBand: peer.channelPerformanceBand,
        feeCompetitivenessBand: peer.feeCompetitivenessBand,
        failedForwardPressure: peer.failedForwardPressure,
      })),
  };
};

const buildRecommendationProjection = (
  recommendation: ReturnType<typeof scoreNodeState>,
  arb: ReturnType<typeof buildArb>,
  verifyPass: boolean
): JsonObject => ({
  schemaVersion: "expected-recommendation-bundle-v1",
  modelVersion: recommendation.modelVersion,
  feeActions: [...recommendation.feeRecommendations]
    .sort((a, b) => compareText(a.channelId, b.channelId))
    .map((item) => ({
      channelId: item.channelId,
      action: item.action,
      suggestedFeePpm: item.suggestedFeePpm,
    })),
  rankingOrder: [...recommendation.forwardOpportunityRanking]
    .sort((a, b) => a.rank - b.rank || compareText(a.channelId, b.channelId))
    .map((item) => item.channelId),
  arb: {
    arbVersion: arb.arbVersion,
    recommendationType: arb.recommendationType,
    privacyPolicyId: arb.privacyPolicyId,
    modelVersion: arb.modelVersion,
    signatureAlgorithm: arb.signature.algorithm,
    verificationPass: verifyPass,
  },
});

const runScenario = async (scenario: string): Promise<void> => {
  const scenarioDir = path.resolve(FIXTURE_ROOT, scenario);
  const rawPath = path.resolve(scenarioDir, "lightning-snapshot.raw.json");
  const expectedNormalizedPath = path.resolve(scenarioDir, "expected.normalized.json");
  const expectedFeaturePath = path.resolve(scenarioDir, "expected.privacy.feature-only.json");
  const expectedBandedPath = path.resolve(scenarioDir, "expected.privacy.banded.json");
  const expectedRecommendationPath = path.resolve(scenarioDir, "expected.recommendation-bundle.json");

  const rawSnapshot = await readJsonFile<LightningSnapshot>(rawPath);
  const expectedNormalized = await readJsonFile<JsonObject>(expectedNormalizedPath);
  const expectedFeature = await readJsonFile<JsonObject>(expectedFeaturePath);
  const expectedBanded = await readJsonFile<JsonObject>(expectedBandedPath);
  const expectedRecommendation = await readJsonFile<JsonObject>(expectedRecommendationPath);

  const normalized = normalizeSnapshot(rawSnapshot);
  const featureOnly = applyPrivacyPolicy(normalized, "feature_only");
  const banded = applyPrivacyPolicy(normalized, "banded");
  const recommendation = scoreNodeState(normalized);
  const recommendationAgain = scoreNodeState(normalized);
  const provenance = generateSourceProvenanceReceipt(rawSnapshot, normalized);
  const arb = buildArb({
    recommendation,
    sourceProvenance: provenance,
    privacyPolicyId: "feature_only",
    devSigningKey: DEV_SIGNING_KEY,
    issuedAt: FIXED_ISSUED_AT,
    ttlSeconds: 86_400,
  });
  const verifyResult = verifyArb({
    arb,
    sourceProvenance: provenance,
    devSigningKey: DEV_SIGNING_KEY,
    now: FIXED_VERIFY_NOW,
  });

  if (!verifyResult.ok) {
    throw new Error(`Scenario ${scenario}: generated ARB failed verification: ${verifyResult.errors.join(" | ")}`);
  }

  assertCanonicalEqual(
    `Scenario ${scenario} recommendation determinism`,
    recommendation,
    recommendationAgain
  );

  const normalizedProjection = buildNormalizedProjection(normalized);
  const featureProjection = buildFeatureProjection(featureOnly);
  const bandedProjection = buildBandedProjection(banded);
  const recommendationProjection = buildRecommendationProjection(recommendation, arb, verifyResult.ok);

  assertCanonicalEqual(`Scenario ${scenario} normalized`, normalizedProjection, expectedNormalized);
  assertCanonicalEqual(`Scenario ${scenario} privacy feature_only`, featureProjection, expectedFeature);
  assertCanonicalEqual(`Scenario ${scenario} privacy banded`, bandedProjection, expectedBanded);
  assertCanonicalEqual(
    `Scenario ${scenario} recommendation bundle`,
    recommendationProjection,
    expectedRecommendation
  );
};

async function main(): Promise<void> {
  for (const scenario of SCENARIOS) {
    await runScenario(scenario);
    console.log(`PASS ${scenario}`);
  }
  console.log(`All regression scenarios passed (${SCENARIOS.length}).`);
}

main().catch((error) => {
  console.error("Regression test failed.", error);
  process.exitCode = 1;
});

