(function () {
  'use strict';

  const BRACKETS_STORAGE_KEY = 'brackets_admin_token';

  let state = {
    data: null,
    isAdmin: false,
    token: sessionStorage.getItem(BRACKETS_STORAGE_KEY)
  };

  let builtPanelIds = '';
  let upperLinksRedrawRaf = null;
  let upperLinkResizeObservers = [];

  function teardownUpperBracketLinkObservers() {
    upperLinkResizeObservers.forEach((o) => o.disconnect());
    upperLinkResizeObservers = [];
  }

  /** Double rAF : layout / polices ; ne dessine que les panneaux élimination visibles. */
  function scheduleUpperBracketLinksRedraw() {
    if (upperLinksRedrawRaf != null) cancelAnimationFrame(upperLinksRedrawRaf);
    upperLinksRedrawRaf = requestAnimationFrame(() => {
      upperLinksRedrawRaf = requestAnimationFrame(() => {
        upperLinksRedrawRaf = null;
        if (!state.data || !state.data.tournaments) return;
        state.data.tournaments.forEach((t) => {
          if (t.type !== 'elimination' || t.drawBracketLinks === false) return;
          const d = safeDomId(t.id);
          const panel = document.getElementById('panel-' + d);
          if (!panel || panel.classList.contains('hidden')) return;
          const tree = document.getElementById('tree-upper-' + d);
          if (tree) drawBracketLinks(tree, t, 'upper');
        });
      });
    });
  }

  function setupUpperBracketLinkObservers() {
    teardownUpperBracketLinkObservers();
    if (typeof ResizeObserver === 'undefined' || !state.data || !state.data.tournaments) return;
    state.data.tournaments.forEach((t) => {
      if (t.type !== 'elimination' || t.drawBracketLinks === false) return;
      const inner = document.querySelector('#tree-upper-' + safeDomId(t.id) + ' .bracket-tree-inner:not(.bracket-tree-inner-lower)');
      if (!inner) return;
      const ro = new ResizeObserver(() => scheduleUpperBracketLinksRedraw());
      ro.observe(inner);
      upperLinkResizeObservers.push(ro);
    });
  }

  function $(id) { return document.getElementById(id); }

  function escapeHtml(s) {
    if (s == null || s === '') return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function formatNum(n, decimals) {
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toFixed(decimals);
  }

  function formatDuration(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return '—';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function rating2Class(r) {
    if (r == null || Number.isNaN(r)) return '';
    if (r >= 1.05) return 'rating-high';
    if (r >= 0.9) return 'rating-mid';
    return 'rating-low';
  }

  function getAuthHeader() {
    return state.token ? { Authorization: 'Bearer ' + state.token } : {};
  }

  let statsCache = null;

  async function fetchStats() {
    if (statsCache) return statsCache;
    const apiUrl = (typeof window !== 'undefined' && window.HELLOVIEW_API_URL) || '/api/stats';
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error('Chargement stats échoué');
    statsCache = await res.json();
    return statsCache;
  }

  async function openPlayerOverlayFromBrackets(steamId) {
    if (!window.HelloView || !window.HelloView.openPlayerOverlay) return;
    try {
      const data = await fetchStats();
      window.HelloView.openPlayerOverlay(steamId, data);
      document.body.style.overflow = 'hidden';
    } catch (_) {
      /* pas de stats */
    }
  }

  function closePlayerOverlayBrackets() {
    if (window.HelloView && window.HelloView.closePlayerOverlay) window.HelloView.closePlayerOverlay();
    if (!anyOverlayOpenBrackets()) document.body.style.overflow = '';
  }

  function anyOverlayOpenBrackets() {
    const o = (id) => document.getElementById(id) && !document.getElementById(id).hasAttribute('hidden');
    return o('team-overlay') || o('player-overlay') || o('match-overlay');
  }

  function closeTeamOverlayBrackets() {
    if (window.HelloView && window.HelloView.closeTeamOverlay) window.HelloView.closeTeamOverlay();
    if (!anyOverlayOpenBrackets()) document.body.style.overflow = '';
  }

  function closeMatchOverlayBrackets() {
    if (window.HelloView && window.HelloView.closeMatchOverlay) window.HelloView.closeMatchOverlay();
    if (!anyOverlayOpenBrackets()) document.body.style.overflow = '';
  }

  async function openTeamOverlayFromBrackets(teamName) {
    if (!window.HelloView || !window.HelloView.openTeamOverlay) return;
    try {
      const data = await fetchStats();
      window.HelloView.openTeamOverlay(teamName, data, {
        onPlayerClick(steamId) {
          window.HelloView.openPlayerOverlay(steamId, data, { onMatchClick: openMatchOverlayFromBrackets, onTeamClick: openTeamOverlayFromBrackets });
          document.body.style.overflow = 'hidden';
        },
        onMatchClick(checksum) { openMatchOverlayFromBrackets(checksum); }
      });
      document.body.style.overflow = 'hidden';
    } catch (_) {
      /* stats indisponibles */
    }
  }

  const bracketsMatchOverlayOptions = (data) => ({
    onTeamClick: openTeamOverlayFromBrackets,
    onPlayerClick(steamId) {
      window.HelloView.openPlayerOverlay(steamId, data, { onMatchClick: openMatchOverlayFromBrackets, onTeamClick: openTeamOverlayFromBrackets });
    },
    onMatchClick: openMatchOverlayFromBrackets
  });

  async function openMatchOverlayFromBrackets(checksum) {
    if (!window.HelloView || !window.HelloView.openMatchOverlay) return;
    try {
      const data = await fetchStats();
      if (!data) return;
      window.HelloView.openMatchOverlay(checksum, data, bracketsMatchOverlayOptions(data));
      document.body.style.overflow = 'hidden';
    } catch (_) {
      /* stats indisponibles */
    }
  }

  function getTournamentById(id) {
    const list = (state.data && state.data.tournaments) || [];
    return list.find((t) => t.id === id) || null;
  }

  function openMatchOverlayFromBracketsCell(tournamentId, lane, roundIndex, matchIndex) {
    const t = getTournamentById(tournamentId);
    if (!t) return;
    let m = null;
    if (t.type === 'swiss' || lane === 'swiss') {
      m = t.rounds && t.rounds[roundIndex] && t.rounds[roundIndex].matches[matchIndex];
    } else if (lane === 'grand' && t.grandFinale) {
      m = t.grandFinale.matches[matchIndex];
    } else if (lane === 'lower') {
      m = t.lowerRounds && t.lowerRounds[roundIndex] && t.lowerRounds[roundIndex].matches[matchIndex];
    } else {
      m = t.upperRounds && t.upperRounds[roundIndex] && t.upperRounds[roundIndex].matches[matchIndex];
    }
    if (!m) return;
    const demoId = (m.demoId || '').trim();
    if (demoId) {
      openMatchOverlayFromBrackets(demoId);
      return;
    }
    const minimalData = {
      matches: [{ id: 'bracket-no-demo', team_a_name: m.teamA, team_b_name: m.teamB, winner_name: m.winner }],
      players: [],
      teams: []
    };
    if (!window.HelloView || !window.HelloView.openMatchOverlay) return;
    window.HelloView.openMatchOverlay('bracket-no-demo', minimalData, bracketsMatchOverlayOptions(minimalData));
    document.body.style.overflow = 'hidden';
  }

  async function fetchBrackets() {
    const res = await fetch('/api/brackets');
    if (!res.ok) throw new Error('Chargement brackets échoué');
    state.data = await res.json();
    return state.data;
  }

  async function saveMatch(body) {
    const res = await fetch('/api/brackets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(body)
    });
    if (res.status === 401) {
      state.token = null;
      state.isAdmin = false;
      sessionStorage.removeItem(BRACKETS_STORAGE_KEY);
      updateAdminUI();
      throw new Error('Session expirée');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Erreur enregistrement');
    }
    const json = await res.json();
    if (json.brackets) {
      state.data = {
        ...json.brackets,
        matchesFromDb: state.data && state.data.matchesFromDb ? state.data.matchesFromDb : [],
        teamsFromDb: state.data && state.data.teamsFromDb ? state.data.teamsFromDb : []
      };
    }
    return json;
  }

  function updateAdminUI() {
    const btnAdmin = $('btn-admin');
    const btnLogout = $('btn-logout');
    const header = $('brackets-header');
    if (state.isAdmin) {
      btnAdmin.classList.add('hidden');
      btnLogout.classList.remove('hidden');
      if (header) header.classList.add('is-admin');
    } else {
      btnAdmin.classList.remove('hidden');
      btnLogout.classList.add('hidden');
      if (header) header.classList.remove('is-admin');
    }
    renderAll();
  }

  function getWinnerLoser(m) {
    const a = (m.teamA || '').trim();
    const b = (m.teamB || '').trim();
    const w = (m.winner || '').trim();
    if (w) {
      const loser = normName(a) === normName(w) ? b : a;
      return [w, loser || '—'];
    }
    return [a || '—', b || '—'];
  }

  const SWISS_SLOT_HEIGHT = 52;
  const SWISS_SLOTS = 16;

  const normName = (s) => (s || '').trim().toLowerCase();

  function safeDomId(id) {
    return String(id || 't').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function getSwissLayout(tournament) {
    const layout = tournament.swissLayout || {};
    const blocks = layout.roundBlocks || {};
    const labels = layout.wlLabels || {};
    const slots = Number(layout.slots) > 0 ? Number(layout.slots) : SWISS_SLOTS;
    return { roundBlocks: blocks, wlLabels: labels, slots };
  }

  function computeSwissStandings(tournament) {
    if (!tournament || tournament.type !== 'swiss' || !tournament.rounds) return [];
    const qualifyWins = Number(tournament.swissRules?.qualifyWins) >= 0 ? Number(tournament.swissRules.qualifyWins) : 3;
    const eliminateLosses = Number(tournament.swissRules?.eliminateLosses) >= 0 ? Number(tournament.swissRules.eliminateLosses) : 3;
    const rounds = tournament.rounds;
    const teamNames = new Set();
    (rounds || []).forEach((r) => {
      (r.matches || []).forEach((m) => {
        if ((m.teamA || '').trim()) teamNames.add((m.teamA || '').trim());
        if ((m.teamB || '').trim()) teamNames.add((m.teamB || '').trim());
      });
    });
    const names = [...teamNames].sort();
    const standings = names.map((teamName) => ({
      teamName,
      record: { wins: 0, losses: 0 },
      perRound: [],
      status: null
    }));
    const byName = {};
    standings.forEach((s) => { byName[normName(s.teamName)] = s; });
    for (let ri = 0; ri < rounds.length; ri++) {
      standings.forEach((s) => {
        s.perRound.push({ result: null, wins: s.record.wins, losses: s.record.losses });
      });
      const round = rounds[ri];
      (round.matches || []).forEach((m) => {
        const nameA = (m.teamA || '').trim();
        const nameB = (m.teamB || '').trim();
        const w = (m.winner || '').trim();
        if (!nameA || !nameB) return;
        const sa = byName[normName(nameA)];
        const sb = byName[normName(nameB)];
        if (!sa || !sb) return;
        const aWon = w && normName(w) === normName(nameA);
        const bWon = w && normName(w) === normName(nameB);
        if (aWon) {
          sa.record.wins += 1;
          sa.perRound[ri] = { result: 'W', wins: sa.record.wins, losses: sa.record.losses };
          sb.record.losses += 1;
          sb.perRound[ri] = { result: 'L', wins: sb.record.wins, losses: sb.record.losses };
        } else if (bWon) {
          sb.record.wins += 1;
          sb.perRound[ri] = { result: 'W', wins: sb.record.wins, losses: sb.record.losses };
          sa.record.losses += 1;
          sa.perRound[ri] = { result: 'L', wins: sa.record.wins, losses: sa.record.losses };
        }
      });
      standings.forEach((s) => {
        if (s.status != null) return;
        if (s.record.wins >= qualifyWins) s.status = 'qualified';
        else if (s.record.losses >= eliminateLosses) s.status = 'eliminated';
      });
    }
    return standings;
  }

  function getStandingsAtStartOfRound(tournament, ri) {
    const standings = computeSwissStandings(tournament);
    return standings.map((s) => {
      const pr = ri === 0 ? { wins: 0, losses: 0 } : (s.perRound[ri - 1] || { wins: 0, losses: 0 });
      return { teamName: s.teamName, wins: pr.wins, losses: pr.losses };
    });
  }

  function computeSwissFlowNodes(tournament) {
    if (!tournament || tournament.type !== 'swiss' || !tournament.rounds) return [];
    const qualifyWins = Number(tournament.swissRules?.qualifyWins) >= 0 ? Number(tournament.swissRules.qualifyWins) : 3;
    const eliminateLosses = Number(tournament.swissRules?.eliminateLosses) >= 0 ? Number(tournament.swissRules.eliminateLosses) : 3;
    const rounds = tournament.rounds || [];
    const nodes = [];
    const seenKeys = new Set();

    for (let ri = 0; ri < rounds.length; ri++) {
      const round = rounds[ri];
      const startStandings = getStandingsAtStartOfRound(tournament, ri);
      const byName = {};
      startStandings.forEach((s) => { byName[normName(s.teamName)] = s; });

      const bucketMatches = {};
      (round.matches || []).forEach((m, mi) => {
        const nameA = (m.teamA || '').trim();
        const nameB = (m.teamB || '').trim();
        if (!nameA || !nameB) return;
        const sa = byName[normName(nameA)];
        const sb = byName[normName(nameB)];
        const w = (sa && sb) ? sa.wins : 0;
        const l = (sa && sb) ? sa.losses : 0;
        const key = w + ':' + l;
        if (!bucketMatches[key]) bucketMatches[key] = [];
        bucketMatches[key].push({ roundIndex: ri, matchIndex: mi, m });
      });

      const boLabel = ri >= 2 ? 'Bo3' : 'Bo1';
      const sortedKeys = Object.keys(bucketMatches).sort((a, b) => {
        const [wa, la] = a.split(':').map(Number);
        const [wb, lb] = b.split(':').map(Number);
        if (wa !== wb) return wb - wa;
        return la - lb;
      });
      sortedKeys.forEach((key) => {
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        const [w, l] = key.split(':').map(Number);
        const matches = bucketMatches[key];
        let borderClass = 'swiss-flux-border-neutral';
        if (w === qualifyWins && l === 0) borderClass = 'swiss-flux-border-qualified';
        else if (w === 0 && l === eliminateLosses) borderClass = 'swiss-flux-border-eliminated';
        else if (l === 0) borderClass = 'swiss-flux-border-winners';
        else if (w === 0) borderClass = 'swiss-flux-border-losers';
        else borderClass = 'swiss-flux-border-mid';
        nodes.push({ wins: w, losses: l, label: w + ':' + l + ' - ' + boLabel, borderClass, matches });
      });
    }

    const standings = computeSwissStandings(tournament);
    const qualified = standings.filter((s) => s.status === 'qualified').map((s) => s.teamName);
    const eliminated = standings.filter((s) => s.status === 'eliminated');
    const elimByRecord = {};
    eliminated.forEach((s) => {
      const key = s.record.losses + ':' + s.record.wins;
      if (!elimByRecord[key]) elimByRecord[key] = [];
      elimByRecord[key].push(s.teamName);
    });
    if (qualified.length) {
      nodes.push({ type: 'qualified', label: qualifyWins + ':0 - Qualifiés', borderClass: 'swiss-flux-border-qualified', teams: qualified });
    }
    [eliminateLosses + ':0', eliminateLosses + ':1', eliminateLosses + ':2'].forEach((key) => {
      const teams = elimByRecord[key];
      if (teams && teams.length) {
        const [l, w] = key.split(':').map(Number);
        nodes.push({ type: 'eliminated', label: l + ':' + w + ' - Éliminés', borderClass: 'swiss-flux-border-eliminated', teams });
      }
    });

    return nodes;
  }

  function renderSwissFlux(panelEl, tournament) {
    const d = safeDomId(tournament.id);
    const container = panelEl.querySelector('#swiss-flux-' + d);
    if (!container) return;
    const nodes = computeSwissFlowNodes(tournament);
    container.innerHTML = '';
    nodes.forEach((node) => {
      const box = document.createElement('div');
      box.className = 'swiss-flux-node ' + (node.borderClass || '');
      const title = document.createElement('div');
      title.className = 'swiss-flux-node-title';
      title.textContent = node.label;
      box.appendChild(title);
      const body = document.createElement('div');
      body.className = 'swiss-flux-node-body';
      if (node.type === 'qualified' || node.type === 'eliminated') {
        (node.teams || []).forEach((teamName) => {
          const row = document.createElement('div');
          row.className = 'swiss-flux-team-row';
          row.textContent = teamName || '—';
          body.appendChild(row);
        });
      } else {
        (node.matches || []).forEach(({ roundIndex, matchIndex, m }) => {
          const [winner, loser] = getWinnerLoser(m);
          const row = document.createElement('div');
          row.className = 'swiss-flux-match-row';
          row.innerHTML =
            '<span class="swiss-flux-team">' + escapeHtml(winner) + '</span>' +
            '<span class="swiss-flux-score">' + (m.winner ? '1-0' : '–') + '</span>' +
            '<span class="swiss-flux-team">' + escapeHtml(loser) + '</span>';
          if (state.isAdmin) {
            row.classList.add('admin');
            row.addEventListener('click', () => openEditModal(tournament.id, 'swiss', roundIndex, matchIndex));
          } else {
            row.classList.add('clickable');
            row.addEventListener('click', () => openMatchOverlayFromBracketsCell(tournament.id, 'swiss', roundIndex, matchIndex));
          }
          body.appendChild(row);
        });
      }
      box.appendChild(body);
      container.appendChild(box);
      const arrow = document.createElement('div');
      arrow.className = 'swiss-flux-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      container.appendChild(arrow);
    });
    const arrows = container.querySelectorAll('.swiss-flux-arrow');
    if (arrows.length) arrows[arrows.length - 1].remove();
  }

  function renderSwiss(panelEl, tournament) {
    const grid = panelEl.querySelector('#swiss-grid-' + safeDomId(tournament.id));
    if (!grid || !tournament.rounds) return;
    const { roundBlocks, wlLabels, slots } = getSwissLayout(tournament);
    const rounds = tournament.rounds || [];
    grid.innerHTML = '';
    const totalHeight = slots * SWISS_SLOT_HEIGHT;

    rounds.forEach((round, ri) => {
      const col = document.createElement('div');
      col.className = 'swiss-round swiss-round-with-slots';
      col.style.minHeight = totalHeight + 'px';
      const title = (round.title != null && String(round.title).trim() !== '') ? String(round.title).trim() : ('Round ' + (ri + 1));
      col.innerHTML = '<h3 class="swiss-round-title">' + escapeHtml(title) + '</h3><div class="swiss-round-body"></div>';
      const body = col.querySelector('.swiss-round-body');
      const inner = document.createElement('div');
      inner.className = 'swiss-round-inner';
      const container = document.createElement('div');
      container.className = 'swiss-matches';
      body.appendChild(inner);

      const key = String(ri);
      const blocks = roundBlocks[key] || roundBlocks[ri] || [[0, slots]];
      const labels = wlLabels[key] || wlLabels[ri] || [];

      const labelsStrip = document.createElement('div');
      labelsStrip.className = 'swiss-round-labels';
      blocks.forEach(([start, end], blockIdx) => {
        if (blockIdx > 0) {
          const sep = document.createElement('div');
          sep.className = 'swiss-round-label-sep';
          labelsStrip.appendChild(sep);
        }
        const labelVal = labels[blockIdx] || '';
        const labelEl = document.createElement('div');
        labelEl.className = 'swiss-round-label';
        if (labelVal) labelEl.setAttribute('data-wl', labelVal);
        labelEl.style.height = (end - start) * SWISS_SLOT_HEIGHT + 'px';
        labelEl.textContent = labelVal;
        labelsStrip.appendChild(labelEl);
      });
      inner.appendChild(labelsStrip);
      inner.appendChild(container);
      const matchCount = (round.matches || []).length;

      blocks.forEach(([start, end], blockIdx) => {
        const blockWrap = document.createElement('div');
        blockWrap.className = 'swiss-round-block';
        if (blockIdx > 0) blockWrap.classList.add('swiss-round-block-sep');
        for (let slot = start; slot < end; slot++) {
          const m = slot < matchCount ? round.matches[slot] : null;
          const slotEl = document.createElement('div');
          slotEl.className = 'swiss-slot';
          slotEl.style.height = SWISS_SLOT_HEIGHT + 'px';
          if (m) {
            const [winner, loser] = getWinnerLoser(m);
            const cell = document.createElement('div');
            cell.className = 'match-cell' + (state.isAdmin ? ' admin' : '');
            cell.dataset.tournamentId = tournament.id;
            cell.dataset.lane = 'swiss';
            cell.dataset.roundIndex = String(ri);
            cell.dataset.matchIndex = String(slot);
            cell.innerHTML =
              '<span class="match-winner">' + escapeHtml(winner) + '</span>' +
              '<span class="match-loser">' + escapeHtml(loser) + '</span>';
            if (state.isAdmin) {
              cell.addEventListener('click', () => openEditModal(tournament.id, 'swiss', ri, slot));
            } else {
              cell.classList.add('clickable');
              cell.addEventListener('click', () => openMatchOverlayFromBracketsCell(tournament.id, 'swiss', ri, slot));
            }
            slotEl.appendChild(cell);
          }
          blockWrap.appendChild(slotEl);
        }
        container.appendChild(blockWrap);
      });
      grid.appendChild(col);
    });
    renderParcours(panelEl, tournament);
    renderSwissFlux(panelEl, tournament);
  }

  function renderParcours(panelEl, tournament) {
    const d = safeDomId(tournament.id);
    const table = panelEl.querySelector('#parcours-table-' + d);
    if (!table) return;
    const standings = computeSwissStandings(tournament);
    const rounds = tournament.rounds || [];
    const thRounds = rounds.map((r, i) => {
      const lab = (r.title != null && String(r.title).trim() !== '') ? String(r.title).trim() : ('R' + (i + 1));
      return '<th>' + escapeHtml(lab) + '</th>';
    }).join('');
    table.innerHTML = '<thead><tr><th>#</th><th>Équipe</th>' + thRounds + '<th>Statut</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    standings.forEach((s, idx) => {
      const tr = document.createElement('tr');
      const rCells = rounds.map((_, ri) => {
        const pr = s.perRound[ri];
        if (!pr || pr.result === null) return '<td>—</td>';
        const rec = pr.wins + '-' + pr.losses;
        return '<td class="parcours-cell ' + (pr.result === 'W' ? 'parcours-w' : 'parcours-l') + '">' + pr.result + ' → ' + rec + '</td>';
      });
      let status = '—';
      if (s.status === 'qualified') status = 'QUALIFIÉ';
      else if (s.status === 'eliminated') status = 'ÉLIMINÉ';
      const teamName = s.teamName || '—';
      tr.innerHTML =
        '<td>' + (idx + 1) + '</td>' +
        '<td class="parcours-team parcours-team-clickable" role="button" tabindex="0" data-team-name="' + escapeHtml(teamName) + '">' + escapeHtml(teamName) + '</td>' +
        rCells.join('') +
        '<td class="parcours-status parcours-status-' + (s.status || '') + '">' + status + '</td>';
      const teamCell = tr.querySelector('.parcours-team-clickable');
      if (teamCell) {
        teamCell.addEventListener('click', (e) => { e.stopPropagation(); openTeamOverlayFromBrackets(teamName); });
        teamCell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTeamOverlayFromBrackets(teamName); } });
      }
      tbody.appendChild(tr);
    });
  }

  function renderEliminationColumn(inner, tournament, rounds, lane, options) {
    const isLower = options && options.isLower;
    const labels = options && options.labels;
    if (isLower) {
      const ghostCol = document.createElement('div');
      ghostCol.className = 'bracket-round bracket-round-ghost';
      ghostCol.innerHTML = '<div class="bracket-round-title"></div><div class="bracket-round-matches"></div>';
      inner.appendChild(ghostCol);
    }
    (rounds || []).forEach((round, ri) => {
      const col = document.createElement('div');
      col.className = 'bracket-round';
      const rt = (round.title != null && String(round.title).trim() !== '') ? String(round.title).trim() : ((labels && labels[ri]) || '');
      col.innerHTML = '<div class="bracket-round-title">' + escapeHtml(rt) + '</div><div class="bracket-round-matches"></div>';
      const matchContainer = col.querySelector('.bracket-round-matches');
      (round.matches || []).forEach((m, mi) => {
        const [winner, loser] = getWinnerLoser(m);
        const wrap = document.createElement('div');
        wrap.className = 'bracket-match-wrap';
        const cell = document.createElement('div');
        cell.className = 'bracket-match' + (state.isAdmin ? ' admin' : '');
        cell.dataset.tournamentId = tournament.id;
        cell.dataset.lane = lane;
        cell.dataset.roundIndex = String(ri);
        cell.dataset.matchIndex = String(mi);
        cell.dataset.bracketRef = tournament.id + ':' + lane + ':' + ri + ':' + mi;
        cell.innerHTML =
          '<span class="match-winner">' + escapeHtml(winner) + '</span>' +
          '<span class="match-loser">' + escapeHtml(loser) + '</span>';
        if (state.isAdmin) {
          cell.addEventListener('click', () => openEditModal(tournament.id, lane, ri, mi));
        } else {
          cell.classList.add('clickable');
          cell.addEventListener('click', () => openMatchOverlayFromBracketsCell(tournament.id, lane, ri, mi));
        }
        wrap.appendChild(cell);
        matchContainer.appendChild(wrap);
      });
      inner.appendChild(col);
    });
  }

  function renderEliminationTree(treeHost, tournament, lane) {
    const tree = treeHost.querySelector('.bracket-tree-inner');
    if (!tree || !tournament) return;
    tree.innerHTML = '';
    if (lane === 'upper' && tournament.drawBracketLinks !== false) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'bracket-links-svg');
      svg.setAttribute('aria-hidden', 'true');
      tree.appendChild(svg);
    }
    if (lane === 'upper') {
      renderEliminationColumn(tree, tournament, tournament.upperRounds, 'upper', { isLower: false });
    } else {
      renderEliminationColumn(tree, tournament, (tournament.lowerRounds || []).slice(0, 6), 'lower', { isLower: true });
    }
  }

  function renderGrandFinale(wrapEl, tournament) {
    const host = wrapEl.querySelector('.bracket-grand-finale-wrap');
    if (!host || !tournament || !tournament.grandFinale) {
      if (host) host.innerHTML = '';
      return;
    }
    const gf = tournament.grandFinale;
    host.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'bracket-grand-finale-inner';
    const gtitle = (gf.title != null && String(gf.title).trim() !== '') ? String(gf.title).trim() : 'Grande Finale';
    inner.innerHTML = '<div class="bracket-round-title bracket-round-grand-final">' + escapeHtml(gtitle) + '</div><div class="bracket-round-matches"></div>';
    const matchContainer = inner.querySelector('.bracket-round-matches');
    (gf.matches || []).forEach((m, mi) => {
      const [winner, loser] = getWinnerLoser(m);
      const wrap = document.createElement('div');
      wrap.className = 'bracket-match-wrap';
      const cell = document.createElement('div');
      cell.className = 'bracket-match' + (state.isAdmin ? ' admin' : '');
      cell.dataset.tournamentId = tournament.id;
      cell.dataset.lane = 'grand';
      cell.dataset.roundIndex = '0';
      cell.dataset.matchIndex = String(mi);
      cell.dataset.bracketRef = tournament.id + ':grand:0:' + mi;
      cell.innerHTML =
        '<span class="match-winner">' + escapeHtml(winner) + '</span>' +
        '<span class="match-loser">' + escapeHtml(loser) + '</span>';
      if (state.isAdmin) {
        cell.addEventListener('click', () => openEditModal(tournament.id, 'grand', 0, mi));
      } else {
        cell.classList.add('clickable');
        cell.addEventListener('click', () => openMatchOverlayFromBracketsCell(tournament.id, 'grand', 0, mi));
      }
      wrap.appendChild(cell);
      matchContainer.appendChild(wrap);
    });
    host.appendChild(inner);
  }

  function drawBracketLinks(treeHost, tournament, lane) {
    if (lane !== 'upper' || tournament.drawBracketLinks === false) return;
    const treeInner = treeHost.querySelector('.bracket-tree-inner:not(.bracket-tree-inner-lower)');
    if (!treeInner) return;
    const panel = treeHost.closest('.brackets-panel');
    if (panel && panel.classList.contains('hidden')) return;

    const svg = treeInner.querySelector('.bracket-links-svg');
    if (!svg) return;

    const upper = tournament.upperRounds || [];
    svg.innerHTML = '';

    const w = Math.max(1, treeInner.scrollWidth, treeInner.offsetWidth);
    const h = Math.max(1, treeInner.scrollHeight, treeInner.offsetHeight);
    if (w <= 1 || h <= 1) return;

    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.style.width = w + 'px';
    svg.style.height = h + 'px';

    const ir = treeInner.getBoundingClientRect();

    function cellLocal(el) {
      const r = el.getBoundingClientRect();
      return {
        xR: r.right - ir.left,
        xL: r.left - ir.left,
        yM: r.top + r.height / 2 - ir.top
      };
    }

    function cellRect(ref) {
      const safe = ref.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const el = treeInner.querySelector('[data-bracket-ref="' + safe + '"]');
      if (!el) return null;
      return cellLocal(el);
    }

    upper.forEach((round, ri) => {
      (round.matches || []).forEach((m, mi) => {
        const outs = (m.links && m.links.out) || [];
        outs.forEach((ref) => {
          if (ref.lane !== 'upper') return;
          const fromRef = tournament.id + ':upper:' + ri + ':' + mi;
          const toRef = tournament.id + ':upper:' + ref.roundIndex + ':' + ref.matchIndex;
          const a = cellRect(fromRef);
          const b = cellRect(toRef);
          if (!a || !b) return;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          const mid = (a.xR + b.xL) / 2;
          const d = 'M ' + a.xR + ' ' + a.yM + ' C ' + mid + ' ' + a.yM + ', ' + mid + ' ' + b.yM + ', ' + b.xL + ' ' + b.yM;
          path.setAttribute('d', d);
          path.setAttribute('class', 'bracket-link-path');
          path.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.appendChild(path);
        });
      });
    });
  }

  function renderEliminationPanel(panelEl, tournament) {
    const d = safeDomId(tournament.id);
    const upperTree = panelEl.querySelector('#tree-upper-' + d);
    const lowerWrap = panelEl.querySelector('#lower-wrap-' + d);
    const lowerBlock = panelEl.querySelector('#lower-block-' + d);
    if (upperTree) renderEliminationTree(upperTree, tournament, 'upper');
    renderGrandFinale(panelEl, tournament);
    if (tournament.lowerRounds && tournament.lowerRounds.length && lowerWrap) {
      if (lowerBlock) lowerBlock.classList.remove('hidden');
      renderEliminationTree(lowerWrap, tournament, 'lower');
    } else if (lowerBlock) {
      lowerBlock.classList.add('hidden');
    }
  }

  function buildTabsAndPanels() {
    const tabsNav = $('brackets-tabs');
    const panelsRoot = $('brackets-panels');
    if (!tabsNav || !panelsRoot || !state.data || !state.data.tournaments) return;
    const tournaments = state.data.tournaments;
    const sig = tournaments.length + ':' + tournaments.map((t) => t.id).join(',');
    if (sig === builtPanelIds) return;
    teardownUpperBracketLinkObservers();
    builtPanelIds = sig;

    tabsNav.innerHTML = '';
    panelsRoot.innerHTML = '';
    if (!tournaments.length) {
      panelsRoot.innerHTML = '<p class="brackets-desc">Aucun tournoi configuré (brackets vides).</p>';
      return;
    }

    tournaments.forEach((t, idx) => {
      const d = safeDomId(t.id);
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.role = 'tab';
      tab.id = 'tab-' + d;
      tab.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
      tab.dataset.panelId = 'panel-' + d;
      tab.textContent = t.title || t.id;
      tabsNav.appendChild(tab);

      if (t.type === 'swiss') {
        const section = document.createElement('section');
        section.className = 'brackets-panel' + (idx === 0 ? '' : ' hidden');
        section.id = 'panel-' + d;
        section.dataset.tournamentId = t.id;
        section.innerHTML =
          '<p class="brackets-desc">' + escapeHtml(t.description || '') + '</p>' +
          '<div class="swiss-views">' +
          '<button type="button" class="swiss-view-tab active" data-swiss-view="matches" data-tid="' + escapeHtml(t.id) + '" aria-pressed="true">Rounds</button>' +
          '<button type="button" class="swiss-view-tab" data-swiss-view="flux" data-tid="' + escapeHtml(t.id) + '" aria-pressed="false">Flux</button>' +
          '<button type="button" class="swiss-view-tab" data-swiss-view="parcours" data-tid="' + escapeHtml(t.id) + '" aria-pressed="false">Qualifications</button>' +
          '</div>' +
          '<div class="swiss-matches-view" id="swiss-matches-view-' + d + '">' +
          '<div class="swiss-grid" id="swiss-grid-' + d + '"></div></div>' +
          '<div class="swiss-flux-view hidden" id="swiss-flux-view-' + d + '"><div class="swiss-flux" id="swiss-flux-' + d + '"></div></div>' +
          '<div class="swiss-parcours-view hidden" id="swiss-parcours-view-' + d + '">' +
          '<div class="parcours-table-wrap"><table class="parcours-table" id="parcours-table-' + d + '"></table></div></div>';
        panelsRoot.appendChild(section);
      } else {
        const section = document.createElement('section');
        section.className = 'brackets-panel' + (idx === 0 ? '' : ' hidden');
        section.id = 'panel-' + d;
        section.dataset.tournamentId = t.id;
        const lowerVisible = t.lowerRounds && t.lowerRounds.length;
        const upperLbl = escapeHtml(t.upperBracketLabel || 'Upper Bracket');
        const lowerLbl = escapeHtml(t.lowerBracketLabel || 'Lower Bracket (perdants 8e)');
        section.innerHTML =
          '<p class="brackets-desc">' + escapeHtml(t.description || '') + '</p>' +
          '<div class="bracket-panel-elim-wrap">' +
          '<div class="bracket-row-upper">' +
          '<div class="bracket-block bracket-block-upper">' +
          '<div class="bracket-vertical-title" aria-hidden="true">' + upperLbl + '</div>' +
          '<div class="bracket-tree" id="tree-upper-' + d + '">' +
          '<div class="bracket-tree-inner"></div></div>' +
          '</div>' +
          '<div class="bracket-grand-finale-wrap" id="grand-wrap-' + d + '"></div>' +
          '</div>' +
          '<div class="bracket-block bracket-block-lower' + (lowerVisible ? '' : ' hidden') + '" id="lower-block-' + d + '">' +
          '<div class="bracket-vertical-title bracket-vertical-title-lower" aria-hidden="true">' + lowerLbl + '</div>' +
          '<div class="bracket-tree bracket-tree-lower" id="lower-wrap-' + d + '"><div class="bracket-tree-inner bracket-tree-inner-lower"></div></div>' +
          '</div></div>';
        panelsRoot.appendChild(section);
      }
    });

  }

  function onTabClick(e) {
    const btn = e.target.closest('.tab[data-panel-id]');
    if (!btn || !btn.closest('#brackets-tabs')) return;
    const panelId = btn.dataset.panelId;
    switchTab(panelId);
    const panel = document.getElementById(panelId);
    const tournamentId = panel && panel.dataset.tournamentId;
    if (!tournamentId) return;
    const t = getTournamentById(tournamentId);
    if (t && t.type === 'swiss') {
      const h = tournamentId === 'swiss' ? 'swiss' : tournamentId;
      if (location.hash !== '#' + h) location.hash = h;
      switchSwissView(tournamentId, 'matches');
    } else if (location.hash !== '#' + tournamentId) {
      location.hash = tournamentId;
    }
    scheduleUpperBracketLinksRedraw();
  }

  function onSwissViewClick(e) {
    const btn = e.target.closest('.swiss-view-tab[data-swiss-view]');
    if (!btn) return;
    const tid = btn.dataset.tid;
    const view = btn.dataset.swissView;
    if (tid && view) switchSwissView(tid, view);
  }

  function switchTab(panelDomId) {
    document.querySelectorAll('#brackets-panels .brackets-panel').forEach((p) => p.classList.add('hidden'));
    document.querySelectorAll('#brackets-tabs .tab').forEach((t) => t.setAttribute('aria-selected', 'false'));
    const panel = document.getElementById(panelDomId);
    const tabId = panelDomId.replace('panel-', 'tab-');
    const tab = document.getElementById(tabId);
    if (panel) panel.classList.remove('hidden');
    if (tab) tab.setAttribute('aria-selected', 'true');
  }

  function switchSwissView(tournamentId, view) {
    const d = safeDomId(tournamentId);
    const panel = document.getElementById('panel-' + d);
    if (!panel) return;
    const isMatches = view === 'matches';
    const isFlux = view === 'flux';
    const isParcours = view === 'parcours';
    panel.querySelectorAll('.swiss-view-tab').forEach((b) => {
      const active = b.dataset.swissView === view;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active);
    });
    const mv = panel.querySelector('#swiss-matches-view-' + d);
    const fv = panel.querySelector('#swiss-flux-view-' + d);
    const pv = panel.querySelector('#swiss-parcours-view-' + d);
    if (mv) mv.classList.toggle('hidden', !isMatches);
    if (fv) fv.classList.toggle('hidden', !isFlux);
    if (pv) pv.classList.toggle('hidden', !isParcours);
    let hash;
    if (tournamentId === 'swiss') {
      hash = view === 'matches' ? 'swiss' : 'swiss-' + view;
    } else {
      hash = view === 'matches' ? tournamentId : tournamentId + '-' + view;
    }
    if (location.hash !== '#' + hash) location.hash = hash;
  }

  function renderAll() {
    if (!state.data || !state.data.tournaments) return;
    buildTabsAndPanels();
    state.data.tournaments.forEach((t) => {
      const d = safeDomId(t.id);
      const panel = document.getElementById('panel-' + d);
      if (!panel) return;
      if (t.type === 'swiss') renderSwiss(panel, t);
      else renderEliminationPanel(panel, t);
    });
    setupUpperBracketLinkObservers();
    scheduleUpperBracketLinksRedraw();
  }

  function getMatchesFromDb() {
    return (state.data && state.data.matchesFromDb) || [];
  }

  function openEditModal(tournamentId, lane, roundIndex, matchIndex) {
    const t = getTournamentById(tournamentId);
    if (!t) return;
    let m = null;
    if (t.type === 'swiss' || lane === 'swiss') {
      m = t.rounds && t.rounds[roundIndex] && t.rounds[roundIndex].matches[matchIndex];
    } else if (lane === 'grand' && t.grandFinale) {
      m = t.grandFinale.matches[matchIndex];
    } else if (lane === 'lower') {
      m = t.lowerRounds && t.lowerRounds[roundIndex] && t.lowerRounds[roundIndex].matches[matchIndex];
    } else {
      m = t.upperRounds && t.upperRounds[roundIndex] && t.upperRounds[roundIndex].matches[matchIndex];
    }
    if (!m) return;
    $('edit-tournamentId').value = tournamentId;
    $('edit-lane').value = lane;
    $('edit-roundIndex').value = roundIndex;
    $('edit-matchIndex').value = matchIndex;
    $('edit-section').value = tournamentId;
    $('edit-lowerBracket').value = (lane === 'lower' || lane === 'grand') ? '1' : '';
    const hintEl = $('edit-demo-hint');
    hintEl.classList.add('hidden');
    hintEl.textContent = '';

    const matchesFromDb = getMatchesFromDb();
    const demoSelect = $('edit-demoSelect');
    demoSelect.innerHTML = '<option value="">— Aucun —</option>';
    matchesFromDb.forEach((match) => {
      const opt = document.createElement('option');
      opt.value = match.id;
      const nameA = (match.team_a_name || '').trim() || '—';
      const nameB = (match.team_b_name || '').trim() || '—';
      const parts = [];
      if (match.label && match.label !== match.id) parts.push(match.label);
      parts.push(nameA + ' vs ' + nameB);
      if (match.map_name) parts.push(match.map_name);
      opt.textContent = parts.join(' · ');
      opt.dataset.winnerName = match.winner_name || '';
      opt.dataset.teamAName = match.team_a_name || '';
      opt.dataset.teamBName = match.team_b_name || '';
      demoSelect.appendChild(opt);
    });
    demoSelect.value = (m.demoId && matchesFromDb.some((x) => x.id === m.demoId)) ? m.demoId : '';
    $('edit-teamA').value = (m.teamA || '').trim();
    $('edit-teamB').value = (m.teamB || '').trim();
    $('edit-winnerValue').value = (m.winner || '').trim();
    $('edit-demoId').value = (m.demoId != null ? m.demoId : '');
    $('modal-overlay').classList.remove('hidden');
  }

  function onEditDemoSelectChange() {
    const demoSelect = $('edit-demoSelect');
    const hintEl = $('edit-demo-hint');
    const id = demoSelect.value;
    if (!id) {
      $('edit-demoId').value = '';
      $('edit-teamA').value = '';
      $('edit-teamB').value = '';
      $('edit-winnerValue').value = '';
      hintEl.classList.add('hidden');
      return;
    }
    const opt = demoSelect.selectedOptions[0];
    if (!opt) return;
    $('edit-demoId').value = id;
    const nameA = (opt.dataset.teamAName || '').trim();
    const nameB = (opt.dataset.teamBName || '').trim();
    const winnerName = (opt.dataset.winnerName || '').trim();
    $('edit-teamA').value = nameA;
    $('edit-teamB').value = nameB;
    $('edit-winnerValue').value = winnerName || '';
    if (!winnerName) {
      hintEl.classList.remove('hidden');
      hintEl.textContent = 'Ce match n’a pas de vainqueur enregistré en base.';
      hintEl.className = 'edit-demo-hint hint-muted';
    } else {
      hintEl.classList.add('hidden');
    }
  }

  function closeEditModal() {
    $('modal-overlay').classList.add('hidden');
  }

  async function submitEdit(e) {
    e.preventDefault();
    const tournamentId = ($('edit-tournamentId').value || '').trim();
    const lane = ($('edit-lane').value || 'upper').trim();
    const roundIndex = parseInt($('edit-roundIndex').value, 10);
    const matchIndex = parseInt($('edit-matchIndex').value, 10);
    const payload = {
      tournamentId,
      lane,
      roundIndex,
      matchIndex,
      section: tournamentId,
      lowerBracket: lane === 'lower' || lane === 'grand',
      teamA: ($('edit-teamA').value || '').trim(),
      teamB: ($('edit-teamB').value || '').trim(),
      winner: ($('edit-winnerValue').value || '').trim() || null,
      demoId: ($('edit-demoId').value || '').trim() || null
    };
    try {
      await saveMatch(payload);
      closeEditModal();
      renderAll();
    } catch (err) {
      alert(err.message);
    }
  }

  function showLoginModal() {
    $('login-error').classList.add('hidden');
    $('login-password').value = '';
    $('login-overlay').classList.remove('hidden');
  }

  function closeLoginModal() {
    $('login-overlay').classList.add('hidden');
  }

  async function submitLogin(e) {
    e.preventDefault();
    const password = $('login-password').value;
    const errEl = $('login-error');
    errEl.classList.add('hidden');
    try {
      const res = await fetch('/api/brackets/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        errEl.textContent = json.error || 'Erreur connexion';
        errEl.classList.remove('hidden');
        return;
      }
      if (json.token) {
        state.token = json.token;
        state.isAdmin = true;
        sessionStorage.setItem(BRACKETS_STORAGE_KEY, json.token);
        closeLoginModal();
        updateAdminUI();
      }
    } catch (err) {
      errEl.textContent = err.message || 'Erreur réseau';
      errEl.classList.remove('hidden');
    }
  }

  function updateBracketsFooterTime() {
    const el = document.getElementById('data-updated-at');
    if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  async function pollBrackets() {
    try {
      const res = await fetch('/api/brackets');
      if (!res.ok) return;
      const next = await res.json();
      const prevJson = state.data ? JSON.stringify(state.data) : '';
      const nextJson = JSON.stringify(next);
      if (prevJson !== nextJson) {
        state.data = next;
        builtPanelIds = '';
        renderAll();
        updateBracketsFooterTime();
      }
    } catch (_) { /* ignore */ }
  }

  let resizeTimer = null;
  function onResizeRedrawLinks() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => scheduleUpperBracketLinksRedraw(), 120);
  }

  function applyHashRouting() {
    try {
      const raw = (location.hash || '').replace(/^#/, '');
      const hash = raw.toLowerCase();
      const tournaments = (state.data && state.data.tournaments) || [];

      if (hash === 'swiss' || hash === 'swiss-flux' || hash === 'swiss-parcours') {
        switchTab('panel-' + safeDomId('swiss'));
        if (hash === 'swiss-flux') switchSwissView('swiss', 'flux');
        else if (hash === 'swiss-parcours') switchSwissView('swiss', 'parcours');
        else switchSwissView('swiss', 'matches');
        return;
      }

      for (let i = 0; i < tournaments.length; i++) {
        const t = tournaments[i];
        const tidl = String(t.id).toLowerCase();
        if (t.type === 'swiss') {
          if (hash === tidl) {
            switchTab('panel-' + safeDomId(t.id));
            switchSwissView(t.id, 'matches');
            return;
          }
          if (hash === tidl + '-flux') {
            switchTab('panel-' + safeDomId(t.id));
            switchSwissView(t.id, 'flux');
            return;
          }
          if (hash === tidl + '-parcours') {
            switchTab('panel-' + safeDomId(t.id));
            switchSwissView(t.id, 'parcours');
            return;
          }
        } else if (hash === tidl) {
          switchTab('panel-' + safeDomId(t.id));
          return;
        }
      }
    } finally {
      scheduleUpperBracketLinksRedraw();
    }
  }

  async function init() {
    try {
      await fetchBrackets();
      updateBracketsFooterTime();
    } catch (e) {
      state.data = { schemaVersion: 2, tournaments: [] };
    }
    state.isAdmin = !!state.token;
    updateAdminUI();

    setInterval(pollBrackets, 5000);
    window.addEventListener('resize', onResizeRedrawLinks);

    const tabsNavInit = $('brackets-tabs');
    if (tabsNavInit) tabsNavInit.addEventListener('click', onTabClick);
    const panelsRootInit = $('brackets-panels');
    if (panelsRootInit) panelsRootInit.addEventListener('click', onSwissViewClick);

    applyHashRouting();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => scheduleUpperBracketLinksRedraw()).catch(() => {});
    }

    window.addEventListener('hashchange', () => {
      applyHashRouting();
    });

    $('btn-admin').addEventListener('click', showLoginModal);
    $('btn-logout').addEventListener('click', () => {
      state.token = null;
      state.isAdmin = false;
      sessionStorage.removeItem(BRACKETS_STORAGE_KEY);
      updateAdminUI();
    });

    $('modal-form').addEventListener('submit', submitEdit);
    $('modal-cancel').addEventListener('click', closeEditModal);
    $('modal-overlay').addEventListener('click', (e) => { if (e.target === $('modal-overlay')) closeEditModal(); });
    if ($('edit-demoSelect')) $('edit-demoSelect').addEventListener('change', onEditDemoSelectChange);

    const playerOverlay = $('player-overlay');
    if (playerOverlay) {
      const closePlayer = closePlayerOverlayBrackets;
      if ($('player-overlay-close')) $('player-overlay-close').addEventListener('click', closePlayer);
      if ($('player-overlay-backdrop')) $('player-overlay-backdrop').addEventListener('click', closePlayer);
    }
    const matchOverlay = $('match-overlay');
    if (matchOverlay) {
      const closeMatch = closeMatchOverlayBrackets;
      if ($('overlay-close')) $('overlay-close').addEventListener('click', closeMatch);
      if ($('overlay-backdrop')) $('overlay-backdrop').addEventListener('click', closeMatch);
    }
    const teamOverlay = $('team-overlay');
    if (teamOverlay) {
      const closeTeam = closeTeamOverlayBrackets;
      if ($('team-overlay-close')) $('team-overlay-close').addEventListener('click', closeTeam);
      if ($('team-overlay-backdrop')) $('team-overlay-backdrop').addEventListener('click', closeTeam);
    }

    $('login-form').addEventListener('submit', submitLogin);
    $('login-cancel').addEventListener('click', closeLoginModal);
    $('login-overlay').addEventListener('click', (e) => { if (e.target === $('login-overlay')) closeLoginModal(); });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (matchOverlay && !matchOverlay.hasAttribute('hidden')) {
        closeMatchOverlayBrackets();
        return;
      }
      if (teamOverlay && !teamOverlay.hasAttribute('hidden')) {
        closeTeamOverlayBrackets();
        return;
      }
      if (playerOverlay && !playerOverlay.hasAttribute('hidden')) {
        closePlayerOverlayBrackets();
        return;
      }
      if ($('login-overlay') && !$('login-overlay').classList.contains('hidden')) {
        closeLoginModal();
        return;
      }
      if ($('modal-overlay') && !$('modal-overlay').classList.contains('hidden')) {
        closeEditModal();
      }
    });
  }

  init();
})();
