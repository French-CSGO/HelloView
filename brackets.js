(function () {
  'use strict';

  const BRACKETS_STORAGE_KEY = 'brackets_admin_token';

  let state = {
    data: null,
    isAdmin: false,
    token: sessionStorage.getItem(BRACKETS_STORAGE_KEY)
  };

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
      /* pas de stats : on pourrait afficher un message */
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

  function openMatchOverlayFromBracketsCell(section, roundIndex, matchIndex, isLower) {
    const rounds = isLower ? (state.data[section] && state.data[section].lowerRounds) || [] : (state.data[section] && state.data[section].rounds) || [];
    const m = rounds[roundIndex] && rounds[roundIndex].matches[matchIndex];
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

  async function saveMatch(section, roundIndex, matchIndex, payload) {
    const res = await fetch('/api/brackets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ section, roundIndex, matchIndex, ...payload })
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

  /** Retourne [winner, loser] si un vainqueur est défini, sinon [teamA, teamB]. */
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
  const SWISS_CONNECTOR_WIDTH = 44;
  const SWISS_SLOTS = 16;

  const normName = (s) => (s || '').trim().toLowerCase();

  /** Pour chaque match de la ronde r (r >= 1), renvoie les indices des deux matchs de la ronde r-1 d’où viennent les deux équipes (par nom). */
  function getSwissConnectors() {
    const swiss = state.data && state.data.swiss;
    if (!swiss || !swiss.rounds) return [];
    const rounds = swiss.rounds;
    const out = [];
    for (let r = 1; r < rounds.length; r++) {
      const prev = rounds[r - 1].matches || [];
      const curr = rounds[r].matches || [];
      const conn = [];
      curr.forEach((m, j) => {
        const nameA = (m.teamA || '').trim();
        const nameB = (m.teamB || '').trim();
        let srcA = -1, srcB = -1;
        prev.forEach((pm, k) => {
          if (normName(pm.teamA) === normName(nameA) || normName(pm.teamB) === normName(nameA)) srcA = k;
          if (normName(pm.teamA) === normName(nameB) || normName(pm.teamB) === normName(nameB)) srcB = k;
        });
        conn.push({ targetMatchIndex: j, srcMatchA: srcA, srcMatchB: srcB });
      });
      out.push(conn);
    }
    return out;
  }

  function computeSwissStandings() {
    const swiss = state.data && state.data.swiss;
    if (!swiss || !swiss.rounds) return [];
    const rounds = swiss.rounds;
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
        if (s.record.wins >= 3) s.status = 'qualified';
        else if (s.record.losses >= 3) s.status = 'eliminated';
      });
    }
    return standings;
  }

  /** Standings au début de la ronde ri (avant que la ronde ne soit jouée). */
  function getStandingsAtStartOfRound(ri) {
    const standings = computeSwissStandings();
    return standings.map((s) => {
      const pr = ri === 0 ? { wins: 0, losses: 0 } : (s.perRound[ri - 1] || { wins: 0, losses: 0 });
      return { teamName: s.teamName, wins: pr.wins, losses: pr.losses };
    });
  }

  /** Nœuds du flux Swiss : regroupement par bilan W-L + qualifiés / éliminés. */
  function computeSwissFlowNodes() {
    const swiss = state.data && state.data.swiss;
    if (!swiss || !swiss.rounds) return [];
    const rounds = swiss.rounds || [];
    const nodes = [];
    const seenKeys = new Set();

    for (let ri = 0; ri < rounds.length; ri++) {
      const round = rounds[ri];
      const startStandings = getStandingsAtStartOfRound(ri);
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
        if (w === 3 && l === 0) borderClass = 'swiss-flux-border-qualified';
        else if (w === 0 && l === 3) borderClass = 'swiss-flux-border-eliminated';
        else if (l === 0) borderClass = 'swiss-flux-border-winners';
        else if (w === 0) borderClass = 'swiss-flux-border-losers';
        else borderClass = 'swiss-flux-border-mid';
        nodes.push({ wins: w, losses: l, label: w + ':' + l + ' - ' + boLabel, borderClass, matches });
      });
    }

    const standings = computeSwissStandings();
    const qualified = standings.filter((s) => s.status === 'qualified').map((s) => s.teamName);
    const eliminated = standings.filter((s) => s.status === 'eliminated');
    const elimByRecord = {};
    eliminated.forEach((s) => {
      const key = s.record.losses + ':' + s.record.wins;
      if (!elimByRecord[key]) elimByRecord[key] = [];
      elimByRecord[key].push(s.teamName);
    });
    if (qualified.length) {
      nodes.push({ type: 'qualified', label: '3:0 - Qualifiés', borderClass: 'swiss-flux-border-qualified', teams: qualified });
    }
    ['3:0', '3:1', '3:2'].forEach((key) => {
      const teams = elimByRecord[key];
      if (teams && teams.length) {
        const [l, w] = key.split(':').map(Number);
        nodes.push({ type: 'eliminated', label: l + ':' + w + ' - Éliminés', borderClass: 'swiss-flux-border-eliminated', teams });
      }
    });

    return nodes;
  }

  function renderSwissFlux() {
    const container = $('swiss-flux');
    if (!container) return;
    const nodes = computeSwissFlowNodes();
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
            row.addEventListener('click', () => openEditModal('swiss', roundIndex, matchIndex));
          } else {
            row.classList.add('clickable');
            row.addEventListener('click', () => openMatchOverlayFromBracketsCell('swiss', roundIndex, matchIndex, false));
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

  function renderSwiss() {
    const grid = $('swiss-grid');
    if (!state.data || !state.data.swiss) return;
    const rounds = state.data.swiss.rounds || [];
    const roundNames = ['Round 1', 'Round 2', 'Round 3', 'Round 4', 'Round 5'];
    grid.innerHTML = '';
    const totalHeight = SWISS_SLOTS * SWISS_SLOT_HEIGHT;

    /** Répartition en blocs par ronde (indices de slot par bloc). Ronde 3 = 4+8+4 (milieu regroupé). */
    const roundBlocks = {
      1: [[0, 8], [8, 16]],
      2: [[0, 4], [4, 12], [12, 16]],
      3: [[0, 6], [6, 12]],
      4: [[0, 6]]
    };
    /** Labels W-L par ronde (un par bloc). */
    const roundLabels = {
      0: ['0-0'],
      1: ['1-0', '0-1'],
      2: ['2-0', '1-1', '0-2'],
      3: ['2-1', '1-2'],
      4: ['2-2']
    };

    rounds.forEach((round, ri) => {
      const col = document.createElement('div');
      col.className = 'swiss-round swiss-round-with-slots';
      col.style.minHeight = totalHeight + 'px';
      col.innerHTML = '<h3 class="swiss-round-title">' + escapeHtml(roundNames[ri] || 'R' + (ri + 1)) + '</h3><div class="swiss-round-body"></div>';
      const body = col.querySelector('.swiss-round-body');
      const inner = document.createElement('div');
      inner.className = 'swiss-round-inner';
      const container = document.createElement('div');
      container.className = 'swiss-matches';
      body.appendChild(inner);

      const blocks = roundBlocks[ri];
      const slotRanges = blocks || [[0, SWISS_SLOTS]];
      const labels = roundLabels[ri] || [];

      const labelsStrip = document.createElement('div');
      labelsStrip.className = 'swiss-round-labels';
      slotRanges.forEach(([start, end], blockIdx) => {
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

      slotRanges.forEach(([start, end], blockIdx) => {
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
            cell.dataset.section = 'swiss';
            cell.dataset.roundIndex = String(ri);
            cell.dataset.matchIndex = String(slot);
            cell.innerHTML =
              '<span class="match-winner">' + escapeHtml(winner) + '</span>' +
              '<span class="match-loser">' + escapeHtml(loser) + '</span>';
            if (state.isAdmin) {
              cell.addEventListener('click', () => openEditModal('swiss', ri, slot));
            } else {
              cell.classList.add('clickable');
              cell.addEventListener('click', () => openMatchOverlayFromBracketsCell('swiss', ri, slot, false));
            }
            slotEl.appendChild(cell);
          }
          blockWrap.appendChild(slotEl);
        }
        container.appendChild(blockWrap);
      });
      grid.appendChild(col);
    });
    renderParcours();
    renderSwissFlux();
  }

  function renderParcours() {
    const table = $('parcours-table');
    if (!table) return;
    const standings = computeSwissStandings();
    table.innerHTML = '<thead><tr><th>#</th><th>Équipe</th><th>R1</th><th>R2</th><th>R3</th><th>R4</th><th>R5</th><th>Statut</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    standings.forEach((s, idx) => {
      const tr = document.createElement('tr');
      const rCells = [0, 1, 2, 3, 4].map((ri) => {
        const pr = s.perRound[ri];
        if (!pr) return '<td>—</td>';
        if (pr.result === null) return '<td>—</td>';
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

  function renderEliminationTree(containerId, section, isLower) {
    const container = $(containerId);
    if (!container || !state.data || !state.data[section]) return;
    let rounds = isLower ? (state.data[section].lowerRounds || []) : state.data[section].rounds;
    const lowerLabels = ['Lower R1', 'Lower R2', 'Lower R3', 'Lower R4', 'Lower Final'];
    if (isLower) rounds = rounds.slice(0, 5);
    const labels = isLower
      ? lowerLabels
      : (section === 'elite' ? ['8e de finale', 'Quarts', 'Demi-finales', 'Upper Final'] : ['8e de finale', 'Quarts', 'Demi-finales', 'Upper Final']);
    container.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'bracket-tree-inner' + (isLower ? ' bracket-tree-inner-lower' : '');
    if (isLower) {
      const ghostCol = document.createElement('div');
      ghostCol.className = 'bracket-round bracket-round-ghost';
      ghostCol.innerHTML = '<div class="bracket-round-title"></div><div class="bracket-round-matches"></div>';
      inner.appendChild(ghostCol);
    }
    (rounds || []).forEach((round, ri) => {
      const col = document.createElement('div');
      col.className = 'bracket-round';
      col.innerHTML = '<div class="bracket-round-title">' + escapeHtml(labels[ri] || '') + '</div><div class="bracket-round-matches"></div>';
      const matchContainer = col.querySelector('.bracket-round-matches');
      (round.matches || []).forEach((m, mi) => {
        const [winner, loser] = getWinnerLoser(m);
        const wrap = document.createElement('div');
        wrap.className = 'bracket-match-wrap';
        const cell = document.createElement('div');
        cell.className = 'bracket-match' + (state.isAdmin ? ' admin' : '');
        cell.dataset.section = section;
        cell.dataset.roundIndex = String(ri);
        cell.dataset.matchIndex = String(mi);
        cell.dataset.lowerBracket = isLower ? '1' : '';
        cell.innerHTML =
          '<span class="match-winner">' + escapeHtml(winner) + '</span>' +
          '<span class="match-loser">' + escapeHtml(loser) + '</span>';
        if (state.isAdmin) {
          cell.addEventListener('click', () => openEditModal(section, ri, mi, isLower));
        } else {
          cell.classList.add('clickable');
          cell.addEventListener('click', () => openMatchOverlayFromBracketsCell(section, ri, mi, isLower));
        }
        wrap.appendChild(cell);
        matchContainer.appendChild(wrap);
      });
      inner.appendChild(col);
    });
    container.appendChild(inner);
  }

  function renderGrandFinale(containerId, section) {
    const container = $(containerId);
    if (!container || !state.data || !state.data[section]) return;
    const lowerRounds = state.data[section].lowerRounds || [];
    const round = lowerRounds[5];
    container.innerHTML = '';
    if (!round || !round.matches || round.matches.length === 0) return;
    const inner = document.createElement('div');
    inner.className = 'bracket-grand-finale-inner';
    inner.innerHTML = '<div class="bracket-round-title bracket-round-grand-final">Grande Finale</div><div class="bracket-round-matches"></div>';
    const matchContainer = inner.querySelector('.bracket-round-matches');
    round.matches.forEach((m, mi) => {
      const [winner, loser] = getWinnerLoser(m);
      const wrap = document.createElement('div');
      wrap.className = 'bracket-match-wrap';
      const cell = document.createElement('div');
      cell.className = 'bracket-match' + (state.isAdmin ? ' admin' : '');
      cell.dataset.section = section;
      cell.dataset.roundIndex = '5';
      cell.dataset.matchIndex = String(mi);
      cell.dataset.lowerBracket = '1';
      cell.innerHTML =
        '<span class="match-winner">' + escapeHtml(winner) + '</span>' +
        '<span class="match-loser">' + escapeHtml(loser) + '</span>';
      if (state.isAdmin) {
        cell.addEventListener('click', () => openEditModal(section, 5, mi, true));
      } else {
        cell.classList.add('clickable');
        cell.addEventListener('click', () => openMatchOverlayFromBracketsCell(section, 5, mi, true));
      }
      wrap.appendChild(cell);
      matchContainer.appendChild(wrap);
    });
    container.appendChild(inner);
  }

  function renderAll() {
    renderSwiss();
    renderEliminationTree('elite-tree', 'elite', false);
    renderEliminationTree('elite-lower-tree', 'elite', true);
    renderGrandFinale('elite-grand-finale', 'elite');
    renderEliminationTree('amateur-tree', 'amateur', false);
    renderEliminationTree('amateur-lower-tree', 'amateur', true);
    renderGrandFinale('amateur-grand-finale', 'amateur');
  }

  function getMatchesFromDb() {
    return (state.data && state.data.matchesFromDb) || [];
  }

  function openEditModal(section, roundIndex, matchIndex, isLower) {
    if (!state.data || !state.data[section]) return;
    const rounds = isLower ? (state.data[section].lowerRounds || []) : state.data[section].rounds;
    const m = rounds[roundIndex] && rounds[roundIndex].matches[matchIndex];
    if (!m) return;
    $('edit-section').value = section;
    $('edit-roundIndex').value = roundIndex;
    $('edit-matchIndex').value = matchIndex;
    $('edit-lowerBracket').value = isLower ? '1' : '';
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
    const section = $('edit-section').value;
    const roundIndex = parseInt($('edit-roundIndex').value, 10);
    const matchIndex = parseInt($('edit-matchIndex').value, 10);
    const lowerBracket = ($('edit-lowerBracket').value || '') === '1';
    const payload = {
      teamA: ($('edit-teamA').value || '').trim(),
      teamB: ($('edit-teamB').value || '').trim(),
      winner: ($('edit-winnerValue').value || '').trim() || null,
      demoId: ($('edit-demoId').value || '').trim() || null,
      lowerBracket
    };
    try {
      await saveMatch(section, roundIndex, matchIndex, payload);
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

  function switchTab(panelId) {
    document.querySelectorAll('.brackets-panel').forEach((p) => p.classList.add('hidden'));
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', 'false'));
    const panel = $(panelId);
    const tabId = 'tab-' + panelId.replace('panel-', '');
    const tab = $(tabId);
    if (panel) panel.classList.remove('hidden');
    if (tab) tab.setAttribute('aria-selected', 'true');
    const tabName = panelId.replace('panel-', '');
    if (tabName && location.hash !== '#' + tabName) {
      if (tabName === 'swiss' && (location.hash === '#swiss-flux' || location.hash === '#swiss-parcours')) return;
      location.hash = tabName;
    }
  }

  function switchSwissView(view) {
    const isMatches = view === 'matches';
    const isFlux = view === 'flux';
    const isParcours = view === 'parcours';
    $('swiss-tab-matches').classList.toggle('active', isMatches);
    $('swiss-tab-matches').setAttribute('aria-pressed', isMatches);
    $('swiss-tab-flux').classList.toggle('active', isFlux);
    $('swiss-tab-flux').setAttribute('aria-pressed', isFlux);
    $('swiss-tab-parcours').classList.toggle('active', isParcours);
    $('swiss-tab-parcours').setAttribute('aria-pressed', isParcours);
    $('swiss-matches-view').classList.toggle('hidden', !isMatches);
    $('swiss-flux-view').classList.toggle('hidden', !isFlux);
    $('swiss-parcours-view').classList.toggle('hidden', !isParcours);
    const hash = view === 'matches' ? 'swiss' : 'swiss-' + view;
    if (location.hash !== '#' + hash) location.hash = hash;
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
        renderAll();
        updateBracketsFooterTime();
      }
    } catch (_) { /* ignore */ }
  }

  async function init() {
    try {
      await fetchBrackets();
      updateBracketsFooterTime();
    } catch (e) {
      state.data = { swiss: { rounds: [] }, elite: { rounds: [] }, amateur: { rounds: [] } };
    }
    state.isAdmin = !!state.token;
    updateAdminUI();

    setInterval(pollBrackets, 5000);

    $('tab-swiss').addEventListener('click', () => switchTab('panel-swiss'));
    $('tab-elite').addEventListener('click', () => switchTab('panel-elite'));
    $('tab-amateur').addEventListener('click', () => switchTab('panel-amateur'));

    const hash = (location.hash || '').replace(/^#/, '').toLowerCase();
    if (hash === 'elite' || hash === 'amateur') switchTab('panel-' + hash);
    else if (hash === 'swiss' || hash === 'swiss-flux' || hash === 'swiss-parcours') {
      switchTab('panel-swiss');
      if (hash === 'swiss-flux') switchSwissView('flux');
      else if (hash === 'swiss-parcours') switchSwissView('parcours');
    }

    window.addEventListener('hashchange', () => {
      const h = (location.hash || '').replace(/^#/, '').toLowerCase();
      if (h === 'elite' || h === 'amateur') switchTab('panel-' + h);
      else if (h === 'swiss' || h === 'swiss-flux' || h === 'swiss-parcours') {
        switchTab('panel-swiss');
        if (h === 'swiss-flux') switchSwissView('flux');
        else if (h === 'swiss-parcours') switchSwissView('parcours');
      }
    });

    $('swiss-tab-matches').addEventListener('click', () => switchSwissView('matches'));
    $('swiss-tab-flux').addEventListener('click', () => switchSwissView('flux'));
    $('swiss-tab-parcours').addEventListener('click', () => switchSwissView('parcours'));

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
