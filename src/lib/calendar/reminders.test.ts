process.env.TZ = process.env.TEST_TZ ?? "Asia/Jakarta";
import { beforeEach, describe, expect, it } from "vitest";
import { calendar } from "$lib/stores/calendar.svelte";
import { dueReminders } from "./reminders";
import type { CalEvent } from "./types";

const NOW = new Date(2026, 9, 22, 8, 0).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const min = (n: number) => n * 60_000;

const ev = (over: Partial<CalEvent>): CalEvent => ({
  id: "e1", title: "Les", notes: "", start: iso(NOW + min(10)), end: null, allDay: false,
  repeat: "none", repeatUntil: null, remindMin: 15, color: null, ...over,
});

beforeEach(() => {
  calendar.events = [];
  calendar.sources = [];
});

describe("dueReminders", () => {
  it("fires once the reminder time has arrived and before the event starts", () => {
    calendar.events = [ev({})];
    expect(dueReminders(NOW, new Set())).toHaveLength(1);
  });

  it("waits while it is too early", () => {
    calendar.events = [ev({ start: iso(NOW + min(30)) })];
    expect(dueReminders(NOW, new Set())).toHaveLength(0);
  });

  it("does not fire after the event has started", () => {
    calendar.events = [ev({ start: iso(NOW - min(1)) })];
    expect(dueReminders(NOW, new Set())).toHaveLength(0);
  });

  it("a reminder at start time fires when the event starts and for two minutes after, then stops", () => {
    calendar.events = [ev({ remindMin: 0, start: iso(NOW + min(1)) })];
    expect(dueReminders(NOW, new Set())).toHaveLength(0);
    expect(dueReminders(NOW + min(1), new Set())).toHaveLength(1);
    expect(dueReminders(NOW + min(2), new Set())).toHaveLength(1);
    expect(dueReminders(NOW + min(3) + 1, new Set())).toHaveLength(0);
  });

  it("an earlier reminder is not fired late once its event is long over", () => {
    calendar.events = [ev({ remindMin: 15, start: iso(NOW - min(60)) })];
    expect(dueReminders(NOW, new Set())).toHaveLength(0);
  });

  it("never fires twice for the same occurrence", () => {
    calendar.events = [ev({})];
    const [first] = dueReminders(NOW, new Set());
    expect(dueReminders(NOW, new Set([first.key]))).toHaveLength(0);
  });

  it("ignores events without a reminder", () => {
    calendar.events = [ev({ remindMin: null })];
    expect(dueReminders(NOW, new Set())).toHaveLength(0);
  });

  it("reminds for the next occurrence of a repeating event", () => {
    // Acara mingguan yang dimulai pekan lalu; kemunculan berikutnya 10 menit lagi.
    calendar.events = [ev({ repeat: "weekly", start: iso(NOW + min(10) - 7 * 86_400_000) })];
    const due = dueReminders(NOW, new Set());
    expect(due).toHaveLength(1);
    expect(due[0].start).toBe(NOW + min(10));
  });
});
