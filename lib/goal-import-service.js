const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { calculateSegmentMeq, getMeqFactor } = require("./meq");

const execFileAsync = promisify(execFile);
const OCR_NUMBER_REGEX = /R\$\s*\d+(?:\.\d{3})*(?:,\d+)?|\d+(?:\.\d{3})*(?:,\d+)?/g;
const DATE_REGEX = /\b(\d{2}\/\d{2}\/\d{4})\b/;

function stripAccents(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeMachineToken(value) {
  return stripAccents(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseBrNumber(value) {
  if (value == null || value === "") return null;
  const normalized = String(value)
    .replace(/R\$\s*/gi, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!normalized) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function parseInteger(value) {
  const result = parseBrNumber(value);
  return Number.isFinite(result) ? Math.round(result) : null;
}

function parseDateBr(value) {
  const text = String(value || "").trim();
  const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return text;
  return "";
}

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] != null && obj[key] !== "") {
      return obj[key];
    }
  }
  return null;
}

function normalizeSegmentsFromRow(row) {
  if (Array.isArray(row?.segments) && row.segments.length) {
    return row.segments;
  }

  const segments = [];
  for (let index = 1; index <= 6; index += 1) {
    const segment = {
      meta_estacas: firstDefined(row, [`meta_estacas_${index}`, `meta_qtd_estacas_${index}`, `qtd_estacas_${index}`, `quantidade_${index}`]),
      diametro_cm: firstDefined(row, [`diametro_${index}`, `diametro_cm_${index}`, `\u00f8_${index}`, `o_${index}`]),
      profundidade_m: firstDefined(row, [`profundidade_${index}`, `profundidade_m_${index}`]),
      valor_unitario: firstDefined(row, [`valor_${index}`, `valor_unitario_${index}`, `valor_\u00f8_${index}`]),
    };
    if (Object.values(segment).some((value) => value != null && value !== "")) {
      segments.push(segment);
    }
  }
  return segments;
}

function normalizeSegment(segment, index) {
  const metaEstacas = parseInteger(firstDefined(segment, ["meta_estacas", "meta", "quantidade_estacas", "qtd_estacas"]));
  const diametroCm = parseBrNumber(firstDefined(segment, ["diametro_cm", "diametro", "\u00f8", "o"]));
  const profundidadeM = parseBrNumber(firstDefined(segment, ["profundidade_m", "profundidade"]));
  const valorUnitario = parseBrNumber(firstDefined(segment, ["valor_unitario", "valor", "preco"]));
  const filledValues = [metaEstacas, diametroCm, profundidadeM, valorUnitario].filter((value) => value != null).length;

  if (!filledValues) {
    return null;
  }

  const { meqFactor, metaMeqSegmento } = calculateSegmentMeq(metaEstacas, profundidadeM, diametroCm);

  return {
    segment_index: index,
    meta_estacas: metaEstacas ?? 0,
    diametro_cm: diametroCm,
    profundidade_m: profundidadeM,
    valor_unitario: valorUnitario,
    meq_factor: meqFactor,
    meta_meq_segmento: metaMeqSegmento,
    incomplete: filledValues > 0 && filledValues < 4,
  };
}

function buildMachineIndex(machines = []) {
  return machines.map((item) => {
    const machineName = item.active_mapping?.machine_name || item.machine_name || "";
    return {
      imei: item.imei || "",
      machine_name: machineName,
      token: normalizeMachineToken(machineName),
      aliases: [machineName, item.machine_name, item.active_mapping?.machine_name].filter(Boolean).map(normalizeMachineToken),
    };
  });
}

function matchMachine(equipmentLabel, machines = []) {
  const token = normalizeMachineToken(equipmentLabel);
  if (!token) return null;

  const exact = machines.find((item) => item.aliases.includes(token) || item.token === token);
  if (exact) {
    return {
      imei: exact.imei,
      machine_name: exact.machine_name,
      confidence: "exact",
    };
  }

  const loose = machines.find((item) => token.includes(item.token) || item.token.includes(token));
  if (loose) {
    return {
      imei: loose.imei,
      machine_name: loose.machine_name,
      confidence: "loose",
    };
  }

  return null;
}

function normalizeGoalRow(row, machineIndex, options = {}) {
  const warnings = [];
  const errors = [];
  const equipmentLabel = String(firstDefined(row, ["equipment_label", "equipment", "equipamento", "maquina"]) || "").trim();
  const date = parseDateBr(firstDefined(row, ["date", "data"]));
  const obraCode = String(firstDefined(row, ["obra_code", "obra", "numero_obra", "n_obra"]) || "").trim();
  const metaMeqInformado = parseBrNumber(firstDefined(row, ["meta_meq_informado", "meta_meq", "meta_meq_planilha"]));
  const rawSegments = normalizeSegmentsFromRow(row);
  const segments = rawSegments
    .map((segment, index) => normalizeSegment(segment, index + 1))
    .filter(Boolean);
  const manualMachineName = String(firstDefined(row, ["machine_name"]) || "").trim();
  const manualImei = String(firstDefined(row, ["imei"]) || "").trim();
  const machineMatch =
    manualMachineName || manualImei
      ? {
          imei: manualImei,
          machine_name: manualMachineName || equipmentLabel,
          confidence: "manual",
        }
      : matchMachine(equipmentLabel, machineIndex);

  if (!date) {
    errors.push("Data invalida ou ausente.");
  }
  if (!equipmentLabel) {
    errors.push("Equipamento ausente.");
  }
  if (!obraCode) {
    warnings.push("Numero da obra ausente.");
  }
  if (!segments.length) {
    errors.push("Nenhuma faixa valida encontrada.");
  }
  if (!machineMatch) {
    warnings.push("Equipamento nao reconhecido automaticamente.");
  } else if (machineMatch.confidence !== "exact") {
    warnings.push("Equipamento reconhecido com correspondencia aproximada.");
  }

  for (const segment of segments) {
    if (segment.incomplete) {
      errors.push(`Faixa ${segment.segment_index} incompleta.`);
    }
    if (!Number.isFinite(segment.meq_factor)) {
      errors.push(`Faixa ${segment.segment_index} sem fator MEQ valido para o diametro informado.`);
    }
  }

  const metaEstacasTotal = segments.reduce((sum, segment) => sum + (segment.meta_estacas || 0), 0);
  const metaMeqTotal = Number(
    segments.reduce((sum, segment) => sum + (segment.meta_meq_segmento || 0), 0).toFixed(2)
  );

  if (Number.isFinite(metaMeqInformado) && Math.abs(metaMeqInformado - metaMeqTotal) > 0.05) {
    warnings.push(`Meta MEQ informada (${metaMeqInformado.toFixed(2)}) difere da recalculada (${metaMeqTotal.toFixed(2)}).`);
  }

  if (row?.ocr_warning) {
    warnings.push(String(row.ocr_warning));
  }

  return {
    id: row.id || crypto.randomUUID(),
    date,
    equipment_label: equipmentLabel,
    machine_name: machineMatch?.machine_name || equipmentLabel,
    imei: machineMatch?.imei || "",
    machine_match: machineMatch,
    obra_code: obraCode,
    meta_estacas_total: metaEstacasTotal,
    meta_meq_total: metaMeqTotal,
    meta_meq_informado: Number.isFinite(metaMeqInformado) ? Number(metaMeqInformado.toFixed(2)) : null,
    source_image_id: options.sourceImageId || "",
    source_file_name: options.sourceFileName || "",
    segments: segments.map((segment) => ({
      segment_index: segment.segment_index,
      meta_estacas: segment.meta_estacas || 0,
      diametro_cm: segment.diametro_cm,
      profundidade_m: segment.profundidade_m,
      valor_unitario: segment.valor_unitario,
      meq_factor: Number.isFinite(segment.meq_factor) ? Number(segment.meq_factor.toFixed(4)) : null,
      meta_meq_segmento: Number.isFinite(segment.meta_meq_segmento) ? Number(segment.meta_meq_segmento.toFixed(2)) : null,
    })),
    warnings,
    errors,
  };
}

function normalizeGoalRows(rows, machines, options = {}) {
  const machineIndex = buildMachineIndex(machines);
  return rows
    .map((row) => normalizeGoalRow(row, machineIndex, options))
    .filter((row) => row.date || row.equipment_label || row.segments.length);
}

function sanitizeOcrText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[|]/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitOcrCandidates(text) {
  const lines = sanitizeOcrText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = [];
  let current = null;

  for (const line of lines) {
    if (DATE_REGEX.test(line)) {
      if (current?.lines.length) candidates.push(current);
      current = { lines: [line] };
      continue;
    }

    if (!current) continue;

    if (current.lines.length < 3) {
      current.lines.push(line);
    } else {
      candidates.push(current);
      current = { lines: [line] };
    }
  }

  if (current?.lines.length) {
    candidates.push(current);
  }

  return candidates;
}

function normalizePossibleDiameter(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  const candidates = [numeric, numeric * 10, numeric / 10, numeric / 100];
  for (const candidate of candidates) {
    if (Number.isFinite(getMeqFactor(candidate))) {
      return Number(candidate.toFixed(2));
    }
  }
  return null;
}

function isValidSegmentValues(metaEstacas, diametroCm, profundidadeM, valorUnitario) {
  return (
    Number.isFinite(metaEstacas) &&
    metaEstacas > 0 &&
    metaEstacas < 10000 &&
    Number.isFinite(diametroCm) &&
    Number.isFinite(getMeqFactor(diametroCm)) &&
    Number.isFinite(profundidadeM) &&
    profundidadeM > 0 &&
    profundidadeM < 100 &&
    Number.isFinite(valorUnitario) &&
    valorUnitario >= 0
  );
}

function extractNumericTokens(text) {
  return [...String(text || "").matchAll(OCR_NUMBER_REGEX)].map((match) => ({
    raw: match[0],
    value: parseBrNumber(match[0]),
    index: match.index ?? 0,
  }));
}

function extractLabeledMetaMeq(text) {
  const match = String(text || "").match(/MEQ(?:\s+TOTAL|\s+PLANILHA)?[:\s]+([\d.,]+)/i);
  return match ? parseBrNumber(match[1]) : null;
}

function extractObraCode(text) {
  const normalizedText = String(text || "");
  const explicitMatch = normalizedText.match(/\bOBRA\b[:\s-]*([A-Z0-9./-]{2,})/i);
  if (explicitMatch) {
    return explicitMatch[1].replace(/[|,;]+$/g, "");
  }

  const genericMatch = normalizedText.match(/\b([A-Z]{0,3}\d{3,}[A-Z0-9/-]*)\b/);
  return genericMatch ? genericMatch[1] : "";
}

function extractEquipmentLabel(text) {
  const withoutDate = String(text || "").replace(DATE_REGEX, " ");
  const firstNumberIndex = withoutDate.search(/\d/);
  const head = firstNumberIndex >= 0 ? withoutDate.slice(0, firstNumberIndex) : withoutDate;
  const cleaned = head
    .replace(/\bOBRA\b.*$/i, " ")
    .replace(/\bMETA\b.*$/i, " ")
    .replace(/[^\w\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const genericWords = new Set(["DATA", "EQUIPAMENTO", "MAQUINA", "PLANILHA", "METAS", "SEMANAL"]);
  const tokens = cleaned
    .split(" ")
    .filter((token) => token && !genericWords.has(stripAccents(token).toUpperCase()));

  return tokens.join(" ").trim();
}

function buildSegmentsFromNumbers(tokens) {
  const segments = [];
  const usedIndexes = new Set();

  for (let index = 0; index <= tokens.length - 4; ) {
    const metaEstacas = Math.round(tokens[index].value);
    const diametroCm = normalizePossibleDiameter(tokens[index + 1].value);
    const profundidadeM = tokens[index + 2].value;
    const valorUnitario = tokens[index + 3].value;

    if (isValidSegmentValues(metaEstacas, diametroCm, profundidadeM, valorUnitario)) {
      segments.push({
        meta_estacas: metaEstacas,
        diametro_cm: diametroCm,
        profundidade_m: Number(profundidadeM.toFixed(2)),
        valor_unitario: Number(valorUnitario.toFixed(2)),
      });
      usedIndexes.add(index);
      usedIndexes.add(index + 1);
      usedIndexes.add(index + 2);
      usedIndexes.add(index + 3);
      index += 4;
      continue;
    }

    index += 1;
  }

  const leftovers = tokens.filter((_, index) => !usedIndexes.has(index));
  return { segments, leftovers };
}

function parseOcrCandidate(candidate) {
  const text = candidate.lines.join(" ");
  const dateMatch = text.match(DATE_REGEX);
  if (!dateMatch) return null;

  const date = dateMatch[1];
  const withoutDate = text.replace(date, " ");
  const obraCode = extractObraCode(withoutDate);
  const withoutObra = obraCode ? withoutDate.replace(obraCode, " ") : withoutDate;
  const equipmentLabel = extractEquipmentLabel(withoutObra);
  const numericTokens = extractNumericTokens(withoutObra);
  const { segments, leftovers } = buildSegmentsFromNumbers(numericTokens);
  const labeledMetaMeq = extractLabeledMetaMeq(withoutDate);
  const fallbackMetaMeq = leftovers.length ? leftovers[leftovers.length - 1].value : null;

  return {
    date,
    equipment_label: equipmentLabel,
    obra_code: obraCode,
    meta_meq_informado: Number.isFinite(labeledMetaMeq) ? labeledMetaMeq : fallbackMetaMeq,
    segments,
    ocr_warning: "Leitura via Tesseract: revise os campos antes de confirmar.",
  };
}

function parseRowsFromOcrText(text) {
  const rows = splitOcrCandidates(text)
    .map((candidate) => parseOcrCandidate(candidate))
    .filter(Boolean);

  if (rows.length) return rows;

  const fullText = sanitizeOcrText(text);
  const fallbackDate = fullText.match(DATE_REGEX)?.[1] || "";
  return [
    {
      date: fallbackDate,
      equipment_label: extractEquipmentLabel(fullText),
      obra_code: extractObraCode(fullText),
      meta_meq_informado: extractLabeledMetaMeq(fullText),
      segments: buildSegmentsFromNumbers(extractNumericTokens(fullText)).segments,
      ocr_warning: "O OCR nao conseguiu separar as linhas automaticamente. Revise manualmente.",
    },
  ];
}

function parseImageDataUrl(imageDataUrl) {
  const match = String(imageDataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Imagem invalida. Envie um data URL base64.");
  }
  return {
    mimeType: match[1],
    base64Data: match[2],
  };
}

function resolveTesseractCommand() {
  return String(process.env.TESSERACT_PATH || "tesseract").trim() || "tesseract";
}

async function runTesseractOcr({ mimeType, base64Data }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-ocr-"));
  const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  const inputPath = path.join(tempDir, `input.${extension}`);
  const outputBasePath = path.join(tempDir, "output");
  const outputTextPath = `${outputBasePath}.txt`;
  const tesseractCommand = resolveTesseractCommand();
  const tesseractLang = String(process.env.TESSERACT_LANG || "por").trim() || "por";
  const tesseractPsm = String(process.env.TESSERACT_PSM || "6").trim() || "6";

  try {
    await fs.writeFile(inputPath, Buffer.from(base64Data, "base64"));
    await execFileAsync(tesseractCommand, [inputPath, outputBasePath, "-l", tesseractLang, "--psm", tesseractPsm], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return await fs.readFile(outputTextPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Tesseract nao encontrado. Instale o binario ou configure TESSERACT_PATH.");
    }
    throw new Error(`Falha ao executar Tesseract: ${error.message}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function parseGoalImportImage({ imageDataUrl, fileName, machines }) {
  const { mimeType, base64Data } = parseImageDataUrl(imageDataUrl);
  const sourceImageId = crypto.randomUUID();
  const ocrText = await runTesseractOcr({ mimeType, base64Data, fileName });

  if (!ocrText.trim()) {
    throw new Error("Tesseract nao retornou texto utilizavel.");
  }

  const rows = parseRowsFromOcrText(ocrText);

  return {
    import_id: sourceImageId,
    source_file_name: fileName || "",
    rows: normalizeGoalRows(rows, machines, {
      sourceImageId,
      sourceFileName: fileName || "",
    }),
  };
}

module.exports = {
  normalizeGoalRows,
  parseGoalImportImage,
};
