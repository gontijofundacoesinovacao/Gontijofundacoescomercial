const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const dotenv = require("dotenv");
const PDFDocument = require("pdfkit");
const adminStore = require("./lib/admin-store");
const {
  buildDailyDashboard,
  buildWeeklyDashboard,
  buildSecondaryDashboard,
} = require("./lib/dashboard-service");
const {
  S3Client,
  ListObjectsV2Command,
  HeadBucketCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  const allowedOrigin =
    process.env.CORS_ORIGIN ||
    (/^https?:\/\/localhost:\d+$/.test(String(requestOrigin || "")) ? requestOrigin : "");
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

app.use(express.json({ limit: "1mb" }));

const adminSessions = new Map();

const requiredEnv = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_BUCKET",
];

function missingEnvVars() {
  return requiredEnv.filter((name) => !process.env[name]);
}

function buildS3Client() {
  return new S3Client({
    region: process.env.AWS_REGION || "sa-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

function getClientLogin(value) {
  return String(value || process.env.S3_CLIENT_LOGIN || "cgontijo").trim();
}

function buildPrefix(clientLogin, imei, date) {
  const [year, month, day] = date.split("-");
  const base = (process.env.S3_PREFIX_BASE || "c").replace(/\/+$/, "");
  return `${base}/${clientLogin}/h/${imei}/${year}/${month}/${day}/`;
}

function parseEstacaKey(key) {
  const fileName = key.split("/").pop() || "";
  const match = fileName.match(
    /^(\d{6})-([^-]+)-([^-]+)-(.+)$/
  );

  if (!match) {
    return {
      fileName,
      finishedAt: null,
      contrato: null,
      obra: null,
      estaca: null,
    };
  }

  const [, hhmmss, contratoRaw, obraRaw, estacaRaw] = match;
  const decode = (value) =>
    value.replace(/e/g, " ").replace(/s/g, "-").replace(/p/g, ".").replace(/a/g, "+");

  return {
    fileName,
    finishedAt: `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`,
    contrato: decode(contratoRaw),
    obra: decode(obraRaw),
    estaca: decode(estacaRaw),
  };
}

function getConverterPath() {
  const toolName = process.platform === "win32" ? "sacibin2txt.exe" : "sacibin2txt";
  return path.join(__dirname, "tools", toolName);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getCacheDir() {
  return path.join(__dirname, ".cache", "estacas");
}

function getCacheFilePath(key) {
  const hash = crypto.createHash("sha1").update(key).digest("hex");
  return path.join(getCacheDir(), `${hash}.json`);
}

function readCachedDetail(key) {
  try {
    const filePath = getCacheFilePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeCachedDetail(key, detail) {
  try {
    ensureDir(getCacheDir());
    fs.writeFileSync(getCacheFilePath(key), JSON.stringify(detail), "utf8");
  } catch {
  }
}

function parseDateString(date) {
  const [year, month, day] = String(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildWeekDates(weekStart) {
  const start = parseDateString(weekStart);
  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + index);
    return formatUtcDate(current);
  });
}

function shiftDate(dateText, days) {
  const date = parseDateString(dateText);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

function getCurrentDateString(timeZone = process.env.APP_TIMEZONE || "America/Sao_Paulo") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

function getWeekStartFromDate(dateText) {
  const date = parseDateString(dateText);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return formatUtcDate(date);
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  return raw.split(";").reduce((acc, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) return acc;
    acc[name] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function cookieOptionsForRequest() {
  const isCrossOrigin = Boolean(process.env.CORS_ORIGIN);
  const secure = process.env.NODE_ENV === "production" || isCrossOrigin;
  return {
    path: "/",
    sameSite: isCrossOrigin ? "None" : "Lax",
    secure,
  };
}

function clearCookie(res, name) {
  setCookie(res, name, "", {
    maxAge: 0,
    ...cookieOptionsForRequest(),
  });
}

function getAdminSession(req) {
  const token = parseCookies(req).admin_session;
  if (!token) return null;
  const session = adminSessions.get(token);
  if (!session) return null;
  return { token, ...session };
}

function requireAdmin(req, res, next) {
  const session = getAdminSession(req);
  if (!session) {
    return res.status(401).json({
      ok: false,
      message: "Sessao admin obrigatoria.",
    });
  }
  req.adminSession = session;
  return next();
}

function validateMappingPayload(input) {
  const payload = {
    imei: String(input?.imei || "").trim(),
    machine_name: String(input?.machine_name || "").trim(),
    obra_code: String(input?.obra_code || "").trim(),
    obra_name: String(input?.obra_name || "").trim(),
    daily_goal_estacas: Number(input?.daily_goal_estacas || 0),
    weekly_goal_estacas: Number(input?.weekly_goal_estacas || 0),
    active: Boolean(input?.active),
  };

  if (!/^\d{15}$/.test(payload.imei)) {
    throw new Error("IMEI invalido. Informe 15 digitos numericos.");
  }
  if (!payload.machine_name) {
    throw new Error("Nome da maquina obrigatorio.");
  }
  if (payload.daily_goal_estacas < 0 || payload.weekly_goal_estacas < 0) {
    throw new Error("Metas devem ser maiores ou iguais a zero.");
  }

  return payload;
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function runConverter(inputBuffer) {
  return new Promise((resolve, reject) => {
    const converterPath = getConverterPath();

    if (!fs.existsSync(converterPath)) {
      reject(new Error(`Conversor nao encontrado em ${converterPath}`));
      return;
    }

    const child = spawn(converterPath, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Conversor retornou codigo ${code}: ${Buffer.concat(stderrChunks).toString("utf8")}`
          )
        );
        return;
      }

      resolve(Buffer.concat(stdoutChunks).toString("utf8"));
    });

    child.stdin.write(inputBuffer);
    child.stdin.end();
  });
}

function parseNumericLine(line) {
  return line
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part));
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function sum(values) {
  return values.filter((value) => Number.isFinite(value)).reduce((total, value) => total + value, 0);
}

function parseBrDateTime(text) {
  const match = String(text || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, dd, mm, yy, hh, min] = match.map(Number);
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return new Date(Date.UTC(year, mm - 1, dd, hh, min, 0));
}

function minutesBetween(startText, endText) {
  const start = parseBrDateTime(startText);
  const end = parseBrDateTime(endText);
  if (!start || !end) {
    return null;
  }
  return Math.max(0, (end.getTime() - start.getTime()) / 60000);
}

function parseInclination(text) {
  const parts = String(text || "")
    .split(",")
    .map((item) => Number(item.trim()));
  const x = parts[0];
  const y = parts[1];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  const xDeg = x / 10;
  const yDeg = y / 10;
  return {
    xDeg,
    yDeg,
    magnitudeDeg: Math.sqrt((xDeg ** 2) + (yDeg ** 2)),
  };
}

function decodeGps(latitudeRaw, longitudeRaw, altitudeRaw) {
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);
  const altitude = Number(altitudeRaw);

  if (!latitude || !longitude || !altitude) {
    return null;
  }

  const lat = (latitude - 2147483648) / 600000;
  const lon = (longitude - 2147483648) / 600000;
  const alt = altitude - 32768;

  if (lat >= 90 || lat <= -90 || lon >= 180 || lon <= -180) {
    return null;
  }

  return { lat, lon, alt };
}

function parseLine8Metadata(text) {
  const values = String(text || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));

  if (!values.length) {
    return { pulsesPerRotation: null, gps: null, rawValues: [] };
  }

  let gps = null;
  if (values.length === 4) {
    gps = decodeGps(values[1], values[2], values[3]);
  } else if (values.length === 20) {
    gps = decodeGps(values[17], values[18], values[19]);
  }

  return {
    pulsesPerRotation: Number.isFinite(values[0]) ? values[0] : null,
    gps,
    rawValues: values,
  };
}

function convertPressureBar(rawValue) {
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  return -3.32 + (28.32 * rawValue) / 256;
}

function convertTorqueBar(rawValue) {
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  return -53.1 + (453.1 * rawValue) / 256;
}

function classifyShift(timeText) {
  const match = String(timeText || "").match(/^(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return "indefinido";
  }
  const hour = Number(match[1]);
  if (hour >= 6 && hour < 14) return "manha";
  if (hour >= 14 && hour < 22) return "tarde";
  return "noite";
}

function calculateDepthAndPhases(sliceLines) {
  let drilling = 0;
  let concreting = 0;
  let drillingInProgress = true;
  let last = null;

  for (const tick of sliceLines) {
    const [current] = parseNumericLine(tick);

    if (Number.isNaN(current)) {
      continue;
    }

    if (drillingInProgress) {
      if (current === last) {
        drillingInProgress = false;
      } else {
        drilling += 1;
      }
    } else {
      concreting += 1;
    }

    last = current;
  }

  return {
    drillingSlices: drilling,
    concretingSlices: concreting,
    depthCm: Math.max(drilling, concreting) * 8,
  };
}

function parseConvertedText(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const meaningful = lines.filter((line) => line.trim().length > 0);

  if (meaningful.length < 12) {
    throw new Error("Saida do conversor invalida ou incompleta.");
  }

  const headerLines = meaningful.slice(0, 12);
  const sliceLines = meaningful.slice(12);
  const phaseSummary = calculateDepthAndPhases(sliceLines);

  const slices = sliceLines.map((line, index) => {
    const [timeTick, value2, value3] = parseNumericLine(line);
    return {
      index: index + 1,
      raw: line,
      timeTick,
      value2,
      value3,
    };
  });

  return {
    header: {
      version: headerLines[0] || "",
      contrato: headerLines[1] || "",
      obra: headerLines[2] || "",
      numero: headerLines[3] || "",
      diametro: headerLines[4] || "",
      bomba: headerLines[5] || "",
      inclinacao: headerLines[6] || "",
      linha8: headerLines[7] || "",
      inicioPerfuracao: headerLines[8] || "",
      fimPerfuracao: headerLines[9] || "",
      inicioConcretagem: headerLines[10] || "",
      fimConcretagem: headerLines[11] || "",
    },
    phases: phaseSummary,
    slices,
  };
}

async function getObjectBuffer(client, key) {
  const result = await client.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    })
  );

  return streamToBuffer(result.Body);
}

async function buildEstacaDetail(client, key) {
  const cached = readCachedDetail(key);
  if (cached) {
    return cached;
  }

  const bodyBuffer = await getObjectBuffer(client, key);
  const convertedText = await runConverter(bodyBuffer);
  const parsed = parseConvertedText(convertedText);

  const detail = {
    key,
    size: bodyBuffer.length,
    parsed,
  };

  writeCachedDetail(key, detail);
  return detail;
}

function toOperationalSummary(item, detail) {
  const header = detail.parsed.header || {};
  const phases = detail.parsed.phases || {};
  const slices = detail.parsed.slices || [];
  const diameterMm = Number(String(header.diametro || "").replace(",", ".").trim());
  const diameterCm = Number.isFinite(diameterMm) ? diameterMm / 10 : null;
  const realizadoM = Number.isFinite(phases.depthCm) ? phases.depthCm / 100 : null;
  const line8 = parseLine8Metadata(header.linha8);
  const inclination = parseInclination(header.inclinacao);
  const drillingDurationMin = minutesBetween(header.inicioPerfuracao, header.fimPerfuracao);
  const concretingDurationMin = minutesBetween(header.inicioConcretagem, header.fimConcretagem);
  const totalDurationMin =
    Number.isFinite(drillingDurationMin) && Number.isFinite(concretingDurationMin)
      ? drillingDurationMin + concretingDurationMin
      : null;
  const drillingSlices = slices.slice(0, phases.drillingSlices);
  const concretingSlices = slices.slice(phases.drillingSlices + 1);
  const pumpVolumeDeciliters = Number(String(header.bomba || "").replace(",", ".").trim());
  const pumpVolumeLiters = Number.isFinite(pumpVolumeDeciliters) ? pumpVolumeDeciliters / 10 : null;
  const estimatedConcreteLiters =
    pumpVolumeLiters != null ? sum(concretingSlices.map((slice) => slice.value3)) * pumpVolumeLiters : null;
  const avgPressureBar = average(concretingSlices.map((slice) => convertPressureBar(slice.value2)));
  const avgTorqueBar = average(drillingSlices.map((slice) => convertTorqueBar(slice.value3)));
  const drillingTicks = drillingSlices.map((slice) => slice.timeTick).filter((value) => Number.isFinite(value));
  const drillingTicksDiff = drillingTicks.length > 1 ? drillingTicks[drillingTicks.length - 1] - drillingTicks[0] : null;
  const drillingMinutesByTicks = Number.isFinite(drillingTicksDiff) ? drillingTicksDiff / 93.75 / 60 : null;
  const avgRotationRpm =
    line8.pulsesPerRotation && drillingMinutesByTicks && drillingMinutesByTicks > 0
      ? (sum(drillingSlices.map((slice) => slice.value2)) / line8.pulsesPerRotation) / drillingMinutesByTicks
      : null;
  const finishedAtDate = item.finishedAt ? `${item.finishedAt}` : null;
  const shift = classifyShift(item.finishedAt);

  return {
    key: item.key,
    fileName: item.fileName,
    finishedAt: item.finishedAt,
    contrato: (header.contrato || item.contrato || "").trim(),
    obra: (header.obra || item.obra || "").trim(),
    estaca: (header.numero || item.estaca || "").trim(),
    diametroCm: diameterCm,
    realizadoM: realizadoM,
    profundidadeCm: phases.depthCm ?? 0,
    drillingSlices: phases.drillingSlices ?? 0,
    concretingSlices: phases.concretingSlices ?? 0,
    drillingDurationMin,
    concretingDurationMin,
    totalDurationMin,
    inicioPerfuracao: header.inicioPerfuracao || "",
    fimPerfuracao: header.fimPerfuracao || "",
    inicioConcretagem: header.inicioConcretagem || "",
    fimConcretagem: header.fimConcretagem || "",
    inclination,
    pulsesPerRotation: line8.pulsesPerRotation,
    gps: line8.gps,
    estimatedConcreteLiters,
    avgPressureBar,
    avgTorqueBar,
    avgRotationRpm,
    shift,
    finishedAtDate,
  };
}

async function listEstacasByPrefix(client, prefix) {
  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: process.env.S3_BUCKET,
      Prefix: prefix,
    })
  );

  return (result.Contents || []).map((item) => {
    const parsed = parseEstacaKey(item.Key);
    return {
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified,
      ...parsed,
    };
  });
}

async function buildOperationalSummaries(client, prefix) {
  const objects = await listEstacasByPrefix(client, prefix);
  const summaries = [];

  for (const item of objects) {
    const detail = await buildEstacaDetail(client, item.key);
    summaries.push(toOperationalSummary(item, detail));
  }

  return summaries;
}

function applySummaryFilters(items, obraFilter, contratoFilter) {
  const obraQuery = String(obraFilter || "").trim().toLowerCase();
  const contratoQuery = String(contratoFilter || "").trim().toLowerCase();

  return items.filter((item) => {
    const obraOk = !obraQuery || String(item.obra || "").toLowerCase().includes(obraQuery);
    const contratoOk = !contratoQuery || String(item.contrato || "").toLowerCase().includes(contratoQuery);
    return obraOk && contratoOk;
  });
}

function groupTotals(items, field) {
  const map = new Map();

  for (const item of items) {
    const key = String(item[field] || "Nao informado").trim() || "Nao informado";
    const current = map.get(key) || { name: key, meters: 0, count: 0 };
    current.meters += item.realizadoM || 0;
    current.count += 1;
    map.set(key, current);
  }

  return [...map.values()].sort((a, b) => b.meters - a.meters);
}

function buildTimeline(items) {
  return [...items]
    .sort((a, b) => `${a.date} ${a.finishedAt}`.localeCompare(`${b.date} ${b.finishedAt}`))
    .map((item) => ({
      date: item.date,
      finishedAt: item.finishedAt,
      machine: item.machineName,
      estaca: item.estaca,
      obra: item.obra,
      contrato: item.contrato,
      realizadoM: item.realizadoM,
    }));
}

function buildHeatmap(machineReports, weekDates) {
  return machineReports.map((report) => ({
    machine: report.machine.name,
    imei: report.machine.imei,
    cells: weekDates.map((date) => {
      const daily = report.daily.find((item) => item.date === date);
      return {
        date,
        meters: daily?.totalMeters || 0,
        count: daily?.totalCount || 0,
      };
    }),
  }));
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function buildBoxplot(items) {
  const grouped = new Map();

  for (const item of items) {
    const key = item.machineName;
    const values = grouped.get(key) || [];
    if (Number.isFinite(item.realizadoM)) {
      values.push(item.realizadoM);
    }
    grouped.set(key, values);
  }

  return [...grouped.entries()].map(([machine, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      machine,
      min: sorted[0] ?? null,
      q1: percentile(sorted, 0.25),
      median: percentile(sorted, 0.5),
      q3: percentile(sorted, 0.75),
      max: sorted[sorted.length - 1] ?? null,
    };
  });
}

function buildAlerts(machineReports, previousMachineReports, allItems) {
  const alerts = [];
  const previousMap = new Map(previousMachineReports.map((item) => [item.machine.imei, item]));

  for (const report of machineReports) {
    const previous = previousMap.get(report.machine.imei);
    if (report.daysWithoutProduction > 0) {
      alerts.push({
        type: "warning",
        machine: report.machine.name,
        message: `${report.daysWithoutProduction} dia(s) sem producao na semana.`,
      });
    }
    if (previous && previous.weeklyTotalMeters > 0 && report.weeklyTotalMeters < previous.weeklyTotalMeters * 0.7) {
      alerts.push({
        type: "warning",
        machine: report.machine.name,
        message: "Queda de produtividade superior a 30% em relacao a semana anterior.",
      });
    }
    if ((report.quality?.outOfInclinationLimit || 0) > 0) {
      alerts.push({
        type: "danger",
        machine: report.machine.name,
        message: `${report.quality.outOfInclinationLimit} estaca(s) com inclinacao acima do limite configurado.`,
      });
    }
  }

  const avgDepth = average(allItems.map((item) => item.realizadoM));
  if (Number.isFinite(avgDepth)) {
    for (const item of allItems) {
      if (item.realizadoM > avgDepth * 1.3 || item.realizadoM < avgDepth * 0.7) {
        alerts.push({
          type: "info",
          machine: item.machineName,
          message: `Estaca ${item.estaca} com profundidade fora do padrao medio da semana.`,
        });
      }
    }
  }

  return alerts.slice(0, 20);
}

function ensurePdfSpace(doc, needed = 28) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function formatDateBr(dateText) {
  const match = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(dateText || "");
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatClockFromHeader(text) {
  const match = String(text || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return "";
  return `${match[4]}:${match[5]}`;
}

function buildDiaryContext({ clientLogin, imei, date, items, machineName }) {
  const sortedByTime = [...items].sort((a, b) =>
    String(a.finishedAt || "").localeCompare(String(b.finishedAt || ""))
  );
  const firstItem = sortedByTime[0] || {};
  const lastItem = sortedByTime[sortedByTime.length - 1] || {};
  const totalMeters = sum(items.map((item) => item.realizadoM || 0));
  const totalArmacao = 0;
  const diameters = [...new Set(items.map((item) => item.diametroCm).filter(Number.isFinite))];

  const headerStart = items
    .map((item) => formatClockFromHeader(item.inicioPerfuracao))
    .filter(Boolean)
    .sort()[0] || "";
  const headerEnd = items
    .map((item) => formatClockFromHeader(item.fimConcretagem))
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || "";

  return {
    obraNumber: String(firstItem.obra || "").trim() || "N/A",
    clientName: process.env.DIARY_CLIENT_NAME || String(firstItem.contrato || clientLogin || "").trim() || "N/A",
    machineName: machineName || process.env.DIARY_MACHINE_NAME || imei,
    dateBr: formatDateBr(date),
    address: process.env.DIARY_ADDRESS || "N/A",
    team: process.env.DIARY_TEAM || "N/A",
    weather: {
      ensolarado: process.env.DIARY_WEATHER === "ensolarado",
      nublado: process.env.DIARY_WEATHER === "nublado",
      chuvaFraca: process.env.DIARY_WEATHER === "chuva_fraca",
      chuvaForte: process.env.DIARY_WEATHER === "chuva_forte",
    },
    startTime: headerStart || firstItem.finishedAt || "N/A",
    endTime: headerEnd || lastItem.finishedAt || "N/A",
    totalMeters,
    totalArmacao,
    totalCount: items.length,
    diameters,
    planningRows: diameters.slice(0, 2).map((diameter) => ({
      piles: process.env.DIARY_NEXT_DAY_PILES_PER_ROW || "2",
      diameter: String(Math.round(diameter)),
    })),
  };
}

function drawBox(doc, x, y, w, h, options = {}) {
  const fill = options.fill || null;
  const stroke = options.stroke || "#9f988c";
  if (fill) {
    doc.save();
    doc.fillColor(fill).rect(x, y, w, h).fill();
    doc.restore();
  }
  doc.save();
  doc.lineWidth(options.lineWidth || 1).strokeColor(stroke).rect(x, y, w, h).stroke();
  doc.restore();
}

function drawText(doc, text, x, y, w, options = {}) {
  doc
    .font(options.font || "Helvetica")
    .fontSize(options.size || 9)
    .fillColor(options.color || "#111111")
    .text(String(text ?? ""), x, y, {
      width: w,
      align: options.align || "left",
      continued: false,
    });
}

function drawLine(doc, x1, y1, x2, y2, color = "#9f988c") {
  doc.save();
  doc.strokeColor(color).lineWidth(1).moveTo(x1, y1).lineTo(x2, y2).stroke();
  doc.restore();
}

function buildDiaryPdf({ clientLogin, imei, date, items, prefix, machineName }) {
  const doc = new PDFDocument({ size: "A4", margin: 26 });
  const chunks = [];
  const ctx = buildDiaryContext({ clientLogin, imei, date, items, machineName });

  doc.on("data", (chunk) => chunks.push(chunk));

  const left = 42;
  const top = 52;
  const pageWidth = doc.page.width - left * 2;
  const gray = "#d7d3ce";
  const dark = "#151515";
  const border = "#9e9a94";
  drawBox(doc, left, top, pageWidth, 28, { fill: gray, stroke: border });
  drawText(doc, "GONTIJO", left + 6, top + 4, 78, {
    font: "Helvetica-Bold",
    size: 12,
  });
  drawText(doc, "FUNDACOES", left + 10, top + 16, 72, {
    size: 7.5,
    color: "#666666",
  });

  drawText(doc, "DIARIO DE OBRA", left + 120, top + 8, 250, {
    font: "Helvetica-Bold",
    size: 13,
    align: "center",
  });
  drawText(doc, `N° DA OBRA: ${ctx.obraNumber}`, left + 380, top + 8, 130, {
    font: "Helvetica-Bold",
    size: 9,
    align: "right",
  });

  const row1Y = top + 28;
  drawBox(doc, left, row1Y, 322, 30, { stroke: border });
  drawBox(doc, left + 322, row1Y, 74, 30, { stroke: border });
  drawBox(doc, left + 396, row1Y, 108, 30, { stroke: border });
  drawText(doc, "Cliente:", left + 6, row1Y + 10, 40, { font: "Helvetica-Bold", size: 6.8 });
  drawText(doc, ctx.clientName, left + 44, row1Y + 10, 268, { size: 7 });
  drawText(doc, "Equipamento", left + 322 + 6, row1Y + 10, 60, { font: "Helvetica-Bold", size: 6.8 });
  drawText(doc, "Data:", left + 396 + 6, row1Y + 10, 26, { font: "Helvetica-Bold", size: 6.8 });
  drawText(doc, ctx.dateBr, left + 396 + 60, row1Y + 10, 40, { size: 7, align: "right" });

  const row2Y = row1Y + 30;
  drawBox(doc, left, row2Y, 322, 30, { stroke: border });
  drawBox(doc, left + 322, row2Y, 74, 30, { stroke: border });
  drawBox(doc, left + 396, row2Y, 108, 30, { stroke: border });
  drawText(doc, "Endereco:", left + 6, row2Y + 9, 42, { font: "Helvetica-Bold", size: 6.8 });
  drawText(doc, ctx.address, left + 50, row2Y + 9, 262, { size: 6.6 });
  drawText(doc, ctx.machineName, left + 322, row2Y + 9, 74, { font: "Helvetica-Bold", size: 10, align: "center" });
  drawText(doc, "Horario inicio:", left + 396 + 6, row2Y + 7, 52, { font: "Helvetica-Bold", size: 6.8 });
  drawText(doc, ctx.startTime, left + 396 + 70, row2Y + 7, 28, { size: 7, align: "right" });

  const row3Y = row2Y + 30;
  drawBox(doc, left, row3Y, 322, 30, { stroke: border });
  drawBox(doc, left + 322, row3Y, 74, 30, { stroke: border });
  drawBox(doc, left + 396, row3Y, 108, 30, { stroke: border });
  drawText(doc, "Equipe:", left + 6, row3Y + 8, 34, { font: "Helvetica-Bold", size: 6.8 });
  drawText(doc, ctx.team, left + 38, row3Y + 8, 274, { size: 6.2 });
  drawText(doc, "Horario termino:", left + 396 + 6, row3Y + 7, 58, { font: "Helvetica-Bold", size: 6.8 });
  drawText(doc, ctx.endTime, left + 396 + 70, row3Y + 7, 28, { size: 7, align: "right" });

  const weatherY = row3Y + 38;
  drawText(doc, "Ensolarado:", left, weatherY, 70, { font: "Helvetica-Bold", size: 7 });
  drawText(doc, ctx.weather.ensolarado ? "X" : "_____", left + 42, weatherY, 34, { size: 7 });
  drawText(doc, "Nublado:", left + 130, weatherY, 52, { font: "Helvetica-Bold", size: 7 });
  drawText(doc, ctx.weather.nublado ? "X" : "_____", left + 165, weatherY, 34, { size: 7 });
  drawText(doc, "Chuva fraca:", left + 255, weatherY, 62, { font: "Helvetica-Bold", size: 7 });
  drawText(doc, ctx.weather.chuvaFraca ? "X" : "_____", left + 306, weatherY, 34, { size: 7 });
  drawText(doc, "Chuva forte:", left + 378, weatherY, 62, { font: "Helvetica-Bold", size: 7 });
  drawText(doc, ctx.weather.chuvaForte ? "X" : "_____", left + 428, weatherY, 34, { size: 7 });

  let y = weatherY + 18;
  drawBox(doc, left, y, pageWidth, 22, { fill: gray, stroke: border });
  drawText(doc, "Servicos Executados", left, y + 7, pageWidth, {
    font: "Helvetica-Bold",
    size: 8,
    align: "center",
  });
  y += 22;

  const serviceCols = [left, left + 118, left + 206, left + 316, left + 413, left + 504];
  drawBox(doc, left, y, pageWidth, 22, { stroke: border });
  ["Pilar/Estaca", "Diametro (cm)", "Realizado (m)", "Bits", "Armacao (m)"].forEach((label, index) => {
    if (index > 0) {
      drawLine(doc, serviceCols[index], y, serviceCols[index], y + 22, border);
    }
    drawText(doc, label, serviceCols[index], y + 7, serviceCols[index + 1] - serviceCols[index], {
      font: "Helvetica",
      size: 6.5,
      align: "center",
    });
  });
  y += 22;

  const rowHeight = 22;
  items.forEach((item) => {
    drawBox(doc, left, y, pageWidth, rowHeight, { stroke: border });
    for (let i = 1; i < serviceCols.length - 1; i += 1) {
      drawLine(doc, serviceCols[i], y, serviceCols[i], y + rowHeight, border);
    }
    const values = [
      String(item.estaca || "").trim(),
      item.diametroCm != null ? String(Math.round(item.diametroCm)).replace(".", ",") : "-",
      item.realizadoM != null ? formatDecimalNumber(item.realizadoM, 2) : "-",
      "Nao",
      "0,00",
    ];
    values.forEach((value, index) => {
      drawText(doc, value, serviceCols[index], y + 7, serviceCols[index + 1] - serviceCols[index], {
        size: 7.5,
        align: "center",
      });
    });
    y += rowHeight;
  });

  drawBox(doc, left, y, pageWidth, rowHeight, { stroke: border });
  for (let i = 1; i < serviceCols.length - 1; i += 1) {
    drawLine(doc, serviceCols[i], y, serviceCols[i], y + rowHeight, border);
  }
  [
    `${ctx.totalCount} estacas`,
    "-",
    formatDecimalNumber(ctx.totalMeters, 2),
    "-",
    formatDecimalNumber(ctx.totalArmacao, 2),
  ].forEach((value, index) => {
    drawText(doc, value, serviceCols[index], y + 7, serviceCols[index + 1] - serviceCols[index], {
      font: "Helvetica-Bold",
      size: 7.5,
      align: "center",
    });
  });

  y += 30;
  drawBox(doc, left, y, pageWidth, 22, { fill: gray, stroke: border });
  drawText(doc, "OCORRENCIAS", left, y + 7, pageWidth, { font: "Helvetica-Bold", size: 8, align: "center" });
  y += 22;
  drawBox(doc, left, y, 150, 20, { stroke: border });
  drawBox(doc, left + 150, y, pageWidth - 150, 20, { stroke: border });
  drawText(doc, "Horario", left, y + 6, 150, { font: "Helvetica-Bold", size: 7, align: "center" });
  drawText(doc, "Descricao", left + 150, y + 6, pageWidth - 150, { font: "Helvetica-Bold", size: 7, align: "center" });
  y += 20;
  drawBox(doc, left, y, 150, 40, { stroke: border });
  drawBox(doc, left + 150, y, pageWidth - 150, 40, { stroke: border });
  drawText(doc, "N/A", left, y + 14, 150, { size: 7, align: "center" });
  drawText(
    doc,
    process.env.DIARY_OCCURRENCES || "Sem ocorrencias registradas automaticamente.",
    left + 158,
    y + 9,
    pageWidth - 166,
    { size: 7 }
  );

  y += 58;
  const fuelHeaderY = y;
  drawBox(doc, left, fuelHeaderY, pageWidth, 24, { fill: gray, stroke: border });
  drawText(doc, "ABASTECIMENTO", left, fuelHeaderY + 8, pageWidth, {
    font: "Helvetica-Bold",
    size: 8,
    align: "center",
  });

  const blockY = fuelHeaderY + 24;
  const leftBlockW = 223;
  const centerBlockW = 175;
  const rightBlockW = pageWidth - leftBlockW - centerBlockW;

  drawBox(doc, left, blockY, leftBlockW, 116, { stroke: border });
  drawBox(doc, left + leftBlockW, blockY, centerBlockW, 116, { stroke: border });
  drawBox(doc, left + leftBlockW + centerBlockW, blockY, rightBlockW, 116, { stroke: border });

  drawLine(doc, left + 76, blockY, left + 76, blockY + 116, border);
  drawLine(doc, left + 150, blockY, left + 150, blockY + 116, border);
  drawLine(doc, left + 150, blockY + 29, left + leftBlockW, blockY + 29, border);
  drawLine(doc, left + 76, blockY + 58, left + leftBlockW, blockY + 58, border);
  drawLine(doc, left + 150, blockY + 87, left + leftBlockW, blockY + 87, border);

  drawText(doc, "Preencher na data da", left + 6, blockY + 16, 64, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, "mobilizacao", left + 6, blockY + 24, 64, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, "(Antes da montagem)", left + 6, blockY + 39, 64, { font: "Helvetica-Bold", size: 5.8, align: "center" });
  drawText(doc, "Preencher ao final do dia", left + 6, blockY + 77, 64, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, "(Todos os dias)", left + 6, blockY + 92, 64, { font: "Helvetica-Bold", size: 5.8, align: "center" });

  drawText(doc, "Litros de diesel no", left + 83, blockY + 9, 62, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, "tanque", left + 83, blockY + 17, 62, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, process.env.DIARY_DIESEL_TANQUE_INICIAL || "N/A", left + 156, blockY + 12, 60, { size: 7, align: "center" });
  drawText(doc, "Litros de diesel no", left + 83, blockY + 38, 62, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, "galao", left + 83, blockY + 46, 62, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, process.env.DIARY_DIESEL_GALAO_INICIAL || "N/A", left + 156, blockY + 41, 60, { size: 7, align: "center" });
  drawText(doc, "Litros de diesel no", left + 83, blockY + 67, 62, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, "tanque", left + 83, blockY + 75, 62, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, process.env.DIARY_DIESEL_TANQUE_FINAL || "N/A", left + 156, blockY + 70, 60, { size: 7, align: "center" });
  drawText(doc, "Litros de diesel no", left + 83, blockY + 96, 62, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, "galao", left + 83, blockY + 104, 62, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, process.env.DIARY_DIESEL_GALAO_FINAL || "N/A", left + 156, blockY + 99, 60, { size: 7, align: "center" });

  drawBox(doc, left + leftBlockW, blockY, centerBlockW, 30, { fill: gray, stroke: border });
  drawText(doc, "PREENCHER AO FINAL DO DIA", left + leftBlockW, blockY + 10, centerBlockW, {
    font: "Helvetica-Bold",
    size: 7,
    align: "center",
  });
  drawBox(doc, left + leftBlockW, blockY + 30, centerBlockW, 28, { stroke: border });
  drawLine(doc, left + leftBlockW + 110, blockY + 30, left + leftBlockW + 110, blockY + 58, border);
  drawText(doc, "Horimetro", left + leftBlockW, blockY + 40, 110, { font: "Helvetica-Bold", size: 7, align: "center" });
  drawText(doc, process.env.DIARY_HORIMETRO || "N/A", left + leftBlockW + 110, blockY + 40, centerBlockW - 110, { size: 7, align: "center" });

  drawBox(doc, left + leftBlockW, blockY + 58, 92, 58, { stroke: border });
  drawBox(doc, left + leftBlockW + 92, blockY + 58, 83, 58, { stroke: border });
  drawText(doc, "Planejamento do dia seguinte", left + leftBlockW, blockY + 65, 175, {
    font: "Helvetica-Bold",
    size: 6.4,
    align: "center",
  });
  drawLine(doc, left + leftBlockW, blockY + 82, left + leftBlockW + 175, blockY + 82, border);
  drawText(doc, "Nº de estacas", left + leftBlockW, blockY + 87, 92, { font: "Helvetica-Bold", size: 6.3, align: "center" });
  drawText(doc, "Diametro (cm)", left + leftBlockW + 92, blockY + 87, 83, { font: "Helvetica-Bold", size: 6.3, align: "center" });
  drawText(doc, process.env.DIARY_NEXT_DAY_PILES || "N/A", left + leftBlockW, blockY + 100, 92, { size: 7, align: "center" });
  drawText(doc, process.env.DIARY_NEXT_DAY_DIAMETERS || ctx.diameters.map((value) => Math.round(value)).join(", ") || "N/A", left + leftBlockW + 92, blockY + 100, 83, { size: 7, align: "center" });

  drawText(doc, "Nº de estacas para termino da obra", left + leftBlockW + centerBlockW + 8, blockY + 30, rightBlockW - 16, {
    font: "Helvetica-Bold",
    size: 6.3,
    align: "center",
  });
  drawBox(doc, left + leftBlockW + centerBlockW + 8, blockY + 54, rightBlockW - 16, 50, { stroke: border });
  drawLine(doc, left + leftBlockW + centerBlockW + 66, blockY + 54, left + leftBlockW + centerBlockW + 66, blockY + 104, border);
  drawText(doc, "Nº de estacas", left + leftBlockW + centerBlockW + 8, blockY + 62, 58, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, "Diametro (cm)", left + leftBlockW + centerBlockW + 66, blockY + 62, rightBlockW - 74, { font: "Helvetica-Bold", size: 6.2, align: "center" });
  drawText(doc, process.env.DIARY_END_REMAINING_PILES || "N/A", left + leftBlockW + centerBlockW + 8, blockY + 81, 58, { size: 7, align: "center" });
  drawText(doc, process.env.DIARY_END_REMAINING_DIAMETERS || "N/A", left + leftBlockW + centerBlockW + 66, blockY + 81, rightBlockW - 74, { size: 7, align: "center" });

  const fuelMetaY = blockY + 128;
  drawText(doc, "Chegou diesel na obra?", left, fuelMetaY, 104, { font: "Helvetica-Bold", size: 6.5 });
  drawText(doc, process.env.DIARY_CHEGOU_DIESEL || "sim", left + 88, fuelMetaY, 18, { size: 6.5, align: "center" });
  drawText(doc, "x NAO", left + 118, fuelMetaY, 34, { font: "Helvetica-Bold", size: 6.5 });
  drawText(doc, "Fornecido por:", left, fuelMetaY + 20, 72, { font: "Helvetica-Bold", size: 6.5 });
  drawText(doc, process.env.DIARY_FORNECEDOR_DIESEL || "N/A", left + 66, fuelMetaY + 20, 34, { size: 6.5, align: "center" });
  drawText(doc, "x Cliente", left + 118, fuelMetaY + 20, 42, { font: "Helvetica-Bold", size: 6.5 });
  drawText(doc, "Quantos litros?", left, fuelMetaY + 42, 62, { font: "Helvetica-Bold", size: 6.5 });
  drawText(doc, "Horario de chegada", left + 90, fuelMetaY + 42, 80, { font: "Helvetica-Bold", size: 6.5 });
  drawBox(doc, left, fuelMetaY + 54, 118, 24, { stroke: border });
  drawBox(doc, left + 118, fuelMetaY + 54, 98, 24, { stroke: border });
  drawText(doc, process.env.DIARY_DIESEL_QUANTOS || "N/A", left, fuelMetaY + 62, 118, { size: 6.5, align: "center" });
  drawText(doc, process.env.DIARY_DIESEL_HORARIO || "N/A", left + 118, fuelMetaY + 62, 98, { size: 6.5, align: "center" });

  drawBox(doc, left + 228, fuelMetaY + 40, 160, 24, { fill: gray, stroke: border });
  drawText(doc, "Previsao de termino da obra", left + 228, fuelMetaY + 48, 160, {
    font: "Helvetica-Bold",
    size: 6.8,
    align: "center",
  });
  drawBox(doc, left + 388, fuelMetaY + 40, 116, 24, { stroke: border });
  drawText(doc, process.env.DIARY_END_FORECAST || "____/____/____", left + 388, fuelMetaY + 48, 116, {
    size: 7,
    align: "center",
  });

  doc.addPage();
  const p2Left = 42;
  drawText(doc, process.env.DIARY_SIGNATURE_MARK || "", p2Left + 8, 62, 120, {
    size: 8,
    color: "#777777",
  });
  drawLine(doc, p2Left, 92, p2Left + 175, 92, "#505050");
  drawText(doc, process.env.DIARY_COMPANY_SIGNATURE || "Gontijo Fundacoes", p2Left, 98, 175, {
    font: "Helvetica-Bold",
    size: 7,
  });
  drawText(doc, `Nome: ${process.env.DIARY_RESPONSIBLE_NAME || "________________________"}`, p2Left, 108, 190, {
    font: "Helvetica-Bold",
    size: 7,
  });
  drawText(doc, `Documento: ${process.env.DIARY_RESPONSIBLE_DOC || "________________"}`, p2Left, 118, 190, {
    font: "Helvetica-Bold",
    size: 7,
  });

  drawLine(doc, 438, 82, 558, 82, "#505050");
  drawText(doc, "Responsavel da obra", 448, 86, 110, {
    font: "Helvetica-Bold",
    size: 7,
    align: "center",
  });

  drawBox(doc, 42, 390, 500, 18, { fill: gray, stroke: border });
  drawText(doc, "OCORRENCIAS - FOTOS EM ANEXO", 42, 395, 500, {
    font: "Helvetica-Bold",
    size: 10,
    align: "center",
    color: dark,
  });

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function formatDecimalNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(digits).replace(".", ",");
}

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/admin/session", (req, res) => {
  const password = String(req.body?.password || "");
  const configuredPassword = process.env.ADMIN_PASSWORD || "admin";

  if (password !== configuredPassword) {
    return res.status(401).json({
      ok: false,
      message: "Senha admin invalida.",
    });
  }

    const token = crypto.randomUUID();
  adminSessions.set(token, {
    createdAt: new Date().toISOString(),
  });
  setCookie(res, "admin_session", token, {
    maxAge: 60 * 60 * 12,
    ...cookieOptionsForRequest(),
  });

  return res.json({
    ok: true,
    mode: adminStore.getMode(),
  });
});

app.post("/api/admin/logout", (_req, res) => {
  clearCookie(res, "admin_session");
  return res.json({ ok: true });
});

app.get("/api/admin/status", (req, res) => {
  const session = getAdminSession(req);
  return res.json({
    ok: true,
    authenticated: Boolean(session),
    mode: adminStore.getMode(),
  });
});

app.get("/api/admin/machines", requireAdmin, async (_req, res) => {
  try {
    return res.json({
      ok: true,
      items: await adminStore.listMachines(),
      mode: adminStore.getMode(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao listar maquinas admin.",
      details: error.message,
    });
  }
});

app.get("/api/admin/mappings", requireAdmin, async (req, res) => {
  try {
    const includeInactive = String(req.query.includeInactive || "false") === "true";
    return res.json({
      ok: true,
      items: await adminStore.listMappings({ includeInactive }),
      mode: adminStore.getMode(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao listar vinculos admin.",
      details: error.message,
    });
  }
});

app.post("/api/admin/mappings", requireAdmin, async (req, res) => {
  try {
    const mapping = await adminStore.createMapping(validateMappingPayload(req.body || {}));
    if (mapping?.active) {
      await adminStore.activateMapping(mapping.id);
    }
    return res.status(201).json({
      ok: true,
      item: mapping?.active ? await adminStore.getMappingById(mapping.id) : mapping,
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: "Falha ao criar vinculo admin.",
      details: error.message,
    });
  }
});

app.put("/api/admin/mappings/:id", requireAdmin, async (req, res) => {
  try {
    const mapping = await adminStore.updateMapping(req.params.id, validateMappingPayload(req.body || {}));
    return res.json({
      ok: true,
      item: mapping,
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: "Falha ao atualizar vinculo admin.",
      details: error.message,
    });
  }
});

app.post("/api/admin/mappings/:id/activate", requireAdmin, async (req, res) => {
  try {
    const mapping = await adminStore.activateMapping(req.params.id);
    return res.json({
      ok: true,
      item: mapping,
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: "Falha ao ativar vinculo admin.",
      details: error.message,
    });
  }
});

app.post("/api/admin/mappings/:id/archive", requireAdmin, async (req, res) => {
  try {
    const mapping = await adminStore.archiveMapping(req.params.id);
    return res.json({
      ok: true,
      item: mapping,
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: "Falha ao encerrar vinculo admin.",
      details: error.message,
    });
  }
});

app.get("/api/display/config", (req, res) => {
  const screen = String(req.query.screen || "primary");
  const rotationSeconds = Number(process.env.TV_ROTATION_SECONDS || 300);
  const autoRefreshSeconds = Number(process.env.TV_AUTO_REFRESH_SECONDS || 60);

  return res.json({
    ok: true,
    item: {
      screen,
      tvMode: true,
      rotationSeconds: screen === "secondary" ? Number(process.env.TV_SECONDARY_ROTATION_SECONDS || 120) : rotationSeconds,
      autoRefreshSeconds,
      tabs: screen === "secondary"
        ? ["secondary-overview", "secondary-heatmap", "secondary-timeline"]
        : ["daily", "weekly"],
    },
  });
});

app.get("/api/dashboard/daily", async (req, res) => {
  const missing = missingEnvVars();
  if (missing.length > 0) {
    return res.status(500).json({
      ok: false,
      message: "Variaveis de ambiente obrigatorias ausentes.",
      missing,
    });
  }

  try {
    const date = String(req.query.date || getCurrentDateString());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        ok: false,
        message: "Data invalida. Use o formato YYYY-MM-DD.",
      });
    }

    const clientLogin = getClientLogin(req.query.clientLogin);
    const client = buildS3Client();
    const mappings = await adminStore.listActiveMappings();
    const dashboard = await buildDailyDashboard({
      mappings,
      date,
      loadSummaries: async (imei, summaryDate) => {
        const prefix = buildPrefix(clientLogin, imei, summaryDate);
        return buildOperationalSummaries(client, prefix);
      },
    });

    return res.json({
      ok: true,
      clientLogin,
      ...dashboard,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao gerar dashboard diario.",
      details: error.message,
    });
  }
});

app.get("/api/dashboard/weekly", async (req, res) => {
  const missing = missingEnvVars();
  if (missing.length > 0) {
    return res.status(500).json({
      ok: false,
      message: "Variaveis de ambiente obrigatorias ausentes.",
      missing,
    });
  }

  try {
    const weekStart = String(req.query.weekStart || getWeekStartFromDate(getCurrentDateString()));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return res.status(400).json({
        ok: false,
        message: "weekStart invalido. Use o formato YYYY-MM-DD.",
      });
    }

    const clientLogin = getClientLogin(req.query.clientLogin);
    const client = buildS3Client();
    const weekDates = buildWeekDates(weekStart);
    const mappings = await adminStore.listActiveMappings();
    const dashboard = await buildWeeklyDashboard({
      mappings,
      weekStart,
      weekDates,
      loadSummaries: async (imei, summaryDate) => {
        const prefix = buildPrefix(clientLogin, imei, summaryDate);
        return buildOperationalSummaries(client, prefix);
      },
    });

    return res.json({
      ok: true,
      clientLogin,
      ...dashboard,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao gerar dashboard semanal.",
      details: error.message,
    });
  }
});

app.get("/api/dashboard/secondary", async (req, res) => {
  const missing = missingEnvVars();
  if (missing.length > 0) {
    return res.status(500).json({
      ok: false,
      message: "Variaveis de ambiente obrigatorias ausentes.",
      missing,
    });
  }

  try {
    const date = String(req.query.date || getCurrentDateString());
    const weekStart = String(req.query.weekStart || getWeekStartFromDate(date));
    const clientLogin = getClientLogin(req.query.clientLogin);
    const client = buildS3Client();
    const mappings = await adminStore.listActiveMappings();
    const weekDates = buildWeekDates(weekStart);

    const dailyDashboard = await buildDailyDashboard({
      mappings,
      date,
      loadSummaries: async (imei, summaryDate) => {
        const prefix = buildPrefix(clientLogin, imei, summaryDate);
        return buildOperationalSummaries(client, prefix);
      },
    });

    const weeklyDashboard = await buildWeeklyDashboard({
      mappings,
      weekStart,
      weekDates,
      loadSummaries: async (imei, summaryDate) => {
        const prefix = buildPrefix(clientLogin, imei, summaryDate);
        return buildOperationalSummaries(client, prefix);
      },
    });

    return res.json({
      ok: true,
      clientLogin,
      date,
      weekStart,
      item: buildSecondaryDashboard({
        dailyDashboard,
        weeklyDashboard,
      }),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao gerar painel secundario.",
      details: error.message,
    });
  }
});

app.get("/api/health", async (_req, res) => {
  const missing = missingEnvVars();

  if (missing.length > 0) {
    return res.status(500).json({
      ok: false,
      message: "Variaveis de ambiente obrigatorias ausentes.",
      missing,
    });
  }

  try {
    const client = buildS3Client();
    await client.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));

    return res.json({
      ok: true,
      message: "Conexao com o bucket validada.",
      bucket: process.env.S3_BUCKET,
      region: process.env.AWS_REGION || "sa-east-1",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao validar acesso ao bucket.",
      error: error.name,
      details: error.message,
    });
  }
});

app.get("/api/estacas", async (req, res) => {
  const missing = missingEnvVars();
  const { imei, date, clientLogin } = req.query;

  if (missing.length > 0) {
    return res.status(500).json({
      ok: false,
      message: "Variaveis de ambiente obrigatorias ausentes.",
      missing,
    });
  }

  if (!/^\d{15}$/.test(String(imei || ""))) {
    return res.status(400).json({
      ok: false,
      message: "IMEI invalido. Informe 15 digitos numericos.",
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    return res.status(400).json({
      ok: false,
      message: "Data invalida. Use o formato YYYY-MM-DD.",
    });
  }

  const normalizedClientLogin = getClientLogin(clientLogin);
  const prefix = buildPrefix(normalizedClientLogin, imei, date);

  try {
    const client = buildS3Client();
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET,
        Prefix: prefix,
      })
    );

    const objects = (result.Contents || []).map((item) => {
      const parsed = parseEstacaKey(item.Key);
      return {
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
        ...parsed,
      };
    });

    return res.json({
      ok: true,
      bucket: process.env.S3_BUCKET,
      clientLogin: normalizedClientLogin,
      prefix,
      count: objects.length,
      items: objects,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao consultar objetos no S3.",
      error: error.name,
      details: error.message,
      prefix,
    });
  }
});

app.get("/api/estacas/summary", async (req, res) => {
  const missing = missingEnvVars();
  const { imei, date, clientLogin } = req.query;

  if (missing.length > 0) {
    return res.status(500).json({
      ok: false,
      message: "Variaveis de ambiente obrigatorias ausentes.",
      missing,
    });
  }

  if (!/^\d{15}$/.test(String(imei || ""))) {
    return res.status(400).json({
      ok: false,
      message: "IMEI invalido. Informe 15 digitos numericos.",
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    return res.status(400).json({
      ok: false,
      message: "Data invalida. Use o formato YYYY-MM-DD.",
    });
  }

  const normalizedClientLogin = getClientLogin(clientLogin);
  const prefix = buildPrefix(normalizedClientLogin, imei, date);

  try {
    const client = buildS3Client();
    const summaries = await buildOperationalSummaries(client, prefix);

    return res.json({
      ok: true,
      bucket: process.env.S3_BUCKET,
      clientLogin: normalizedClientLogin,
      prefix,
      count: summaries.length,
      items: summaries,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao gerar resumo das estacas.",
      error: error.name,
      details: error.message,
      prefix,
    });
  }
});

app.get("/api/estacas/summary/pdf", async (req, res) => {
  const missing = missingEnvVars();
  const { imei, date, clientLogin, machineName } = req.query;

  if (missing.length > 0) {
    return res.status(500).json({
      ok: false,
      message: "Variaveis de ambiente obrigatorias ausentes.",
      missing,
    });
  }

  if (!/^\d{15}$/.test(String(imei || ""))) {
    return res.status(400).json({
      ok: false,
      message: "IMEI invalido. Informe 15 digitos numericos.",
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    return res.status(400).json({
      ok: false,
      message: "Data invalida. Use o formato YYYY-MM-DD.",
    });
  }

  const normalizedClientLogin = getClientLogin(clientLogin);
  const prefix = buildPrefix(normalizedClientLogin, imei, date);

  try {
    const client = buildS3Client();
    const items = await buildOperationalSummaries(client, prefix);
    const pdfBuffer = await buildDiaryPdf({
      clientLogin: normalizedClientLogin,
      imei,
      date,
      items,
      prefix,
      machineName: String(machineName || "").trim(),
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"diario-estacas-${normalizedClientLogin}-${imei}-${date}.pdf\"`
    );
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao gerar diario em PDF.",
      error: error.name,
      details: error.message,
      prefix,
    });
  }
});

app.post("/api/dashboard/weekly", async (req, res) => {
  const missing = missingEnvVars();
  const { clientLogin, weekStart, machines, obraFilter, contratoFilter } = req.body || {};

  if (missing.length > 0) {
    return res.status(500).json({
      ok: false,
      message: "Variaveis de ambiente obrigatorias ausentes.",
      missing,
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart || ""))) {
    return res.status(400).json({
      ok: false,
      message: "weekStart invalido. Use o formato YYYY-MM-DD.",
    });
  }

  if (!Array.isArray(machines) || machines.length === 0) {
    return res.status(400).json({
      ok: false,
      message: "Informe ao menos uma maquina para o dashboard semanal.",
    });
  }

  const normalizedClientLogin = getClientLogin(clientLogin);
  const weekDates = buildWeekDates(weekStart);
  const normalizedMachines = machines
    .map((item) => ({
      name: String(item?.name || "").trim(),
      imei: String(item?.imei || "").trim(),
    }))
    .filter((item) => item.name && /^\d{15}$/.test(item.imei));

  if (!normalizedMachines.length) {
    return res.status(400).json({
      ok: false,
      message: "Nenhuma maquina valida foi enviada.",
    });
  }

  try {
    const client = buildS3Client();
    const machineReports = [];
    const previousMachineReports = [];
    const allItems = [];
    const previousAllItems = [];
    const previousWeekDates = buildWeekDates(shiftDate(weekStart, -7));

    for (const machine of normalizedMachines) {
      const daily = [];
      const previousDaily = [];
      let weeklyTotalMeters = 0;
      let weeklyTotalCount = 0;
      let firstFinishedAt = null;
      let lastFinishedAt = null;
      const shiftStats = {
        manha: { meters: 0, count: 0 },
        tarde: { meters: 0, count: 0 },
        noite: { meters: 0, count: 0 },
        indefinido: { meters: 0, count: 0 },
      };
      const weeklyItems = [];

      for (const date of weekDates) {
        const prefix = buildPrefix(normalizedClientLogin, machine.imei, date);
        const summaries = applySummaryFilters(await buildOperationalSummaries(client, prefix), obraFilter, contratoFilter)
          .map((item) => ({ ...item, machineName: machine.name, machineImei: machine.imei, date }));
        const totalMeters = summaries.reduce((sum, item) => sum + (item.realizadoM || 0), 0);
        const totalCount = summaries.length;
        const firstTime = summaries.map((item) => item.finishedAt).filter(Boolean).sort()[0] || null;
        const lastTime = summaries.map((item) => item.finishedAt).filter(Boolean).sort().at(-1) || null;

        daily.push({
          date,
          totalMeters,
          totalCount,
          firstTime,
          lastTime,
        });

        weeklyTotalMeters += totalMeters;
        weeklyTotalCount += totalCount;
        weeklyItems.push(...summaries);
        allItems.push(...summaries);

        if (firstTime && (!firstFinishedAt || `${date} ${firstTime}` < firstFinishedAt)) {
          firstFinishedAt = `${date} ${firstTime}`;
        }
        if (lastTime && (!lastFinishedAt || `${date} ${lastTime}` > lastFinishedAt)) {
          lastFinishedAt = `${date} ${lastTime}`;
        }

        for (const item of summaries) {
          const bucket = shiftStats[item.shift] || shiftStats.indefinido;
          bucket.meters += item.realizadoM || 0;
          bucket.count += 1;
        }
      }

      let previousWeeklyTotalMeters = 0;
      let previousWeeklyTotalCount = 0;
      for (const date of previousWeekDates) {
        const prefix = buildPrefix(normalizedClientLogin, machine.imei, date);
        const summaries = applySummaryFilters(await buildOperationalSummaries(client, prefix), obraFilter, contratoFilter)
          .map((item) => ({ ...item, machineName: machine.name, machineImei: machine.imei, date }));
        const totalMeters = summaries.reduce((sum, item) => sum + (item.realizadoM || 0), 0);
        const totalCount = summaries.length;
        previousDaily.push({ date, totalMeters, totalCount });
        previousWeeklyTotalMeters += totalMeters;
        previousWeeklyTotalCount += totalCount;
        previousAllItems.push(...summaries);
      }

      const avgInclination = average(weeklyItems.map((item) => item.inclination?.magnitudeDeg));
      const outOfInclinationLimit = weeklyItems.filter((item) => (item.inclination?.magnitudeDeg || 0) > 5).length;
      const avgDrillingDurationMin = average(weeklyItems.map((item) => item.drillingDurationMin));
      const avgConcretingDurationMin = average(weeklyItems.map((item) => item.concretingDurationMin));
      const utilizationRate = weekDates.length ? ((weekDates.length - daily.filter((item) => item.totalCount === 0).length) / weekDates.length) * 100 : 0;
      const avgConcreteLiters = average(weeklyItems.map((item) => item.estimatedConcreteLiters));
      const avgPressureBar = average(weeklyItems.map((item) => item.avgPressureBar));
      const avgTorqueBar = average(weeklyItems.map((item) => item.avgTorqueBar));
      const avgRotationRpm = average(weeklyItems.map((item) => item.avgRotationRpm));
      const gpsPoints = weeklyItems.filter((item) => item.gps);

      machineReports.push({
        machine,
        daily,
        previousDaily,
        weeklyTotalMeters,
        weeklyTotalCount,
        previousWeeklyTotalMeters,
        previousWeeklyTotalCount,
        firstFinishedAt,
        lastFinishedAt,
        daysWithoutProduction: daily.filter((item) => item.totalCount === 0).length,
        utilizationRate,
        shifts: shiftStats,
        quality: {
          avgInclination,
          outOfInclinationLimit,
          avgPressureBar,
          avgTorqueBar,
          avgRotationRpm,
          avgConcreteLiters,
        },
        operations: {
          avgDrillingDurationMin,
          avgConcretingDurationMin,
          avgMetersPerPile: weeklyTotalCount ? weeklyTotalMeters / weeklyTotalCount : 0,
        },
        gpsPoints: gpsPoints.map((item) => ({
          lat: item.gps.lat,
          lon: item.gps.lon,
          alt: item.gps.alt,
          estaca: item.estaca,
          obra: item.obra,
        })),
      });

      previousMachineReports.push({
        machine,
        weeklyTotalMeters: previousWeeklyTotalMeters,
        weeklyTotalCount: previousWeeklyTotalCount,
      });
    }

    const obraTotals = groupTotals(allItems, "obra");
    const contratoTotals = groupTotals(allItems, "contrato");
    const previousTotalMeters = previousMachineReports.reduce((sum, item) => sum + item.weeklyTotalMeters, 0);
    const previousTotalCount = previousMachineReports.reduce((sum, item) => sum + item.weeklyTotalCount, 0);

    return res.json({
      ok: true,
      clientLogin: normalizedClientLogin,
      weekStart,
      weekDates,
      previousWeekStart: previousWeekDates[0],
      previousWeekDates,
      previousTotals: {
        meters: previousTotalMeters,
        count: previousTotalCount,
      },
      obraTotals,
      contratoTotals,
      timeline: buildTimeline(allItems).slice(0, 50),
      heatmap: buildHeatmap(machineReports, weekDates),
      boxplot: buildBoxplot(allItems),
      alerts: buildAlerts(machineReports, previousMachineReports, allItems),
      machines: machineReports,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao gerar dashboard semanal.",
      error: error.name,
      details: error.message,
    });
  }
});

app.get("/api/estacas/detail", async (req, res) => {
  const missing = missingEnvVars();
  const { key } = req.query;

  if (missing.length > 0) {
    return res.status(500).json({
      ok: false,
      message: "Variaveis de ambiente obrigatorias ausentes.",
      missing,
    });
  }

  if (!key || typeof key !== "string") {
    return res.status(400).json({
      ok: false,
      message: "Parametro key obrigatorio.",
    });
  }

  try {
    const client = buildS3Client();
    const detail = await buildEstacaDetail(client, key);

    return res.json({
      ok: true,
      bucket: process.env.S3_BUCKET,
      key: detail.key,
      size: detail.size,
      parsed: detail.parsed,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao baixar ou converter a estaca.",
      error: error.name,
      details: error.message,
      key,
    });
  }
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Servidor em http://localhost:${port}`);
  });
}

module.exports = app;
