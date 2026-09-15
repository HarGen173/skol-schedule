import test from "node:test";
import assert from "node:assert/strict";
import { isWeekdayIso, layoutDayEvents, markOverlaps, matchesSelectedCourses, monthWeeks, timeRange, toMinutes, workingDays } from "../public/lib.js";

test("converts time to minutes", () => assert.equal(toMinutes("09:30"), 570));

test("marks both intersecting events but not adjacent events", () => {
  const events = [
    { id: "a", date: "2026-09-01", startTime: "09:00", endTime: "11:00" },
    { id: "b", date: "2026-09-01", startTime: "10:30", endTime: "12:00" },
    { id: "c", date: "2026-09-01", startTime: "12:00", endTime: "13:00" },
    { id: "d", date: "2026-09-02", startTime: "10:00", endTime: "11:00" }
  ];
  assert.deepEqual([...markOverlaps(events)].sort(), ["a", "b"]);
});

test("builds complete Monday-to-Sunday month rows", () => {
  const weeks = monthWeeks(2026, 9);
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0][0].getDay(), 1);
  assert.equal(weeks.at(-1).at(-1).getDay(), 0);
});

test("selects only Monday through Friday for the visible calendar", () => {
  const visibleDays = workingDays(monthWeeks(2026, 9)[0]);
  assert.deepEqual(visibleDays.map((date) => date.getDay()), [1, 2, 3, 4, 5]);
  assert.equal(isWeekdayIso("2026-09-05"), false);
  assert.equal(isWeekdayIso("2026-09-07"), true);
});

test("matches any of multiple selected courses and treats an empty set as all", () => {
  assert.equal(matchesSelectedCourses("MA001", new Set()), true);
  assert.equal(matchesSelectedCourses("MA001", new Set(["MA001", "MA002"])), true);
  assert.equal(matchesSelectedCourses("MA003", new Set(["MA001", "MA002"])), false);
});

test("places overlapping classes into separate horizontal lanes", () => {
  const layout = layoutDayEvents([
    { id: "a", startTime: "09:00", endTime: "11:00" },
    { id: "b", startTime: "10:00", endTime: "12:00" },
    { id: "c", startTime: "12:00", endTime: "13:00" }
  ]);
  assert.deepEqual(layout.map(({ id, lane, laneCount }) => ({ id, lane, laneCount })), [
    { id: "a", lane: 0, laneCount: 2 },
    { id: "b", lane: 1, laneCount: 2 },
    { id: "c", lane: 0, laneCount: 1 }
  ]);
});

test("rounds visible time range to full hours", () => {
  assert.deepEqual(timeRange([{ startTime: "09:30", endTime: "17:15" }]), { start: 540, end: 1080 });
});