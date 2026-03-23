const STORAGE_KEY = 'gontijo_dashboard_v2';
const listeners = new Set();

function todayString() {
  return new Date().toLocaleDateString('en-CA');
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function weekValueFromDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day + 3);
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  const weekNumber = 1 + Math.round((date - firstThursday) / 604800000);
  return `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

function loadStored() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

const stored = loadStored();
const currentDate = todayString();
const shouldUseCurrentDate = !isIsoDate(stored.date) || stored.date !== currentDate;
const initialDate = shouldUseCurrentDate ? currentDate : stored.date;
const initialWeekInput =
  shouldUseCurrentDate || !stored.weekInput ? weekValueFromDate(initialDate) : stored.weekInput;

const state = {
  activeView: 'daily',
  clientLogin: stored.clientLogin || 'cgontijo',
  date: initialDate,
  weekInput: initialWeekInput,
  screen: new URLSearchParams(window.location.search).get('screen') || '',
};

function persist() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      clientLogin: state.clientLogin,
      date: state.date,
      weekInput: state.weekInput,
    })
  );
}

export function getState() {
  return { ...state };
}

export function setState(updates) {
  Object.assign(state, updates);
  persist();
  listeners.forEach((listener) => listener(getState()));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWeekStartFromInput(value) {
  const match = String(value || '').match(/^(\d{4})-W(\d{2})$/);
  if (!match) return '';
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

export function getFriendlyWeekRange(weekInput) {
  const weekStart = getWeekStartFromInput(weekInput);
  if (!weekStart) return '-';
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString('pt-BR')} - ${end.toLocaleDateString('pt-BR')}`;
}
