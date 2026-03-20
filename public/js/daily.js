import { api } from './api.js';
import { getState } from './state.js';
import { renderBuildingCard, renderComparisonList } from './charts.js';

let machineSpotlightTimer = null;

function toneClass(machine) {
  if (machine.progress_percent == null) return 'neutral';
  if (machine.progress_percent >= 100) return 'green';
  if (machine.progress_percent >= 70) return 'orange';
  return 'red';
}

function clearMachineSpotlightTimer() {
  if (machineSpotlightTimer) {
    clearInterval(machineSpotlightTimer);
    machineSpotlightTimer = null;
  }
}

function machineSpotlightTone(machine) {
  if (machine.progress_percent == null) return 'neutral';
  if (machine.progress_percent >= 100) return 'green';
  if (machine.progress_percent >= 70) return 'orange';
  return 'red';
}

function renderMachineSpotlight(container, machines) {
  clearMachineSpotlightTimer();

  if (!machines.length) {
    container.innerHTML = '<article class="hero-card"><p class="inline-feedback">Nenhuma maquina disponivel para destaque.</p></article>';
    return;
  }

  let index = 0;

  const draw = () => {
    const machine = machines[index];
    const remaining = Math.max(Number(machine.daily_goal_estacas || 0) - Number(machine.realized_estacas || 0), 0);
    const progress = machine.progress_percent == null ? 0 : Math.max(0, Math.min(machine.progress_percent, 100));
    const tone = machineSpotlightTone(machine);
    const percentLabel = machine.progress_percent == null ? 'Sem meta cadastrada' : `${machine.progress_percent.toFixed(1)}% da meta`;
    const workSourceLabel =
      machine.work_source === 'admin'
        ? 'Admin'
        : machine.work_source === 'api'
        ? 'Operacao'
        : 'Sem obra';

    container.innerHTML = `
      <article class="hero-card machine-spotlight machine-spotlight--${tone}">
        <div class="machine-spotlight__top">
          <div>
            <p class="eyebrow">Maquina a maquina</p>
            <h3>${machine.machine_name}</h3>
            <p class="machine-spotlight__work">${machine.obra_name || 'Sem obra definida'}</p>
          </div>
          <div class="machine-spotlight__badges">
            <span class="status-tag ${tone}">${percentLabel}</span>
            <span class="machine-spotlight__position">${index + 1}/${machines.length}</span>
          </div>
        </div>
        <div class="machine-spotlight__hero">
          <div class="machine-spotlight__score">
            <span class="machine-spotlight__label">Realizado hoje</span>
            <strong>${machine.realized_estacas}</strong>
            <p>IMEI ${machine.imei}</p>
          </div>
          <div class="machine-spotlight__progress">
            <div class="machine-spotlight__progress-bar">
              <span style="width:${progress}%"></span>
            </div>
            <div class="machine-spotlight__progress-scale">
              <span>0</span>
              <span>Meta ${machine.daily_goal_estacas}</span>
            </div>
          </div>
        </div>
        <div class="machine-spotlight__metrics">
          <article class="machine-spotlight__metric is-primary">
            <span>Meta dia</span>
            <strong>${machine.daily_goal_estacas}</strong>
          </article>
          <article class="machine-spotlight__metric">
            <span>Faltam</span>
            <strong>${remaining}</strong>
          </article>
          <article class="machine-spotlight__metric">
            <span>Fonte</span>
            <strong>${workSourceLabel}</strong>
          </article>
        </div>
        <div class="machine-spotlight__footer">
          <span>Rotacao automatica a cada 10 segundos</span>
          <span>${machine.obra_code ? `Obra ${machine.obra_code}` : 'Codigo da obra indisponivel'}</span>
        </div>
      </article>
    `;
    index = (index + 1) % machines.length;
  };

  draw();
  if (machines.length > 1) {
    machineSpotlightTimer = setInterval(draw, 10000);
  }
}

function machineCard(machine) {
  const percent = machine.progress_percent == null ? 0 : Math.min(machine.progress_percent, 100);
  const sourceLabel =
    machine.work_source === 'admin'
      ? 'Obra definida no admin'
      : machine.work_source === 'api'
      ? 'Obra puxada da operacao'
      : 'Sem obra definida';
  return `
    <article class="machine-card">
      <div class="machine-top">
        <div class="machine-meta">
          <strong>${machine.machine_name}</strong>
          <small>${machine.imei}</small>
          <small>${machine.obra_name || 'Sem obra'}</small>
          <small>${sourceLabel}</small>
        </div>
        <span class="status-tag ${toneClass(machine)}">
          ${machine.progress_percent == null ? 'Sem meta' : `${machine.progress_percent.toFixed(0)}%`}
        </span>
      </div>
      <div class="machine-progress"><span style="width:${percent}%"></span></div>
      <div class="machine-stats">
        <div><span>Estacas</span><strong>${machine.realized_estacas}</strong></div>
        <div><span>Meta dia</span><strong>${machine.daily_goal_estacas}</strong></div>
        <div><span>Numero obra</span><strong>${machine.obra_code || '-'}</strong></div>
      </div>
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

export async function renderDailyView() {
  const state = getState();
  const data = await api.getDaily({
    clientLogin: state.clientLogin,
    date: state.date,
  });

  document.getElementById('dailyDateLabel').textContent = new Date(`${data.date}T00:00:00`).toLocaleDateString('pt-BR');
  document.getElementById('dailyMachinesCount').textContent = `${data.machines.length} maquinas`;

  const hero = document.getElementById('dailyHero');
  hero.innerHTML = `
    <div id="dailyBuildingMain"></div>
    <div id="dailyBuildingGoal"></div>
    <article class="hero-card">
      <div class="panel-head">
        <div>
          <p class="eyebrow">Resumo</p>
          <h3>Obras em destaque</h3>
        </div>
        <span>Distribuicao de producao</span>
      </div>
      <div id="dailyWorksComparison" class="compare-list"></div>
    </article>
  `;

  renderBuildingCard(document.getElementById('dailyBuildingMain'), {
    eyebrow: 'Principal',
    title: 'Estacas realizadas no dia',
    realized: data.total_realized_estacas,
    goal: data.total_goal_estacas,
    percent: data.total_progress_percent,
    description: 'Painel principal para acompanhar o total executado no dia frente a meta diaria consolidada.',
    accent: true,
  });

  renderMachineSpotlight(document.getElementById('dailyBuildingGoal'), data.machines);
  renderComparisonList(
    document.getElementById('dailyWorksComparison'),
    data.top_works.slice(0, 5).map((work) => ({
      label: work.obra_name,
      subLabel: `${work.goal_estacas || 0} de meta no dia`,
      value: work.realized_estacas,
      sideValue: `${work.realized_estacas} estacas`,
    })),
    {
      kicker: 'Obra',
      emptyText: 'Nenhuma obra em destaque.',
    }
  );

  document.getElementById('dailyMachineCards').innerHTML = data.machines.map(machineCard).join('');
  document.getElementById('dailyTimeline').innerHTML = data.timeline.length
    ? data.timeline.map(timelineCard).join('')
    : '<p class="inline-feedback">Nenhum evento registrado para o dia selecionado.</p>';

  return data;
}
