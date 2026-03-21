/**
 * Fichier stats statique (`data/players.json`) : versionné pour migrations.
 * Forme cible alignée sur GET /api/stats : { players, matches, teams }
 * + métadonnée `statsFileVersion` (entier, incrémenté lors de breaking changes).
 *
 * Lecture : parseStatsFileContent(raw) accepte l’ancien format import
 * ({ matches, players } sans version) et produit toujours la forme courante.
 */

const STATS_FILE_VERSION = 1;

/**
 * @param {unknown} matches
 * @param {unknown} players
 * @returns {Array<Record<string, unknown>>}
 */
function enrichMatchesFromPlayers(matches, players) {
  const byChecksum = {};
  (players || []).forEach((p) => {
    if (!p || typeof p !== 'object') return;
    const ck = p.match_checksum != null ? String(p.match_checksum).trim() : '';
    if (!ck) return;
    if (!byChecksum[ck]) byChecksum[ck] = [];
    if (p.team_name != null && String(p.team_name).trim() !== '') {
      const name = String(p.team_name).trim();
      if (!byChecksum[ck].includes(name)) byChecksum[ck].push(name);
    }
  });
  return (matches || []).map((m) => {
    if (!m || typeof m !== 'object') return {};
    const id = m.id != null ? String(m.id).trim() : '';
    const teams = id ? (byChecksum[id] || []) : [];
    const out = { ...m };
    if (id) out.id = id;
    if (out.label == null && out.name != null) out.label = out.name;
    if ((out.team_a_name == null || String(out.team_a_name).trim() === '') && teams[0]) {
      out.team_a_name = teams[0];
    }
    if ((out.team_b_name == null || String(out.team_b_name).trim() === '') && teams[1]) {
      out.team_b_name = teams[1];
    }
    return out;
  });
}

/**
 * @param {unknown} players
 * @param {unknown} matches
 * @returns {Array<{ team_name: string, matchCount: number, wins: number, losses: number, winsPct: number | null, logo_url: null }>}
 */
function buildTeamsFromPlayersAndMatches(players, matches) {
  const teamNames = [...new Set((players || [])
    .filter((p) => p && typeof p === 'object')
    .map((p) => p.team_name)
    .filter((n) => n != null && String(n).trim() !== '')
    .map((n) => String(n).trim()))];

  const matchWinnerByChecksum = {};
  (matches || []).forEach((m) => {
    if (!m || typeof m !== 'object') return;
    const id = m.id != null ? String(m.id).trim() : '';
    if (!id) return;
    if (m.winner_name != null && String(m.winner_name).trim() !== '') {
      matchWinnerByChecksum[id] = String(m.winner_name).trim();
    }
  });

  return teamNames.map((team_name) => {
    const playedChecksums = [...new Set((players || [])
      .filter((p) => p && typeof p === 'object' && p.team_name === team_name)
      .map((p) => p.match_checksum)
      .filter(Boolean)
      .map((c) => String(c).trim()))];

    let wins = 0;
    let losses = 0;
    playedChecksums.forEach((checksum) => {
      const winner = matchWinnerByChecksum[checksum];
      if (winner == null) return;
      if (winner === team_name) wins += 1;
      else losses += 1;
    });
    const decided = wins + losses;
    const winsPct = decided > 0 ? (wins / decided) * 100 : null;
    return {
      team_name,
      matchCount: playedChecksums.length,
      wins,
      losses,
      winsPct,
      logo_url: null
    };
  });
}

/**
 * Normalise un objet déjà parsé vers la forme fichier stats v1.
 * @param {unknown} parsed
 * @returns {{ statsFileVersion: number, players: Array, matches: Array, teams: Array }}
 */
function normalizeStatsPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { statsFileVersion: STATS_FILE_VERSION, players: [], matches: [], teams: [] };
  }

  const players = Array.isArray(parsed.players)
    ? parsed.players.map((p) => (p && typeof p === 'object' ? { ...p } : p)).filter((p) => p && typeof p === 'object')
    : [];

  let matches = Array.isArray(parsed.matches)
    ? parsed.matches.map((m) => (m && typeof m === 'object' ? { ...m } : m)).filter((m) => m && typeof m === 'object')
    : [];

  matches = enrichMatchesFromPlayers(matches, players);

  let teams = Array.isArray(parsed.teams)
    ? parsed.teams.map((t) => (t && typeof t === 'object' ? { ...t } : t)).filter((t) => t && typeof t === 'object')
    : [];

  if (teams.length === 0) {
    teams = buildTeamsFromPlayersAndMatches(players, matches);
  }

  return {
    statsFileVersion: STATS_FILE_VERSION,
    players,
    matches,
    teams
  };
}

/**
 * @param {string} rawJson
 * @returns {{ statsFileVersion: number, players: Array, matches: Array, teams: Array }}
 */
function parseStatsFileContent(rawJson) {
  let data;
  try {
    data = JSON.parse(rawJson);
  } catch {
    return normalizeStatsPayload(null);
  }

  const v = data.statsFileVersion;
  if (typeof v === 'number' && v > STATS_FILE_VERSION) {
    console.warn(
      '[stats-file-model] statsFileVersion',
      v,
      'plus récent que le support connu',
      STATS_FILE_VERSION,
      '— traitement comme import brut'
    );
  }

  // Futur : chaîne de migrations if (v === 1) data = migrate1to2(data);
  return normalizeStatsPayload(data);
}

module.exports = {
  STATS_FILE_VERSION,
  normalizeStatsPayload,
  parseStatsFileContent,
  enrichMatchesFromPlayers,
  buildTeamsFromPlayersAndMatches
};
