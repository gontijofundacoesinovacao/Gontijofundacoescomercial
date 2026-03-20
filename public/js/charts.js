const chartRegistry = new Map();

function destroyChart(id) {
  const chart = chartRegistry.get(id);
  if (chart) {
    chart.destroy();
    chartRegistry.delete(id);
  }
}

function statusTone(percent) {
  if (percent == null) return 'neutral';
  if (percent >= 100) return 'green';
  if (percent >= 70) return 'orange';
  return 'red';
}

export function renderBuildingCard(container, options) {
  const percent = options.percent == null ? null : Number(options.percent.toFixed(1));
  const tone = options.tone || statusTone(percent);
  const realized = Number(options.realized || 0);
  const goal = Number(options.goal || 0);
  const primaryValue = Number(options.primaryValue ?? realized);
  const fillPercent = options.fillPercent == null
    ? Math.max(0, Math.min(percent || 0, 100))
    : Math.max(0, Math.min(Number(options.fillPercent) || 0, 100));
  const percentLabel = options.percentLabel || (percent == null ? 'Sem meta' : `${percent}% da meta`);
  const metrics = options.metrics || [
    { label: 'Realizado', value: realized },
    { label: 'Meta', value: goal },
    { label: 'Percentual', value: percent == null ? '-' : `${percent}%` },
  ];
  container.innerHTML = `
    <article class="hero-card ${options.accent ? 'hero-card--accent' : ''}">
      <div class="panel-head">
        <div>
          <p class="eyebrow">${options.eyebrow || 'Meta'}</p>
          <h3>${options.title}</h3>
        </div>
        <span class="status-tag ${tone}">
          ${percentLabel}
        </span>
      </div>
      <div class="building-chart">
        <div class="building-figure">
          <div class="building-fill ${options.fillClass || ''}" style="height:${fillPercent}%"></div>
          <div class="building-grid">${'<span></span>'.repeat(30)}</div>
        </div>
        <div class="building-label">
          <strong>${primaryValue}</strong>
          <p>${options.description || ''}</p>
          <div class="summary-strip">
            ${metrics
              .map(
                (item) => `
                  <div class="summary-chip">
                    <span>${item.label}</span>
                    <strong>${item.value}</strong>
                  </div>
                `
              )
              .join('')}
          </div>
        </div>
      </div>
    </article>
  `;
}

export function renderComparisonList(container, items, options = {}) {
  const max = Math.max(...items.map((item) => Number(item.value || 0)), Number(options.max || 0), 1);
  if (!items.length) {
    container.innerHTML = `<p class="inline-feedback">${options.emptyText || 'Nenhum dado disponivel.'}</p>`;
    return;
  }

  container.innerHTML = items
    .map((item, index) => {
      const width = Math.max(8, (Number(item.value || 0) / max) * 100);
      return `
        <article class="compare-row">
          <div class="compare-row__head">
            <div>
              <span class="compare-row__kicker">${options.kicker || 'Ranking'} ${index + 1}</span>
              <strong>${item.label}</strong>
              <p>${item.subLabel || ''}</p>
            </div>
            <div class="compare-row__values">
              <strong>${item.value}</strong>
              ${item.sideValue == null ? '' : `<span>${item.sideValue}</span>`}
            </div>
          </div>
          <div class="compare-row__track">
            <span style="width:${width}%"></span>
          </div>
        </article>
      `;
    })
    .join('');
}

export function renderLineChart(canvasId, labels, values, label) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label,
          data: values,
          borderColor: '#d81f26',
          backgroundColor: 'rgba(216, 31, 38, 0.14)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#b9141a',
          pointBorderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(185, 20, 26, 0.08)' },
          ticks: { precision: 0 },
        },
      },
    },
  });
  chartRegistry.set(canvasId, chart);
}

export function renderMultiLineChart(canvasId, labels, datasets) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: '#8a4f4f',
            usePointStyle: true,
            padding: 18,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#8a4f4f' },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(185, 20, 26, 0.08)' },
          ticks: {
            precision: 0,
            color: '#8a4f4f',
          },
        },
      },
    },
  });
  chartRegistry.set(canvasId, chart);
}

export function renderHeatmap(container, rows) {
  if (!rows.length) {
    container.innerHTML = '<p class="inline-feedback">Nenhum dado para o heatmap.</p>';
    return;
  }

  const header = rows[0].cells.map((cell) => `<span>${cell.date.slice(5)}</span>`).join('');
  const maxCount = Math.max(...rows.flatMap((row) => row.cells.map((cell) => cell.count)), 1);
  container.innerHTML = `
    <div class="heatmap-row">
      <strong class="heatmap-machine">Maquina</strong>
      ${header}
    </div>
    ${rows
      .map(
        (row) => `
          <div class="heatmap-row">
            <span class="heatmap-machine">${row.machine_name}</span>
            ${row.cells
              .map((cell) => {
                const alpha = 0.15 + cell.count / maxCount * 0.85;
                const style = `background:rgba(216,31,38,${alpha.toFixed(2)});`;
                return `<span class="heatmap-cell" style="${style}">${cell.count}</span>`;
              })
              .join('')}
          </div>
        `
      )
      .join('')}
  `;
}
