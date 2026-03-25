import { api } from './api.js';

const MEQ_FACTORS = new Map([
  [25, 0.5],
  [30, 0.6],
  [40, 0.8],
  [50, 1],
  [60, 1.2],
  [70, 1.4],
  [80, 1.6],
  [90, 1.8],
  [100, 2],
  [110, 2.2],
  [120, 2.4],
]);

const MEQ_FACTOR_POINTS = [...MEQ_FACTORS.entries()].sort((a, b) => a[0] - b[0]);

function feedback(message, tone = 'neutral') {
  const node = document.getElementById('mappingFeedback');
  node.textContent = message;
  node.className = 'inline-feedback';
  node.style.color = tone === 'error' ? '#b9141a' : tone === 'success' ? '#0f8b4c' : '';
}

function loginFeedback(message, tone = 'neutral') {
  const node = document.getElementById('adminLoginFeedback');
  node.textContent = message;
  node.className = 'inline-feedback';
  node.style.color = tone === 'error' ? '#b9141a' : tone === 'success' ? '#0f8b4c' : '';
}

function importFeedback(message, tone = 'neutral') {
  const node = document.getElementById('goalImportFeedback');
  node.textContent = message;
  node.className = 'inline-feedback';
  node.style.color = tone === 'error' ? '#b9141a' : tone === 'success' ? '#0f8b4c' : '';
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function parseNumber(value) {
  if (value == null || value === '') return null;
  const normalized = String(value)
    .replace(/R\$\s*/gi, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')
    .trim();
  if (!normalized) return null;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function parseInteger(value) {
  const result = parseNumber(value);
  return Number.isFinite(result) ? Math.round(result) : null;
}

function normalizeMachineToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function getMeqFactor(diameterCm) {
  if (!Number.isFinite(diameterCm)) return null;
  const roundedDiameter = Math.round(diameterCm * 1000) / 1000;
  const exact = MEQ_FACTORS.get(roundedDiameter) ?? MEQ_FACTORS.get(Math.round(roundedDiameter));
  if (Number.isFinite(exact)) return exact;
  const minDiameter = MEQ_FACTOR_POINTS[0]?.[0];
  const maxDiameter = MEQ_FACTOR_POINTS[MEQ_FACTOR_POINTS.length - 1]?.[0];
  if (!Number.isFinite(minDiameter) || !Number.isFinite(maxDiameter)) return null;
  if (roundedDiameter < minDiameter || roundedDiameter > maxDiameter) return null;

  for (let index = 0; index < MEQ_FACTOR_POINTS.length - 1; index += 1) {
    const [startDiameter, startFactor] = MEQ_FACTOR_POINTS[index];
    const [endDiameter, endFactor] = MEQ_FACTOR_POINTS[index + 1];
    if (roundedDiameter < startDiameter || roundedDiameter > endDiameter) continue;
    const ratio = (roundedDiameter - startDiameter) / (endDiameter - startDiameter);
    return Number((startFactor + (endFactor - startFactor) * ratio).toFixed(4));
  }

  return null;
}

function calculateSegment(segment, index) {
  const metaEstacas = parseInteger(segment.meta_estacas) ?? 0;
  const diametroCm = parseNumber(segment.diametro_cm);
  const profundidadeM = parseNumber(segment.profundidade_m);
  const valorUnitario = parseNumber(segment.valor_unitario);
  const factor = getMeqFactor(diametroCm);
  const metaMeqSegmento =
    Number.isFinite(metaEstacas) && Number.isFinite(profundidadeM) && Number.isFinite(factor)
      ? Number((metaEstacas * profundidadeM * factor).toFixed(2))
      : null;
  const filledCount = [metaEstacas || null, diametroCm, profundidadeM, valorUnitario].filter((value) => value != null).length;
  return {
    segment_index: index + 1,
    meta_estacas: metaEstacas,
    diametro_cm: diametroCm,
    profundidade_m: profundidadeM,
    valor_unitario: valorUnitario,
    meq_factor: factor,
    meta_meq_segmento: metaMeqSegmento,
    incomplete: filledCount > 0 && filledCount < 4,
  };
}

function machineOption(item) {
  const selected = item.active_mapping;
  return `<option value="${item.imei}" data-machine-name="${selected?.machine_name || item.machine_name}">
    ${selected?.machine_name || item.machine_name} | ${item.imei}
  </option>`;
}

function mappingRow(item) {
  const status = item.active ? 'Ativo' : 'Historico';
  return `
    <tr>
      <td>
        <strong>${item.machine_name}</strong><br />
        <small>${item.updated_at ? new Date(item.updated_at).toLocaleString('pt-BR') : '-'}</small>
      </td>
      <td>${item.imei}</td>
      <td>
        <strong>${item.obra_name || '-'}</strong><br />
        <small>${item.obra_code || '-'}</small>
      </td>
      <td>${item.daily_goal_estacas}</td>
      <td>${item.weekly_goal_estacas}</td>
      <td><span class="status-tag ${item.active ? 'green' : 'neutral'}">${status}</span></td>
      <td>
        <div class="table-actions">
          <button class="mini-button" type="button" data-action="edit" data-id="${item.id}">Editar</button>
          ${item.active ? '' : `<button class="mini-button" type="button" data-action="activate" data-id="${item.id}">Ativar</button>`}
          ${item.active ? `<button class="mini-button" type="button" data-action="archive" data-id="${item.id}">Encerrar</button>` : ''}
        </div>
      </td>
    </tr>
  `;
}

function goalTargetRow(item) {
  return `
    <tr>
      <td>${item.date ? new Date(`${item.date}T00:00:00`).toLocaleDateString('pt-BR') : '-'}</td>
      <td>
        <strong>${item.machine_name || item.equipment_label || '-'}</strong><br />
        <small>${item.imei || 'Sem IMEI'}</small>
      </td>
      <td>${item.obra_code || '-'}</td>
      <td>${item.meta_estacas_total ?? 0}</td>
      <td>${formatNumber(item.meta_meq_total || 0, 2)}</td>
      <td>${item.source_file_name || '-'}</td>
      <td><span class="status-tag ${item.status === 'confirmed' ? 'green' : 'neutral'}">${item.status || 'confirmed'}</span></td>
    </tr>
  `;
}

function warningChip(text, tone) {
  return `<span class="goal-warning-chip ${tone}">${text}</span>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fillForm(item) {
  document.getElementById('mappingIdInput').value = item?.id || '';
  document.getElementById('mappingImeiInput').value = item?.imei || '';
  document.getElementById('mappingMachineNameInput').value = item?.machine_name || '';
  document.getElementById('mappingObraCodeInput').value = item?.obra_code || '';
  document.getElementById('mappingObraNameInput').value = item?.obra_name || '';
  document.getElementById('mappingDailyGoalInput').value = item?.daily_goal_estacas ?? 0;
  document.getElementById('mappingWeeklyGoalInput').value = item?.weekly_goal_estacas ?? 0;
  document.getElementById('mappingActiveInput').checked = item?.active ?? true;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
    reader.readAsDataURL(file);
  });
}

function createEmptySegment() {
  return {
    meta_estacas: 0,
    diametro_cm: '',
    profundidade_m: '',
    valor_unitario: '',
  };
}

export async function initAdminModule() {
  const loginCard = document.getElementById('adminLoginCard');
  const panel = document.getElementById('adminPanel');
  const modeLabel = document.getElementById('adminModeLabel');
  const includeInactiveInput = document.getElementById('includeInactiveInput');
  const mappingTableBody = document.getElementById('mappingTableBody');
  const machineSelect = document.getElementById('machineSelect');
  const goalTargetsTableBody = document.getElementById('goalTargetsTableBody');
  const goalImportReview = document.getElementById('goalImportReview');
  const goalImportTableBody = document.getElementById('goalImportTableBody');
  const goalImportSummary = document.getElementById('goalImportSummary');
  const goalImportFileInput = document.getElementById('goalImportFileInput');
  const goalImportParseButton = document.getElementById('goalImportParseButton');
  const goalImportSaveButton = document.getElementById('goalImportSaveButton');

  let currentMappings = [];
  let currentMachines = [];
  let currentImport = null;

  function matchMachine(equipmentLabel) {
    const token = normalizeMachineToken(equipmentLabel);
    if (!token) return null;
    const candidates = currentMachines.map((item) => ({
      imei: item.imei,
      machine_name: item.active_mapping?.machine_name || item.machine_name,
      token: normalizeMachineToken(item.active_mapping?.machine_name || item.machine_name),
    }));
    const exact = candidates.find((item) => item.token === token);
    if (exact) return exact;
    const loose = candidates.find((item) => token.includes(item.token) || item.token.includes(token));
    return loose || null;
  }

  function recomputeRow(row) {
    const warnings = [];
    const errors = [];
    const machineMatch = row.imei
      ? { imei: row.imei, machine_name: row.machine_name || row.equipment_label, confidence: 'manual' }
      : matchMachine(row.equipment_label);

    if (!row.date) errors.push('Data invalida ou ausente.');
    if (!row.equipment_label) errors.push('Equipamento ausente.');
    if (!row.obra_code) warnings.push('Numero da obra ausente.');
    if (!machineMatch) warnings.push('Equipamento nao reconhecido automaticamente.');

    const segments = (row.segments || [])
      .map((segment, index) => calculateSegment(segment, index))
      .filter((segment) => [segment.meta_estacas, segment.diametro_cm, segment.profundidade_m, segment.valor_unitario].some((value) => value != null && value !== '' && value !== 0));

    if (!segments.length) errors.push('Nenhuma faixa valida encontrada.');

    segments.forEach((segment) => {
      if (segment.incomplete) errors.push(`Faixa ${segment.segment_index} incompleta.`);
      if (!Number.isFinite(segment.meq_factor)) errors.push(`Faixa ${segment.segment_index} sem fator MEQ valido.`);
    });

    const metaEstacasTotal = segments.reduce((sum, segment) => sum + (segment.meta_estacas || 0), 0);
    const metaMeqTotal = Number(segments.reduce((sum, segment) => sum + (segment.meta_meq_segmento || 0), 0).toFixed(2));
    const informedMeq = parseNumber(row.meta_meq_informado);
    if (Number.isFinite(informedMeq) && Math.abs(informedMeq - metaMeqTotal) > 0.05) {
      warnings.push(`Meta MEQ informada (${formatNumber(informedMeq, 2)}) difere da recalculada (${formatNumber(metaMeqTotal, 2)}).`);
    }

    return {
      ...row,
      machine_match: machineMatch,
      machine_name: machineMatch?.machine_name || row.machine_name || row.equipment_label,
      imei: machineMatch?.imei || row.imei || '',
      meta_estacas_total: metaEstacasTotal,
      meta_meq_total: metaMeqTotal,
      meta_meq_informado: informedMeq,
      warnings,
      errors,
      segments,
    };
  }

  function renderGoalImportRows() {
    if (!currentImport?.rows?.length) {
      goalImportTableBody.innerHTML = '';
      goalImportReview.classList.add('is-hidden');
      goalImportSaveButton.disabled = true;
      goalImportSummary.textContent = 'Nenhuma linha lida.';
      return;
    }

    currentImport.rows = currentImport.rows.map((row) => recomputeRow(row));
    const invalidCount = currentImport.rows.filter((row) => row.errors.length).length;
    goalImportSummary.textContent = `${currentImport.rows.length} linha(s) no lote | ${invalidCount} com erro`;
    goalImportSaveButton.disabled = currentImport.rows.every((row) => row.errors.length);

    goalImportTableBody.innerHTML = currentImport.rows
      .map((row, rowIndex) => {
        const machineOptions = [
          `<option value="">Nao reconhecida</option>`,
          ...currentMachines.map((item) => {
            const name = item.active_mapping?.machine_name || item.machine_name;
            const selected = String(item.imei) === String(row.imei) ? 'selected' : '';
            return `<option value="${item.imei}" data-machine-name="${name}" ${selected}>${name} | ${item.imei}</option>`;
          }),
        ].join('');

        const segmentsHtml = `
          <div class="goal-segments">
            ${row.segments
              .map(
                (segment, segmentIndex) => `
                  <article class="goal-segment-card">
                    <div class="goal-segment-card__head">
                      <strong>Faixa ${segment.segment_index}</strong>
                      <button class="mini-button" type="button" data-row-index="${rowIndex}" data-segment-index="${segmentIndex}" data-action="remove-segment">Remover</button>
                    </div>
                    <div class="goal-segment-card__grid">
                      <label>
                        Meta estacas
                        <input data-row-index="${rowIndex}" data-segment-index="${segmentIndex}" data-field="meta_estacas" type="number" min="0" value="${segment.meta_estacas ?? 0}" />
                      </label>
                      <label>
                        Diametro (cm)
                        <input data-row-index="${rowIndex}" data-segment-index="${segmentIndex}" data-field="diametro_cm" type="number" step="0.01" min="0" value="${segment.diametro_cm ?? ''}" />
                      </label>
                      <label>
                        Profundidade (m)
                        <input data-row-index="${rowIndex}" data-segment-index="${segmentIndex}" data-field="profundidade_m" type="number" step="0.01" min="0" value="${segment.profundidade_m ?? ''}" />
                      </label>
                      <label>
                        Valor unitario
                        <input data-row-index="${rowIndex}" data-segment-index="${segmentIndex}" data-field="valor_unitario" type="number" step="0.01" min="0" value="${segment.valor_unitario ?? ''}" />
                      </label>
                    </div>
                    <small>Fator MEQ: ${segment.meq_factor == null ? '-' : formatNumber(segment.meq_factor, 4)} | MEQ faixa: ${segment.meta_meq_segmento == null ? '-' : formatNumber(segment.meta_meq_segmento, 2)}</small>
                  </article>
                `
              )
              .join('')}
            <button class="mini-button" type="button" data-row-index="${rowIndex}" data-action="add-segment">Adicionar faixa</button>
          </div>
        `;

        const warningsHtml = [
          ...row.warnings.map((item) => warningChip(item, 'warning')),
          ...row.errors.map((item) => warningChip(item, 'error')),
        ].join('');

        const rawTextHtml = `
          <div class="goal-ocr-box">
            <label class="goal-ocr-box__label">
              Texto livre do OCR
              <textarea class="goal-ocr-box__textarea" data-row-index="${rowIndex}" data-row-field="ocr_raw_text" rows="7">${escapeHtml(row.ocr_raw_text || '')}</textarea>
            </label>
            <div class="table-actions">
              <button class="mini-button" type="button" data-row-index="${rowIndex}" data-action="apply-ocr-text">Aplicar texto</button>
            </div>
          </div>
        `;

        return `
          <tr>
            <td><input data-row-index="${rowIndex}" data-row-field="date" type="date" value="${row.date || ''}" /></td>
            <td><input data-row-index="${rowIndex}" data-row-field="equipment_label" type="text" value="${row.equipment_label || ''}" /></td>
            <td>
              <select data-row-index="${rowIndex}" data-row-field="imei">
                ${machineOptions}
              </select>
            </td>
            <td><input data-row-index="${rowIndex}" data-row-field="obra_code" type="text" value="${row.obra_code || ''}" /></td>
            <td class="goal-meta-cell"><strong>${row.meta_estacas_total || 0}</strong></td>
            <td class="goal-meta-cell">
              <strong>${formatNumber(row.meta_meq_total || 0, 2)}</strong><br />
              <small>Planilha: ${row.meta_meq_informado == null ? '-' : formatNumber(row.meta_meq_informado, 2)}</small>
            </td>
            <td>${segmentsHtml}</td>
            <td>${rawTextHtml}</td>
            <td><div class="goal-warnings">${warningsHtml || '<span class="goal-warning-chip warning">Sem alertas.</span>'}</div></td>
            <td>
              <div class="table-actions">
                <button class="mini-button" type="button" data-row-index="${rowIndex}" data-action="remove-row">Remover linha</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    goalImportReview.classList.remove('is-hidden');
  }

  async function refreshAdmin() {
    const status = await api.getAdminStatus();
    modeLabel.textContent = status.mode === 'supabase' ? 'Supabase' : 'Modo local';
    if (!status.authenticated) {
      loginCard.classList.remove('is-hidden');
      panel.classList.add('is-hidden');
      return;
    }

    loginCard.classList.add('is-hidden');
    panel.classList.remove('is-hidden');

    const [machinesResponse, mappingsResponse, goalsResponse] = await Promise.all([
      api.getAdminMachines(),
      api.getAdminMappings(includeInactiveInput.checked),
      api.getGoalTargets(120),
    ]);

    currentMachines = machinesResponse.items;
    currentMappings = mappingsResponse.items;
    machineSelect.innerHTML = currentMachines.map(machineOption).join('');
    mappingTableBody.innerHTML = currentMappings.length
      ? currentMappings.map(mappingRow).join('')
      : '<tr><td colspan="7">Nenhum vinculo cadastrado.</td></tr>';
    goalTargetsTableBody.innerHTML = goalsResponse.items.length
      ? goalsResponse.items.map(goalTargetRow).join('')
      : '<tr><td colspan="7">Nenhuma meta confirmada.</td></tr>';
    fillForm(null);
    renderGoalImportRows();
    feedback('Area admin carregada.', 'success');
  }

  document.getElementById('adminLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api.loginAdmin(document.getElementById('adminPasswordInput').value);
      loginFeedback('Autenticacao realizada com sucesso.', 'success');
      await refreshAdmin();
    } catch (error) {
      loginFeedback(error.message, 'error');
    }
  });

  document.getElementById('adminLogoutButton').addEventListener('click', async () => {
    await api.logoutAdmin();
    loginFeedback('Sessao encerrada.');
    await refreshAdmin();
  });

  includeInactiveInput.addEventListener('change', refreshAdmin);

  machineSelect.addEventListener('change', () => {
    const option = machineSelect.selectedOptions[0];
    document.getElementById('mappingImeiInput').value = machineSelect.value;
    document.getElementById('mappingMachineNameInput').value = option?.dataset.machineName || '';
  });

  document.getElementById('mappingResetButton').addEventListener('click', () => {
    fillForm(null);
    feedback('Formulario limpo.');
  });

  document.getElementById('mappingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = document.getElementById('mappingIdInput').value;
    const payload = {
      imei: document.getElementById('mappingImeiInput').value,
      machine_name: document.getElementById('mappingMachineNameInput').value,
      obra_code: document.getElementById('mappingObraCodeInput').value,
      obra_name: document.getElementById('mappingObraNameInput').value,
      daily_goal_estacas: Number(document.getElementById('mappingDailyGoalInput').value || 0),
      weekly_goal_estacas: Number(document.getElementById('mappingWeeklyGoalInput').value || 0),
      active: document.getElementById('mappingActiveInput').checked,
    };

    try {
      if (id) {
        await api.updateMapping(id, payload);
        feedback('Vinculo atualizado.', 'success');
      } else {
        await api.createMapping(payload);
        feedback('Vinculo criado.', 'success');
      }
      await refreshAdmin();
    } catch (error) {
      feedback(error.message, 'error');
    }
  });

  mappingTableBody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.dataset.id;
    const item = currentMappings.find((mapping) => String(mapping.id) === String(id));
    if (!item) return;

    try {
      if (button.dataset.action === 'edit') {
        fillForm(item);
        feedback(`Editando ${item.machine_name}.`);
      }
      if (button.dataset.action === 'activate') {
        await api.activateMapping(id);
        await refreshAdmin();
        feedback('Vinculo ativado.', 'success');
      }
      if (button.dataset.action === 'archive') {
        await api.archiveMapping(id);
        await refreshAdmin();
        feedback('Vinculo encerrado.', 'success');
      }
    } catch (error) {
      feedback(error.message, 'error');
    }
  });

  document.getElementById('goalImportForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = goalImportFileInput.files?.[0];
    if (!file) {
      importFeedback('Selecione uma imagem antes de enviar.', 'error');
      return;
    }

    goalImportParseButton.disabled = true;
    importFeedback('Enviando imagem para leitura...', 'neutral');

    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      const response = await api.parseGoalImage({
        fileName: file.name,
        imageDataUrl,
      });
      currentImport = response.item;
      renderGoalImportRows();
      importFeedback(`Imagem lida. ${currentImport.rows.length} linha(s) carregada(s) para revisao.`, 'success');
    } catch (error) {
      importFeedback(error.message, 'error');
    } finally {
      goalImportParseButton.disabled = false;
    }
  });

  document.getElementById('goalImportResetButton').addEventListener('click', () => {
    currentImport = null;
    goalImportFileInput.value = '';
    renderGoalImportRows();
    importFeedback('Importacao limpa.');
  });

  goalImportTableBody.addEventListener('input', (event) => {
    const target = event.target;
    const rowIndex = Number(target.dataset.rowIndex);
    if (!Number.isFinite(rowIndex) || !currentImport?.rows?.[rowIndex]) return;

    if (target.dataset.rowField) {
      currentImport.rows[rowIndex][target.dataset.rowField] = target.value;
    }

    if (target.dataset.field) {
      const segmentIndex = Number(target.dataset.segmentIndex);
      currentImport.rows[rowIndex].segments[segmentIndex][target.dataset.field] = target.value;
    }

    renderGoalImportRows();
  });

  goalImportTableBody.addEventListener('change', (event) => {
    const target = event.target;
    const rowIndex = Number(target.dataset.rowIndex);
    if (!Number.isFinite(rowIndex) || !currentImport?.rows?.[rowIndex]) return;

    if (target.dataset.rowField === 'imei') {
      const selected = currentMachines.find((item) => String(item.imei) === String(target.value));
      currentImport.rows[rowIndex].imei = target.value;
      currentImport.rows[rowIndex].machine_name = selected
        ? selected.active_mapping?.machine_name || selected.machine_name
        : currentImport.rows[rowIndex].equipment_label;
    }

    renderGoalImportRows();
  });

  goalImportTableBody.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const rowIndex = Number(button.dataset.rowIndex);
    if (!Number.isFinite(rowIndex) || !currentImport?.rows?.[rowIndex]) return;

    if (button.dataset.action === 'add-segment') {
      currentImport.rows[rowIndex].segments.push(createEmptySegment());
    }

    if (button.dataset.action === 'apply-ocr-text') {
      importFeedback('Reinterpretando texto OCR...', 'neutral');
      api
        .parseGoalTextRow({
          rawText: currentImport.rows[rowIndex].ocr_raw_text || '',
          importId: currentImport.import_id,
          fileName: currentImport.source_file_name,
        })
        .then((response) => {
          if (response.item) {
            currentImport.rows[rowIndex] = {
              ...response.item,
              id: currentImport.rows[rowIndex].id || response.item.id,
            };
            renderGoalImportRows();
            importFeedback('Texto OCR reaplicado na linha.', 'success');
          } else {
            importFeedback('Nenhuma linha foi reconhecida a partir do texto informado.', 'error');
          }
        })
        .catch((error) => {
          importFeedback(error.message, 'error');
        });
      return;
    }

    if (button.dataset.action === 'remove-segment') {
      const segmentIndex = Number(button.dataset.segmentIndex);
      currentImport.rows[rowIndex].segments.splice(segmentIndex, 1);
      if (!currentImport.rows[rowIndex].segments.length) {
        currentImport.rows[rowIndex].segments.push(createEmptySegment());
      }
    }

    if (button.dataset.action === 'remove-row') {
      currentImport.rows.splice(rowIndex, 1);
    }

    renderGoalImportRows();
  });

  goalImportSaveButton.addEventListener('click', async () => {
    if (!currentImport?.rows?.length) {
      importFeedback('Nao ha linhas para salvar.', 'error');
      return;
    }

    currentImport.rows = currentImport.rows.map((row) => recomputeRow(row));
    renderGoalImportRows();

    const validRows = currentImport.rows.filter((row) => !row.errors.length);
    if (!validRows.length) {
      importFeedback('Nenhuma linha valida para confirmar.', 'error');
      return;
    }

    goalImportSaveButton.disabled = true;
    importFeedback('Salvando metas confirmadas...', 'neutral');

    try {
      const response = await api.confirmGoalImport({
        importId: currentImport.import_id,
        fileName: currentImport.source_file_name,
        rows: currentImport.rows,
      });
      currentImport.rows = response.rejectedRows || [];
      renderGoalImportRows();
      await refreshAdmin();
      importFeedback(
        `Metas salvas: ${response.savedCount}. Rejeitadas: ${response.rejectedCount}.`,
        response.rejectedCount ? 'error' : 'success'
      );
    } catch (error) {
      importFeedback(error.message, 'error');
    } finally {
      goalImportSaveButton.disabled = false;
    }
  });

  await refreshAdmin();
  return { refreshAdmin };
}
