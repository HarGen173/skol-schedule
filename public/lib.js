export function toMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function markOverlaps(events) {
  const overlapIds = new Set();
  const byDate = Map.groupBy(events, (event) => event.date);
  for (const dayEvents of byDate.values()) {
    for (let left = 0; left < dayEvents.length; left += 1) {
      for (let right = left + 1; right < dayEvents.length; right += 1) {
        const a = dayEvents[left];
        const b = dayEvents[right];
        if (toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime)) {
          overlapIds.add(a.id);
          overlapIds.add(b.id);
        }
      }
    }
  }
  return overlapIds;
}

export function layoutDayEvents(events) {
  const sorted = [...events].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime) || toMinutes(a.endTime) - toMinutes(b.endTime));
  const result = [];
  let group = [];
  let groupEnd = -1;

  function placeGroup() {
    const lanes = [];
    const placed = group.map((event) => {
      const start = toMinutes(event.startTime);
      let lane = lanes.findIndex((end) => end <= start);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = toMinutes(event.endTime);
      return { ...event, lane };
    });
    result.push(...placed.map((event) => ({ ...event, laneCount: Math.max(1, lanes.length) })));
  }

  for (const event of sorted) {
    const start = toMinutes(event.startTime);
    if (group.length && start >= groupEnd) {
      placeGroup();
      group = [];
      groupEnd = -1;
    }
    group.push(event);
    groupEnd = Math.max(groupEnd, toMinutes(event.endTime));
  }
  if (group.length) placeGroup();
  return result;
}

export function timeRange(events, fallback = { start: 9 * 60, end: 19 * 60 }) {
  if (!events.length) return fallback;
  const earliest = Math.min(...events.map((event) => toMinutes(event.startTime)));
  const latest = Math.max(...events.map((event) => toMinutes(event.endTime)));
  return {
    start: Math.floor(earliest / 60) * 60,
    end: Math.ceil(latest / 60) * 60
  };
}

export function workingDays(week) {
  return week.filter((date) => date.getDay() >= 1 && date.getDay() <= 5);
}

export function isWeekdayIso(dateString) {
  const day = new Date(`${dateString}T12:00:00`).getDay();
  return day >= 1 && day <= 5;
}

export function matchesSelectedCourses(courseCode, selectedCourses) {
  const selected = selectedCourses instanceof Set ? selectedCourses : new Set(selectedCourses);
  return selected.size === 0 || selected.has(courseCode);
}

export function monthWeeks(year, month) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const end = new Date(last);
  end.setDate(last.getDate() + ((7 - last.getDay()) % 7));
  const weeks = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 7)) {
    weeks.push(Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(cursor);
      date.setDate(cursor.getDate() + offset);
      return date;
    }));
  }
  return weeks;
}

export function localIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}