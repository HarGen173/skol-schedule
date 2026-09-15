import { isWeekdayIso, layoutDayEvents, localIso, markOverlaps, matchesSelectedCourses, matchesSelectedPrograms, monthWeeks, timeRange, toMinutes, workingDays } from "./lib.js";

const locale = "ru-RU";
const hourHeight = 64;
const upstream = "https://schedule.skoltech.ru:8443/api/v1";
const useLocalApi = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const state = { terms: [], term: null, year: 0, month: 0, data: null, selectedCourses: new Set(), courses: [], selectedPrograms: new Set(), programs: [], availablePrograms: new Set() };
const elements = Object.fromEntries([
  "termSelect", "monthPicker", "previousMonth", "nextMonth", "todayButton", "resetFilters",
  "coursePicker", "courseButton", "courseMenu", "courseSearch", "courseOptions", "selectAllCourses", "clearCourses",
  "programPicker", "programButton", "programMenu", "programSearch", "programOptions", "selectAllPrograms", "clearPrograms",
  "instructorFilter", "roomFilter", "searchFilter",
  "activeFilters", "filterCount", "status", "calendar"
].map((id) => [id, document.getElementById(id)]));
const filterElements = [elements.instructorFilter, elements.roomFilter, elements.searchFilter];

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
  elements.status.hidden = false;
  elements.calendar.hidden = true;
}

async function request(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Не удалось загрузить данные");
  return body;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function loadTerms() {
  return request(useLocalApi ? "/api/terms" : `${upstream}/terms`);
}

async function loadStaticMonth(term, year, month) {
  const courses = await request(`${upstream}/terms/${encodeURIComponent(term.id)}/courses`);
  const dates = Array.from({ length: daysInMonth(year, month) }, (_, index) => isoDate(year, month, index + 1))
    .filter((date) => date >= term.start_date && date <= term.end_date);
  const dailyClasses = await mapWithConcurrency(dates, 6, async (date) => ({
    date,
    classes: await request(`${upstream}/terms/${encodeURIComponent(term.id)}/classes?date=${date}`)
  }));
  const courseByCode = new Map(courses.map((course) => [course.code, course]));
  const classes = dailyClasses.flatMap(({ date, classes: items }) => items.map((item, index) => {
    const course = courseByCode.get(item.course_code);
    return {
      id: `${date}-${item.course_code}-${item.start_time}-${item.room_id}-${index}`,
      date,
      startTime: item.start_time,
      endTime: item.end_time,
      courseName: item.course_name,
      courseCode: item.course_code,
      instructors: String(item.instructors || "").split("\n").filter(Boolean),
      programs: String(item.programs || "").split("\n").filter(Boolean),
      room: item.room_name || "—",
      lmsLink: item.lms_link || course?.lms_link || "",
      syllabusLink: course?.syllabus_link?.replace(/^http:/, "https:") || ""
    };
  }));
  return { term, courses, classes };
}

function loadMonthData() {
  if (!useLocalApi) return loadStaticMonth(state.term, state.year, state.month);
  return request(`/api/month?term=${encodeURIComponent(state.term.id)}&year=${state.year}&month=${state.month}`);
}

function monthValue(year, month) { return `${year}-${String(month).padStart(2, "0")}`; }

function selectTerm(term) {
  state.term = term;
  const start = new Date(`${term.start_date}T12:00:00`);
  state.year = start.getFullYear();
  state.month = start.getMonth() + 1;
  elements.termSelect.value = term.id;
  elements.monthPicker.min = term.start_date.slice(0, 7);
  elements.monthPicker.max = term.end_date.slice(0, 7);
  elements.monthPicker.value = monthValue(state.year, state.month);
}

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set("term", state.term.id);
  url.searchParams.set("month", monthValue(state.year, state.month));
  history.replaceState(null, "", url);
}

function optionList(select, values, placeholder) {
  const current = select.value;
  select.replaceChildren(new Option(placeholder, ""), ...[...new Set(values)].filter(Boolean).sort((a, b) => a.localeCompare(b, locale)).map((value) => new Option(value, value)));
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function courseLabel(course) {
  return course.name;
}

function renderCourseOptions() {
  const query = elements.courseSearch.value.trim().toLocaleLowerCase(locale);
  const visible = state.courses.filter((course) => `${course.code} ${course.name}`.toLocaleLowerCase(locale).includes(query));
  elements.courseOptions.replaceChildren(...visible.map((course) => {
    const label = document.createElement("label");
    label.className = "course-option";
    label.setAttribute("role", "option");
    label.setAttribute("aria-selected", String(state.selectedCourses.has(course.code)));
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = course.code;
    checkbox.checked = state.selectedCourses.has(course.code);
    const text = document.createElement("span");
    text.textContent = courseLabel(course);
    label.append(checkbox, text);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedCourses.add(course.code);
      else state.selectedCourses.delete(course.code);
      renderCourseSelection();
      render();
    });
    return label;
  }));
}

function renderCourseSelection() {
  const count = state.selectedCourses.size;
  elements.courseButton.textContent = count === 0 ? "Все курсы" : `Выбрано: ${count}`;
  elements.courseButton.classList.toggle("has-selection", count > 0);
  renderCourseOptions();
}

function setCourseMenu(open) {
  elements.courseMenu.hidden = !open;
  elements.courseButton.setAttribute("aria-expanded", String(open));
  if (open) elements.courseSearch.focus();
}

function renderProgramOptions() {
  const query = elements.programSearch.value.trim().toLocaleLowerCase(locale);
  const fragment = document.createDocumentFragment();
  for (const level of ["BSc", "MSc", "PhD"]) {
    const programs = state.programs.filter((program) => program.level === level && program.label.toLocaleLowerCase(locale).includes(query));
    if (!programs.length) continue;
    const heading = document.createElement("div");
    heading.className = "option-group";
    heading.textContent = level;
    fragment.append(heading);
    for (const program of programs) {
      const label = document.createElement("label");
      label.className = `course-option${state.availablePrograms.has(program.label) ? "" : " unavailable"}`;
      label.setAttribute("role", "option");
      label.setAttribute("aria-selected", String(state.selectedPrograms.has(program.label)));
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = program.label;
      checkbox.checked = state.selectedPrograms.has(program.label);
      const text = document.createElement("span");
      text.textContent = program.name;
      label.append(checkbox, text);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selectedPrograms.add(program.label);
        else state.selectedPrograms.delete(program.label);
        renderProgramSelection();
        render();
      });
      fragment.append(label);
    }
  }
  elements.programOptions.replaceChildren(fragment);
}

function renderProgramSelection() {
  const count = state.selectedPrograms.size;
  elements.programButton.textContent = count === 0 ? "Все программы" : `Выбрано: ${count}`;
  elements.programButton.classList.toggle("has-selection", count > 0);
  renderProgramOptions();
}

function setProgramMenu(open) {
  elements.programMenu.hidden = !open;
  elements.programButton.setAttribute("aria-expanded", String(open));
  if (open) elements.programSearch.focus();
}

function prepareFilters() {
  const classes = state.data.classes.filter((item) => isWeekdayIso(item.date));
  const availableCodes = new Set(classes.map((item) => item.courseCode));
  state.courses = state.data.courses.filter((course) => availableCodes.has(course.code)).sort((a, b) => courseLabel(a).localeCompare(courseLabel(b), locale));
  state.selectedCourses = new Set([...state.selectedCourses].filter((code) => availableCodes.has(code)));
  state.availablePrograms = new Set(classes.flatMap((item) => item.programs));
  renderCourseSelection();
  renderProgramSelection();
  optionList(elements.instructorFilter, classes.flatMap((item) => item.instructors), "Все преподаватели");
  optionList(elements.roomFilter, classes.map((item) => item.room), "Все аудитории");
}

function filteredEvents() {
  const query = elements.searchFilter.value.trim().toLocaleLowerCase(locale);
  return state.data.classes.filter((item) => isWeekdayIso(item.date)).filter((item) => {
    return matchesSelectedCourses(item.courseCode, state.selectedCourses)
      && matchesSelectedPrograms(item.programs, state.selectedPrograms)
      && (!elements.instructorFilter.value || item.instructors.includes(elements.instructorFilter.value))
      && (!elements.roomFilter.value || item.room === elements.roomFilter.value)
      && (!query || `${item.courseCode} ${item.courseName} ${item.instructors.join(" ")}`.toLocaleLowerCase(locale).includes(query));
  });
}

function renderActiveFilters() {
  const active = filterElements.filter((element) => element.value);
  const selectedCourses = [...state.selectedCourses];
  const selectedPrograms = [...state.selectedPrograms];
  elements.filterCount.textContent = active.length + selectedCourses.length + selectedPrograms.length || "";
  const courseChips = selectedCourses.map((code) => {
    const course = state.courses.find((item) => item.code === code);
    const name = course?.name || code;
    const button = document.createElement("button");
    button.className = "filter-chip course-chip";
    button.textContent = `${name} ×`;
    button.title = `Убрать курс «${name}»`;
    button.addEventListener("click", () => {
      state.selectedCourses.delete(code);
      renderCourseSelection();
      render();
    });
    return button;
  });
  const otherChips = active.map((element) => {
    const button = document.createElement("button");
    button.className = "filter-chip";
    const label = element.closest("label").querySelector("span").textContent;
    button.textContent = `${label}: ${element.value} ×`;
    button.addEventListener("click", () => { element.value = ""; render(); });
    return button;
  });
  const programChips = selectedPrograms.map((label) => {
    const button = document.createElement("button");
    button.className = "filter-chip program-chip";
    button.textContent = `${label} ×`;
    button.title = `Убрать программу «${label}»`;
    button.addEventListener("click", () => {
      state.selectedPrograms.delete(label);
      renderProgramSelection();
      render();
    });
    return button;
  });
  elements.activeFilters.replaceChildren(...courseChips, ...programChips, ...otherChips);
}

function weekNumber(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
}

function eventCard(event, overlapping, range) {
  const card = document.createElement(event.syllabusLink ? "a" : "div");
  card.className = `event${overlapping.has(event.id) ? " overlap" : ""}`;
  const duration = toMinutes(event.endTime) - toMinutes(event.startTime);
  const top = ((toMinutes(event.startTime) - range.start) / 60) * hourHeight;
  const height = Math.max(36, (duration / 60) * hourHeight - 4);
  const width = 100 / event.laneCount;
  card.style.top = `${top}px`;
  card.style.height = `${height}px`;
  card.style.left = `calc(${event.lane * width}% + 2px)`;
  card.style.width = `calc(${width}% - 4px)`;
  if (event.syllabusLink) {
    card.href = event.syllabusLink;
    card.target = "_blank";
    card.rel = "noreferrer";
  }
  card.title = `${event.startTime}–${event.endTime}\n${event.courseName}\n${event.room}\n${event.instructors.join(", ")}${event.syllabusLink ? "\nНажмите, чтобы открыть syllabus" : ""}`;
  card.innerHTML = `
    <div class="event-time"><span>${event.startTime}</span>${overlapping.has(event.id) ? '<span class="conflict-label">!</span>' : ""}</div>
    <div class="event-title"></div>
    <div class="event-meta"></div>`;
  card.querySelector(".event-title").textContent = event.courseName;
  card.querySelector(".event-meta").textContent = event.room;
  return card;
}

function timeAxis(range) {
  const axis = document.createElement("div");
  axis.className = "time-axis";
  for (let minutes = range.start; minutes < range.end; minutes += 60) {
    const label = document.createElement("span");
    label.style.top = `${((minutes - range.start) / 60) * hourHeight + 7}px`;
    label.textContent = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:00`;
    axis.append(label);
  }
  return axis;
}

function render() {
  if (!state.data) return;
  const events = filteredEvents().sort((a, b) => a.startTime.localeCompare(b.startTime));
  const byDate = Map.groupBy(events, (event) => event.date);
  const overlapping = markOverlaps(events);
  const weeks = monthWeeks(state.year, state.month);
  const today = localIso(new Date());
  const fragment = document.createDocumentFragment();
  const weekdayNames = ["Пн", "Вт", "Ср", "Чт", "Пт"];

  for (const week of weeks) {
    const weekdays = workingDays(week);
    const weekKeys = weekdays.map(localIso);
    const weekEvents = events.filter((event) => weekKeys.includes(event.date));
    const range = timeRange(weekEvents);
    const timelineHeight = ((range.end - range.start) / 60) * hourHeight;
    const row = document.createElement("div");
    row.className = "week-block";
    const header = document.createElement("div");
    header.className = "week-header";
    const number = document.createElement("div");
    number.className = "week-number";
    number.textContent = `W${weekNumber(week[0])}`;
    header.append(number);
    weekdays.forEach((date, index) => {
      const key = localIso(date);
      const heading = document.createElement("div");
      heading.className = `day-heading${date.getMonth() + 1 !== state.month ? " outside" : ""}${key === today ? " today" : ""}`;
      heading.innerHTML = `<span>${weekdayNames[index]}</span><strong>${date.getDate()}</strong>`;
      header.append(heading);
    });
    row.append(header);

    const body = document.createElement("div");
    body.className = "week-timeline";
    body.style.height = `${timelineHeight}px`;
    body.append(timeAxis(range));
    for (const date of weekdays) {
      const key = localIso(date);
      const day = document.createElement("div");
      day.className = `day-track${date.getMonth() + 1 !== state.month ? " outside" : ""}`;
      day.append(...layoutDayEvents(byDate.get(key) || []).map((event) => eventCard(event, overlapping, range)));
      body.append(day);
    }
    row.append(body);
    fragment.append(row);
  }
  elements.calendar.replaceChildren(fragment);
  elements.status.hidden = true;
  elements.calendar.hidden = false;
  renderActiveFilters();
}

async function loadMonth() {
  setStatus("Загружаем расписание с schedule.skoltech.ru…");
  updateUrl();
  try {
    state.data = await loadMonthData();
    prepareFilters();
    render();
  } catch (error) {
    setStatus(`Ошибка: ${error.message}. Попробуйте обновить страницу.`, true);
  }
}

function moveMonth(offset) {
  const date = new Date(state.year, state.month - 1 + offset, 1);
  const value = monthValue(date.getFullYear(), date.getMonth() + 1);
  if (value < elements.monthPicker.min || value > elements.monthPicker.max) return;
  state.year = date.getFullYear(); state.month = date.getMonth() + 1;
  elements.monthPicker.value = value;
  loadMonth();
}

async function init() {
  try {
    [state.terms, state.programs] = await Promise.all([loadTerms(), request("./programs.json")]);
    elements.termSelect.replaceChildren(...state.terms.map((term) => new Option(term.name, term.id)));
    const params = new URLSearchParams(location.search);
    const requested = state.terms.find((term) => term.id === params.get("term"));
    selectTerm(requested || state.terms.find((term) => term.current) || state.terms[0]);
    const requestedMonth = params.get("month");
    if (/^\d{4}-\d{2}$/.test(requestedMonth) && requestedMonth >= elements.monthPicker.min && requestedMonth <= elements.monthPicker.max) {
      [state.year, state.month] = requestedMonth.split("-").map(Number);
      elements.monthPicker.value = requestedMonth;
    }
    await loadMonth();
  } catch (error) { setStatus(`Ошибка: ${error.message}`, true); }
}

elements.termSelect.addEventListener("change", () => { selectTerm(state.terms.find((term) => term.id === elements.termSelect.value)); loadMonth(); });
elements.monthPicker.addEventListener("change", () => { [state.year, state.month] = elements.monthPicker.value.split("-").map(Number); loadMonth(); });
elements.previousMonth.addEventListener("click", () => moveMonth(-1));
elements.nextMonth.addEventListener("click", () => moveMonth(1));
elements.todayButton.addEventListener("click", () => { selectTerm(state.terms.find((term) => term.current) || state.terms[0]); loadMonth(); });
elements.resetFilters.addEventListener("click", () => {
  filterElements.forEach((element) => { element.value = ""; });
  state.selectedCourses.clear();
  state.selectedPrograms.clear();
  renderCourseSelection();
  renderProgramSelection();
  render();
});
filterElements.forEach((element) => element.addEventListener(element === elements.searchFilter ? "input" : "change", render));
elements.courseButton.addEventListener("click", () => {
  setProgramMenu(false);
  setCourseMenu(elements.courseMenu.hidden);
});
elements.courseSearch.addEventListener("input", renderCourseOptions);
elements.selectAllCourses.addEventListener("click", () => {
  state.selectedCourses = new Set(state.courses.map((course) => course.code));
  renderCourseSelection();
  render();
});
elements.clearCourses.addEventListener("click", () => {
  state.selectedCourses.clear();
  renderCourseSelection();
  render();
});
elements.programButton.addEventListener("click", () => {
  setCourseMenu(false);
  setProgramMenu(elements.programMenu.hidden);
});
elements.programSearch.addEventListener("input", renderProgramOptions);
elements.selectAllPrograms.addEventListener("click", () => {
  state.selectedPrograms = new Set(state.programs.map((program) => program.label));
  renderProgramSelection();
  render();
});
elements.clearPrograms.addEventListener("click", () => {
  state.selectedPrograms.clear();
  renderProgramSelection();
  render();
});
document.addEventListener("click", (event) => {
  if (!elements.coursePicker.contains(event.target)) setCourseMenu(false);
  if (!elements.programPicker.contains(event.target)) setProgramMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setCourseMenu(false);
    setProgramMenu(false);
  }
});

init();