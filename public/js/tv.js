import { api } from './api.js';
import { renderDailyView } from './daily.js';
import { renderWeeklyView } from './weekly.js';
import { renderSecondaryView } from './secondary.js';

function showOnly(viewId) {
  document.querySelectorAll('.view-section').forEach((section) => {
    section.classList.toggle('is-active', section.id === viewId);
  });
}

export async function initTvMode(screen) {
  document.body.classList.add('tv-mode');
  document.body.dataset.screen = screen;
  document.getElementById('mainNav').classList.add('is-hidden');
  document.getElementById('controlPanel').classList.add('is-hidden');
  document.getElementById('refreshButton').classList.add('is-hidden');

  if (screen === 'primary-tv') {
    const config = await api.getDisplayConfig('primary');
    const renderers = [() => renderDailyView(), () => renderWeeklyView()];
    const views = ['dailyView', 'weeklyView'];
    let index = 0;

    async function rotate() {
      showOnly(views[index % views.length]);
      await renderers[index % renderers.length]();
      index += 1;
    }

    await rotate();
    setInterval(rotate, config.item.rotationSeconds * 1000);
    setInterval(() => window.location.reload(), config.item.autoRefreshSeconds * 1000);
    return;
  }

  if (screen === 'secondary-tv') {
    showOnly('secondaryView');
    await renderSecondaryView();
    const config = await api.getDisplayConfig('secondary');
    setInterval(() => renderSecondaryView(), config.item.rotationSeconds * 1000);
    setInterval(() => window.location.reload(), config.item.autoRefreshSeconds * 1000);
  }
}
