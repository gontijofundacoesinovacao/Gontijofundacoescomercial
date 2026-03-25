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
      diametro_cm: firstDefined(row, [`diametro_${index}`, `diametro_cm_${index}`, "\u00f8_" + index, `o_${index}`]),
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
    ocr_raw_text: String(row?.ocr_raw_text || "").trim(),
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
    .filter((row) => row.date || row.equipment_label || row.segments.length || row.ocr_raw_text);
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

function isHeaderLikeLine(line) {
  const normalized = stripAccents(String(line || "").toUpperCase());
  const tokens = ["DATA", "EQUIPAMENTO", "OBRA", "META", "QUANTIDADE", "ESTACAS", "DIAMETRO", "PROFUNDIDADE", "VALOR"];
  return tokens.filter((token) => normalized.includes(token)).length >= 4 && !DATE_REGEX.test(normalized);
}

function splitOcrCandidates(text) {
  const lines = sanitizeOcrText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isHeaderLikeLine(line));

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

function extractObraParts(text) {
  const normalizedText = String(text || "").trim();
  const explicitMatch = normalizedText.match(/\bOBRA\b[:\s-]*([A-Z0-9./-]{2,})/i);
  if (explicitMatch) {
    return {
      equipmentLabel: normalizedText.slice(0, explicitMatch.index).trim(),
      obraCode: explicitMatch[1].replace(/[|,;]+$/g, ""),
      remainder: normalizedText.slice((explicitMatch.index ?? 0) + explicitMatch[0].length).trim(),
    };
  }

  for (const match of normalizedText.matchAll(/\b([A-Z0-9./-]+)\b/g)) {
    const token = match[1];
    if (token.replace(/\D/g, "").length < 4) continue;

    return {
      equipmentLabel: normalizedText.slice(0, match.index).trim(),
      obraCode: token.replace(/[|,;]+$/g, ""),
      remainder: normalizedText.slice((match.index ?? 0) + token.length).trim(),
    };
  }

  return {
    equipmentLabel: normalizedText,
    obraCode: "",
    remainder: "",
  };
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
  return cleaned
    .split(" ")
    .filter((token) => token && !genericWords.has(stripAccents(token).toUpperCase()))
    .join(" ")
    .trim();
}

function buildSegmentsFromNumbers(tokens) {
  const values = tokens.map((token) => token.value).filter((value) => Number.isFinite(value));
  const segments = [];

  for (let segmentIndex = 0; segmentIndex < 2; segmentIndex += 1) {
    const baseIndex = segmentIndex * 4;
    const metaEstacas = Math.round(values[baseIndex] ?? NaN);
    const diametroCm = normalizePossibleDiameter(values[baseIndex + 1]);
    const profundidadeM = values[baseIndex + 2];
    const valorUnitario = values[baseIndex + 3];

    if (!isValidSegmentValues(metaEstacas, diametroCm, profundidadeM, valorUnitario)) {
      continue;
    }

    segments.push({
      meta_estacas: metaEstacas,
      diametro_cm: diametroCm,
      profundidade_m: Number(profundidadeM.toFixed(2)),
      valor_unitario: Number(valorUnitario.toFixed(2)),
    });
  }

  return {
    segments,
    leftovers: values.slice(segments.length * 4),
  };
}

function parseOcrCandidate(candidate) {
  const rawText = sanitizeOcrText(candidate.lines.join(" "));
  const dateMatch = rawText.match(DATE_REGEX);
  if (!dateMatch) return null;

  const date = dateMatch[1];
  const afterDate = rawText.slice((dateMatch.index ?? 0) + date.length).trim();
  const obraParts = extractObraParts(afterDate);
  const equipmentLabel = extractEquipmentLabel(obraParts.equipmentLabel || afterDate);
  const numericTokens = extractNumericTokens(obraParts.remainder);
  const { segments, leftovers } = buildSegmentsFromNumbers(numericTokens);
  const labeledMetaMeq = extractLabeledMetaMeq(afterDate);
  const fallbackMetaMeq = leftovers.length ? leftovers[leftovers.length - 1] : null;

  return {
    date,
    equipment_label: equipmentLabel,
    obra_code: obraParts.obraCode,
    meta_meq_informado: Number.isFinite(labeledMetaMeq) ? labeledMetaMeq : fallbackMetaMeq,
    segments,
    ocr_raw_text: rawText,
    ocr_warning: "Leitura via Tesseract: revise os campos e, se precisar, edite o texto livre antes de salvar.",
  };
}

function parseRowsFromOcrText(text) {
  const rows = splitOcrCandidates(text)
    .map((candidate) => parseOcrCandidate(candidate))
    .filter(Boolean);

  if (rows.length) return rows;

  const fullText = sanitizeOcrText(text);
  const fallbackDate = fullText.match(DATE_REGEX)?.[1] || "";
  const obraParts = extractObraParts(fullText);

  return [
    {
      date: fallbackDate,
      equipment_label: extractEquipmentLabel(obraParts.equipmentLabel || fullText),
      obra_code: obraParts.obraCode,
      meta_meq_informado: extractLabeledMetaMeq(fullText),
      segments: buildSegmentsFromNumbers(extractNumericTokens(obraParts.remainder || fullText)).segments,
      ocr_raw_text: fullText,
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
  const tesseractCommand = resolveTesseractCommand();
  const tesseractLang = String(process.env.TESSERACT_LANG || "por").trim() || "por";
  const psmList = String(process.env.TESSERACT_PSM_LIST || `${process.env.TESSERACT_PSM || "6"},11`)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const results = [];

  try {
    await fs.writeFile(inputPath, Buffer.from(base64Data, "base64"));

    for (const psm of [...new Set(psmList)]) {
      const outputBasePath = path.join(tempDir, `output-${psm}`);
      const outputTextPath = `${outputBasePath}.txt`;
      await execFileAsync(
        tesseractCommand,
        [inputPath, outputBasePath, "-l", tesseractLang, "--psm", psm, "-c", "preserve_interword_spaces=1"],
        {
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        }
      );
      const text = await fs.readFile(outputTextPath, "utf8");
      if (text.trim()) {
        results.push({ psm, text });
      }
    }

    return results;
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Tesseract nao encontrado. Instale o binario ou configure TESSERACT_PATH.");
    }
    throw new Error(`Falha ao executar Tesseract: ${error.message}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function parseGoalImportText({ rawText, machines, sourceImageId, sourceFileName }) {
  const rows = parseRowsFromOcrText(rawText);
  return normalizeGoalRows(rows, machines, {
    sourceImageId,
    sourceFileName,
  });
}

async function parseGoalImportImage({ imageDataUrl, fileName, machines }) {
  const { mimeType, base64Data } = parseImageDataUrl(imageDataUrl);
  const sourceImageId = crypto.randomUUID();
  const ocrPasses = await runTesseractOcr({ mimeType, base64Data });

  if (!ocrPasses.length) {
    throw new Error("Tesseract nao retornou texto utilizavel.");
  }

  const mergedRows = [];
  const seen = new Set();

  for (const pass of ocrPasses) {
    for (const row of parseRowsFromOcrText(pass.text)) {
      const dedupeKey = [row.date, row.equipment_label, row.obra_code, row.ocr_raw_text].join("|");
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      mergedRows.push(row);
    }
  }

  const normalizedRows = normalizeGoalRows(mergedRows, machines, {
    sourceImageId,
    sourceFileName: fileName || "",
  });

  return {
    import_id: sourceImageId,
    source_file_name: fileName || "",
    ocr_raw_text: sanitizeOcrText(ocrPasses.map((item) => item.text).join("\n\n")),
    rows: normalizedRows,
  };
}

module.exports = {
  normalizeGoalRows,
  parseGoalImportImage,
  parseGoalImportText,
};
