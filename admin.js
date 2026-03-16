/**
 * Panel admin HelloView — auth, page Joueurs (liste, recherche, upload avatar par steamid).
 */

(function () {
  const ADMIN_STORAGE_KEY = 'helloview-admin-token';
  let cachedPlayers = [];
  let cachedTeams = [];
  let currentSearch = '';
  let currentSort = 'name-asc';
  let currentTeamSearch = '';

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const t = document.createElement('textarea');
    t.textContent = s;
    return t.innerHTML;
  }

  function getToken() {
    return sessionStorage.getItem(ADMIN_STORAGE_KEY);
  }

  function setToken(token) {
    if (token) sessionStorage.setItem(ADMIN_STORAGE_KEY, token);
    else sessionStorage.removeItem(ADMIN_STORAGE_KEY);
  }

  function showLogin() {
    $('admin-login-wrap').classList.remove('hidden');
    $('admin-app').classList.add('hidden');
  }

  function showApp() {
    $('admin-login-wrap').classList.add('hidden');
    $('admin-app').classList.remove('hidden');
  }

  function sortPlayers(players) {
    const list = [...players];
    const nameA = (a, b) => (a.name || '').localeCompare(b.name || '', 'fr');
    const teamA = (a, b) => (a.team_name || '').localeCompare(b.team_name || '', 'fr');
    const hasPhoto = (p) => !!(p.custom_avatar_url);
    switch (currentSort) {
      case 'name-asc':
        list.sort(nameA);
        break;
      case 'name-desc':
        list.sort((a, b) => -nameA(a, b));
        break;
      case 'photo-yes':
        list.sort((a, b) => (hasPhoto(b) ? 1 : 0) - (hasPhoto(a) ? 1 : 0) || nameA(a, b));
        break;
      case 'photo-no':
        list.sort((a, b) => (hasPhoto(a) ? 1 : 0) - (hasPhoto(b) ? 1 : 0) || nameA(a, b));
        break;
      case 'team-asc':
        list.sort((a, b) => teamA(a, b) || nameA(a, b));
        break;
      case 'team-desc':
        list.sort((a, b) => -teamA(a, b) || nameA(a, b));
        break;
      default:
        list.sort(nameA);
    }
    return list;
  }

  function renderPlayersList(players, searchQuery) {
    const list = $('admin-players-list');
    const loading = $('admin-players-loading');
    const errEl = $('admin-players-error');
    loading.classList.add('hidden');
    errEl.classList.add('hidden');
    list.classList.remove('hidden');

    const q = (searchQuery || '').toLowerCase().trim();
    let filtered = q
      ? players.filter((p) => {
          const name = (p.name || '').toLowerCase();
          const team = (p.team_name || '').toLowerCase();
          const steam = (p.steam_id || '').toLowerCase();
          return name.includes(q) || team.includes(q) || steam.includes(q);
        })
      : players;
    filtered = sortPlayers(filtered);

    list.innerHTML = '';
    filtered.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'admin-player-card';
      const customUrl = p.custom_avatar_url;
      const avatarUrl = customUrl || p.avatar_url || p.avatarfull_url;
      const steamId = p.steam_id || '';
      const name = p.name || '—';
      const team = p.team_name || '—';
      const avatarHtml = avatarUrl
        ? '<img class="admin-player-avatar" src="' + escapeHtml(avatarUrl) + '" alt="">'
        : '<div class="admin-player-avatar-placeholder" aria-hidden="true">?</div>';
      const deleteBtn = customUrl
        ? '<button type="button" class="admin-delete-avatar-btn" data-steamid="' + escapeHtml(steamId) + '" title="Supprimer la photo">Supprimer photo</button>'
        : '';
      li.innerHTML =
        '<div class="admin-player-avatar-wrap">' + avatarHtml + '</div>' +
        '<div class="admin-player-info">' +
        '<p class="admin-player-name">' + escapeHtml(name) + '</p>' +
        '<p class="admin-player-meta">' + escapeHtml(team) + ' · <span class="admin-player-steamid">' + escapeHtml(steamId) + '</span></p>' +
        '</div>' +
        '<div class="admin-player-upload">' +
        deleteBtn +
        '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-steamid="' + escapeHtml(steamId) + '" aria-label="Choisir une photo">' +
        '<button type="button" class="admin-upload-btn" data-steamid="' + escapeHtml(steamId) + '">Envoyer photo</button>' +
        '<span class="admin-upload-status" data-steamid="' + escapeHtml(steamId) + '" aria-live="polite"></span>' +
        '</div>';
      list.appendChild(li);
    });

    list.querySelectorAll('.admin-delete-avatar-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const steamId = btn.dataset.steamid;
        if (!steamId) return;
        deleteAvatar(steamId, btn);
      });
    });

    list.querySelectorAll('.admin-player-upload input[type="file"]').forEach((input) => {
      const steamId = input.dataset.steamid;
      const btn = list.querySelector('.admin-upload-btn[data-steamid="' + steamId + '"]');
      const status = list.querySelector('.admin-upload-status[data-steamid="' + steamId + '"]');
      if (!btn) return;
      btn.addEventListener('click', () => {
        if (!input.files || input.files.length === 0) {
          status.textContent = 'Choisir un fichier d’abord';
          status.className = 'admin-upload-status error';
          return;
        }
        uploadAvatar(steamId, input.files[0], btn, status, () => {
          loadPlayers(currentSearch);
        });
      });
    });
  }

  function deleteAvatar(steamId, btnEl) {
    const token = getToken();
    if (!token || !steamId) return;
    const status = $('admin-players-list').querySelector('.admin-upload-status[data-steamid="' + steamId + '"]');
    if (btnEl) btnEl.disabled = true;
    if (status) { status.textContent = 'Suppression…'; status.className = 'admin-upload-status'; }

    fetch('/api/admin/avatar/' + encodeURIComponent(steamId), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || r.statusText)));
        return r.json();
      })
      .then(() => {
        loadPlayers(currentSearch);
      })
      .catch((err) => {
        if (status) { status.textContent = err.message || 'Erreur'; status.className = 'admin-upload-status error'; }
        if (btnEl) btnEl.disabled = false;
      });
  }

  function uploadAvatar(steamId, file, btn, statusEl, onSuccess) {
    const token = getToken();
    if (!token || !steamId) return;
    btn.disabled = true;
    statusEl.textContent = 'Envoi…';
    statusEl.className = 'admin-upload-status';

    const form = new FormData();
    form.append('avatar', file);

    fetch('/api/admin/avatar/' + encodeURIComponent(steamId), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || r.statusText)));
        return r.json();
      })
      .then(() => {
        statusEl.textContent = 'Enregistré';
        statusEl.className = 'admin-upload-status';
        if (onSuccess) onSuccess(cachedPlayers, currentSearch);
      })
      .catch((err) => {
        statusEl.textContent = err.message || 'Erreur';
        statusEl.className = 'admin-upload-status error';
      })
      .finally(() => {
        btn.disabled = false;
      });
  }

  function loadPlayers(searchQuery) {
    const loading = $('admin-players-loading');
    const errEl = $('admin-players-error');
    const list = $('admin-players-list');
    loading.classList.remove('hidden');
    errEl.classList.add('hidden');
    list.classList.add('hidden');

    fetch('/api/stats')
      .then((r) => {
        if (!r.ok) throw new Error('Erreur chargement stats');
        return r.json();
      })
      .then((data) => {
        const bySteam = new Map();
        (data.players || []).forEach((p) => {
          if (p.steam_id && !bySteam.has(p.steam_id)) {
            bySteam.set(p.steam_id, {
              steam_id: p.steam_id,
              name: p.name,
              team_name: p.team_name,
              avatar_url: p.avatar_url,
              avatarfull_url: p.avatarfull_url,
              custom_avatar_url: p.custom_avatar_url
            });
          }
        });
        cachedPlayers = Array.from(bySteam.values());
        currentSearch = searchQuery || '';
        const sortEl = $('admin-sort-players');
        if (sortEl) currentSort = sortEl.value || 'name-asc';
        renderPlayersList(cachedPlayers, currentSearch);
      })
      .catch((err) => {
        loading.classList.add('hidden');
        errEl.textContent = err.message || 'Impossible de charger les joueurs';
        errEl.classList.remove('hidden');
      });
  }

  function teamPlaceholderColor(teamName) {
    const palette = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#6366f1', '#84cc16'];
    let h = 0;
    const s = String(teamName || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
    return palette[Math.abs(h) % palette.length];
  }

  function renderTeamsList(teams, searchQuery) {
    const list = $('admin-teams-list');
    const loading = $('admin-teams-loading');
    const errEl = $('admin-teams-error');
    if (!list) return;
    loading.classList.add('hidden');
    errEl.classList.add('hidden');
    list.classList.remove('hidden');

    const q = (searchQuery || '').toLowerCase().trim();
    const filtered = q ? teams.filter((t) => (t.team_name || '').toLowerCase().includes(q)) : teams;

    list.innerHTML = '';
    filtered.forEach((t) => {
      const teamName = t.team_name || '—';
      const logoUrl = t.logo_url || null;
      const letter = (teamName !== '—' && teamName.length) ? teamName.charAt(0).toUpperCase() : '?';
      const bgColor = teamPlaceholderColor(teamName);
      const logoHtml = logoUrl
        ? '<img class="admin-team-logo" src="' + escapeHtml(logoUrl) + '" alt="">'
        : '<div class="admin-team-logo-placeholder" style="background:' + escapeHtml(bgColor) + '">' + escapeHtml(letter) + '</div>';
      const deleteBtn = logoUrl
        ? '<button type="button" class="admin-delete-logo-btn" data-team="' + escapeHtml(teamName) + '" title="Supprimer le logo">Supprimer logo</button>'
        : '';
      const li = document.createElement('li');
      li.className = 'admin-team-card';
      li.innerHTML =
        '<div class="admin-team-logo-wrap">' + logoHtml + '</div>' +
        '<div class="admin-team-info">' +
        '<p class="admin-team-name">' + escapeHtml(teamName) + '</p>' +
        '</div>' +
        '<div class="admin-team-upload">' +
        deleteBtn +
        '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-team="' + escapeHtml(teamName) + '" aria-label="Choisir un logo">' +
        '<button type="button" class="admin-upload-btn" data-team="' + escapeHtml(teamName) + '">Envoyer logo</button>' +
        '<span class="admin-upload-status" data-team="' + escapeHtml(teamName) + '" aria-live="polite"></span>' +
        '</div>';
      list.appendChild(li);
    });

    list.querySelectorAll('.admin-delete-logo-btn').forEach((btn) => {
      btn.addEventListener('click', () => deleteTeamLogo(btn.dataset.team));
    });
    list.querySelectorAll('.admin-team-card').forEach((card) => {
      const teamName = card.querySelector('.admin-team-name');
      const input = card.querySelector('input[type="file"]');
      const btn = card.querySelector('.admin-upload-btn');
      const status = card.querySelector('.admin-upload-status');
      const name = teamName ? teamName.textContent : '';
      if (!btn || !input) return;
      btn.addEventListener('click', () => {
        if (!input.files || !input.files.length) {
          if (status) { status.textContent = 'Choisir un fichier d\'abord'; status.className = 'admin-upload-status error'; }
          return;
        }
        uploadTeamLogo(name, input.files[0], btn, status, () => loadTeams(currentTeamSearch));
      });
    });
  }

  function uploadTeamLogo(teamName, file, btnEl, statusEl, onSuccess) {
    const token = getToken();
    if (!token || !teamName) return;
    btnEl.disabled = true;
    if (statusEl) { statusEl.textContent = 'Envoi…'; statusEl.className = 'admin-upload-status'; }
    const form = new FormData();
    form.append('logo', file);
    fetch('/api/admin/team-logo/' + encodeURIComponent(teamName), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form
    })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || r.statusText)));
        return r.json();
      })
      .then(() => {
        if (statusEl) { statusEl.textContent = 'Enregistré'; statusEl.className = 'admin-upload-status'; }
        onSuccess();
      })
      .catch((err) => {
        if (statusEl) { statusEl.textContent = err.message || 'Erreur'; statusEl.className = 'admin-upload-status error'; }
      })
      .finally(() => { btnEl.disabled = false; });
  }

  function deleteTeamLogo(teamName) {
    const token = getToken();
    if (!token || !teamName) return;
    fetch('/api/admin/team-logo/' + encodeURIComponent(teamName), { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(new Error(d.error || r.statusText)));
        return r.json();
      })
      .then(() => loadTeams(currentTeamSearch))
      .catch((err) => alert(err.message || 'Erreur'));
  }

  function loadTeams(searchQuery) {
    const loading = $('admin-teams-loading');
    const errEl = $('admin-teams-error');
    const list = $('admin-teams-list');
    if (!loading || !list) return;
    loading.classList.remove('hidden');
    errEl.classList.add('hidden');
    list.classList.add('hidden');
    fetch('/api/stats')
      .then((r) => { if (!r.ok) throw new Error('Erreur stats'); return r.json(); })
      .then((data) => {
        cachedTeams = (data.teams || []).slice();
        currentTeamSearch = searchQuery || '';
        renderTeamsList(cachedTeams, currentTeamSearch);
      })
      .catch((err) => {
        loading.classList.add('hidden');
        errEl.textContent = err.message || 'Impossible de charger les équipes';
        errEl.classList.remove('hidden');
      });
  }

  function showPage(page) {
    document.querySelectorAll('.admin-page').forEach((el) => el.classList.add('hidden'));
    const el = page === 'joueurs' ? $('admin-page-joueurs') : page === 'equipes' ? $('admin-page-equipes') : null;
    if (el) el.classList.remove('hidden');
  }

  function init() {
    const token = getToken();
    if (!token) {
      showLogin();
      return;
    }
    showApp();
    loadPlayers();

    $('admin-search-players').addEventListener('input', (e) => {
      currentSearch = e.target.value.trim();
      renderPlayersList(cachedPlayers, currentSearch);
    });

    const sortSelect = $('admin-sort-players');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        currentSort = sortSelect.value;
        renderPlayersList(cachedPlayers, currentSearch);
      });
    }

    const searchTeams = $('admin-search-teams');
    if (searchTeams) searchTeams.addEventListener('input', (e) => {
      currentTeamSearch = e.target.value.trim();
      renderTeamsList(cachedTeams, currentTeamSearch);
    });
  }

  $('admin-login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = ($('admin-password') || {}).value || '';
    const errEl = $('admin-login-error');
    errEl.classList.add('hidden');
    errEl.textContent = '';

    fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.token) {
          setToken(data.token);
          showApp();
          loadPlayers();
        } else {
          errEl.textContent = data.error || 'Erreur';
          errEl.classList.remove('hidden');
        }
      })
      .catch(() => {
        errEl.textContent = 'Erreur réseau';
        errEl.classList.remove('hidden');
      });
  });

  function doLogout() {
    setToken(null);
    showLogin();
  }
  if ($('admin-logout')) $('admin-logout').addEventListener('click', doLogout);
  if ($('admin-logout-header')) $('admin-logout-header').addEventListener('click', doLogout);

  document.querySelectorAll('.admin-nav-item[data-page]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.admin-nav-item[data-page]').forEach((x) => x.classList.remove('admin-nav-item-active'));
      a.classList.add('admin-nav-item-active');
      const page = a.dataset.page;
      showPage(page);
      if (page === 'joueurs') loadPlayers(($('admin-search-players') || {}).value || '');
      if (page === 'equipes') loadTeams(($('admin-search-teams') || {}).value || '');
    });
  });

  if (document.location.hash === '#equipes') {
    document.querySelectorAll('.admin-nav-item[data-page]').forEach((x) => x.classList.remove('admin-nav-item-active'));
    const eq = document.querySelector('.admin-nav-item[data-page="equipes"]');
    if (eq) eq.classList.add('admin-nav-item-active');
  }
  if (document.location.hash !== '#joueurs' && document.location.hash !== '#equipes') {
    document.location.hash = 'joueurs';
  }
  init();
  if (document.location.hash === '#equipes') {
    showPage('equipes');
    loadTeams();
  } else {
    showPage('joueurs');
  }
})();
