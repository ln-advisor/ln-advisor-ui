export const PHALA_PLATFORM_URL = "https://cloud.phala.com";
export const PHALA_DOCS_URL = "https://docs.phala.com";
export const PHALA_CLOUD_API_BASE_URL = "https://cloud-api.phala.network/api/v1";

export const PHALA_DEFAULT_API_VERSION = "2026-01-21" as const;
export const PHALA_LEGACY_API_VERSION = "2025-10-28" as const;

export const PHALA_API_VERSION_HEADER = "X-Phala-Version" as const;
export const PHALA_AUTH_HEADER = "Authorization" as const;
export const PHALA_API_KEY_HEADER = "X-API-Key" as const;

export const PHALA_DOC_LINKS = {
  platform: "https://docs.phala.com/",
  cloudConsole: "https://cloud.phala.com/",
  cloudSdkOverview: "https://docs.phala.com/phala-cloud/references/cloud-js-sdk/overview",
  cloudSdkApiVersioning: "https://docs.phala.com/phala-cloud/references/cloud-js-sdk/api-versioning",
  cloudSdkSchemaReference: "https://docs.phala.com/phala-cloud/references/cloud-js-sdk/schema-reference",
  cloudApiOverview: "https://docs.phala.com/phala-cloud/phala-cloud-api/overview",
  attestationOverview: "https://docs.phala.com/phala-cloud/attestation/overview",
  attestationGet: "https://docs.phala.com/phala-cloud/attestation/get-attestation",
  attestationVerifyApp: "https://docs.phala.com/phala-cloud/attestation/verify-your-application",
  attestationVerifyPlatform: "https://docs.phala.com/phala-cloud/attestation/verify-the-platform",
  attestationFields: "https://docs.phala.com/phala-cloud/attestation/attestation-fields",
  attestationApiReference: "https://docs.phala.com/phala-cloud/phala-cloud-api/attestations",
  secureEnvVars: "https://docs.phala.com/phala-cloud/cvm/set-secure-environment-variables",
  confidentialGpuDeployVerify:
    "https://docs.phala.com/phala-cloud/confidential-ai/confidential-gpu/deploy-and-verify",
  dstackOverview: "https://docs.phala.com/dstack/overview",
  dstackGettingStarted: "https://docs.phala.com/dstack/getting-started",
  dstackLocalDev: "https://docs.phala.com/dstack/local-development",
} as const;

export const PHALA_ENDPOINTS = {
  provisionCvm: "/cvms/provision",
  commitCvmProvision: "/cvms",
  updateCvmEnvs: (cvmId: string): string => `/cvms/${encodeURIComponent(cvmId)}/envs`,
  updateDockerCompose: (cvmId: string): string => `/cvms/${encodeURIComponent(cvmId)}/docker-compose`,
  getKmsAppEnvEncryptPubKey: (kms: string, appId: string): string =>
    `/kms/${encodeURIComponent(kms)}/pubkey/${encodeURIComponent(appId)}`,
  getCvmAttestation: (cvmId: string): string => `/cvms/${encodeURIComponent(cvmId)}/attestation`,
  verifyAttestation: "/attestations/verify",
  getCurrentUser: "/auth/me",
  getCvmInfo: (cvmId: string): string => `/cvms/${encodeURIComponent(cvmId)}`,
} as const;
