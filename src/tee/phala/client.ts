import {
  PHALA_API_KEY_HEADER,
  PHALA_API_VERSION_HEADER,
  PHALA_AUTH_HEADER,
  PHALA_CLOUD_API_BASE_URL,
  PHALA_DEFAULT_API_VERSION,
  PHALA_ENDPOINTS,
} from "./constants";
import { encryptEnvMapForPhala, type EncryptEnvMapOptions, type EncryptEnvMapResult } from "./encryptedEnv";
import {
  parseAttestationVerifyResponse,
  parseCommitResponse,
  parseCurrentUserV20260121,
  parseCvmAttestationResponse,
  parseCvmInfoV20260121,
  parseKmsPubKeyResponse,
  parseProvisionResponse,
  type CvmInfoV20260121,
  type CurrentUserV20260121,
  type PhalaApiRequestOptions,
  type PhalaApiVersion,
  type PhalaAttestationVerifyResponse,
  type PhalaClientResponse,
  type PhalaCommitResponse,
  type PhalaCvmAttestationResponse,
  type PhalaKmsPubKeyResponse,
  type PhalaProvisionResponse,
} from "./types";

const joinUrl = (baseUrl: string, pathname: string): string => {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${normalizedBase}${normalizedPath}`;
};

const asMessage = (value: unknown): string => (value instanceof Error ? value.message : String(value));

export interface PhalaCloudApiClientOptions {
  apiKey?: string;
  apiBaseUrl?: string;
  apiVersion?: PhalaApiVersion;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface PhalaRequestContext {
  url: string;
  method: string;
  body?: unknown;
}

export class PhalaCloudApiClient {
  readonly apiBaseUrl: string;
  readonly apiVersion: PhalaApiVersion;
  readonly timeoutMs: number;

  private readonly apiKey: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PhalaCloudApiClientOptions = {}) {
    this.apiBaseUrl = (options.apiBaseUrl || PHALA_CLOUD_API_BASE_URL).trim().replace(/\/+$/, "");
    this.apiVersion = options.apiVersion || PHALA_DEFAULT_API_VERSION;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.apiKey = options.apiKey?.trim() || null;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async getCurrentUserV20260121(options?: PhalaApiRequestOptions): Promise<PhalaClientResponse<CurrentUserV20260121>> {
    const response = await this.requestJson("GET", PHALA_ENDPOINTS.getCurrentUser, undefined, options);
    return {
      data: parseCurrentUserV20260121(response.data),
      meta: response.meta,
    };
  }

  async getCvmInfoV20260121(
    cvmId: string,
    options?: PhalaApiRequestOptions
  ): Promise<PhalaClientResponse<CvmInfoV20260121>> {
    const response = await this.requestJson("GET", PHALA_ENDPOINTS.getCvmInfo(cvmId), undefined, options);
    return {
      data: parseCvmInfoV20260121(response.data),
      meta: response.meta,
    };
  }

  async provisionCvm(
    payload: Record<string, unknown>,
    options?: PhalaApiRequestOptions
  ): Promise<PhalaClientResponse<PhalaProvisionResponse>> {
    const response = await this.requestJson("POST", PHALA_ENDPOINTS.provisionCvm, payload, options);
    return {
      data: parseProvisionResponse(response.data),
      meta: response.meta,
    };
  }

  async commitCvmProvision(
    payload: Record<string, unknown>,
    options?: PhalaApiRequestOptions
  ): Promise<PhalaClientResponse<PhalaCommitResponse>> {
    const response = await this.requestJson("POST", PHALA_ENDPOINTS.commitCvmProvision, payload, options);
    return {
      data: parseCommitResponse(response.data),
      meta: response.meta,
    };
  }

  async updateCvmEnvs(
    cvmId: string,
    payload: Record<string, unknown>,
    options?: PhalaApiRequestOptions
  ): Promise<PhalaClientResponse<Record<string, unknown>>> {
    return this.requestJson("PATCH", PHALA_ENDPOINTS.updateCvmEnvs(cvmId), payload, options);
  }

  async updateCvmDockerCompose(
    cvmId: string,
    payload: Record<string, unknown>,
    options?: PhalaApiRequestOptions
  ): Promise<PhalaClientResponse<Record<string, unknown>>> {
    return this.requestJson("PATCH", PHALA_ENDPOINTS.updateDockerCompose(cvmId), payload, options);
  }

  async getKmsPubKey(
    kms: string,
    appId: string,
    options?: PhalaApiRequestOptions
  ): Promise<PhalaClientResponse<PhalaKmsPubKeyResponse>> {
    const response = await this.requestJson("GET", PHALA_ENDPOINTS.getKmsAppEnvEncryptPubKey(kms, appId), undefined, options);
    return {
      data: parseKmsPubKeyResponse(response.data),
      meta: response.meta,
    };
  }

  async getCvmAttestation(
    cvmId: string,
    options?: PhalaApiRequestOptions
  ): Promise<PhalaClientResponse<PhalaCvmAttestationResponse>> {
    const response = await this.requestJson("GET", PHALA_ENDPOINTS.getCvmAttestation(cvmId), undefined, options);
    return {
      data: parseCvmAttestationResponse(response.data),
      meta: response.meta,
    };
  }

  async verifyAttestationQuote(
    quoteHex: string,
    options?: PhalaApiRequestOptions
  ): Promise<PhalaClientResponse<PhalaAttestationVerifyResponse>> {
    const response = await this.requestJson("POST", PHALA_ENDPOINTS.verifyAttestation, { hex: quoteHex }, options);
    return {
      data: parseAttestationVerifyResponse(response.data),
      meta: response.meta,
    };
  }

  async encryptEnvForApp(input: {
    kms: string;
    appId: string;
    env: Record<string, string>;
    aad?: string;
    deterministic?: EncryptEnvMapOptions["deterministic"];
    requestOptions?: PhalaApiRequestOptions;
  }): Promise<{ encryption: EncryptEnvMapResult; kmsPubKey: PhalaKmsPubKeyResponse }> {
    const pubkeyResponse = await this.getKmsPubKey(input.kms, input.appId, input.requestOptions);
    const encryption = encryptEnvMapForPhala({
      recipientPublicKey: pubkeyResponse.data.publicKey,
      env: input.env,
      aad: input.aad,
      deterministic: input.deterministic,
    });
    return {
      encryption,
      kmsPubKey: pubkeyResponse.data,
    };
  }

  async updateEncryptedEnvs(input: {
    cvmId: string;
    kms: string;
    appId: string;
    env: Record<string, string>;
    aad?: string;
    deterministic?: EncryptEnvMapOptions["deterministic"];
    requestOptions?: PhalaApiRequestOptions;
  }): Promise<
    PhalaClientResponse<{
      updateResult: Record<string, unknown>;
      encryptedEnvBundle: EncryptEnvMapResult["bundle"];
      kmsPubKey: PhalaKmsPubKeyResponse;
    }>
  > {
    const encrypted = await this.encryptEnvForApp({
      kms: input.kms,
      appId: input.appId,
      env: input.env,
      aad: input.aad,
      deterministic: input.deterministic,
      requestOptions: input.requestOptions,
    });

    const updatePayload = {
      // TODO(phala): confirm final field contract (some API versions use `envs`, others use `encrypted_env`).
      encrypted_env: encrypted.encryption.serialized.trim(),
    };

    const updateResponse = await this.updateCvmEnvs(input.cvmId, updatePayload, input.requestOptions);
    return {
      data: {
        updateResult: updateResponse.data,
        encryptedEnvBundle: encrypted.encryption.bundle,
        kmsPubKey: encrypted.kmsPubKey,
      },
      meta: updateResponse.meta,
    };
  }

  private async requestJson<T = Record<string, unknown>>(
    method: string,
    pathname: string,
    body?: unknown,
    options?: PhalaApiRequestOptions
  ): Promise<PhalaClientResponse<T>> {
    const url = joinUrl(this.apiBaseUrl, pathname);
    const requestHeaders = new Headers();
    requestHeaders.set(PHALA_API_VERSION_HEADER, this.apiVersion);
    requestHeaders.set("Accept", "application/json");
    if (this.apiKey) {
      requestHeaders.set(PHALA_API_KEY_HEADER, this.apiKey);
      // Backward-compat fallback for older gateways that still honor Bearer auth.
      if (process.env.PHALA_FORCE_BEARER_AUTH === "1") {
        requestHeaders.set(PHALA_AUTH_HEADER, `Bearer ${this.apiKey}`);
      }
    }
    if (body !== undefined) {
      requestHeaders.set("Content-Type", "application/json");
    }

    if (options?.extraHeaders) {
      for (const [key, value] of Object.entries(options.extraHeaders)) {
        requestHeaders.set(key, value);
      }
    }

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const signal = options?.signal || timeoutController.signal;

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      const rawText = await response.text();
      const data = rawText.length === 0 ? ({} as T) : (JSON.parse(rawText) as T);

      if (!response.ok) {
        throw new Error(`Phala API request failed (${response.status}) ${method} ${pathname}: ${rawText}`);
      }

      return {
        data,
        meta: {
          status: response.status,
          apiVersion: this.apiVersion,
        },
      };
    } catch (error) {
      const context: PhalaRequestContext = { url, method, ...(body !== undefined ? { body } : {}) };
      throw new Error(`Phala API request error: ${asMessage(error)} | context=${JSON.stringify(context)}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
