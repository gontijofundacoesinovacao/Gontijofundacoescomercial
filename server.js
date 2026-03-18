const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const dotenv = require("dotenv");
const PDFDocument = require("pdfkit");
const {
  S3Client,
  ListObjectsV2Command,
  HeadBucketCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
app.use(express.json({ limit: "1mb" }));

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

function buildDiaryPdf({ clientLogin, imei, date, items, prefix }) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));

  doc.fontSize(20).text("Diario de Estacas", { align: "center" });
  doc.moveDown(0.6);
  doc.fontSize(10);
  doc.text(`Cliente: ${clientLogin}`);
  doc.text(`IMEI: ${imei}`);
  doc.text(`Data: ${date}`);
  doc.text(`Prefixo: ${prefix}`);
  doc.text(`Total de estacas: ${items.length}`);
  doc.moveDown();

  const tableTopBase = doc.y;
  const col = {
    estaca: 40,
    diametro: 170,
    realizado: 270,
    fim: 370,
    contrato: 445,
    obra: 515,
  };

  const drawHeader = () => {
    ensurePdfSpace(doc, 30);
    const top = doc.y;
    doc.rect(40, top, 515, 24).fill("#ece6da");
    doc.fillColor("#000").fontSize(10).font("Helvetica-Bold");
    doc.text("Pilar/Estaca", col.estaca + 4, top + 7, { width: 120 });
    doc.text("Diametro (cm)", col.diametro + 4, top + 7, { width: 90 });
    doc.text("Realizado (m)", col.realizado + 4, top + 7, { width: 90 });
    doc.text("Fim", col.fim + 4, top + 7, { width: 60 });
    doc.text("Contrato", col.contrato + 4, top + 7, { width: 65 });
    doc.text("Obra", col.obra + 4, top + 7, { width: 35 });
    doc.y = top + 24;
    doc.font("Helvetica").fontSize(10);
  };

  drawHeader();

  for (const item of items) {
    ensurePdfSpace(doc, 24);
    const top = doc.y;
    doc.rect(40, top, 515, 24).stroke("#c7bead");
    doc.text(String(item.estaca || "").trim(), col.estaca + 4, top + 7, { width: 120 });
    doc.text(item.diametroCm != null ? String(Math.round(item.diametroCm)).replace(".", ",") : "-", col.diametro + 4, top + 7, { width: 90 });
    doc.text(item.realizadoM != null ? item.realizadoM.toFixed(2).replace(".", ",") : "-", col.realizado + 4, top + 7, { width: 90 });
    doc.text(item.finishedAt || "-", col.fim + 4, top + 7, { width: 60 });
    doc.text(String(item.contrato || "").trim(), col.contrato + 4, top + 7, { width: 65 });
    doc.text(String(item.obra || "").trim(), col.obra + 4, top + 7, { width: 35 });
    doc.y = top + 24;
    if (doc.y + 40 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }
  }

  doc.moveDown(1.2);
  ensurePdfSpace(doc, 60);
  doc.font("Helvetica-Bold").text("Observacoes do calculo");
  doc.font("Helvetica").fontSize(9);
  doc.text("- Cada fatia representa 8 cm, conforme a documentacao da Geodigitus.");
  doc.text("- O campo Realizado (m) foi calculado a partir da contagem de fatias convertidas.");
  doc.text("- O diametro foi lido do cabecalho gerado pelo sacibin2txt.");

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

app.use(express.static(path.join(__dirname, "public")));

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
    const items = await buildOperationalSummaries(client, prefix);
    const pdfBuffer = await buildDiaryPdf({
      clientLogin: normalizedClientLogin,
      imei,
      date,
      items,
      prefix,
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

app.listen(port, () => {
  console.log(`Servidor em http://localhost:${port}`);
});
