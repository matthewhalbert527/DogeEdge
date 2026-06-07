interface SignalRow {
  id: string;
  openedAt: string;
  closedAt: string | null;
  strategy: string;
  market: string;
  signal: "YES" | "NO" | "-";
  price: number | null;
  contracts: number;
  result: "Win" | "Loss" | "-";
  pnl: number | null;
}

export interface JournalEntry {
  id: string;
  openedAt: string;
  closedAt: string;
  strategy: string;
  market: string;
  side: "YES" | "NO";
  entryPrice: number;
  contracts: number;
  result: "Win" | "Loss";
  pnl: number;
  source: "paper-signal";
  dataMode: "real-kalshi" | "real-spot" | "demo";
}

export interface PnlSummary {
  allTimePnl: number;
  todayPnl: number;
  sessionPnl: number;
  allTimeTrades: number;
  todayTrades: number;
  sessionTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

export const journalStorageKey = "dogeedge.paperJournal.v1";

export function journalEntryFromSignal(row: SignalRow, generatedAt: string, dataMode: JournalEntry["dataMode"]): JournalEntry | null {
  if (row.pnl === null || row.price === null || row.result === "-" || row.signal === "-") return null;
  return {
    id: row.id,
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? generatedAt,
    strategy: row.strategy,
    market: row.market,
    side: row.signal,
    entryPrice: row.price,
    contracts: row.contracts,
    result: row.result,
    pnl: row.pnl,
    source: "paper-signal",
    dataMode,
  };
}

export function mergeJournalEntries(current: JournalEntry[], incoming: JournalEntry[]) {
  if (!incoming.length) return current;
  const existing = new Set(current.map((entry) => entry.id));
  const additions = incoming.filter((entry) => !existing.has(entry.id));
  return additions.length ? [...additions, ...current].slice(0, 500) : current;
}

export function summarizeJournal(entries: JournalEntry[], now: Date, sessionStartedAt: string): PnlSummary {
  const todayKey = dayKey(now);
  const sessionStart = Date.parse(sessionStartedAt);
  const sessionEntries = entries.filter((entry) => Date.parse(entry.closedAt) >= sessionStart);
  const todayEntries = entries.filter((entry) => dayKey(new Date(entry.closedAt)) === todayKey);
  const wins = entries.filter((entry) => entry.result === "Win").length;
  const losses = entries.filter((entry) => entry.result === "Loss").length;
  const allTimeTrades = entries.length;

  return {
    allTimePnl: sumPnl(entries),
    todayPnl: sumPnl(todayEntries),
    sessionPnl: sumPnl(sessionEntries),
    allTimeTrades,
    todayTrades: todayEntries.length,
    sessionTrades: sessionEntries.length,
    wins,
    losses,
    winRate: allTimeTrades > 0 ? wins / allTimeTrades : null,
  };
}

export function loadJournal(storage: Pick<Storage, "getItem">): JournalEntry[] {
  try {
    const raw = storage.getItem(journalStorageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isJournalEntry) : [];
  } catch {
    return [];
  }
}

export function saveJournal(storage: Pick<Storage, "setItem">, entries: JournalEntry[]) {
  storage.setItem(journalStorageKey, JSON.stringify(entries));
}

function sumPnl(entries: JournalEntry[]) {
  return Number(entries.reduce((total, entry) => total + entry.pnl, 0).toFixed(2));
}

function dayKey(date: Date) {
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<JournalEntry>;
  return typeof entry.id === "string"
    && typeof entry.openedAt === "string"
    && typeof entry.closedAt === "string"
    && typeof entry.strategy === "string"
    && typeof entry.market === "string"
    && (entry.side === "YES" || entry.side === "NO")
    && typeof entry.entryPrice === "number"
    && typeof entry.contracts === "number"
    && (entry.result === "Win" || entry.result === "Loss")
    && typeof entry.pnl === "number";
}
