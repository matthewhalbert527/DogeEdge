import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

export const defaultKalshiReplayWsUrl = "wss://external-api-ws.kalshi.com/trade-api/ws/v2";
export const defaultKalshiWsPath = "/trade-api/ws/v2";

export async function loadKalshiWsCredentials(env = process.env) {
  const keyId = stringOrNull(env.KALSHI_API_KEY_ID);
  const inlinePem = normalizePrivateKey(env.KALSHI_PRIVATE_KEY_PEM);
  const privateKeyPath = stringOrNull(env.KALSHI_PRIVATE_KEY_PATH);
  let privateKeyPem = inlinePem;
  let privateKeySource = inlinePem ? "env_pem" : null;
  if (!privateKeyPem && privateKeyPath) {
    try {
      privateKeyPem = normalizePrivateKey(await readFile(privateKeyPath, "utf8"));
      privateKeySource = "file";
    } catch {
      return {
        ok: false,
        keyId,
        privateKeyPem: null,
        keyIdPresent: Boolean(keyId),
        privateKeyPresent: false,
        privateKeyPathPresent: true,
        privateKeySource: "file_unreadable",
        reason: "KALSHI_PRIVATE_KEY_PATH_unreadable",
      };
    }
  }
  if (!keyId || !privateKeyPem) {
    return {
      ok: false,
      keyId,
      privateKeyPem,
      keyIdPresent: Boolean(keyId),
      privateKeyPresent: Boolean(privateKeyPem),
      privateKeyPathPresent: Boolean(privateKeyPath),
      privateKeySource,
      reason: "KALSHI_API_KEY_ID_or_KALSHI_PRIVATE_KEY_PEM_missing",
    };
  }
  try {
    crypto.createPrivateKey(privateKeyPem);
    return {
      ok: true,
      keyId,
      privateKeyPem,
      keyIdPresent: true,
      privateKeyPresent: true,
      privateKeyPathPresent: Boolean(privateKeyPath),
      privateKeySource,
      reason: null,
    };
  } catch {
    return {
      ok: false,
      keyId,
      privateKeyPem: null,
      keyIdPresent: true,
      privateKeyPresent: true,
      privateKeyPathPresent: Boolean(privateKeyPath),
      privateKeySource,
      reason: "kalshi_private_key_not_parseable",
    };
  }
}

export function kalshiWsAuthHeaders({ keyId, privateKeyPem, timestamp = String(Date.now()), requestPath = defaultKalshiWsPath } = {}) {
  if (!keyId || !privateKeyPem) {
    return { ok: false, reason: "KALSHI_API_KEY_ID_or_KALSHI_PRIVATE_KEY_PEM_missing" };
  }
  return {
    ok: true,
    timestamp,
    keyId,
    signature: signPss(privateKeyPem, `${timestamp}GET${requestPath}`),
  };
}

export function redactedCredentialReport(credentials = {}) {
  return {
    keyIdPresent: Boolean(credentials.keyIdPresent ?? credentials.keyId),
    privateKeyPresent: Boolean(credentials.privateKeyPresent ?? credentials.privateKeyPem),
    privateKeyPathPresent: Boolean(credentials.privateKeyPathPresent),
    privateKeySource: credentials.privateKeySource ?? null,
    reason: credentials.ok ? null : credentials.reason ?? null,
  };
}

export function signPss(privateKeyPem, text) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(text);
  signer.end();
  return signer.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString("base64");
}

function normalizePrivateKey(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim().length ? value.trim() : null;
}
