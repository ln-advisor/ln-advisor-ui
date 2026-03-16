import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface LoadEnvFilesOptions {
  cwd?: string;
  files?: string[];
}

export interface LoadEnvFilesResult {
  loadedFiles: string[];
}

const parseEnvValue = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const parseEnvLine = (line: string): { key: string; value: string } | null => {
  const trimmed = line.trim().replace(/^\uFEFF/, "");
  if (!trimmed || trimmed.startsWith("#")) return null;

  const equalIndex = trimmed.indexOf("=");
  if (equalIndex <= 0) return null;

  const key = trimmed.slice(0, equalIndex).trim();
  if (!key) return null;

  const valueRaw = trimmed.slice(equalIndex + 1);
  return {
    key,
    value: parseEnvValue(valueRaw),
  };
};

export const loadEnvFiles = (options: LoadEnvFilesOptions = {}): LoadEnvFilesResult => {
  const cwd = options.cwd || process.cwd();
  const files = options.files || [".env", ".env.test"];
  const loadedFiles: string[] = [];

  for (const file of files) {
    const fullPath = path.resolve(cwd, file);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      process.env[parsed.key] = parsed.value;
    }

    loadedFiles.push(fullPath);
  }

  return { loadedFiles };
};
