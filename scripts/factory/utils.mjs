import { createHash } from "node:crypto";

export const minuteMs = 60_000;
export const contractMs = 15 * minuteMs;

export function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function numberOrDefault(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function booleanOrDefault(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function parseTime(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isoFromMs(value) {
  return new Date(value).toISOString();
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundMoney(value) {
  return Number(value.toFixed(4));
}

export function roundPrice(value) {
  return Number(value.toFixed(6));
}

export function roundRatio(value) {
  return Number(value.toFixed(4));
}

export function average(values) {
  const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : null;
}

export function median(values) {
  const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

export function stddev(values) {
  const mean = average(values);
  if (mean === null) return null;
  const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (finite.length < 2) return 0;
  const variance = finite.reduce((total, value) => total + (value - mean) ** 2, 0) / (finite.length - 1);
  return Math.sqrt(variance);
}

export function hashJson(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function seededRandom(seed) {
  let state = 2166136261;
  for (const char of String(seed)) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-abs * abs);
  return sign * y;
}

export function maxDrawdownFromEquity(equity) {
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.min(maxDrawdown, value - peak);
  }
  return roundMoney(maxDrawdown);
}

export function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

export function dayKey(iso) {
  return typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : "unknown";
}

