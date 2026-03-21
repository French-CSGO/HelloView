(function () {
  const POLL_INTERVAL_MS = 10000;
  const NEW_HIGHLIGHT_DURATION_MS = 4000;

  const MATCH_GROUPS_COOKIE = 'helloview_match_groups_collapsed';

  const state = {
    data: null,
    bracketsData: null,
    matchIdsByBracket: {},
    filterBrackets: [],
    filterMatches: [],
    filterTeams: [],
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
  let filterBracketSelectEl = null;
  let bracketFilterCombo = null;
  let filterTeamSelectEl = null;
  let teamFilterCombo = null;
  let filterMatchSelectEl = null;
  let matchFilterCombo = null;

  function collectDemoIdsFromTournament(t) {
    const set = new Set();
    const addFrom = (matches) => {
      (matches || []).forEach((m) => {
        if (!m) return;
        if (Array.isArray(m.demoIds) && m.demoIds.length) {
          m.demoIds.forEach((id) => { if (id) set.add(id); });
        } else if (m.demoId) set.add(m.demoId);
      });
    };
    if (!t) return set;
    if (t.type === 'swiss') {
      (t.rounds || []).forEach((r) => addFrom(r.matches));
    } else {
      (t.upperRounds || []).forEach((r) => addFrom(r.matches));
      (t.lowerRounds || []).forEach((r) => addFrom(r.matches));
      if (t.grandFinale) addFrom(t.grandFinale.matches);
    }
    return set;
  }

  function getMatchIdsByBracket(bracketsData) {
    const out = {};
    if (!bracketsData) return out;
    if (bracketsData.schemaVersion === 2 && Array.isArray(bracketsData.tournaments)) {
      bracketsData.tournaments.forEach((t) => {
        out[t.id] = collectDemoIdsFromTournament(t);
      });
      return out;
    }
    ['swiss', 'elite', 'amateur'].forEach((k) => { out[k] = new Set(); });
    (bracketsData.swiss?.rounds || []).forEach((r) => (r.matches || []).forEach((m) => { if (m.demoId) out.swiss.add(m.demoId); }));
    (bracketsData.elite?.rounds || []).forEach((r) => (r.matches || []).forEach((m) => { if (m.demoId) out.elite.add(m.demoId); }));
    (bracketsData.elite?.lowerRounds || []).forEach((r) => (r.matches || []).forEach((m) => { if (m.demoId) out.elite.add(m.demoId); }));
    (bracketsData.amateur?.rounds || []).forEach((r) => (r.matches || []).forEach((m) => { if (m.demoId) out.amateur.add(m.demoId); }));
    (bracketsData.amateur?.lowerRounds || []).forEach((r) => (r.matches || []).forEach((m) => { if (m.demoId) out.amateur.add(m.demoId); }));
    return out;
  }

  /** Union des demo ids des brackets sélectionnés ; null = aucun filtre bracket (tous les matchs). */
  function getUnionMatchIdsForSelectedBrackets() {
    if (!state.filterBrackets.length) return null;
    const union = new Set();
    state.filterBrackets.forEach((id) => {
      const s = state.matchIdsByBracket[id];
      if (s) s.forEach((x) => union.add(x));
    });
    return union;
  }

  function pruneMatchFiltersToBracketUnion() {
    const u = getUnionMatchIdsForSelectedBrackets();
    if (u === null) return;
    state.filterMatches = state.filterMatches.filter((id) => u.has(id));
  }

  const FILTER_PARAMS = {
    bracket: 'bracket',
    match: 'match',
    team: 'team',
    autoScroll: 'autoScroll',
    autoScrollPlayers: 'autoScrollPlayers',
    autoScrollTeams: 'autoScrollTeams'
  };
  const AUTOSCROLL_COOKIE = 'helloview_autoscroll';
  const AUTOSCROLL_PLAYERS_COOKIE = 'helloview_autoscroll_players';
  const AUTOSCROLL_TEAMS_COOKIE = 'helloview_autoscroll_teams';

  function getCookieValue(name) {
    try {
      const m = document.cookie.match(new RegExp('(?:^|; )' + encodeURIComponent(name) + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (_) {
      return null;
    }
  }

  /** Ancien paramètre URL : force les deux on/off. */
  function readLegacyAutoScrollUrlMode() {
    const u = new URLSearchParams(window.location.search).get(FILTER_PARAMS.autoScroll);
    if (u === '1') return 'both-on';
    if (u === '0') return 'both-off';
    return null;
  }

  function readAutoScrollPlayersEnabled() {
    const legacy = readLegacyAutoScrollUrlMode();
    if (legacy === 'both-on') return true;
    if (legacy === 'both-off') return false;
    const params = new URLSearchParams(window.location.search);
    const v = params.get(FILTER_PARAMS.autoScrollPlayers);
    if (v === '1') return true;
    if (v === '0') return false;
    const cp = getCookieValue(AUTOSCROLL_PLAYERS_COOKIE);
    if (cp === '1') return true;
    if (cp === '0') return false;
    if (getCookieValue(AUTOSCROLL_COOKIE) === '1') return true;
    return false;
  }

  function readAutoScrollTeamsEnabled() {
    const legacy = readLegacyAutoScrollUrlMode();
    if (legacy === 'both-on') return true;
    if (legacy === 'both-off') return false;
    const params = new URLSearchParams(window.location.search);
    const v = params.get(FILTER_PARAMS.autoScrollTeams);
    if (v === '1') return true;
    if (v === '0') return false;
    const ct = getCookieValue(AUTOSCROLL_TEAMS_COOKIE);
    if (ct === '1') return true;
    if (ct === '0') return false;
    if (getCookieValue(AUTOSCROLL_COOKIE) === '1') return true;
    return false;
  }

  function readAnyAutoScrollEnabled() {
    return readAutoScrollPlayersEnabled() || readAutoScrollTeamsEnabled();
  }

  function applyFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    state.filterBrackets = [];
    const bracketsMulti = params.getAll(FILTER_PARAMS.bracket).map((s) => s.trim()).filter(Boolean);
    if (bracketsMulti.length) state.filterBrackets = [...new Set(bracketsMulti)];
    else {
      const b = params.get(FILTER_PARAMS.bracket);
      if (b && b.trim()) state.filterBrackets = [b.trim()];
    }
    state.filterMatches = [];
    const matchesMulti = params.getAll(FILTER_PARAMS.match).map((s) => s.trim()).filter(Boolean);
    if (matchesMulti.length) state.filterMatches = [...new Set(matchesMulti)];
    else {
      const m = params.get(FILTER_PARAMS.match);
      if (m && m.trim()) state.filterMatches = [m.trim()];
    }
    state.filterTeams = [];
    const teamsMulti = params.getAll(FILTER_PARAMS.team).map((s) => String(s).trim()).filter(Boolean);
    if (teamsMulti.length) state.filterTeams = [...new Set(teamsMulti)];
    else {
      const t = params.get(FILTER_PARAMS.team);
      if (t && t.trim()) state.filterTeams = [t.trim()];
    }
  }

  function syncFiltersToUrl() {
    const params = new URLSearchParams();
    state.filterBrackets.forEach((id) => params.append(FILTER_PARAMS.bracket, id));
    state.filterMatches.forEach((id) => params.append(FILTER_PARAMS.match, id));
    state.filterTeams.forEach((name) => params.append(FILTER_PARAMS.team, name));
    const pT = $('auto-scroll-players-toggle');
    const tT = $('auto-scroll-teams-toggle');
    if (pT && pT.checked) params.set(FILTER_PARAMS.autoScrollPlayers, '1');
    if (tT && tT.checked) params.set(FILTER_PARAMS.autoScrollTeams, '1');
    const qs = params.toString();
    const url = qs ? window.location.pathname + '?' + qs : window.location.pathname;
    history.replaceState(null, '', url);
  }

  function hasActiveFilters() {
    return !!(state.filterBrackets.length || state.filterMatches.length || state.filterTeams.length);
  }

  function clearAllFilters() {
    state.filterBrackets = [];
    state.filterMatches = [];
    state.filterTeams = [];
    populateBracketFilterSelect();
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
    const bracketSet = getUnionMatchIdsForSelectedBrackets();
    if (bracketSet !== null) {
      if (bracketSet.size === 0) return [];
      matches = matches.filter((m) => bracketSet.has(m.id));
    }
    return matches;
  }

  function updateFiltersFromData(newMatchIds) {
    if (!state.data) return;
    const { players } = state.data;

    if (filterMatchSelectEl && matchFilterCombo) {
      const newSet = new Set(newMatchIds || []);
      const matches = getMatchesForMatchSelect();

      filterMatchSelectEl.innerHTML = '';
      matches.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = getMatchListLabel(m);
        if (newSet.has(m.id)) opt.className = 'match-new';
        opt.selected = state.filterMatches.includes(m.id);
        filterMatchSelectEl.appendChild(opt);
      });
      const matchIdsInList = new Set(matches.map((m) => m.id));
      state.filterMatches = state.filterMatches.filter((id) => matchIdsInList.has(id));
      matchFilterCombo.rebuildListFromSelect();
    }

    if (filterTeamSelectEl && teamFilterCombo) {
      filterTeamSelectEl.innerHTML = '';
      const teams = [...new Set((players || []).map(p => p.team_name))].filter(Boolean).sort();
      teams.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        opt.selected = state.filterTeams.includes(t);
        filterTeamSelectEl.appendChild(opt);
      });
      teamFilterCombo.rebuildListFromSelect();
    }
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
    if (filterMatchSelectEl) {
      filterMatchSelectEl.querySelectorAll('.match-new').forEach((opt) => opt.classList.remove('match-new'));
    }
    if (matchFilterCombo) matchFilterCombo.rebuildListFromSelect();
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
        applyFiltersFromUrl();
        if (state.filtersInited) populateBracketFilterSelect();
        state.lastUpdated = new Date();
        const autoscrollOn = readAnyAutoScrollEnabled();
        document.body.classList.toggle('autoscroll-active', autoscrollOn);
        if (autoscrollOn) closeSidePanel();
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

  function populateBracketFilterSelect() {
    if (!filterBracketSelectEl) return;
    filterBracketSelectEl.innerHTML = '';
    const bd = state.bracketsData;
    if (bd && bd.schemaVersion === 2 && Array.isArray(bd.tournaments)) {
      bd.tournaments.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.title || t.id;
        opt.selected = state.filterBrackets.includes(t.id);
        filterBracketSelectEl.appendChild(opt);
      });
    } else {
      const labels = { swiss: 'Swiss', elite: 'Arbre Elite', amateur: 'Arbre Amateur' };
      ['swiss', 'elite', 'amateur'].forEach((id) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = labels[id];
        opt.selected = state.filterBrackets.includes(id);
        filterBracketSelectEl.appendChild(opt);
      });
    }
    const vals = new Set([...filterBracketSelectEl.options].map((o) => o.value));
    state.filterBrackets = state.filterBrackets.filter((id) => vals.has(id));
    if (bracketFilterCombo) bracketFilterCombo.rebuildListFromSelect();
  }

  function initFilters() {
    const bvCreate = window.HelloView && window.HelloView.createSearchableSelectCombo;

    const bHost = $('filter-bracket-combo-host');
    if (bHost && bvCreate) {
      bHost.innerHTML = '';
      bracketFilterCombo = bvCreate({
        appendTo: bHost,
        selectId: 'filter-bracket',
        emptyValue: '',
        emptyLabel: 'Tous les brackets',
        items: [],
        searchPlaceholder: 'Filtrer les brackets…',
        comboClass: 'filter-bracket-hv-combo',
        ariaLabel: 'Filtrer par bracket',
        multiple: true,
        multiTriggerManyLabel: '{n} brackets',
        clearable: true,
        clearButtonAriaLabel: 'Effacer le filtre bracket',
        onChange: function () {
          state.filterBrackets = filterBracketSelectEl
            ? [...filterBracketSelectEl.selectedOptions].map((o) => o.value)
            : [];
          pruneMatchFiltersToBracketUnion();
          updateFiltersFromData([]);
          syncFiltersToUrl();
          render();
        }
      });
      filterBracketSelectEl = bracketFilterCombo.select;
    } else {
      bracketFilterCombo = null;
      filterBracketSelectEl = null;
    }

    populateBracketFilterSelect();

    const host = $('filter-match-combo-host');
    if (host && bvCreate) {
      host.innerHTML = '';
      matchFilterCombo = bvCreate({
        appendTo: host,
        selectId: 'filter-match',
        emptyValue: '',
        emptyLabel: 'Tous les matchs',
        items: [],
        searchPlaceholder: 'Filtrer les matchs…',
        comboClass: 'filter-match-hv-combo',
        ariaLabel: 'Filtrer par match',
        multiple: true,
        multiTriggerManyLabel: '{n} matchs',
        clearable: true,
        clearButtonAriaLabel: 'Effacer le filtre match',
        onChange: function () {
          state.filterMatches = filterMatchSelectEl
            ? [...filterMatchSelectEl.selectedOptions].map((o) => o.value)
            : [];
          syncFiltersToUrl();
          render();
        }
      });
      filterMatchSelectEl = matchFilterCombo.select;
    } else {
      matchFilterCombo = null;
      filterMatchSelectEl = null;
    }

    const { players } = state.data;
    const matches = getMatchesForMatchSelect();
    if (filterMatchSelectEl) {
      filterMatchSelectEl.innerHTML = '';
      matches.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = getMatchListLabel(m);
        opt.selected = state.filterMatches.includes(m.id);
        filterMatchSelectEl.appendChild(opt);
      });
      matchFilterCombo.rebuildListFromSelect();
    }

    const tHost = $('filter-team-combo-host');
    if (tHost && bvCreate) {
      tHost.innerHTML = '';
      teamFilterCombo = bvCreate({
        appendTo: tHost,
        selectId: 'filter-team',
        emptyValue: '',
        emptyLabel: 'Toutes les équipes',
        items: [],
        searchPlaceholder: 'Filtrer les équipes…',
        comboClass: 'filter-team-hv-combo',
        ariaLabel: 'Filtrer par équipe',
        multiple: true,
        multiTriggerManyLabel: '{n} équipes',
        clearable: true,
        clearButtonAriaLabel: 'Effacer le filtre équipe',
        onChange: function () {
          state.filterTeams = filterTeamSelectEl
            ? [...filterTeamSelectEl.selectedOptions].map((o) => o.value)
            : [];
          syncFiltersToUrl();
          render();
        }
      });
      filterTeamSelectEl = teamFilterCombo.select;
    } else {
      teamFilterCombo = null;
      filterTeamSelectEl = null;
    }

    if (filterTeamSelectEl) {
      filterTeamSelectEl.innerHTML = '';
      const teams = [...new Set((players || []).map(p => p.team_name))].filter(Boolean).sort();
      teams.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        opt.selected = state.filterTeams.includes(t);
        filterTeamSelectEl.appendChild(opt);
      });
      teamFilterCombo.rebuildListFromSelect();
    }

    const matchOpts = filterMatchSelectEl ? new Set(Array.from(filterMatchSelectEl.options).map((o) => o.value)) : new Set();
    const teamOpts = filterTeamSelectEl ? new Set(Array.from(filterTeamSelectEl.options).map((o) => o.value)) : new Set();
    state.filterMatches = state.filterMatches.filter((id) => matchOpts.has(id));
    state.filterTeams = state.filterTeams.filter((t) => teamOpts.has(t));
    if (bracketFilterCombo) bracketFilterCombo.syncUIFromSelect();
    if (matchFilterCombo) matchFilterCombo.syncUIFromSelect();
    if (teamFilterCombo) teamFilterCombo.syncUIFromSelect();

    const clearBtn = $('btn-clear-filters');
    if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);
  }

  function getFilteredRows() {
    if (!state.data) return [];
    let list = state.data.players.slice();
    const bracketSet = getUnionMatchIdsForSelectedBrackets();
    if (bracketSet !== null) {
      if (bracketSet.size === 0) return [];
      list = list.filter((p) => p.match_checksum && bracketSet.has(p.match_checksum));
    }
    if (state.filterMatches.length) {
      const ms = new Set(state.filterMatches);
      list = list.filter((p) => ms.has(p.match_checksum));
    }
    if (state.filterTeams.length) {
      const ts = new Set(state.filterTeams);
      list = list.filter((p) => ts.has(p.team_name));
    }
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
    const bracketSet = getUnionMatchIdsForSelectedBrackets();
    let ranking;
    if (bracketSet !== null || state.filterMatches.length) {
      ranking = getTeamRanking(rows);
    } else if (state.data.teams && state.data.teams.length > 0) {
      let base = state.data.teams.slice();
      if (state.filterTeams.length) {
        const ts = new Set(state.filterTeams);
        base = base.filter((t) => ts.has(t.team_name));
      }
      ranking = base.sort((a, b) => (b.winsPct ?? 0) - (a.winsPct ?? 0));
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
    const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

    function setCookie(name, enabled) {
      document.cookie = encodeURIComponent(name) + '=' + (enabled ? '1' : '0') + '; path=/; max-age=' + COOKIE_MAX_AGE + '; SameSite=Lax';
    }

    const playersToggle = $('auto-scroll-players-toggle');
    const teamsToggle = $('auto-scroll-teams-toggle');
    let autoScrollPlayersEnabled = readAutoScrollPlayersEnabled();
    let autoScrollTeamsEnabled = readAutoScrollTeamsEnabled();

    if (playersToggle) {
      playersToggle.checked = autoScrollPlayersEnabled;
      playersToggle.setAttribute('aria-checked', String(autoScrollPlayersEnabled));
    }
    if (teamsToggle) {
      teamsToggle.checked = autoScrollTeamsEnabled;
      teamsToggle.setAttribute('aria-checked', String(autoScrollTeamsEnabled));
    }
    const anyOnInit = autoScrollPlayersEnabled || autoScrollTeamsEnabled;
    document.body.classList.toggle('autoscroll-active', anyOnInit);
    if (anyOnInit) closeSidePanel();

    function setupAutoScroll(wrap, isEnabled) {
      if (!wrap) return;
      const scrollState = { direction: 1, paused: false, lastStep: 0, rafId: null };
      function step(now) {
        scrollState.rafId = requestAnimationFrame(step);
        if (!isEnabled() || scrollState.paused) return;
        if (!scrollState.lastStep) scrollState.lastStep = now;
        const elapsed = now - scrollState.lastStep;
        if (elapsed < STEP_MS) return;
        scrollState.lastStep = now;
        const max = wrap.scrollHeight - wrap.clientHeight;
        if (max <= 0) return;
        const delta = (elapsed / 1000) * SCROLL_SPEED * scrollState.direction;
        let next = wrap.scrollTop + delta;
        if (next >= max) {
          next = max;
          scrollState.direction = -1;
        } else if (next <= 0) {
          next = 0;
          scrollState.direction = 1;
        }
        wrap.scrollTop = next;
      }
      scrollState.rafId = requestAnimationFrame(step);
      wrap.addEventListener('mouseenter', () => { scrollState.paused = true; });
      wrap.addEventListener('mouseleave', () => { scrollState.paused = false; });
      wrap.addEventListener('focusin', () => { scrollState.paused = true; });
      wrap.addEventListener('focusout', () => { scrollState.paused = false; });
    }
    setupAutoScroll(document.querySelector('#view-players .table-wrap'), () => autoScrollPlayersEnabled);
    setupAutoScroll(document.querySelector('#view-teams .table-wrap'), () => autoScrollTeamsEnabled);

    function onAutoScrollTogglesChange() {
      autoScrollPlayersEnabled = !!(playersToggle && playersToggle.checked);
      autoScrollTeamsEnabled = !!(teamsToggle && teamsToggle.checked);
      if (playersToggle) playersToggle.setAttribute('aria-checked', String(autoScrollPlayersEnabled));
      if (teamsToggle) teamsToggle.setAttribute('aria-checked', String(autoScrollTeamsEnabled));
      setCookie(AUTOSCROLL_PLAYERS_COOKIE, autoScrollPlayersEnabled);
      setCookie(AUTOSCROLL_TEAMS_COOKIE, autoScrollTeamsEnabled);
      const anyOn = autoScrollPlayersEnabled || autoScrollTeamsEnabled;
      if (anyOn) {
        closeSidePanel();
      } else {
        syncFiltersToUrl();
        applyFiltersFromUrl();
        if (filterBracketSelectEl) {
          [...filterBracketSelectEl.options].forEach((o) => {
            o.selected = state.filterBrackets.includes(o.value);
          });
          if (bracketFilterCombo) bracketFilterCombo.syncUIFromSelect();
        }
        if (filterMatchSelectEl) {
          [...filterMatchSelectEl.options].forEach((o) => {
            o.selected = state.filterMatches.includes(o.value);
          });
          if (matchFilterCombo) matchFilterCombo.syncUIFromSelect();
        }
        if (filterTeamSelectEl) {
          [...filterTeamSelectEl.options].forEach((o) => {
            o.selected = state.filterTeams.includes(o.value);
          });
          if (teamFilterCombo) teamFilterCombo.syncUIFromSelect();
        }
      }
      syncFiltersToUrl();
      document.body.classList.toggle('autoscroll-active', anyOn);
      updateClearFiltersButton();
      render();
    }

    if (playersToggle) playersToggle.addEventListener('change', onAutoScrollTogglesChange);
    if (teamsToggle) teamsToggle.addEventListener('change', onAutoScrollTogglesChange);
  })();
})();
