(function () {
  const POLL_INTERVAL_MS = 10000;
  const NEW_HIGHLIGHT_DURATION_MS = 4000;

  const MATCH_GROUPS_COOKIE = 'helloview_match_groups_collapsed';

  const state = {
    data: null,
    bracketsData: null,
    matchIdsByBracket: { swiss: new Set(), elite: new Set(), amateur: new Set() },
    bracketSection: '',
    matchId: '',
    teamName: '',
    playerSearchQuery: '',
    teamSearchQuery: '',
    previousMatchIds: new Set(),
    filtersInited: false,
    lastUpdated: null,
    collapsedMatchGroups: new Set()
  };

  function getMatchGroupKey(m) {
    return (m.name || m.label || '').trim() || 'Match';
  }

  function loadCollapsedMatchGroups() {
    try {
      const raw = document.cookie.split(';').find((c) => c.trim().startsWith(MATCH_GROUPS_COOKIE + '='));
      if (!raw) return;
      const value = decodeURIComponent(raw.split('=').slice(1).join('=').trim());
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) state.collapsedMatchGroups = new Set(arr);
    } catch (_) {}
  }

  function saveCollapsedMatchGroups() {
    const arr = [...state.collapsedMatchGroups];
    document.cookie = MATCH_GROUPS_COOKIE + '=' + encodeURIComponent(JSON.stringify(arr)) + ';path=/;max-age=31536000;samesite=lax';
  }

  function toggleMatchGroupCollapsed(groupKey) {
    if (state.collapsedMatchGroups.has(groupKey)) state.collapsedMatchGroups.delete(groupKey);
    else state.collapsedMatchGroups.add(groupKey);
    saveCollapsedMatchGroups();
  }

  loadCollapsedMatchGroups();

  const $ = (id) => document.getElementById(id);
  const tableBody = (id) => document.querySelector(`#${id} tbody`);
  const OVERLAY_IDS = ['match-overlay', 'player-overlay', 'team-overlay'];
  function bringOverlayToFront(overlayEl) {
    OVERLAY_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('overlay-on-top', el === overlayEl);
    });
  }
  const bracketSelect = $('filter-bracket');
  const matchSelect = $('filter-match');
  const teamSelect = $('filter-team');

  function getMatchIdsByBracket(bracketsData) {
    const swiss = new Set();
    const elite = new Set();
    const amateur = new Set();
    if (!bracketsData) return { swiss, elite, amateur };
    (bracketsData.swiss?.rounds || []).forEach((r) => (r.matches || []).forEach((m) => { if (m.demoId) swiss.add(m.demoId); }));
    (bracketsData.elite?.rounds || []).forEach((r) => (r.matches || []).forEach((m) => { if (m.demoId) elite.add(m.demoId); }));
    (bracketsData.elite?.lowerRounds || []).forEach((r) => (r.matches || []).forEach((m) => { if (m.demoId) elite.add(m.demoId); }));
    (bracketsData.amateur?.rounds || []).forEach((r) => (r.matches || []).forEach((m) => { if (m.demoId) amateur.add(m.demoId); }));
    (bracketsData.amateur?.lowerRounds || []).forEach((r) => (r.matches || []).forEach((m) => { if (m.demoId) amateur.add(m.demoId); }));
    return { swiss, elite, amateur };
  }

  function getMatchIdsForCurrentBracket() {
    if (!state.bracketSection) return null;
    return state.matchIdsByBracket[state.bracketSection] || null;
  }

  const FILTER_PARAMS = { bracket: 'bracket', match: 'match', team: 'team', autoScroll: 'autoScroll' };

  function applyFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const bracket = params.get(FILTER_PARAMS.bracket);
    if (bracket === 'swiss' || bracket === 'elite' || bracket === 'amateur') state.bracketSection = bracket;
    const match = params.get(FILTER_PARAMS.match);
    if (match && match.trim()) state.matchId = match.trim();
    const team = params.get(FILTER_PARAMS.team);
    if (team) state.teamName = decodeURIComponent(team);
  }

  function syncFiltersToUrl() {
    const params = new URLSearchParams();
    if (state.bracketSection) params.set(FILTER_PARAMS.bracket, state.bracketSection);
    if (state.matchId) params.set(FILTER_PARAMS.match, state.matchId);
    if (state.teamName) params.set(FILTER_PARAMS.team, encodeURIComponent(state.teamName));
    const toggleEl = $('auto-scroll-toggle');
    if (toggleEl && toggleEl.checked) params.set(FILTER_PARAMS.autoScroll, '1');
    const qs = params.toString();
    const url = qs ? window.location.pathname + '?' + qs : window.location.pathname;
    history.replaceState(null, '', url);
  }

  function hasActiveFilters() {
    return !!(state.bracketSection || state.matchId || state.teamName);
  }

  function clearAllFilters() {
    state.bracketSection = '';
    state.matchId = '';
    state.teamName = '';
    if (bracketSelect) bracketSelect.value = '';
    updateFiltersFromData([]);
    syncFiltersToUrl();
    render();
  }

  function updateClearFiltersButton() {
    const btn = $('btn-clear-filters');
    if (!btn) return;
    if (hasActiveFilters()) btn.classList.remove('hidden');
    else btn.classList.add('hidden');
  }

  function formatNum(n, decimals = 2) {
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toFixed(decimals);
  }

  function rating2Class(r) {
    if (r == null || Number.isNaN(r)) return '';
    if (r >= 1.05) return 'rating-high';
    if (r >= 0.9) return 'rating-mid';
    return 'rating-low';
  }

  function teamLogoHtml(teamName, logoUrlOrTeams, sizeClass) {
    return window.HelloView && window.HelloView.teamLogoHtml ? window.HelloView.teamLogoHtml(teamName, logoUrlOrTeams != null ? logoUrlOrTeams : (state.data && state.data.teams), sizeClass) : '';
  }

  function getMatchLabel(checksum) {
    if (!state.data) return '';
    const m = state.data.matches.find((x) => x.id === checksum);
    return m ? (m.name || m.label) : checksum.slice(0, 8);
  }

  function getMatchListLabel(m) {
    const name = (m.name || m.label) || 'Match';
    const teamA = (m.team_a_name || '').trim() || '—';
    const teamB = (m.team_b_name || '').trim() || '—';
    return `${name} · ${teamA} vs ${teamB}`;
  }

  function getNewMatchIds(newMatches) {
    const newIds = new Set((newMatches || []).map(m => m.id));
    const previous = state.previousMatchIds;
    const added = [...newIds].filter(id => !previous.has(id));
    state.previousMatchIds = newIds;
    return added;
  }

  function getMatchesForMatchSelect() {
    if (!state.data || !state.data.matches) return [];
    let matches = state.data.matches;
    const bracketSet = getMatchIdsForCurrentBracket();
    if (bracketSet !== null) {
      if (bracketSet.size === 0) return [];
      matches = matches.filter((m) => bracketSet.has(m.id));
    }
    return matches;
  }

  function updateFiltersFromData(newMatchIds) {
    if (!state.data || !matchSelect || !teamSelect) return;
    const { players } = state.data;
    const newSet = new Set(newMatchIds || []);
    const matches = getMatchesForMatchSelect();

    matchSelect.innerHTML = '<option value="">Tous les matchs</option>';
    matches.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = getMatchListLabel(m);
      if (newSet.has(m.id)) opt.className = 'match-new';
      matchSelect.appendChild(opt);
    });
    const matchIdsInList = new Set(matches.map((m) => m.id));
    if (state.matchId && !matchIdsInList.has(state.matchId)) state.matchId = '';
    matchSelect.value = state.matchId;

    teamSelect.innerHTML = '<option value="">Toutes</option>';
    const teams = [...new Set((players || []).map(p => p.team_name))].filter(Boolean).sort();
    teams.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      teamSelect.appendChild(opt);
    });
    teamSelect.value = state.teamName;
  }

  function applyDataUpdatedEffect() {
    const wrap1 = document.querySelector('.split-pane-players .table-wrap');
    const wrap2 = document.querySelector('.split-pane-teams .table-wrap');
    [wrap1, wrap2].forEach(el => { if (el) el.classList.add('data-updated'); });
    setTimeout(() => {
      [wrap1, wrap2].forEach(el => { if (el) el.classList.remove('data-updated'); });
    }, 1200);
  }

  function setNewMatchesBadge(show) {
    const badge = $('new-matches-badge');
    const wrap = document.querySelector('.filter-match-wrap');
    if (badge) badge.classList.toggle('visible', !!show);
    if (wrap) wrap.classList.toggle('has-new', !!show);
  }

  function removeNewMatchHighlight() {
    matchSelect.querySelectorAll('.match-new').forEach(opt => opt.classList.remove('match-new'));
    setNewMatchesBadge(false);
  }

  function loadData() {
    const apiUrl = (typeof window !== 'undefined' && window.HELLOVIEW_API_URL) || '/api/stats';
    const statsPromise = fetch(apiUrl).then((r) => {
      if (!r.ok) throw new Error('Données introuvables');
      return r.json();
    });
    const bracketsPromise = fetch('/api/brackets').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return Promise.all([statsPromise, bracketsPromise])
      .then(([json, bracketsData]) => {
        const newMatchIds = getNewMatchIds(json.matches);
        state.data = json;
        state.bracketsData = bracketsData;
        state.matchIdsByBracket = getMatchIdsByBracket(bracketsData);
        state.lastUpdated = new Date();
        applyFiltersFromUrl();
        updateFooterDate();
        if (!state.filtersInited) {
          initFilters();
          state.filtersInited = true;
          renderMatchList();
        } else {
          updateFiltersFromData(newMatchIds);
          applyDataUpdatedEffect();
          if (newMatchIds.length > 0) {
            setNewMatchesBadge(true);
            setTimeout(removeNewMatchHighlight, NEW_HIGHLIGHT_DURATION_MS);
          }
        }
        renderMatchList();
        render();
        const params = new URLSearchParams(window.location.search);
        const playerId = params.get('player');
        if (playerId) {
          openPlayerOverlay(playerId);
          history.replaceState({}, '', window.location.pathname);
        }
      })
      .catch((err) => {
        console.error(err);
        if (!document.querySelector('.error')) {
          document.body.insertAdjacentHTML('beforeend',
            '<p class="error" style="padding:2rem;color:#ef4444;">Impossible de charger les données. Lancez le serveur avec <code>npm start</code> (connexion PostgreSQL via .env).</p>');
        }
      });
  }

  function initFilters() {
    const { players } = state.data;
    const matches = getMatchesForMatchSelect();
    matchSelect.innerHTML = '<option value="">Tous les matchs</option>';
    matches.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = getMatchListLabel(m);
      matchSelect.appendChild(opt);
    });
    teamSelect.innerHTML = '<option value="">Toutes</option>';
    const teams = [...new Set((players || []).map(p => p.team_name))].filter(Boolean).sort();
    teams.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      teamSelect.appendChild(opt);
    });
    const matchOpts = Array.from(matchSelect.options).map((o) => o.value);
    const teamOpts = Array.from(teamSelect.options).map((o) => o.value);
    if (state.matchId && !matchOpts.includes(state.matchId)) state.matchId = '';
    if (state.teamName && !teamOpts.includes(state.teamName)) state.teamName = '';
    matchSelect.value = state.matchId || '';
    teamSelect.value = state.teamName || '';
    if (bracketSelect) {
      bracketSelect.value = state.bracketSection || '';
      bracketSelect.addEventListener('change', () => {
        state.bracketSection = bracketSelect.value || '';
        const matchIdsInList = getMatchIdsForCurrentBracket();
        if (state.matchId && matchIdsInList && !matchIdsInList.has(state.matchId)) state.matchId = '';
        updateFiltersFromData([]);
        syncFiltersToUrl();
        render();
      });
    }
    matchSelect.addEventListener('change', () => { state.matchId = matchSelect.value; syncFiltersToUrl(); render(); });
    teamSelect.addEventListener('change', () => { state.teamName = teamSelect.value; syncFiltersToUrl(); render(); });
    const clearBtn = $('btn-clear-filters');
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);
  }

  function getFilteredRows() {
    if (!state.data) return [];
    let list = state.data.players.slice();
    const bracketSet = getMatchIdsForCurrentBracket();
    if (bracketSet !== null) {
      if (bracketSet.size === 0) return [];
      list = list.filter((p) => p.match_checksum && bracketSet.has(p.match_checksum));
    }
    if (state.matchId) list = list.filter((p) => p.match_checksum === state.matchId);
    if (state.teamName) list = list.filter((p) => p.team_name === state.teamName);
    return list;
  }

  /**
   * Classement équipes : Nom, nombre de matchs, W/L, W/L %.
   * Win/Loss déduit de wins_count (1 = victoire du match pour l’équipe).
   */
  function getTeamRanking(rows) {
    const byTeamMatch = {};
    rows.forEach((p) => {
      const key = `${p.team_name}|${p.match_checksum}`;
      if (!byTeamMatch[key]) {
        byTeamMatch[key] = {
          team_name: p.team_name,
          match_checksum: p.match_checksum,
          win: (p.wins_count ?? 0) >= 1
        };
      }
    });

    const byTeam = {};
    Object.values(byTeamMatch).forEach((m) => {
      const name = m.team_name;
      if (!byTeam[name]) {
        byTeam[name] = { team_name: name, wins: 0, losses: 0 };
      }
      if (m.win) byTeam[name].wins += 1;
      else byTeam[name].losses += 1;
    });

    const teams = Object.values(byTeam).map((t) => {
      const total = t.wins + t.losses;
      const winsPct = total > 0 ? (t.wins / total) * 100 : null;
      return {
        team_name: t.team_name,
        matchCount: t.wins + t.losses,
        wins: t.wins,
        losses: t.losses,
        winsPct: winsPct
      };
    });

    return teams.sort((a, b) => (b.winsPct ?? 0) - (a.winsPct ?? 0));
  }

  function renderPlayers() {
    const rows = getFilteredRows();
    let ranking = (window.HelloView && window.HelloView.getPlayerRanking) ? window.HelloView.getPlayerRanking(rows) : [];
    const q = (state.playerSearchQuery || '').trim().toLowerCase();
    if (q) {
      ranking = ranking.filter((p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.team_name && p.team_name.toLowerCase().includes(q))
      );
    }
    const tbody = tableBody('table-players');
    if (!tbody) return;
    tbody.innerHTML = ranking
      .map(
        (p, i) =>
          `<tr class="player-row" data-steam-id="${escapeHtml(p.steam_id)}" role="button" tabindex="0">
            <td class="player-rank num">${i + 1}</td>
            <td class="player-cell">
              ${(p.custom_avatar_url || p.avatar_url) ? `<img class="player-avatar" src="${escapeHtml(p.custom_avatar_url || p.avatar_url)}" alt="" width="32" height="32">` : ''}
              <strong>${escapeHtml(p.name)}</strong>
            </td>
            <td class="player-team-cell">
              ${p.team_name ? `<span class="player-team-wrap"><span class="team-logo-tooltip-wrap">${teamLogoHtml(p.team_name, state.data && state.data.teams, 'team-logo-24')}<span class="team-name-tooltip">${escapeHtml(p.team_name)}</span></span><span class="player-team-name">${escapeHtml(p.team_name)}</span></span>` : '—'}
            </td>
            <td class="num">${p.kill_count}/${p.death_count}/${p.assist_count}</td>
            <td class="num">${formatNum(p.kd, 2)}</td>
            <td class="num">${formatNum(p.adr, 1)}</td>
            <td class="num score ${rating2Class(p.rating2)}">${formatNum(p.rating2, 2)}</td>
          </tr>`
      )
      .join('');
    tbody.querySelectorAll('.player-row').forEach((tr) => {
      tr.addEventListener('click', () => openPlayerOverlay(tr.dataset.steamId));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayerOverlay(tr.dataset.steamId); } });
    });
  }

  function renderTeams() {
    const rows = getFilteredRows();
    const bracketSet = getMatchIdsForCurrentBracket();
    let ranking;
    if (bracketSet !== null || state.matchId) {
      ranking = getTeamRanking(rows);
    } else if (state.data.teams && state.data.teams.length > 0) {
      ranking = state.teamName
        ? state.data.teams.filter(t => t.team_name === state.teamName)
        : state.data.teams.slice();
      ranking = ranking.sort((a, b) => (b.winsPct ?? 0) - (a.winsPct ?? 0));
    } else {
      ranking = getTeamRanking(rows);
    }
    const q = (state.teamSearchQuery || '').trim().toLowerCase();
    if (q) {
      ranking = ranking.filter((t) => t.team_name && t.team_name.toLowerCase().includes(q));
    }
    const tbody = tableBody('table-teams');
    if (!tbody) return;
    tbody.innerHTML = ranking
      .map(
        (t, i) =>
          `<tr class="team-row" data-team-name="${escapeHtml(t.team_name)}" role="button" tabindex="0">
            <td class="team-rank num">${i + 1}</td>
            <td class="team-cell">${teamLogoHtml(t.team_name, t.logo_url || (state.data && state.data.teams), 'team-logo-32')}<strong>${escapeHtml(t.team_name)}</strong></td>
            <td class="num">${t.matchCount}</td>
            <td class="num">${t.wins}/${t.losses}</td>
            <td class="num">${t.winsPct != null ? formatNum(t.winsPct, 1) + '%' : '—'}</td>
          </tr>`
      )
      .join('');
    tbody.querySelectorAll('.team-row').forEach((tr) => {
      tr.addEventListener('click', () => openTeamOverlay(tr.dataset.teamName));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTeamOverlay(tr.dataset.teamName); } });
    });
  }

  function render() {
    renderPlayers();
    renderTeams();
    updateClearFiltersButton();
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function updateHeaderDateTime() {
    const el = $('header-datetime');
    if (!el) return;
    const now = new Date();
    const day = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent = day + ' · ' + time;
  }

  function updateFooterDate() {
    const el = $('data-updated-at');
    if (!el) return;
    const d = state.lastUpdated;
    if (!d) {
      el.textContent = '—';
      return;
    }
    el.textContent = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function renderMatchList() {
    const list = $('side-panel-list');
    if (!list || !state.data || !state.data.matches) return;
    const matches = state.data.matches;
    const groups = {};
    matches.forEach((m) => {
      const key = getMatchGroupKey(m);
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });
    const groupKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    list.innerHTML = '';
    groupKeys.forEach((groupKey) => {
      const groupMatches = groups[groupKey];
      const isCollapsed = state.collapsedMatchGroups.has(groupKey);
      const section = document.createElement('li');
      section.className = 'side-panel-group';
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'side-panel-group-header';
      header.setAttribute('aria-expanded', !isCollapsed);
      header.innerHTML = '<span class="side-panel-group-title">' + escapeHtml(groupKey) + '</span><span class="side-panel-group-count">' + groupMatches.length + '</span>';
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMatchGroupCollapsed(groupKey);
        renderMatchList();
      });
      section.appendChild(header);
      const content = document.createElement('ul');
      content.className = 'side-panel-group-content' + (isCollapsed ? ' collapsed' : '');
      content.setAttribute('aria-hidden', isCollapsed);
      groupMatches.forEach((m) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'side-panel-item';
        btn.textContent = getMatchListLabel(m);
        btn.dataset.matchId = m.id;
        btn.addEventListener('click', (e) => { e.stopPropagation(); openMatchOverlay(m.id); });
        li.appendChild(btn);
        content.appendChild(li);
      });
      section.appendChild(content);
      list.appendChild(section);
    });
  }

  function toggleSidePanel() {
    const panel = $('side-panel');
    const toggle = $('side-panel-toggle');
    if (!panel || !toggle) return;
    const isOpen = panel.classList.toggle('open');
    toggle.setAttribute('aria-expanded', isOpen);
  }

  function closeSidePanel() {
    const panel = $('side-panel');
    const toggle = $('side-panel-toggle');
    if (panel) panel.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }

  function openMatchOverlay(checksum) {
    if (!state.data || !window.HelloView || !window.HelloView.openMatchOverlay) return;
    window.HelloView.openMatchOverlay(checksum, state.data, {
      onTeamClick(teamName) {
        openTeamOverlay(teamName);
      },
      onPlayerClick(steamId) {
        openPlayerOverlay(steamId);
      }
    });
  }

  function closeMatchOverlay() {
    if (window.HelloView && window.HelloView.closeMatchOverlay) window.HelloView.closeMatchOverlay();
    if (!anyOverlayOpen()) document.body.style.overflow = '';
  }

  function openPlayerOverlay(steamId) {
    if (!window.HelloView || !window.HelloView.openPlayerOverlay || !state.data) return;
    window.HelloView.openPlayerOverlay(steamId, state.data, {
      onMatchClick(checksum) {
        openMatchOverlay(checksum);
      },
      onTeamClick(teamName) {
        openTeamOverlay(teamName);
      }
    });
    bringOverlayToFront($('player-overlay'));
    document.body.style.overflow = 'hidden';
    $('player-overlay-close').focus();
  }

  function closePlayerOverlay() {
    if (window.HelloView && window.HelloView.closePlayerOverlay) window.HelloView.closePlayerOverlay();
    if (!anyOverlayOpen()) document.body.style.overflow = '';
  }

  function openTeamOverlay(teamName) {
    if (!state.data || !window.HelloView || !window.HelloView.openTeamOverlay) return;
    window.HelloView.openTeamOverlay(teamName, state.data, {
      onPlayerClick(steamId) {
        openPlayerOverlay(steamId);
      },
      onMatchClick(checksum) {
        openMatchOverlay(checksum);
      }
    });
  }

  function closeTeamOverlay() {
    if (window.HelloView && window.HelloView.closeTeamOverlay) window.HelloView.closeTeamOverlay();
    if (!anyOverlayOpen()) document.body.style.overflow = '';
  }

  function anyOverlayOpen() {
    const o = (id) => document.getElementById(id) && !document.getElementById(id).hasAttribute('hidden');
    return o('team-overlay') || o('player-overlay') || o('match-overlay');
  }

  loadData();
  updateHeaderDateTime();
  setInterval(updateHeaderDateTime, 1000);
  setInterval(loadData, POLL_INTERVAL_MS);

  const matchOverlay = $('match-overlay');
  const playerOverlay = $('player-overlay');
  const teamOverlay = $('team-overlay');
  const backdrop = $('overlay-backdrop');
  const overlayClose = $('overlay-close');
  const playerBackdrop = $('player-overlay-backdrop');
  const playerOverlayClose = $('player-overlay-close');
  const teamBackdrop = $('team-overlay-backdrop');
  const teamOverlayClose = $('team-overlay-close');
  if (backdrop) backdrop.addEventListener('click', closeMatchOverlay);
  if (overlayClose) overlayClose.addEventListener('click', closeMatchOverlay);
  if (playerBackdrop) playerBackdrop.addEventListener('click', closePlayerOverlay);
  if (playerOverlayClose) playerOverlayClose.addEventListener('click', closePlayerOverlay);
  if (teamBackdrop) teamBackdrop.addEventListener('click', closeTeamOverlay);
  if (teamOverlayClose) teamOverlayClose.addEventListener('click', closeTeamOverlay);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const front = [teamOverlay, playerOverlay, matchOverlay].find(
        (el) => el && !el.hasAttribute('hidden') && el.classList.contains('overlay-on-top')
      );
      if (front === teamOverlay) closeTeamOverlay();
      else if (front === playerOverlay) closePlayerOverlay();
      else if (front === matchOverlay) closeMatchOverlay();
      else if (teamOverlay && !teamOverlay.hasAttribute('hidden')) closeTeamOverlay();
      else if (playerOverlay && !playerOverlay.hasAttribute('hidden')) closePlayerOverlay();
      else if (matchOverlay && !matchOverlay.hasAttribute('hidden')) closeMatchOverlay();
      else closeSidePanel();
    }
  });

  const sidePanelToggle = $('side-panel-toggle');
  const sidePanelClose = $('side-panel-close');
  const sidePanel = $('side-panel');
  const sidePanelHotzone = $('side-panel-hotzone');
  if (sidePanelToggle) sidePanelToggle.addEventListener('click', toggleSidePanel);
  if (sidePanelClose) sidePanelClose.addEventListener('click', closeSidePanel);
  if (sidePanelHotzone) {
    sidePanelHotzone.addEventListener('mouseenter', () => {
      if (sidePanel && !sidePanel.classList.contains('open')) {
        sidePanel.classList.add('open');
        if (sidePanelToggle) sidePanelToggle.setAttribute('aria-expanded', 'true');
      }
    });
  }
  if (sidePanel) {
    sidePanel.addEventListener('mouseleave', (e) => {
      if (e.relatedTarget && sidePanelToggle && (e.relatedTarget === sidePanelToggle || sidePanelToggle.contains(e.relatedTarget))) return;
      if (e.relatedTarget && sidePanelHotzone && (e.relatedTarget === sidePanelHotzone || sidePanelHotzone.contains(e.relatedTarget))) return;
      closeSidePanel();
    });
  }

  const searchPlayersEl = $('search-players');
  const searchTeamsEl = $('search-teams');
  if (searchPlayersEl) searchPlayersEl.addEventListener('input', () => { state.playerSearchQuery = searchPlayersEl.value; render(); });
  if (searchTeamsEl) searchTeamsEl.addEventListener('input', () => { state.teamSearchQuery = searchTeamsEl.value; render(); });

  (function initAutoScroll() {
    const SCROLL_SPEED = 18;
    const STEP_MS = 50;
    const COOKIE_NAME = 'helloview_autoscroll';
    const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

    function getAutoScrollCookie() {
      const match = document.cookie.match(new RegExp('(?:^|; )' + encodeURIComponent(COOKIE_NAME) + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    }
    function setAutoScrollCookie(enabled) {
      document.cookie = encodeURIComponent(COOKIE_NAME) + '=' + (enabled ? '1' : '0') + '; path=/; max-age=' + COOKIE_MAX_AGE + '; SameSite=Lax';
    }

    const urlAuto = new URLSearchParams(window.location.search).get('autoScroll');
    let autoScrollEnabled = urlAuto === '1';
    if (urlAuto !== '1' && urlAuto !== '0') autoScrollEnabled = getAutoScrollCookie() === '1';
    const toggleEl = $('auto-scroll-toggle');
    if (toggleEl) {
      toggleEl.checked = autoScrollEnabled;
      toggleEl.setAttribute('aria-checked', String(autoScrollEnabled));
    }

    function setupAutoScroll(wrap) {
      if (!wrap) return;
      const state = { direction: 1, paused: false, lastStep: 0, rafId: null };
      function step(now) {
        state.rafId = requestAnimationFrame(step);
        if (!autoScrollEnabled || state.paused) return;
        if (!state.lastStep) state.lastStep = now;
        const elapsed = now - state.lastStep;
        if (elapsed < STEP_MS) return;
        state.lastStep = now;
        const max = wrap.scrollHeight - wrap.clientHeight;
        if (max <= 0) return;
        const delta = (elapsed / 1000) * SCROLL_SPEED * state.direction;
        let next = wrap.scrollTop + delta;
        if (next >= max) {
          next = max;
          state.direction = -1;
        } else if (next <= 0) {
          next = 0;
          state.direction = 1;
        }
        wrap.scrollTop = next;
      }
      state.rafId = requestAnimationFrame(step);
      wrap.addEventListener('mouseenter', () => { state.paused = true; });
      wrap.addEventListener('mouseleave', () => { state.paused = false; });
      wrap.addEventListener('focusin', () => { state.paused = true; });
      wrap.addEventListener('focusout', () => { state.paused = false; });
    }
    setupAutoScroll(document.querySelector('#view-players .table-wrap'));
    setupAutoScroll(document.querySelector('#view-teams .table-wrap'));

    if (toggleEl) {
      toggleEl.addEventListener('change', () => {
        autoScrollEnabled = toggleEl.checked;
        toggleEl.setAttribute('aria-checked', String(toggleEl.checked));
        setAutoScrollCookie(autoScrollEnabled);
        syncFiltersToUrl();
      });
    }
  })();
})();
