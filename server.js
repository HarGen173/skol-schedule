import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(__dirname, "public");
const upstream = "https://schedule.skoltech.ru:8443/api/v1";
const cache = new Map();
const cacheTtl = 15 * 60 * 1000;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": contentTypes[".json"],
    "Cache-Control": status === 200 ? "public, max-age=300" : "no-store"
  });
  response.end(JSON.stringify(body));
}

async function cachedFetch(url) {
  const saved = cache.get(url);
  if (saved && Date.now() - saved.createdAt < cacheTtl) return saved.value;

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "SkolSchedule/1.0" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Skoltech API returned ${response.status}`);
  const value = await response.json();
  cache.set(url, { createdAt: Date.now(), value });
  return value;
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

async function getMonth(term, year, month) {
  const [terms, courses] = await Promise.all([
    cachedFetch(`${upstream}/terms`),
    cachedFetch(`${upstream}/terms/${encodeURIComponent(term)}/courses`)
  ]);
  const selectedTerm = terms.find((item) => item.id === term);
  if (!selectedTerm) {
    const error = new Error("Unknown term");
    error.status = 404;
    throw error;
  }

  const dates = Array.from({ length: daysInMonth(year, month) }, (_, index) => isoDate(year, month, index + 1))
    .filter((date) => date >= selectedTerm.start_date && date <= selectedTerm.end_date);

  const dailyClasses = await mapWithConcurrency(dates, 6, async (date) => ({
    date,
    classes: await cachedFetch(`${upstream}/terms/${encodeURIComponent(term)}/classes?date=${date}`)
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

  return { term: selectedTerm, courses, classes };
}

async function serveStatic(requestPath, response) {
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = path.resolve(publicDirectory, relativePath);
  if (!filePath.startsWith(`${publicDirectory}${path.sep}`) && filePath !== path.join(publicDirectory, "index.html")) {
    json(response, 403, { error: "Forbidden" });
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "public, max-age=3600"
    });
    response.end(body);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

export function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    try {
      if (request.method !== "GET") return json(response, 405, { error: "Method not allowed" });
      if (url.pathname === "/api/terms") return json(response, 200, await cachedFetch(`${upstream}/terms`));
      if (url.pathname === "/api/month") {
        const term = url.searchParams.get("term") || "";
        const year = Number(url.searchParams.get("year"));
        const month = Number(url.searchParams.get("month"));
        if (!/^[a-z0-9-]+$/i.test(term) || !Number.isInteger(year) || year < 2019 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
          return json(response, 400, { error: "Invalid term, year, or month" });
        }
        return json(response, 200, await getMonth(term, year, month));
      }
      return await serveStatic(decodeURIComponent(url.pathname), response);
    } catch (error) {
      console.error(error);
      return json(response, error.status || 502, { error: error.message || "Upstream service is unavailable" });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => console.log(`SkolSchedule: http://localhost:${port}`));
}