import { api } from './api.js';
import { getState, getWeekStartFromInput } from './state.js';
import { renderComparisonList, renderHeatmap, renderMultiLineChart } from './charts.js';

function alertCard(item) {
  return `
    <article class="alert-card warning">
      <strong>${item.machine_name}</strong>
      <p>${item.message}</p>
    </article>
  `;
}

function timelineCard(item) {
  return `
    <article class="timeline-card">
      <div class="timeline-time">${item.date} ${item.finishedAt || '--:--'}</div>
      <div>
        <strong>${item.machine_name}</strong>
        <p>${item.estaca || 'Sem estaca'} | ${item.obra_name || 'Sem obra'}</p>
      </div>
    </article>
  `;
}

export async function renderSecondaryView() {
  const state = getState();
  const data = await api.getSecondary({
    clientLogin: state.clientLogin,
    date: state.date,
    weekStart: getWeekStartFromInput(state.weekInput),
  });

  document.getElementById('secondaryMeta').textContent = `${data.item.today_total_estacas} hoje / ${data.item.week_total_estacas} semana`;
  renderComparisonList(
    document.getElementById('secondaryMachines'),
    data.item.top_machines.slice(0, 6).map((item) => ({
      label: item.machine_name,
      subLabel: item.obra_name || 'Sem obra',
      value: item.realized_estacas,
      sideValue: `${item.realized_estacas} estacas`,
    })),
    {
      kicker: 'Maquina',
      emptyText: 'Nenhuma maquina no ranking.',
    }
  );
  renderComparisonList(
    document.getElementById('secondaryWorks'),
    data.item.top_works.slice(0, 6).map((item) => ({
      label: item.obra_name,
      subLabel: `${item.machines} maquinas`,
      value: item.realized_estacas,
      sideValue: `${item.goal_estacas || 0} meta`,
    })),
    {
      kicker: 'Obra',
      emptyText: 'Nenhuma obra consolidada.',
    }
  );
  document.getElementById('secondaryAlerts').innerHTML = data.item.alerts.length
    ? data.item.alerts.map(alertCard).join('')
    : '<p class="inline-feedback">Nenhum alerta operacional.</p>';
  document.getElementById('secondaryTimeline').innerHTML = data.item.timeline.length
    ? data.item.timeline.map(timelineCard).join('')
    : '<p class="inline-feedback">Nenhuma timeline disponivel.</p>';

  renderMultiLineChart(
    'secondaryTrendChart',
    data.item.daily_realized_by_day.map((item) => item.date.slice(5)),
    [
      {
        label: 'Realizado',
        data: data.item.daily_realized_by_day.map((item) => item.realized_estacas),
        borderColor: '#d81f26',
        backgroundColor: 'rgba(216, 31, 38, 0.14)',
        fill: true,
        tension: 0.28,
        pointRadius: 5,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#b9141a',
        pointBorderWidth: 2,
      },
      {
        label: 'Meta diaria',
        data: data.item.daily_realized_by_day.map((item) => item.goal_estacas),
        borderColor: '#8a4f4f',
        borderDash: [10, 8],
        fill: false,
        tension: 0,
        pointRadius: 0,
      },
    ]
  );
  renderHeatmap(document.getElementById('secondaryHeatmap'), data.item.heatmap);

  return data;
}
