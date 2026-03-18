const healthButton = document.getElementById("healthButton");
const pdfButton = document.getElementById("pdfButton");
const weeklyButton = document.getElementById("weeklyButton");
const weeklyCsvButton = document.getElementById("weeklyCsvButton");
const dailyTabButton = document.getElementById("dailyTabButton");
const dashboardTabButton = document.getElementById("dashboardTabButton");
const subtabOverviewButton = document.getElementById("subtabOverviewButton");
const subtabMachinesButton = document.getElementById("subtabMachinesButton");
const subtabQualityButton = document.getElementById("subtabQualityButton");
const subtabTimelineButton = document.getElementById("subtabTimelineButton");
const dailyTab = document.getElementById("dailyTab");
const dashboardTab = document.getElementById("dashboardTab");
const healthStatus = document.getElementById("healthStatus");
const searchForm = document.getElementById("searchForm");
const resultBox = document.getElementById("resultBox");
const resultMeta = document.getElementById("resultMeta");
const querySummary = document.getElementById("querySummary");
const resultHint = document.getElementById("resultHint");
const tableWrap = document.getElementById("tableWrap");
const resultsTableBody = document.getElementById("resultsTableBody");
const detailSection = document.getElementById("detailSection");
const detailMeta = document.getElementById("detailMeta");
const detailHeader = document.getElementById("detailHeader");
const detailHint = document.getElementById("detailHint");
const detailSlicesBody = document.getElementById("detailSlicesBody");
const dashboardSection = document.getElementById("dashboardSection");
const dashboardOverviewSection = document.getElementById("dashboardOverviewSection");
const dashboardQualitySection = document.getElementById("dashboardQualitySection");
const dashboardTimelineSection = document.getElementById("dashboardTimelineSection");
const dashboardOverviewMeta = document.getElementById("dashboardOverviewMeta");
const dashboardMeta = document.getElementById("dashboardMeta");
const dashboardHint = document.getElementById("dashboardHint");
const dashboardGrid = document.getElementById("dashboardGrid");
const dashboardSelectionMeta = document.getElementById("dashboardSelectionMeta");
const dashboardStats = document.getElementById("dashboardStats");
const rankingTableBody = document.getElementById("rankingTableBody");
const weeklyOverviewChartCanvas = document.getElementById("weeklyOverviewChart");
const cumulativeChartCanvas = document.getElementById("cumulativeChart");
const obraChartCanvas = document.getElementById("obraChart");
const alertsList = document.getElementById("alertsList");
const contractTableBody = document.getElementById("contractTableBody");
const contractTableBodyDetailed = document.getElementById("contractTableBodyDetailed");
const heatmapGrid = document.getElementById("heatmapGrid");
const boxplotList = document.getElementById("boxplotList");
const timelineList = document.getElementById("timelineList");
const timelineListDetailed = document.getElementById("timelineListDetailed");
const concreteTableBody = document.getElementById("concreteTableBody");
const qualityList = document.getElementById("qualityList");
const qualityMeta = document.getElementById("qualityMeta");
const timelineMeta = document.getElementById("timelineMeta");
const dashboardMachineFilter = document.getElementById("dashboardMachineFilter");
const machineSelect = document.getElementById("machineSelect");
const machinesEditor = document.getElementById("machinesEditor");
const saveMachinesButton = document.getElementById("saveMachinesButton");
const resetMachinesButton = document.getElementById("resetMachinesButton");
const machineStatus = document.getElementById("machineStatus");
const clientLoginInput = document.getElementById("clientLogin");
const imeiInput = document.getElementById("imei");
const dateInput = document.getElementById("date");
const weekInput = document.getElementById("weekInput");
const obraFilterInput = document.getElementById("obraFilterInput");
const contratoFilterInput = document.getElementById("contratoFilterInput");

const DEFAULT_MACHINES = [
  { name: "HTC-03", imei: "356308047707200" },
  { name: "HTM-01", imei: "353719099360685" },
  { name: "HTM-02", imei: "352353087311780" },
  { name: "HTM-03", imei: "352353087304165" },
  { name: "HTM-04", imei: "352353087311855" },
  { name: "HTM-05", imei: "352353087290521" },
  { name: "CA-02", imei: "358278000324905" },
  { name: "CA-03", imei: "352622021019539" },
  { name: "CA-07", imei: "352622021013953" },
  { name: "CA-04(s)", imei: "352622021150631" },
  { name: "CA-05(s)", imei: "352622021181404" },
  { name: "CA-06(s)", imei: "352622021175398" },
  { name: "CA-09(s)", imei: "352622021184705" },
  { name: "MAIT-01", imei: "352622021182170" },
  { name: "HTM-06", imei: "352353087320450" },
  { name: "EM400-01", imei: "353719099340026" },
  { name: "CA-08", imei: "352622021177063" },
  { name: "MAIT-02", imei: "356078119138507" },
  { name: "MAIT-03", imei: "356078119129365" },
];

const MACHINES_STORAGE_KEY = "geodigitus_machines_v1";

clientLoginInput.value = "cgontijo";
dateInput.value = "2026-03-17";
imeiInput.value = "352622021150631";

function setResult(data) {
  resultBox.textContent = JSON.stringify(data, null, 2);
}

const dashboardCharts = [];
let weeklyOverviewChart = null;
let cumulativeChart = null;
let obraChart = null;
let lastDashboardData = null;

function serializeMachines(machines) {
  return machines.map((item) => `${item.name}=${item.imei}`).join("\n");
}

function parseMachines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, imei] = line.split("=");
      return { name: (name || "").trim(), imei: (imei || "").trim() };
    })
    .filter((item) => item.name && /^\d{15}$/.test(item.imei));
}

function loadMachines() {
  try {
    const raw = localStorage.getItem(MACHINES_STORAGE_KEY);
    if (!raw) return DEFAULT_MACHINES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_MACHINES;
    return parsed.filter((item) => item?.name && /^\d{15}$/.test(item?.imei));
  } catch {
    return DEFAULT_MACHINES;
  }
}

function saveMachines(machines) {
  localStorage.setItem(MACHINES_STORAGE_KEY, JSON.stringify(machines));
}

function renderMachineOptions(machines) {
  machineSelect.innerHTML = machines
    .map(
      (item) =>
        `<option value="${escapeHtml(item.imei)}">${escapeHtml(item.name)} | ${escapeHtml(item.imei)}</option>`
    )
    .join("");
}

function renderDashboardMachineFilter(machines) {
  dashboardMachineFilter.innerHTML = machines
    .map(
      (item) => `
        <label class="machine-check">
          <input type="checkbox" class="dashboard-machine-checkbox" value="${escapeHtml(item.imei)}" checked />
          <span>${escapeHtml(item.name)}</span>
          <small>${escapeHtml(item.imei)}</small>
        </label>
      `
    )
    .join("");
  dashboardSelectionMeta.textContent = `${machines.length} maquina(s) selecionada(s).`;
}

function selectedDashboardMachines() {
  const machines = loadMachines();
  const selectedImeis = [...document.querySelectorAll(".dashboard-machine-checkbox:checked")].map((input) => input.value);
  return machines.filter((item) => selectedImeis.includes(item.imei));
}

function syncSelectedMachineFromImei(machines) {
  const match = machines.find((item) => item.imei === imeiInput.value.trim());
  if (match) {
    machineSelect.value = match.imei;
  }
}

function refreshMachinesUi(machines, preserveImei = true) {
  const currentImei = imeiInput.value.trim();
  machinesEditor.value = serializeMachines(machines);
  renderMachineOptions(machines);

  if (preserveImei && machines.some((item) => item.imei === currentImei)) {
    machineSelect.value = currentImei;
  } else if (machines[0]) {
    machineSelect.value = machines[0].imei;
    imeiInput.value = machines[0].imei;
  }
}

function getWeekValueFromDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day + 3);
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  const weekNumber = 1 + Math.round((date - firstThursday) / 604800000);
  return `${date.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function getWeekStartFromWeekInput(value) {
  const match = String(value || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match) return "";
  const [, yearText, weekText] = match;
  const year = Number(yearText);
  const week = Number(weekText);
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const day = simple.getUTCDay() || 7;
  if (day <= 4) {
    simple.setUTCDate(simple.getUTCDate() - day + 1);
  } else {
    simple.setUTCDate(simple.getUTCDate() + 8 - day);
  }
  return simple.toISOString().slice(0, 10);
}

function destroyDashboardCharts() {
  while (dashboardCharts.length) {
    const chart = dashboardCharts.pop();
    chart.destroy();
  }
}

function destroyOverviewChart() {
  if (weeklyOverviewChart) {
    weeklyOverviewChart.destroy();
    weeklyOverviewChart = null;
  }
}

function destroyAuxCharts() {
  if (cumulativeChart) {
    cumulativeChart.destroy();
    cumulativeChart = null;
  }
  if (obraChart) {
    obraChart.destroy();
    obraChart = null;
  }
}

function switchTab(mode) {
  const isDaily = mode === "daily";
  dailyTab.classList.toggle("is-active", isDaily);
  dashboardTab.classList.toggle("is-active", !isDaily);
  dailyTabButton.classList.toggle("is-active", isDaily);
  dashboardTabButton.classList.toggle("is-active", !isDaily);
}

function switchDashboardSubtab(mode) {
  const config = [
    { key: "overview", button: subtabOverviewButton, panel: dashboardOverviewSection },
    { key: "machines", button: subtabMachinesButton, panel: dashboardSection },
    { key: "quality", button: subtabQualityButton, panel: dashboardQualitySection },
    { key: "timeline", button: subtabTimelineButton, panel: dashboardTimelineSection },
  ];

  config.forEach((item) => {
    const isActive = item.key === mode;
    item.button?.classList.toggle("is-active", isActive);
    item.panel?.classList.toggle("is-active", isActive);
    item.panel?.classList.toggle("is-hidden", !isActive);
  });
}

function resetDashboard() {
  destroyDashboardCharts();
  destroyOverviewChart();
  destroyAuxCharts();
  dashboardGrid.innerHTML = "";
  dashboardStats.innerHTML = "";
  rankingTableBody.innerHTML = "";
  contractTableBody.innerHTML = "";
  contractTableBodyDetailed.innerHTML = "";
  alertsList.innerHTML = "";
  heatmapGrid.innerHTML = "";
  boxplotList.innerHTML = "";
  timelineList.innerHTML = "";
  timelineListDetailed.innerHTML = "";
  concreteTableBody.innerHTML = "";
  qualityList.innerHTML = "";
  dashboardSection.classList.add("is-hidden");
  dashboardOverviewSection.classList.add("is-hidden");
  dashboardQualitySection.classList.add("is-hidden");
  dashboardTimelineSection.classList.add("is-hidden");
  dashboardOverviewMeta.textContent = "Nenhum resumo gerado.";
  dashboardMeta.textContent = "Nenhum dashboard gerado.";
  dashboardHint.textContent = "Selecione uma semana e clique em buscar.";
  qualityMeta.textContent = "Nenhuma analise gerada.";
  timelineMeta.textContent = "Nenhuma timeline gerada.";
  switchDashboardSubtab("overview");
}

function buildDelta(current, previous) {
  if (!previous) return "sem base";
  const delta = ((current - previous) / previous) * 100;
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${formatDecimal(delta, 1)}%`;
}

function renderAlerts(alerts) {
  alertsList.innerHTML = alerts.length
    ? alerts
        .map(
          (alert) => `
            <article class="alert-card ${alert.type}">
              <strong>${escapeHtml(alert.machine || "Geral")}</strong>
              <p>${escapeHtml(alert.message)}</p>
            </article>
          `
        )
        .join("")
    : `<p class="muted">Nenhum alerta relevante para os filtros atuais.</p>`;
}

function renderHeatmap(data) {
  heatmapGrid.innerHTML = "";
  const header = document.createElement("div");
  header.className = "heatmap-row heatmap-header";
  header.innerHTML = `<span class="heatmap-machine">Maquina</span>${data.weekDates.map((date) => `<span>${escapeHtml(date.slice(5))}</span>`).join("")}`;
  heatmapGrid.appendChild(header);

  data.heatmap.forEach((row) => {
    const maxMeters = Math.max(...row.cells.map((cell) => cell.meters), 0);
    const el = document.createElement("div");
    el.className = "heatmap-row";
    el.innerHTML = `
      <span class="heatmap-machine">${escapeHtml(row.machine)}</span>
      ${row.cells
        .map((cell) => {
          const intensity = maxMeters > 0 ? cell.meters / maxMeters : 0;
          const background = `rgba(31, 107, 79, ${0.12 + intensity * 0.78})`;
          return `<span class="heatmap-cell" style="background:${background}">${escapeHtml(cell.count)}</span>`;
        })
        .join("")}
    `;
    heatmapGrid.appendChild(el);
  });
}

function renderBoxplot(list) {
  const maxValue = Math.max(...list.map((item) => item.max || 0), 1);
  boxplotList.innerHTML = list
    .map((item) => {
      const scale = (value) => `${((value || 0) / maxValue) * 100}%`;
      return `
        <article class="boxplot-item">
          <div class="boxplot-head">
            <strong>${escapeHtml(item.machine)}</strong>
            <span>${escapeHtml(formatDecimal(item.median, 2))} m</span>
          </div>
          <div class="boxplot-track">
            <span class="boxplot-range" style="left:${scale(item.min)}; width:calc(${scale(item.max)} - ${scale(item.min)})"></span>
            <span class="boxplot-box" style="left:${scale(item.q1)}; width:calc(${scale(item.q3)} - ${scale(item.q1)})"></span>
            <span class="boxplot-median" style="left:${scale(item.median)}"></span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTimeline(target, items) {
  target.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="timeline-item">
              <div class="timeline-time">${escapeHtml(`${item.date} ${item.finishedAt}`)}</div>
              <div class="timeline-body">
                <strong>${escapeHtml(item.machine)} | ${escapeHtml(item.estaca)}</strong>
                <span>${escapeHtml(`${item.obra} | ${item.contrato} | ${formatDecimal(item.realizadoM, 2)} m`)}</span>
              </div>
            </article>
          `
        )
        .join("")
    : `<p class="muted">Nenhuma estaca no periodo filtrado.</p>`;
}

function renderContracts(target, items) {
  target.innerHTML = items
    .slice(0, 10)
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(formatDecimal(item.meters, 2))}</td>
          <td>${escapeHtml(item.count)}</td>
        </tr>
      `
    )
    .join("");
}

function renderQuality(data) {
  const activeMachines = [...(data.machines || [])]
    .filter((item) => item.weeklyTotalCount > 0)
    .sort((a, b) => b.weeklyTotalMeters - a.weeklyTotalMeters);

  qualityMeta.textContent = activeMachines.length
    ? `${activeMachines.length} maquina(s) com leitura de concreto e indicadores tecnicos na semana.`
    : "Nenhuma maquina com producao para analisar.";

  concreteTableBody.innerHTML = activeMachines.length
    ? activeMachines
        .map((report) => `
          <tr>
            <td>${escapeHtml(report.machine.name)}</td>
            <td>${escapeHtml(formatDecimal(report.quality?.avgConcreteLiters || 0, 0))}</td>
            <td>${escapeHtml(formatDecimal(report.quality?.avgPressureBar || 0, 1))} bar</td>
            <td>${escapeHtml(formatDecimal(report.operations?.avgConcretingDurationMin || 0, 1))} min</td>
          </tr>
        `)
        .join("")
    : `<tr><td colspan="4" class="muted">Nenhuma leitura de concreto disponivel para os filtros atuais.</td></tr>`;

  const concreteInsights = [];

  activeMachines.forEach((report) => {
    const pressure = report.quality?.avgPressureBar || 0;
    const concreteLiters = report.quality?.avgConcreteLiters || 0;
    const concretingMinutes = report.operations?.avgConcretingDurationMin || 0;
    const torque = report.quality?.avgTorqueBar || 0;
    const rotation = report.quality?.avgRotationRpm || 0;
    const inclination = report.quality?.avgInclination || 0;
    const outOfLimit = report.quality?.outOfInclinationLimit || 0;

    concreteInsights.push({
      type: pressure > 15 ? "warning" : "info",
      machine: report.machine.name,
      message: `Pressao media ${formatDecimal(pressure, 1)} bar | Concreto ${formatDecimal(concreteLiters, 0)} L/estaca | Concretagem ${formatDecimal(concretingMinutes, 1)} min.`,
    });
    concreteInsights.push({
      type: outOfLimit > 0 ? "danger" : "info",
      machine: report.machine.name,
      message: `Torque medio ${formatDecimal(torque, 1)} bar | Rotacao media ${formatDecimal(rotation, 1)} rpm | Inclinacao media ${formatDecimal(inclination, 1)} | Fora do limite: ${outOfLimit}.`,
    });
  });

  qualityList.innerHTML = concreteInsights.length
    ? concreteInsights
        .map(
          (item) => `
            <article class="alert-card ${item.type}">
              <strong>${escapeHtml(item.machine)}</strong>
              <p>${escapeHtml(item.message)}</p>
            </article>
          `
        )
        .join("")
    : `<p class="muted">Sem dados tecnicos suficientes para montar a analise de concreto.</p>`;
}

function renderDashboard(data) {
  destroyDashboardCharts();
  destroyOverviewChart();
  dashboardGrid.innerHTML = "";
  dashboardStats.innerHTML = "";
  rankingTableBody.innerHTML = "";
  contractTableBody.innerHTML = "";
  contractTableBodyDetailed.innerHTML = "";
  timelineList.innerHTML = "";
  timelineListDetailed.innerHTML = "";
  concreteTableBody.innerHTML = "";
  qualityList.innerHTML = "";

  if (!data.machines?.length) {
    dashboardSection.classList.remove("is-hidden");
    dashboardMeta.textContent = "Nenhuma maquina retornada.";
    dashboardHint.textContent = "Nao houve dados para a semana selecionada.";
    return;
  }

  dashboardSection.classList.remove("is-hidden");
  dashboardOverviewSection.classList.remove("is-hidden");
  const sortedMachines = [...data.machines].sort((a, b) => b.weeklyTotalMeters - a.weeklyTotalMeters);
  const activeMachineReports = sortedMachines.filter((item) => item.weeklyTotalCount > 0);
  const inactiveMachineCount = sortedMachines.length - activeMachineReports.length;

  dashboardMeta.textContent = `${activeMachineReports.length} maquina(s) com producao na semana iniciada em ${data.weekStart}.`;
  dashboardOverviewMeta.textContent = `Cliente ${data.clientLogin} | Semana de ${data.weekDates[0]} a ${data.weekDates[data.weekDates.length - 1]}`;
  dashboardHint.textContent =
    inactiveMachineCount > 0
      ? `Barras: metragem realizada por dia. Linha: quantidade de estacas por dia. ${inactiveMachineCount} maquina(s) sem producao foram ocultadas desta grade.`
      : "Barras: metragem realizada por dia. Linha: quantidade de estacas por dia.";

  const overallMeters = data.machines.reduce((sum, item) => sum + item.weeklyTotalMeters, 0);
  const overallCount = data.machines.reduce((sum, item) => sum + item.weeklyTotalCount, 0);
  const activeMachines = activeMachineReports.length;
  const averagePerMachine = activeMachines ? overallMeters / activeMachines : 0;

  dashboardStats.innerHTML = [
    ["Metros da semana", `${formatDecimal(overallMeters, 2)} m`],
    ["Estacas da semana", String(overallCount)],
    ["Maquinas ativas", String(activeMachines)],
    ["Media por maquina", `${formatDecimal(averagePerMachine, 2)} m`],
    ["Vs semana anterior", buildDelta(overallMeters, data.previousTotals?.meters)],
    ["Estacas vs anterior", buildDelta(overallCount, data.previousTotals?.count)],
  ]
    .map(
      ([label, value]) => `
        <article class="stat-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `
    )
    .join("");

  renderAlerts(data.alerts || []);
  renderHeatmap(data);
  renderBoxplot(data.boxplot || []);
  renderTimeline(timelineList, data.timeline || []);
  renderTimeline(timelineListDetailed, data.timeline || []);
  renderContracts(contractTableBody, data.contratoTotals || []);
  renderContracts(contractTableBodyDetailed, data.contratoTotals || []);
  renderQuality(data);
  timelineMeta.textContent = `${(data.timeline || []).length} evento(s) na linha do tempo para a semana filtrada.`;

  const dailyLabels = data.weekDates.map((date) => date.slice(5));
  const dailyMeters = data.weekDates.map((date) =>
    data.machines.reduce((sum, machine) => sum + (machine.daily.find((d) => d.date === date)?.totalMeters || 0), 0)
  );
  const dailyCounts = data.weekDates.map((date) =>
    data.machines.reduce((sum, machine) => sum + (machine.daily.find((d) => d.date === date)?.totalCount || 0), 0)
  );

  weeklyOverviewChart = new Chart(weeklyOverviewChartCanvas, {
    type: "bar",
    data: {
      labels: dailyLabels,
      datasets: [
        {
          type: "bar",
          label: "Metros executados",
          data: dailyMeters.map((value) => Number(value.toFixed(2))),
          backgroundColor: [
            "rgba(31, 107, 79, 0.88)",
            "rgba(52, 138, 102, 0.88)",
            "rgba(84, 165, 126, 0.88)",
            "rgba(114, 184, 149, 0.88)",
            "rgba(146, 199, 171, 0.88)",
            "rgba(177, 215, 194, 0.88)",
            "rgba(207, 230, 217, 0.88)",
          ],
          borderColor: "#184f3b",
          borderWidth: 1,
          borderRadius: 12,
          borderSkipped: false,
          barThickness: 28,
          yAxisID: "y",
        },
        {
          type: "line",
          label: "Estacas executadas",
          data: dailyCounts,
          borderColor: "#c96a2d",
          backgroundColor: "rgba(201, 106, 45, 0.18)",
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: "#fff7ef",
          pointBorderColor: "#c96a2d",
          pointBorderWidth: 2,
          borderWidth: 3,
          yAxisID: "y1",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            boxWidth: 10,
            padding: 18,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#5f6d64" },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Metros" },
          grid: { color: "rgba(31, 42, 36, 0.08)" },
          ticks: { color: "#5f6d64" },
        },
        y1: {
          beginAtZero: true,
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { precision: 0 },
          title: { display: true, text: "Estacas" },
        },
      },
    },
  });

  const cumulativeMeters = [];
  dailyMeters.reduce((acc, value, index) => {
    const next = acc + value;
    cumulativeMeters[index] = Number(next.toFixed(2));
    return next;
  }, 0);

  cumulativeChart = new Chart(cumulativeChartCanvas, {
    type: "line",
    data: {
      labels: dailyLabels,
      datasets: [
        {
          label: "Metros acumulados",
          data: cumulativeMeters,
          borderColor: "#1d6b50",
          backgroundColor: "rgba(29, 107, 80, 0.18)",
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: "#fff",
          pointBorderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: "rgba(31, 42, 36, 0.08)" } },
      },
    },
  });

  obraChart = new Chart(obraChartCanvas, {
    type: "bar",
    data: {
      labels: (data.obraTotals || []).slice(0, 8).map((item) => item.name),
      datasets: [
        {
          label: "Metros",
          data: (data.obraTotals || []).slice(0, 8).map((item) => Number(item.meters.toFixed(2))),
          backgroundColor: "rgba(99, 154, 125, 0.88)",
          borderRadius: 10,
          borderSkipped: false,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: "rgba(31, 42, 36, 0.08)" } },
        y: { grid: { display: false } },
      },
    },
  });

  rankingTableBody.innerHTML = [...data.machines]
    .sort((a, b) => b.weeklyTotalMeters - a.weeklyTotalMeters)
    .slice(0, 10)
    .map(
      (report, index) => `
        <tr>
          <td>${escapeHtml(`${index + 1}. ${report.machine.name}`)}</td>
          <td>${escapeHtml(formatDecimal(report.weeklyTotalMeters, 2))}</td>
          <td>${escapeHtml(report.weeklyTotalCount)}</td>
        </tr>
      `
    )
    .join("");

  activeMachineReports.forEach((report, index) => {
    const card = document.createElement("article");
    card.className = "dashboard-card";
    card.innerHTML = `
      <div class="dashboard-card-head">
        <div>
          <h3>${escapeHtml(report.machine.name)}</h3>
          <p class="muted">${escapeHtml(report.machine.imei)}</p>
        </div>
        <div class="dashboard-kpis">
          <div><strong>${escapeHtml(formatDecimal(report.weeklyTotalMeters, 2))} m</strong><span>Total semana</span></div>
          <div><strong>${escapeHtml(report.weeklyTotalCount)}</strong><span>Estacas</span></div>
          <div><strong>${escapeHtml(formatDecimal(report.weeklyTotalCount ? report.weeklyTotalMeters / report.weeklyTotalCount : 0, 2))} m</strong><span>Media por estaca</span></div>
        </div>
      </div>
      <canvas id="dashboardChart${index}" height="120"></canvas>
    `;
    dashboardGrid.appendChild(card);

    const labels = report.daily.map((item) => item.date.slice(5));
    const meters = report.daily.map((item) => Number(item.totalMeters.toFixed(2)));
    const counts = report.daily.map((item) => item.totalCount);
    const ctx = card.querySelector("canvas");

    const chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
        {
          type: "bar",
          label: "Realizado (m)",
          data: meters,
          backgroundColor: labels.map((_, labelIndex) =>
            labelIndex % 2 === 0 ? "rgba(26, 95, 71, 0.84)" : "rgba(75, 154, 118, 0.84)"
          ),
          borderColor: "#184f3b",
          borderWidth: 1,
          borderRadius: 10,
          borderSkipped: false,
          barThickness: 22,
          yAxisID: "y",
        },
        {
          type: "line",
          label: "Estacas",
          data: counts,
          borderColor: "#bd6a39",
          backgroundColor: "rgba(189, 106, 57, 0.15)",
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 5,
          pointBackgroundColor: "#fff7ef",
          pointBorderColor: "#bd6a39",
          pointBorderWidth: 2,
          borderWidth: 3,
          yAxisID: "y1",
        },
      ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              usePointStyle: true,
              boxWidth: 10,
              padding: 16,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#5f6d64" },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: "Metros" },
            grid: { color: "rgba(31, 42, 36, 0.08)" },
            ticks: { color: "#5f6d64" },
          },
          y1: {
            beginAtZero: true,
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: { precision: 0 },
            title: { display: true, text: "Estacas" },
          },
        },
      },
    });

    dashboardCharts.push(chart);
  });

  switchDashboardSubtab("overview");
}

function formatSize(bytes) {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDecimal(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits).replace(".", ",");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTable(items = []) {
  if (!items.length) {
    resultsTableBody.innerHTML = "";
    tableWrap.classList.add("is-hidden");
    return;
  }

  resultsTableBody.innerHTML = items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml((item.estaca || "-").trim())}</td>
          <td>${escapeHtml(formatDecimal(item.diametroCm, 0))}</td>
          <td>${escapeHtml(formatDecimal(item.realizadoM, 2))}</td>
          <td>${escapeHtml(item.finishedAt || "-")}</td>
          <td>${escapeHtml((item.contrato || "-").trim())}</td>
          <td>${escapeHtml((item.obra || "-").trim())}</td>
          <td><button type="button" class="secondary-button" data-key="${escapeHtml(item.key)}">Ver detalhes</button></td>
        </tr>
      `
    )
    .join("");

  tableWrap.classList.remove("is-hidden");
}

function resetDetail() {
  detailSection.classList.add("is-hidden");
  detailMeta.textContent = "Nenhuma estaca carregada.";
  detailHint.textContent = "Aguardando selecao.";
  detailHeader.innerHTML = "";
  detailSlicesBody.innerHTML = "";
}

function renderDetail(data) {
  const { parsed, key } = data;
  const header = parsed.header || {};
  const phases = parsed.phases || {};

  detailHeader.innerHTML = [
    ["Arquivo", key],
    ["Versao", header.version],
    ["Contrato", header.contrato],
    ["Obra", header.obra],
    ["Numero", header.numero],
    ["Diametro", header.diametro],
    ["Bomba", header.bomba],
    ["Inclinacao", header.inclinacao],
    ["Linha 8", header.linha8],
    ["Inicio perfuracao", header.inicioPerfuracao],
    ["Fim perfuracao", header.fimPerfuracao],
    ["Inicio concretagem", header.inicioConcretagem],
    ["Fim concretagem", header.fimConcretagem],
    ["Profundidade", `${phases.depthCm ?? 0} cm`],
    ["Fatias perfuracao", phases.drillingSlices ?? 0],
    ["Fatias concretagem", phases.concretingSlices ?? 0],
  ]
    .map(
      ([label, value]) => `
        <div class="detail-item">
          <span class="detail-label">${escapeHtml(label)}</span>
          <strong>${escapeHtml(String(value ?? "-").trim())}</strong>
        </div>
      `
    )
    .join("");

  detailSlicesBody.innerHTML = (parsed.slices || [])
    .map(
      (slice) => `
        <tr>
          <td>${escapeHtml(slice.index)}</td>
          <td>${escapeHtml(slice.timeTick)}</td>
          <td>${escapeHtml(slice.value2)}</td>
          <td>${escapeHtml(slice.value3)}</td>
        </tr>
      `
    )
    .join("");

  detailMeta.textContent = "Estaca convertida com sucesso.";
  detailHint.textContent = `${parsed.slices?.length || 0} fatia(s) carregada(s).`;
  detailSection.classList.remove("is-hidden");
}

async function loadDetail(key) {
  detailSection.classList.remove("is-hidden");
  detailMeta.textContent = "Carregando detalhes...";
  detailHint.textContent = "Baixando binario e convertendo estaca.";
  detailHeader.innerHTML = "";
  detailSlicesBody.innerHTML = "";
  detailSection.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const query = new URLSearchParams({ key });
    const response = await fetch(`/api/estacas/detail?${query.toString()}`);
    const data = await response.json();

    if (!data.ok) {
      detailMeta.textContent = "Falha ao converter estaca.";
      detailHint.textContent = data.details || data.message || "Erro no backend.";
      return;
    }

    renderDetail(data);
  } catch (error) {
    detailMeta.textContent = "Falha ao converter estaca.";
    detailHint.textContent = error.message;
  }
}

function setSummary({ clientLogin, imei, date, prefix }) {
  querySummary.textContent =
    `Cliente: ${clientLogin || "-"} | IMEI: ${imei || "-"} | Data: ${date || "-"} | Prefixo: ${prefix || "-"}`;
}

function currentSearchParams() {
  return {
    clientLogin: clientLoginInput.value.trim(),
    imei: imeiInput.value.trim(),
    date: dateInput.value,
  };
}

const initialMachines = loadMachines();
refreshMachinesUi(initialMachines, false);
syncSelectedMachineFromImei(initialMachines);
renderDashboardMachineFilter(initialMachines);
weekInput.value = getWeekValueFromDate(dateInput.value);
switchTab("daily");
switchDashboardSubtab("overview");

dailyTabButton.addEventListener("click", () => switchTab("daily"));
dashboardTabButton.addEventListener("click", () => switchTab("dashboard"));
subtabOverviewButton.addEventListener("click", () => switchDashboardSubtab("overview"));
subtabMachinesButton.addEventListener("click", () => switchDashboardSubtab("machines"));
subtabQualityButton.addEventListener("click", () => switchDashboardSubtab("quality"));
subtabTimelineButton.addEventListener("click", () => switchDashboardSubtab("timeline"));

healthButton.addEventListener("click", async () => {
  healthStatus.textContent = "Testando...";
  resultHint.textContent = "Validando conexao com o bucket configurado.";

  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    healthStatus.textContent = data.ok ? "Conexao OK." : "Falha na conexao.";
    setResult(data);
    renderTable([]);
    resetDetail();
    resetDashboard();
    resultMeta.textContent = "Teste de conexao executado.";
    resultHint.textContent = data.ok
      ? "Bucket acessivel. Agora voce pode testar a busca por cliente, IMEI e data."
      : "A conexao ao bucket falhou. Revise as variaveis de ambiente do backend.";
  } catch (error) {
    healthStatus.textContent = "Erro ao testar conexao.";
    setResult({ ok: false, error: error.message });
    renderTable([]);
    resetDetail();
    resetDashboard();
    resultHint.textContent = "Nao foi possivel falar com o backend.";
  }
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const { clientLogin, imei, date } = currentSearchParams();
  setSummary({ clientLogin, imei, date, prefix: "(calculando...)" });

  resultMeta.textContent = "Consultando...";
  resultHint.textContent = "Consulta enviada ao backend. Gerando resumo operacional das estacas.";

  try {
    const query = new URLSearchParams({ clientLogin, imei, date });
    const response = await fetch(`/api/estacas/summary?${query.toString()}`);
    const data = await response.json();
    setSummary({ clientLogin, imei, date, prefix: data.prefix });

    if (data.ok) {
      resultMeta.textContent = `${data.count} arquivo(s) encontrado(s) em ${data.prefix}`;
      resultHint.textContent =
        data.count > 0
          ? "Resumo operacional gerado a partir das fatias de cada estaca."
          : "Nenhum arquivo encontrado para este cliente, IMEI e data. Isso indica consulta vazia, nao erro de interface.";
      renderTable(data.items || []);
      resetDetail();
    } else {
      resultMeta.textContent = "Consulta retornou erro.";
      resultHint.textContent = "O backend respondeu com erro. Veja os detalhes abaixo.";
      renderTable([]);
      resetDetail();
    }

    setResult(data);
  } catch (error) {
    resultMeta.textContent = "Erro ao consultar.";
    resultHint.textContent = "Nao foi possivel completar a consulta.";
    renderTable([]);
    resetDetail();
    setResult({ ok: false, error: error.message });
  }
});

resultsTableBody.addEventListener("click", (event) => {
  const button = event.target.closest("[data-key]");
  if (!button) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Carregando...";
  loadDetail(button.dataset.key).finally(() => {
    button.disabled = false;
    button.textContent = originalText;
  });
});

pdfButton.addEventListener("click", async () => {
  const { clientLogin, imei, date } = currentSearchParams();
  const originalText = pdfButton.textContent;
  pdfButton.disabled = true;
  pdfButton.textContent = "Gerando PDF...";

  try {
    const query = new URLSearchParams({ clientLogin, imei, date });
    const response = await fetch(`/api/estacas/summary/pdf?${query.toString()}`);

    if (!response.ok) {
      let message = "Falha ao gerar PDF.";
      try {
        const data = await response.json();
        message = data.details || data.message || message;
      } catch {
      }
      resultHint.textContent = message;
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `diario-estacas-${clientLogin}-${imei}-${date}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    resultHint.textContent = "PDF gerado com sucesso.";
  } catch (error) {
    resultHint.textContent = error.message;
  } finally {
    pdfButton.disabled = false;
    pdfButton.textContent = originalText;
  }
});

machineSelect.addEventListener("change", () => {
  imeiInput.value = machineSelect.value;
});

imeiInput.addEventListener("input", () => {
  syncSelectedMachineFromImei(loadMachines());
});

saveMachinesButton.addEventListener("click", () => {
  const machines = parseMachines(machinesEditor.value);
  if (!machines.length) {
    machineStatus.textContent = "Nenhuma maquina valida encontrada. Use NOME=IMEI com 15 digitos.";
    return;
  }

  saveMachines(machines);
  refreshMachinesUi(machines);
  renderDashboardMachineFilter(machines);
  machineStatus.textContent = `${machines.length} maquina(s) salva(s) no navegador.`;
});

resetMachinesButton.addEventListener("click", () => {
  saveMachines(DEFAULT_MACHINES);
  refreshMachinesUi(DEFAULT_MACHINES);
  renderDashboardMachineFilter(DEFAULT_MACHINES);
  machineStatus.textContent = "Lista padrao restaurada.";
});

dateInput.addEventListener("change", () => {
  weekInput.value = getWeekValueFromDate(dateInput.value);
});

weeklyButton.addEventListener("click", async () => {
  const weekStart = getWeekStartFromWeekInput(weekInput.value);
  const machines = selectedDashboardMachines();
  dashboardSelectionMeta.textContent = `${machines.length} maquina(s) selecionada(s).`;

  if (!weekStart) {
    dashboardSection.classList.remove("is-hidden");
    dashboardMeta.textContent = "Semana invalida.";
    dashboardHint.textContent = "Selecione uma semana valida.";
    return;
  }

  dashboardSection.classList.remove("is-hidden");
  dashboardMeta.textContent = "Gerando dashboard semanal...";
  dashboardHint.textContent = "Consultando estacas da semana para cada maquina.";
  dashboardGrid.innerHTML = "";

  const originalText = weeklyButton.textContent;
  weeklyButton.disabled = true;
  weeklyButton.textContent = "Buscando semana...";

  try {
    const response = await fetch("/api/dashboard/weekly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientLogin: clientLoginInput.value.trim(),
        weekStart,
        machines,
        obraFilter: obraFilterInput.value.trim(),
        contratoFilter: contratoFilterInput.value.trim(),
      }),
    });
    const data = await response.json();

    if (!data.ok) {
      dashboardMeta.textContent = "Falha ao gerar dashboard.";
      dashboardHint.textContent = data.details || data.message || "Erro no backend.";
      return;
    }

    renderDashboard(data);
    lastDashboardData = data;
    switchTab("dashboard");
  } catch (error) {
    dashboardMeta.textContent = "Falha ao gerar dashboard.";
    dashboardHint.textContent = error.message;
  } finally {
    weeklyButton.disabled = false;
    weeklyButton.textContent = originalText;
  }
});

weeklyCsvButton.addEventListener("click", () => {
  if (!lastDashboardData) {
    dashboardHint.textContent = "Gere um dashboard semanal antes de exportar CSV.";
    return;
  }

  const rows = [
    ["Maquina", "IMEI", "Metros", "Estacas", "Media por estaca", "Dias sem producao", "Utilizacao %"],
    ...lastDashboardData.machines.map((item) => [
      item.machine.name,
      item.machine.imei,
      item.weeklyTotalMeters.toFixed(2).replace(".", ","),
      item.weeklyTotalCount,
      (item.operations?.avgMetersPerPile || 0).toFixed(2).replace(".", ","),
      item.daysWithoutProduction,
      (item.utilizationRate || 0).toFixed(1).replace(".", ","),
    ]),
  ];

  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dashboard-semanal-${lastDashboardData.clientLogin}-${lastDashboardData.weekStart}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

dashboardMachineFilter.addEventListener("change", () => {
  const selected = selectedDashboardMachines().length;
  dashboardSelectionMeta.textContent = `${selected} maquina(s) selecionada(s).`;
});
