import {
  createCipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const BASE64_ANY_REGEX = /^[A-Za-z0-9+/_=-]+$/;

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

const isHex = (value: string): boolean => /^[0-9a-fA-F]+$/.test(value);

const decodeBase64Any = (value: string): Buffer => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : `${normalized}${"=".repeat(4 - pad)}`;
  return Buffer.from(padded, "base64");
};

const extractRawX25519PublicKey = (publicKey: KeyObject): Buffer => {
  const der = publicKey.export({ type: "spki", format: "der" });
  if (!Buffer.isBuffer(der) || der.length < X25519_SPKI_PREFIX.length + 32) {
    throw new Error("Unable to export X25519 public key.");
  }

  const prefix = der.subarray(0, X25519_SPKI_PREFIX.length);
  if (!prefix.equals(X25519_SPKI_PREFIX)) {
    throw new Error("Unsupported X25519 SPKI public key encoding.");
  }

  return der.subarray(X25519_SPKI_PREFIX.length);
};

const x25519PublicKeyFromRaw = (rawPublicKey: Buffer): KeyObject => {
  if (rawPublicKey.length !== 32) {
    throw new Error("X25519 public key must be exactly 32 bytes.");
  }

  return createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, rawPublicKey]),
    format: "der",
    type: "spki",
  });
};

const x25519PrivateKeyFromRaw = (rawPrivateKey: Buffer): KeyObject => {
  if (rawPrivateKey.length !== 32) {
    throw new Error("X25519 private key must be exactly 32 bytes.");
  }

  return createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, rawPrivateKey]),
    format: "der",
    type: "pkcs8",
  });
};

const parseRecipientPublicKey = (value: string): Buffer => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("recipientPublicKey is required.");
  }

  if (trimmed.includes("BEGIN PUBLIC KEY")) {
    const key = createPublicKey(trimmed);
    return extractRawX25519PublicKey(key);
  }

  if (isHex(trimmed) && trimmed.length === 64) {
    return Buffer.from(trimmed, "hex");
  }

  if (BASE64_ANY_REGEX.test(trimmed)) {
    const decoded = decodeBase64Any(trimmed);
    if (decoded.length === 32) {
      return decoded;
    }

    try {
      const fromDer = createPublicKey({ key: decoded, format: "der", type: "spki" });
      return extractRawX25519PublicKey(fromDer);
    } catch {
      // Fall through to final error.
    }
  }

  throw new Error("Unsupported recipientPublicKey format. Use PEM, 32-byte hex, or base64/base64url.");
};

const parseHex = (value: string, expectedBytes: number, label: string): Buffer => {
  const trimmed = value.trim();
  if (!isHex(trimmed) || trimmed.length !== expectedBytes * 2) {
    throw new Error(`${label} must be ${expectedBytes}-byte hex.`);
  }
  return Buffer.from(trimmed, "hex");
};

export interface PhalaEncryptedEnvBundle {
  schemaVersion: "phala-encrypted-env-v1";
  algorithm: "x25519-hkdf-sha256-aes-256-gcm";
  encoding: "base64url";
  ephemeralPublicKey: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
  envCount: number;
}

export interface EncryptEnvMapOptions {
  env: Record<string, string>;
  recipientPublicKey: string;
  aad?: string;
  deterministic?: {
    ephemeralPrivateKeyHex: string;
    saltHex: string;
    ivHex: string;
  };
}

export interface EncryptEnvMapResult {
  bundle: PhalaEncryptedEnvBundle;
  serialized: string;
}

export const deriveX25519PublicKeyHex = (privateKeyHex: string): string => {
  const privateKey = x25519PrivateKeyFromRaw(parseHex(privateKeyHex, 32, "privateKeyHex"));
  const publicKey = createPublicKey(privateKey);
  return extractRawX25519PublicKey(publicKey).toString("hex");
};

export const encryptEnvMapForPhala = (options: EncryptEnvMapOptions): EncryptEnvMapResult => {
  const recipientRawPublicKey = parseRecipientPublicKey(options.recipientPublicKey);
  const recipientPublicKey = x25519PublicKeyFromRaw(recipientRawPublicKey);

  const sortedEnvEntries = Object.keys(options.env)
    .sort(compareText)
    .map((key) => [key, options.env[key]] as const);
  const plaintext = Buffer.from(canonicalJson({ env: sortedEnvEntries }), "utf8");

  let ephemeralPrivateKey: KeyObject;
  let ephemeralPublicKey: KeyObject;
  let salt: Buffer;
  let iv: Buffer;

  if (options.deterministic) {
    // Deterministic mode is for local tests and fixtures only.
    ephemeralPrivateKey = x25519PrivateKeyFromRaw(
      parseHex(options.deterministic.ephemeralPrivateKeyHex, 32, "deterministic.ephemeralPrivateKeyHex")
    );
    ephemeralPublicKey = createPublicKey(ephemeralPrivateKey);
    salt = parseHex(options.deterministic.saltHex, 32, "deterministic.saltHex");
    iv = parseHex(options.deterministic.ivHex, 12, "deterministic.ivHex");
  } else {
    const keyPair = generateKeyPairSync("x25519");
    ephemeralPrivateKey = keyPair.privateKey;
    ephemeralPublicKey = keyPair.publicKey;
    salt = randomBytes(32);
    iv = randomBytes(12);
  }

  const sharedSecret = diffieHellman({
    privateKey: ephemeralPrivateKey,
    publicKey: recipientPublicKey,
  });
  const aesKey = hkdfSync("sha256", sharedSecret, salt, Buffer.from("phala-secure-env-v1", "utf8"), 32);
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);

  if (options.aad) {
    cipher.setAAD(Buffer.from(options.aad, "utf8"));
  }

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const rawEphemeralPublicKey = extractRawX25519PublicKey(ephemeralPublicKey);

  const bundle: PhalaEncryptedEnvBundle = {
    schemaVersion: "phala-encrypted-env-v1",
    algorithm: "x25519-hkdf-sha256-aes-256-gcm",
    encoding: "base64url",
    ephemeralPublicKey: rawEphemeralPublicKey.toString("base64url"),
    salt: salt.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    envCount: sortedEnvEntries.length,
  };

  return {
    bundle,
    serialized: `${canonicalJson(bundle)}\n`,
  };
};
