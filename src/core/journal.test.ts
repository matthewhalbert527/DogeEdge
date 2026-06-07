import { describe, expect, it } from "vitest";
import {
  journalEntryFromSignal,
  loadJournal,
  mergeJournalEntries,
  saveJournal,
  summarizeJournal,
  type JournalEntry,
} from "./journal";

const entry = (id: string, closedAt: string, pnl: number, result: "Win" | "Loss" = pnl >= 0 ? "Win" : "Loss"): JournalEntry => ({
  id,
  openedAt: closedAt,
  closedAt,
  strategy: "Threshold Distance",
  market: "DOGE >= $0.1020 (15m)",
  side: "YES",
  entryPrice: 0.62,
  contracts: 10,
  result,
  pnl,
  source: "paper-signal",
  dataMode: "real-spot",
});

describe("paper journal", () => {
  it("deduplicates signal entries by id", () => {
    const first = entry("a", "2026-05-31T03:00:00.000Z", 4.2);
    const merged = mergeJournalEntries([first], [first, entry("b", "2026-05-31T03:05:00.000Z", -1.15)]);

    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("summarizes all-time, today, and session pnl", () => {
    const entries = [
      entry("today-win", "2026-05-31T03:00:00.000Z", 4.2),
      entry("today-loss", "2026-05-31T04:00:00.000Z", -1.15, "Loss"),
      entry("old-win", "2026-05-30T03:00:00.000Z", 2.5),
    ];
    const summary = summarizeJournal(entries, new Date("2026-05-31T05:00:00.000Z"), "2026-05-31T03:30:00.000Z");

    expect(summary.allTimePnl).toBe(5.55);
    expect(summary.todayPnl).toBe(3.05);
    expect(summary.sessionPnl).toBe(-1.15);
    expect(summary.winRate).toBeCloseTo(2 / 3);
  });

  it("ignores unsettled signals when creating journal entries", () => {
    const signal = {
      id: "queued",
      openedAt: "2026-05-31T03:00:00.000Z",
      closedAt: null,
      time: "10:00 PM",
      status: "QUEUED" as const,
      strategy: "No-Trade Sentinel",
      market: "DOGE >= $0.1020 (15m)",
      signal: "-" as const,
      price: null,
      contracts: 0,
      edge: 0.02,
      confidence: 55,
      fillQuality: "-" as const,
      result: "-" as const,
      pnl: null,
    };

    expect(journalEntryFromSignal(signal, "2026-05-31T03:00:00.000Z", "real-spot")).toBeNull();
  });

  it("round trips through local storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    };
    const entries = [entry("a", "2026-05-31T03:00:00.000Z", 4.2)];

    saveJournal(storage, entries);

    expect(loadJournal(storage)).toEqual(entries);
  });
});
