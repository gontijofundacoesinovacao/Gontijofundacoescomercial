function getApiBaseUrl() {
  const configured = window.__APP_CONFIG__?.apiBaseUrl || '';
  return String(configured).replace(/\/+$/, '');
}

function buildApiUrl(path) {
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${path}` : path;
}

async function request(path, options = {}) {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.details || data?.message || `Erro HTTP ${response.status}`);
  }

  return data;
}

export const api = {
  getHealth() {
    return request('/api/health');
  },
  getDaily(params) {
    return request(`/api/dashboard/daily?${new URLSearchParams(params).toString()}`);
  },
  getWeekly(params) {
    return request(`/api/dashboard/weekly?${new URLSearchParams(params).toString()}`);
  },
  getSecondary(params) {
    return request(`/api/dashboard/secondary?${new URLSearchParams(params).toString()}`);
  },
  getDisplayConfig(screen) {
    return request(`/api/display/config?${new URLSearchParams({ screen }).toString()}`);
  },
  getAdminStatus() {
    return request('/api/admin/status');
  },
  loginAdmin(password) {
    return request('/api/admin/session', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },
  logoutAdmin() {
    return request('/api/admin/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  getAdminMachines() {
    return request('/api/admin/machines');
  },
  getAdminMappings(includeInactive) {
    return request(`/api/admin/mappings?${new URLSearchParams({ includeInactive: String(includeInactive) }).toString()}`);
  },
  createMapping(payload) {
    return request('/api/admin/mappings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateMapping(id, payload) {
    return request(`/api/admin/mappings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  activateMapping(id) {
    return request(`/api/admin/mappings/${id}/activate`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
  archiveMapping(id) {
    return request(`/api/admin/mappings/${id}/archive`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
};
