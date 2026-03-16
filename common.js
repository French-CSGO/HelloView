/**
 * Code partagé HelloView : modale joueur (dashboard + brackets).
 * Utilisation : HelloView.openPlayerOverlay(steamId, data, { onMatchClick?: (checksum) => void })
 *               HelloView.closePlayerOverlay()
 */
(function () {
  const $ = (id) => document.getElementById(id);

  function formatNum(n, decimals) {
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toFixed(decimals);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const t = document.createElement('textarea');
    t.textContent = s;
    return t.innerHTML;
  }

  function rating2Class(r) {
    if (r == null || Number.isNaN(r)) return '';
    if (r >= 1.05) return 'rating-high';
    if (r >= 0.9) return 'rating-mid';
    return 'rating-low';
  }

  const RATING_GAUGE_MAX = 2;
  const ADR_MAX = 175;
  const DPR_MAX = 1;
  const KPR_MAX = 1.30;

  function ratingGaugeColorClass(value) {
    if (value == null) return '';
    if (value < 1) return 'rating-gauge-red';
    if (value < 1.25) return 'rating-gauge-orange';
    if (value < 1.5) return 'rating-gauge-yellow';
    if (value < 1.75) return 'rating-gauge-green-pale';
    return 'rating-gauge-green-bright';
  }

  function getRatingColor(value) {
    const root = document.documentElement;
    const s = root && window.getComputedStyle ? getComputedStyle(root) : null;
    if (!s) return '#9a97b0';
    if (value == null || Number.isNaN(value)) return s.getPropertyValue('--text-muted').trim() || '#9a97b0';
    if (value >= 1.05) return s.getPropertyValue('--green').trim() || '#a4ffb0';
    if (value >= 0.9) return s.getPropertyValue('--orange').trim() || '#f59e0b';
    return s.getPropertyValue('--red').trim() || '#ff6b6b';
  }

  function updateGrafanaRatingGauge(value, max) {
    const valueArc = document.getElementById('grafana-gauge-value-arc');
    const valueText = document.getElementById('grafana-gauge-value-text');
    if (!valueArc || !valueText) return;
    const pathLength = valueArc.getTotalLength();
    const ratio = value != null && max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    const filledLength = ratio * pathLength;
    valueArc.setAttribute('stroke-dasharray', `${filledLength} ${pathLength + 100}`);
    valueArc.setAttribute('stroke-dashoffset', '0');
    const color = getRatingColor(value);
    valueArc.style.stroke = color;
    valueArc.className = 'grafana-gauge-value-arc ' + rating2Class(value);
    valueText.textContent = value != null ? formatNum(value, 2) : '—';
    valueText.style.fill = color;
    valueText.style.color = color;
    valueText.className = 'grafana-gauge-text ' + rating2Class(value);
  }

  function adrGaugeClass(v) {
    if (v == null) return '';
    if (v >= 85) return 'rating-high';
    if (v >= 65) return 'rating-mid';
    return 'rating-low';
  }
  function kastGaugeClass(v) {
    if (v == null) return '';
    if (v >= 80) return 'rating-high';
    if (v >= 50) return 'rating-mid';
    return 'rating-low';
  }
  function dprGaugeClass(v) {
    if (v == null) return '';
    if (v <= 0.65) return 'rating-high';
    if (v <= 0.75) return 'rating-mid';
    return 'rating-low';
  }
  function kprGaugeClass(v) {
    if (v == null) return '';
    if (v >= 1) return 'rating-high';
    if (v >= 0.6) return 'rating-mid';
    return 'rating-low';
  }

  function setLinearGauge(valueElId, fillElId, value, max, suffix, fillClass) {
    const ve = $(valueElId);
    const fe = $(fillElId);
    if (ve) ve.textContent = value != null ? formatNum(value, value >= 100 ? 0 : 2) + (suffix || '') : '—';
    if (fe) {
      fe.style.width = (value != null && max > 0 ? Math.min(100, (value / max) * 100) : 0) + '%';
      fe.className = 'gauge-linear-fill' + (fillClass ? ' ' + fillClass : '');
    }
  }

  function formatDuration(seconds) {
    if (seconds == null || Number.isNaN(seconds)) return '—';
    const n = Number(seconds);
    if (n < 60) return n + 's';
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return s > 0 ? m + 'm ' + s + 's' : m + 'm';
  }

  const TEAM_PLACEHOLDER_PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#6366f1', '#84cc16'];
  function teamPlaceholderColor(teamName) {
    let h = 0;
    const s = String(teamName || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i) | 0;
    return TEAM_PLACEHOLDER_PALETTE[Math.abs(h) % TEAM_PLACEHOLDER_PALETTE.length];
  }
  function getTeamLogoUrl(teams, teamName) {
    if (!teams || !teamName) return null;
    const t = teams.find((x) => x.team_name === teamName);
    return t && t.logo_url ? t.logo_url : null;
  }
  function teamLogoHtml(teamName, logoUrlOrTeams, sizeClass) {
    const size = sizeClass || 'team-logo-32';
    const letter = (teamName && teamName.length) ? teamName.charAt(0).toUpperCase() : '?';
    const teams = Array.isArray(logoUrlOrTeams) ? logoUrlOrTeams : null;
    const url = typeof logoUrlOrTeams === 'string' ? logoUrlOrTeams : (teams ? getTeamLogoUrl(teams, teamName) : null);
    if (url) return '<img class="team-logo ' + size + '" src="' + escapeHtml(url) + '" alt="">';
    const color = teamPlaceholderColor(teamName);
    return '<span class="team-logo-placeholder ' + size + '" style="background:' + escapeHtml(color) + '">' + escapeHtml(letter) + '</span>';
  }

  function getPlayerRanking(rows) {
    const bySteam = {};
    (rows || []).forEach((p) => {
      const id = p.steam_id;
      if (!bySteam[id]) {
        bySteam[id] = {
          steam_id: id,
          name: p.name,
          team_name: p.team_name,
          avatar_url: p.avatar_url || null,
          avatarfull_url: p.avatarfull_url || null,
          custom_avatar_url: p.custom_avatar_url || null,
          kill_count: 0,
          death_count: 0,
          assist_count: 0,
          adr_list: [],
          rating2_list: []
        };
      }
      const agg = bySteam[id];
      agg.kill_count += p.kill_count || 0;
      agg.death_count += p.death_count || 0;
      agg.assist_count += p.assist_count || 0;
      agg.adr_list.push(p.average_damage_per_round != null ? p.average_damage_per_round : 0);
      if (p.hltv_rating_2 != null && !Number.isNaN(p.hltv_rating_2)) agg.rating2_list.push(p.hltv_rating_2);
    });
    return Object.values(bySteam).map((agg) => {
      const adr = agg.adr_list.length ? agg.adr_list.reduce((a, b) => a + b, 0) / agg.adr_list.length : 0;
      const rating2 = agg.rating2_list.length ? agg.rating2_list.reduce((a, b) => a + b, 0) / agg.rating2_list.length : 0;
      const kd = agg.death_count > 0 ? agg.kill_count / agg.death_count : agg.kill_count;
      return {
        steam_id: agg.steam_id,
        name: agg.name,
        team_name: agg.team_name,
        avatar_url: agg.avatar_url || null,
        avatarfull_url: agg.avatarfull_url || null,
        custom_avatar_url: agg.custom_avatar_url || null,
        kill_count: agg.kill_count,
        death_count: agg.death_count,
        assist_count: agg.assist_count,
        adr: adr,
        rating2: rating2,
        kd: kd
      };
    }).sort((a, b) => b.rating2 - a.rating2);
  }

  const OVERLAY_IDS = ['match-overlay', 'player-overlay', 'team-overlay'];
  function bringOverlayToFront(overlayEl) {
    if (!overlayEl) return;
    OVERLAY_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.zIndex = el === overlayEl ? '10002' : '10001';
        el.classList.toggle('overlay-on-top', el === overlayEl);
      }
    });
  }

  function buildMatchOverlayPlayerTable(teamName, score, teamPlayers, isWinner, data, options) {
    const teams = (data && data.teams) || [];
    const onPlayerClick = (options && options.onPlayerClick) || (function () {});
    const block = document.createElement('div');
    block.className = 'match-team-block' + (isWinner ? ' match-team-winner' : '');
    const titleWrap = document.createElement('div');
    titleWrap.className = 'match-team-block-title-wrap';
    titleWrap.innerHTML = teamLogoHtml(teamName, teams, 'team-logo-24') + '<h3 class="match-team-block-title">' + escapeHtml(teamName) + ' (' + escapeHtml(String(score)) + ')</h3>';
    block.appendChild(titleWrap);
    const wrap = document.createElement('div');
    wrap.className = 'match-team-table-wrap';
    const table = document.createElement('table');
    table.className = 'match-overlay-players-table';
    const headers = ['Joueur', 'K', 'A', 'D', 'K/D diff', 'K/D', 'DMG', 'KAST', 'UDR', 'HS', 'HS%', 'MVP', 'HLTV 2.0', 'HLTV', 'UD', 'FK', 'FD', 'TK', 'TD', 'FTK', 'FTD', 'S', 'BP', 'BD', '5K', '4K', '3K', '2K'];
    table.innerHTML = '<thead><tr>' + headers.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    teamPlayers.forEach((p) => {
      const k = p.kill_count != null ? p.kill_count : '—';
      const a = p.assist_count != null ? p.assist_count : '—';
      const d = p.death_count != null ? p.death_count : '—';
      const kdDiff = (p.kill_count != null && p.death_count != null) ? (p.kill_count - p.death_count) : null;
      const kd = (p.death_count != null && p.death_count > 0 && p.kill_count != null) ? (p.kill_count / p.death_count) : null;
      const totalDmg = (p.damage_health != null && p.damage_armor != null) ? (p.damage_health + p.damage_armor) : (p.damage_health != null ? p.damage_health : p.damage_armor);
      const hs = p.headshot_count != null ? p.headshot_count : '—';
      const hsPct = (p.kill_count != null && p.kill_count > 0 && p.headshot_count != null) ? (p.headshot_count / p.kill_count * 100) : null;
      const r2Class = rating2Class(p.hltv_rating_2);
      const cells = [
        escapeHtml(p.name),
        formatNum(k, 0),
        formatNum(a, 0),
        formatNum(d, 0),
        kdDiff != null ? formatNum(kdDiff, 0) : '—',
        kd != null ? formatNum(kd, 2) : '—',
        totalDmg != null ? formatNum(totalDmg, 0) : '—',
        p.kast != null ? formatNum(p.kast, 1) + '%' : '—',
        p.utility_damage_per_round != null ? formatNum(p.utility_damage_per_round, 1) : '—',
        hs !== '—' ? String(hs) : '—',
        hsPct != null ? formatNum(hsPct, 1) + '%' : '—',
        p.mvp_count != null ? formatNum(p.mvp_count, 0) : '—',
        p.hltv_rating_2 != null ? '<span class="num ' + r2Class + '">' + formatNum(p.hltv_rating_2, 2) + '</span>' : '—',
        p.hltv_rating != null ? formatNum(p.hltv_rating, 2) : '—',
        p.utility_damage != null ? formatNum(p.utility_damage, 0) : '—',
        p.first_kill_count != null ? formatNum(p.first_kill_count, 0) : '—',
        p.first_death_count != null ? formatNum(p.first_death_count, 0) : '—',
        p.trade_kill_count != null ? formatNum(p.trade_kill_count, 0) : '—',
        p.trade_death_count != null ? formatNum(p.trade_death_count, 0) : '—',
        p.first_trade_kill_count != null ? formatNum(p.first_trade_kill_count, 0) : '—',
        p.first_trade_death_count != null ? formatNum(p.first_trade_death_count, 0) : '—',
        p.score != null ? formatNum(p.score, 0) : '—',
        p.bomb_planted_count != null ? formatNum(p.bomb_planted_count, 0) : '—',
        p.bomb_defused_count != null ? formatNum(p.bomb_defused_count, 0) : '—',
        p.five_kill_count != null ? formatNum(p.five_kill_count, 0) : '—',
        p.four_kill_count != null ? formatNum(p.four_kill_count, 0) : '—',
        p.three_kill_count != null ? formatNum(p.three_kill_count, 0) : '—',
        p.two_kill_count != null ? formatNum(p.two_kill_count, 0) : '—'
      ];
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + cells[0] + '</td>' + cells.slice(1).map((c) => '<td class="num">' + c + '</td>').join('');
      if (p.steam_id) {
        tr.classList.add('clickable-row');
        tr.dataset.steamId = p.steam_id;
        tr.addEventListener('click', () => onPlayerClick(p.steam_id));
      }
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    block.appendChild(wrap);
    return block;
  }

  function openMatchOverlay(checksum, data, options) {
    const overlay = $('match-overlay');
    const titleEl = $('overlay-title');
    const scoreLineEl = $('overlay-header-score-line');
    const metaEl = $('overlay-match-meta');
    const teamsEl = $('overlay-match-teams');
    if (!overlay || !data) return;
    const match = (data.matches || []).find((m) => m.id === checksum);
    const players = (data.players || []).filter((p) => p.match_checksum === checksum);
    const teamAName = match && (match.team_a_name != null) ? match.team_a_name : null;
    const teamBName = match && (match.team_b_name != null) ? match.team_b_name : null;
    const names = [...new Set(players.map((p) => p.team_name))];
    const nameA = teamAName || names[0];
    const nameB = teamBName || names[1];
    const scoreA = match && match.team_a_score != null ? match.team_a_score : '—';
    const scoreB = match && match.team_b_score != null ? match.team_b_score : '—';
    const winnerName = match && match.winner_name ? match.winner_name : null;
    const winnerTeam = winnerName === nameA ? nameA : nameB;
    const loserTeam = winnerName === nameA ? nameB : nameA;
    const winnerScore = winnerName === nameA ? scoreA : scoreB;
    const loserScore = winnerName === nameA ? scoreB : scoreA;
    const playersWinner = players.filter((p) => p.team_name === winnerTeam).sort((a, b) => (b.hltv_rating_2 || 0) - (a.hltv_rating_2 || 0));
    const playersLoser = players.filter((p) => p.team_name === loserTeam).sort((a, b) => (b.hltv_rating_2 || 0) - (a.hltv_rating_2 || 0));

    titleEl.textContent = match ? (match.name || match.label) : 'Détail du match';
    const teams = data.teams || [];
    if (scoreLineEl) {
      scoreLineEl.innerHTML = '<span class="overlay-score-team overlay-score-team-clickable" role="button" tabindex="0">' + escapeHtml(nameA) + ' ' + teamLogoHtml(nameA, teams, 'team-logo-20') + '</span> <span class="overlay-score-box">' + escapeHtml(String(scoreA)) + ' – ' + escapeHtml(String(scoreB)) + '</span> <span class="overlay-score-team overlay-score-team-clickable" role="button" tabindex="0">' + teamLogoHtml(nameB, teams, 'team-logo-20') + ' ' + escapeHtml(nameB) + '</span>';
      const onTeamClick = (options && options.onTeamClick) || (function () {});
      scoreLineEl.querySelectorAll('.overlay-score-team-clickable').forEach((el, i) => {
        const teamName = i === 0 ? nameA : nameB;
        el.addEventListener('click', () => onTeamClick(teamName));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTeamClick(teamName); } });
      });
    }

    const durationStr = match && match.duration_seconds != null ? formatDuration(match.duration_seconds) : '—';
    const mapStr = match && match.map_name ? escapeHtml(match.map_name) : '—';
    const serverStr = (match && match.server_name) ? escapeHtml(match.server_name) : '—';
    metaEl.innerHTML = '<span class="overlay-meta-item"><strong>Map</strong> ' + mapStr + '</span>' +
      '<span class="overlay-meta-item"><strong>Score</strong> ' + escapeHtml(winnerTeam) + ' ' + winnerScore + ' – ' + loserScore + ' ' + escapeHtml(loserTeam) + '</span>' +
      '<span class="overlay-meta-item"><strong>Durée</strong> ' + durationStr + '</span>' +
      '<span class="overlay-meta-item"><strong>Serveur</strong> ' + serverStr + '</span>';

    teamsEl.innerHTML = '';
    teamsEl.appendChild(buildMatchOverlayPlayerTable(winnerTeam, winnerScore, playersWinner, true, data, options));
    teamsEl.appendChild(buildMatchOverlayPlayerTable(loserTeam, loserScore, playersLoser, false, data, options));

    overlay.removeAttribute('hidden');
    bringOverlayToFront(overlay);
    document.body.style.overflow = 'hidden';
    const closeBtn = $('overlay-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeMatchOverlay() {
    const o = $('match-overlay');
    if (o) o.setAttribute('hidden', '');
  }

  function openTeamOverlay(teamName, data, options) {
    const overlay = $('team-overlay');
    const titleEl = $('team-overlay-title');
    const heroLogoWrap = $('team-overlay-logo-wrap');
    const heroTeamName = $('team-overlay-team-name');
    const summaryEl = $('team-overlay-summary');
    const playersListEl = $('team-overlay-players-list');
    const matchesListEl = $('team-overlay-matches-list');
    if (!overlay || !data) return;
    const teams = data.teams || [];
    const team = teams.find((t) => t.team_name === teamName);
    const rows = (data.players || []).filter((p) => p.team_name === teamName);
    const matches = data.matches || [];

    titleEl.textContent = 'Détail équipe';
    if (heroLogoWrap) heroLogoWrap.innerHTML = teamLogoHtml(teamName, team && team.logo_url ? team.logo_url : teams, 'team-logo-80');
    if (heroTeamName) heroTeamName.textContent = teamName || '—';

    const wins = team ? team.wins : 0;
    const losses = team ? team.losses : 0;
    const matchCount = team ? team.matchCount : 0;
    const winsPct = team && team.winsPct != null ? formatNum(team.winsPct, 1) + '%' : '—';
    const ratioVictoire = matchCount > 0 ? formatNum((wins / matchCount) * 100, 1) + '%' : '—';
    const totalPlanted = rows.reduce((s, p) => s + (p.bomb_planted_count || 0), 0);
    const totalDefused = rows.reduce((s, p) => s + (p.bomb_defused_count || 0), 0);
    const n = rows.length;
    const avgHltv1 = n ? rows.reduce((s, p) => s + (p.hltv_rating || 0), 0) / n : null;
    const avgHltv2 = n ? rows.reduce((s, p) => s + (p.hltv_rating_2 || 0), 0) / n : null;
    const avgKast = n ? rows.reduce((s, p) => s + (p.kast || 0), 0) / n : null;
    const avgKpr = n ? rows.reduce((s, p) => s + (p.average_kill_per_round || 0), 0) / n : null;
    const matchChecksums = [...new Set(rows.map((p) => p.match_checksum))];
    let totalRounds = 0;
    matchChecksums.forEach((checksum) => {
      const m = matches.find((x) => x.id === checksum);
      if (m && m.team_a_score != null && m.team_b_score != null) totalRounds += m.team_a_score + m.team_b_score;
    });

    summaryEl.innerHTML = '<div class="team-overlay-stats-grid">' +
      '<div class="team-overlay-stat"><span class="team-overlay-stat-label">Ratio victoire</span><span class="team-overlay-stat-value">' + ratioVictoire + '</span></div>' +
      '<div class="team-overlay-stat"><span class="team-overlay-stat-label">W/L</span><span class="team-overlay-stat-value">' + wins + ' / ' + losses + '</span></div>' +
      '<div class="team-overlay-stat"><span class="team-overlay-stat-label">W/L %</span><span class="team-overlay-stat-value">' + winsPct + '</span></div>' +
      '<div class="team-overlay-stat"><span class="team-overlay-stat-label">Objectifs (plantée / désamorcée)</span><span class="team-overlay-stat-value">' + totalPlanted + ' / ' + totalDefused + '</span></div>' +
      '<div class="team-overlay-stat"><span class="team-overlay-stat-label">HLTV 1.0</span><span class="team-overlay-stat-value">' + (avgHltv1 != null ? formatNum(avgHltv1, 2) : '—') + '</span></div>' +
      '<div class="team-overlay-stat"><span class="team-overlay-stat-label">HLTV 2.0</span><span class="team-overlay-stat-value">' + (avgHltv2 != null ? formatNum(avgHltv2, 2) : '—') + '</span></div>' +
      '<div class="team-overlay-stat"><span class="team-overlay-stat-label">KAST</span><span class="team-overlay-stat-value">' + (avgKast != null ? formatNum(avgKast, 1) + '%' : '—') + '</span></div>' +
      '<div class="team-overlay-stat"><span class="team-overlay-stat-label">Kills / round (moy.)</span><span class="team-overlay-stat-value">' + (avgKpr != null ? formatNum(avgKpr, 2) : '—') + '</span></div>' +
      '<div class="team-overlay-stat"><span class="team-overlay-stat-label">Rounds</span><span class="team-overlay-stat-value">' + (totalRounds || '—') + '</span></div></div>';

    const ranking = getPlayerRanking(rows);
    const onPlayerClick = (options && options.onPlayerClick) || (function () {});
    const playersTable = document.createElement('table');
    playersTable.className = 'stats-table team-overlay-players-table';
    playersTable.innerHTML = '<thead><tr><th>Joueur</th><th>K/D/A</th><th>K/D</th><th>ADR</th><th>RATING 2.0</th></tr></thead><tbody></tbody>';
    const playersTbody = playersTable.querySelector('tbody');
    ranking.forEach((p) => {
      const tr = document.createElement('tr');
      tr.className = 'player-row';
      tr.dataset.steamId = p.steam_id;
      tr.setAttribute('role', 'button');
      tr.setAttribute('tabindex', '0');
      tr.innerHTML = '<td class="player-cell">' +
        ((p.custom_avatar_url || p.avatar_url) ? '<img class="player-avatar" src="' + escapeHtml(p.custom_avatar_url || p.avatar_url) + '" alt="" width="32" height="32">' : '') +
        '<strong>' + escapeHtml(p.name) + '</strong></td>' +
        '<td class="num">' + p.kill_count + '/' + p.death_count + '/' + p.assist_count + '</td>' +
        '<td class="num">' + formatNum(p.kd, 2) + '</td>' +
        '<td class="num">' + formatNum(p.adr, 1) + '</td>' +
        '<td class="num score ' + rating2Class(p.rating2) + '">' + formatNum(p.rating2, 2) + '</td>';
      tr.addEventListener('click', () => onPlayerClick(p.steam_id));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlayerClick(p.steam_id); } });
      playersTbody.appendChild(tr);
    });
    playersListEl.innerHTML = '';
    playersListEl.appendChild(playersTable);

    const onMatchClick = (options && options.onMatchClick) || (function () {});
    const matchIds = [...new Set(rows.map((p) => p.match_checksum))];
    const matchList = matchIds.map((c) => matches.find((m) => m.id === c)).filter(Boolean).sort((a, b) => new Date(a.analyze_date || 0) - new Date(b.analyze_date || 0));
    const table = document.createElement('table');
    table.className = 'stats-table team-matches-table';
    table.innerHTML = '<thead><tr><th>Date / Heure</th><th>Adversaire</th><th>Map</th><th>Score</th><th>Résultat</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    matchList.forEach((m) => {
      const adv = m.team_a_name === teamName ? m.team_b_name : m.team_a_name;
      const scoreA = m.team_a_score != null ? m.team_a_score : '—';
      const scoreB = m.team_b_score != null ? m.team_b_score : '—';
      const scoreStr = m.team_a_name === teamName ? scoreA + ' – ' + scoreB : scoreB + ' – ' + scoreA;
      const won = m.winner_name === teamName;
      const dateStr = m.analyze_date ? new Date(m.analyze_date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      const tr = document.createElement('tr');
      tr.className = 'clickable-row';
      tr.innerHTML = '<td>' + escapeHtml(dateStr) + '</td><td>' + escapeHtml(adv || '—') + '</td><td>' + escapeHtml(m.map_name || '—') + '</td><td class="num">' + scoreStr + '</td><td class="' + (won ? 'result-win' : 'result-loss') + '">' + (won ? 'Victoire' : 'Défaite') + '</td>';
      tr.addEventListener('click', () => onMatchClick(m.id));
      tbody.appendChild(tr);
    });
    matchesListEl.innerHTML = '';
    matchesListEl.appendChild(table);

    overlay.removeAttribute('hidden');
    bringOverlayToFront(overlay);
    document.body.style.overflow = 'hidden';
    const closeBtn = $('team-overlay-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeTeamOverlay() {
    const o = $('team-overlay');
    if (o) o.setAttribute('hidden', '');
  }

  function openPlayerOverlay(steamId, data, options) {
    const overlay = $('player-overlay');
    const titleEl = $('player-overlay-title');
    const listEl = $('player-overlay-matches-list');
    if (!overlay || !data) return;

    const rows = (data.players || []).filter((p) => p.steam_id === steamId);
    if (rows.length === 0) return;

    const first = rows[0];
    const name = first.name;
    const teamName = first.team_name;

    const avgAdr = rows.length ? rows.reduce((s, p) => s + (p.average_damage_per_round || 0), 0) / rows.length : 0;
    const avgKast = rows.length ? rows.reduce((s, p) => s + (p.kast || 0), 0) / rows.length : 0;
    const avgRating2 = rows.length ? rows.reduce((s, p) => s + (p.hltv_rating_2 || 0), 0) / rows.length : 0;
    const avgDpr = rows.length ? rows.reduce((s, p) => s + (p.average_death_per_round || 0), 0) / rows.length : 0;
    const avgKpr = rows.length ? rows.reduce((s, p) => s + (p.average_kill_per_round || 0), 0) / rows.length : 0;

    titleEl.textContent = name;

    const avatarWrap = $('player-overlay-avatar-wrap');
    const nameEl = $('player-overlay-name');
    const teamEl = $('player-overlay-team');
    const identityEl = $('player-overlay-identity');
    const nameRow = nameEl && nameEl.parentElement && nameEl.parentElement.classList.contains('player-overlay-name-row') ? nameEl.parentElement : null;

    if (nameRow) {
      const prevSteam = nameRow.querySelector('.player-overlay-avatar-steam');
      if (prevSteam) prevSteam.remove();
    }
    if (identityEl) identityEl.classList.remove('player-overlay-identity-has-custom');

    if (avatarWrap) {
      const customUrl = first.custom_avatar_url;
      const steamUrl = first.avatarfull_url || first.avatar_url;
      if (customUrl) {
        avatarWrap.innerHTML = '<img class="player-overlay-avatar-custom" src="' + escapeHtml(customUrl) + '" alt="">';
        avatarWrap.classList.add('player-overlay-avatar-has-custom');
        if (identityEl) identityEl.classList.add('player-overlay-identity-has-custom');
        if (nameRow && steamUrl) {
          const steamImg = document.createElement('img');
          steamImg.className = 'player-overlay-avatar-steam';
          steamImg.src = steamUrl;
          steamImg.alt = '';
          nameRow.insertBefore(steamImg, nameEl);
        }
      } else {
        avatarWrap.classList.remove('player-overlay-avatar-has-custom');
        avatarWrap.innerHTML = steamUrl ? '<img src="' + escapeHtml(steamUrl) + '" alt="">' : '';
      }
    }
    if (nameEl) nameEl.textContent = name;
    if (teamEl) {
      const teams = data.teams || [];
      const team = teamName ? teams.find((t) => t.team_name === teamName) : null;
      const logoUrl = team && team.logo_url ? team.logo_url : null;
      const logoHtml = logoUrl ? '<img class="team-logo team-logo-24 player-overlay-team-logo" src="' + escapeHtml(logoUrl) + '" alt="">' : '';
      teamEl.innerHTML = (logoHtml ? logoHtml + ' ' : '') + escapeHtml(teamName || '');
      teamEl.removeAttribute('role');
      teamEl.removeAttribute('tabindex');
      teamEl.classList.remove('player-overlay-team-clickable');
      teamEl.onclick = null;
      teamEl.onkeydown = null;
      if (teamName && options && options.onTeamClick) {
        teamEl.classList.add('player-overlay-team-clickable');
        teamEl.setAttribute('role', 'button');
        teamEl.setAttribute('tabindex', '0');
        teamEl.onclick = () => options.onTeamClick(teamName);
        teamEl.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            options.onTeamClick(teamName);
          }
        };
      }
    }

    updateGrafanaRatingGauge(avgRating2, RATING_GAUGE_MAX);
    setLinearGauge('player-gauge-dpr-value', 'player-gauge-dpr-fill', avgDpr, DPR_MAX, '', dprGaugeClass(avgDpr));
    setLinearGauge('player-gauge-kast-value', 'player-gauge-kast-fill', avgKast, 100, '%', kastGaugeClass(avgKast));
    setLinearGauge('player-gauge-adr-value', 'player-gauge-adr-fill', avgAdr, ADR_MAX, '', adrGaugeClass(avgAdr));
    setLinearGauge('player-gauge-kpr-value', 'player-gauge-kpr-fill', avgKpr, KPR_MAX, '', kprGaugeClass(avgKpr));

    listEl.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'stats-table player-matches-table';
    table.innerHTML = '<thead><tr><th>Date / Heure</th><th>Équipe opposante</th><th>Map</th><th>K - D</th><th>+/-</th><th>Rating</th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    const matches = data.matches || [];
    const onMatchClick = (options && options.onMatchClick) || (function () {});

    rows.forEach((p) => {
      const match = matches.find((m) => m.id === p.match_checksum);
      const dateStr = match && match.analyze_date
        ? new Date(match.analyze_date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '—';
      const opposingTeam = match && (match.team_a_name && match.team_b_name)
        ? (match.team_a_name === teamName ? match.team_b_name : match.team_a_name)
        : '—';
      const mapName = match && match.map_name ? match.map_name : '—';
      const kdStr = (p.kill_count || 0) + ' - ' + (p.death_count || 0);
      const plusMinus = (p.kill_count || 0) - (p.death_count || 0);
      const plusMinusStr = (plusMinus >= 0 ? '+' : '') + plusMinus;
      const rating = p.hltv_rating_2 != null ? formatNum(p.hltv_rating_2, 2) : '—';
      const rClassRow = rating2Class(p.hltv_rating_2);
      const tr = document.createElement('tr');
      tr.className = 'clickable-row';
      tr.innerHTML = '<td>' + escapeHtml(dateStr) + '</td><td>' + escapeHtml(opposingTeam) + '</td><td>' + escapeHtml(mapName) + '</td><td class="num">' + kdStr + '</td><td class="num">' + plusMinusStr + '</td><td class="num score ' + rClassRow + '">' + rating + '</td>';
      tr.addEventListener('click', () => onMatchClick(p.match_checksum));
      tbody.appendChild(tr);
    });
    listEl.appendChild(table);

    overlay.removeAttribute('hidden');
    bringOverlayToFront(overlay);
    document.body.style.overflow = 'hidden';
    const closeBtn = $('player-overlay-close');
    if (closeBtn) closeBtn.focus();
  }

  function closePlayerOverlay() {
    const overlay = $('player-overlay');
    if (overlay) overlay.setAttribute('hidden', '');
  }

  window.HelloView = window.HelloView || {};
  window.HelloView.openPlayerOverlay = openPlayerOverlay;
  window.HelloView.closePlayerOverlay = closePlayerOverlay;
  window.HelloView.openMatchOverlay = openMatchOverlay;
  window.HelloView.closeMatchOverlay = closeMatchOverlay;
  window.HelloView.openTeamOverlay = openTeamOverlay;
  window.HelloView.closeTeamOverlay = closeTeamOverlay;
  window.HelloView.teamLogoHtml = teamLogoHtml;
  window.HelloView.getPlayerRanking = getPlayerRanking;

  /* Konami code : ↑↑↓↓←→←→ B A → vitre brisée + tremblement page */
  const KONAMI = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
  let konamiIndex = 0;
  const SHAKE_DURATION_MS = 1400;

  function playKonamiAnimation() {
    if (document.getElementById('konami-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'konami-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    const style = document.createElement('style');
    style.textContent = [
      'body.konami-shake { animation: konami-body-shake 0.08s ease-in-out infinite; }',
      '@keyframes konami-body-shake { 0%, 100% { transform: translate(0, 0); } 10% { transform: translate(-4px, -3px); } 20% { transform: translate(3px, 4px); } 30% { transform: translate(-3px, 2px); } 40% { transform: translate(4px, -4px); } 50% { transform: translate(-2px, 3px); } 60% { transform: translate(3px, -2px); } 70% { transform: translate(-4px, 4px); } 80% { transform: translate(2px, -3px); } 90% { transform: translate(-3px, -2px); } }',
      '#konami-overlay { position: fixed; inset: 0; z-index: 99999; pointer-events: auto; cursor: pointer; }',
      '#konami-overlay .konami-bg { position: absolute; inset: 0; background: rgba(0,0,0,0.25); }',
      '#konami-overlay .konami-impact-wrap { position: absolute; top: 50%; left: 50%; width: 90vmin; height: 90vmin; max-width: 520px; max-height: 520px; margin: 0; transform: translate(-50%, -50%); }',
      '#konami-overlay .konami-cracks { position: absolute; inset: -10%; width: 120%; height: 120%; left: -10%; top: -10%; opacity: 0; animation: konami-cracks-in 0.35s ease-out 0.05s forwards; }',
      '#konami-overlay .konami-cracks line { stroke: rgba(255,255,255,0.6); stroke-width: 2; }',
      '#konami-overlay .konami-shard { position: absolute; left: 50%; top: 50%; background: linear-gradient(145deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.08) 40%, rgba(200,220,255,0.12) 100%); border: 1px solid rgba(255,255,255,0.5); border-radius: 2px; box-shadow: inset 0 0 6px rgba(255,255,255,0.2); transform-origin: 50% 50%; animation: konami-shard-fly 2.2s ease-out forwards; opacity: 0; }',
      '@keyframes konami-cracks-in { 0% { opacity: 0; transform: scale(0.4); } 100% { opacity: 1; transform: scale(1); } }',
      '@keyframes konami-shard-fly { 0% { opacity: 0.95; transform: translate(0,0) scale(1) rotate(0deg); } 100% { opacity: 0; transform: var(--shard-delta) scale(0.5) rotate(var(--shard-rot)); } }'
    ].join('\n');
    document.head.appendChild(style);

    document.body.classList.add('konami-shake');
    setTimeout(function () {
      document.body.classList.remove('konami-shake');
    }, SHAKE_DURATION_MS);

    const bg = document.createElement('div');
    bg.className = 'konami-bg';
    overlay.appendChild(bg);

    const impactWrap = document.createElement('div');
    impactWrap.className = 'konami-impact-wrap';

    const cracks = document.createElement('svg');
    cracks.className = 'konami-cracks';
    cracks.setAttribute('viewBox', '0 0 400 400');
    cracks.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', 'translate(200,200)');
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2 + Math.random() * 0.3;
      const len = 80 + Math.random() * 80;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0);
      line.setAttribute('y1', 0);
      line.setAttribute('x2', Math.cos(angle) * len);
      line.setAttribute('y2', Math.sin(angle) * len);
      g.appendChild(line);
    }
    cracks.appendChild(g);
    impactWrap.appendChild(cracks);
    overlay.appendChild(impactWrap);

    const numShards = 55;
    const centerX = 0;
    const centerY = 0;
    for (let i = 0; i < numShards; i++) {
      const angle = (i / numShards) * Math.PI * 2 + Math.random() * 0.6;
      const dist = 15 + Math.random() * 45;
      const flyDist = 180 + Math.random() * 220;
      const tx = Math.cos(angle) * flyDist + (Math.random() - 0.5) * 80;
      const ty = Math.sin(angle) * flyDist + (Math.random() - 0.5) * 80 + 80;
      const rot = (Math.random() - 0.5) * 900;
      const size = 14 + Math.random() * 28;
      const shard = document.createElement('div');
      shard.className = 'konami-shard';
      shard.style.width = size + 'px';
      shard.style.height = size + 'px';
      shard.style.marginLeft = (centerX + Math.cos(angle) * dist - size / 2) + 'px';
      shard.style.marginTop = (centerY + Math.sin(angle) * dist - size / 2) + 'px';
      shard.style.setProperty('--shard-delta', 'translate(' + tx + 'px, ' + ty + 'px)');
      shard.style.setProperty('--shard-rot', rot + 'deg');
      shard.style.animationDelay = (0.05 + Math.random() * 0.2) + 's';
      overlay.appendChild(shard);
    }

    document.body.appendChild(overlay);
    overlay.addEventListener('click', function remove() {
      document.body.classList.remove('konami-shake');
      overlay.remove();
      style.remove();
    });
    setTimeout(function () {
      if (overlay.parentNode) overlay.click();
    }, 3800);
  }

  document.addEventListener('keydown', function (e) {
    if (e.keyCode === KONAMI[konamiIndex]) {
      konamiIndex++;
      if (konamiIndex === KONAMI.length) {
        konamiIndex = 0;
        playKonamiAnimation();
      }
    } else {
      konamiIndex = 0;
    }
  });
})();

/* Pied de page partagé (dashboard + brackets) */
(function () {
  function renderAppFooter() {
    var el = document.getElementById('footer-common');
    if (!el) return;
    el.innerHTML = '<span>Dernière mise à jour depuis les demo CS2 : <span id="data-updated-at">—</span></span>' +
      '<div class="footer-credit">HelloView! — <a href="https://github.com/Nemavio/HelloView" target="_blank" rel="noopener noreferrer" class="footer-github" title="Code Source"><svg class="footer-github-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg> Code Source</a> — Vibecodé et hébergé avec <span class="footer-heart" aria-hidden="true">♥</span> par <a href="https://x.com/nemavdotio" target="_blank" rel="noopener noreferrer">Nemavio</a> pour la <a href="https://esport.helloworldedhec.com/" target="_blank" rel="noopener noreferrer">HelloWorld!Nexen</a> !</div>';
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAppFooter);
  } else {
    renderAppFooter();
  }
})();
