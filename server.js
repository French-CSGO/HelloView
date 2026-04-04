/**
 * Serveur API + fichiers statiques pour HelloView.
 * Lit la config MySQL depuis .env (MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD).
 * Optionnel : SEASON_ID pour filtrer par saison G5API.
 * GET /api/stats → { players, matches, teams } depuis la base csdemo.
 * Optionnel : STEAM_API_KEY pour enrichir les joueurs avec avatar_url (avatars Valve).
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bracketsModel = require('./lib/brackets-model');
const demoHostFiles = require('./lib/demo-host-files');
const multer = require('multer');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

const BRACKETS_ADMIN_PASSWORD = process.env.BRACKETS_ADMIN_PASSWORD || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const G5API_URL = (process.env.G5API_URL || '').replace(/\/$/, '');
const adminTokens = new Set();
const adminPanelTokens = new Set();
const dataDir = path.join(__dirname, 'data');
const demoHostDir = path.join(dataDir, 'demo');

/**
 * Construit l'URL de téléchargement d'une démo depuis G5API si G5API_URL est défini,
 * sinon tente la résolution locale dans data/demo/.
 * @param {import('./lib/demo-host-files')} demoIdx index local (peut être null si G5API_URL est défini)
 * @param {string|null} demoFile valeur de ms.demoFile (basename, ex. "match_12.zip")
 * @returns {{ url: string, filename: string } | null}
 */
function resolveDemoDownload(demoIdx, demoFile) {
  if (!demoFile) return null;
  const filename = String(demoFile).trim().split(/[/\\]/).pop();
  if (!filename) return null;
  if (G5API_URL) {
    return { url: `${G5API_URL}/api/demo/${encodeURIComponent(filename)}`, filename };
  }
  return demoHostFiles.demoDownloadForDbPath(demoIdx, demoFile);
}
const bracketsPath = path.join(dataDir, 'brackets.json');
const uploadsDir = path.join(__dirname, 'uploads');
const avatarsDir = path.join(uploadsDir, 'avatars');
const teamLogosDir = path.join(uploadsDir, 'team-logos');

function teamSlug(teamName) {
  const s = String(teamName || '').trim().toLowerCase();
  return s.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'team';
}
function getTeamLogoPath(teamName) {
  const slug = teamSlug(teamName);
  if (!slug) return null;
  if (!fs.existsSync(teamLogosDir)) return null;
  const files = fs.readdirSync(teamLogosDir);
  const found = files.find((f) => f.startsWith(slug + '.') && /\.(jpe?g|png|webp|gif)$/i.test(f));
  return found ? path.join(teamLogosDir, found) : null;
}
function getTeamLogoUrl(teamName) {
  const slug = teamSlug(teamName);
  const hasFile = getTeamLogoPath(teamName);
  return hasFile ? '/api/team-logos/' + encodeURIComponent(slug) : null;
}

const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
function getAvatarPath(steamId) {
  const safe = String(steamId || '').replace(/\D/g, '');
  if (!safe) return null;
  if (!fs.existsSync(avatarsDir)) return null;
  const files = fs.readdirSync(avatarsDir);
  const found = files.find((f) => f.startsWith(safe + '.') && /\.(jpe?g|png|webp|gif)$/i.test(f));
  return found ? path.join(avatarsDir, found) : null;
}
function getCustomAvatarUrl(steamId) {
  return getAvatarPath(steamId) ? '/api/avatars/' + encodeURIComponent(String(steamId).replace(/\D/g, '') || steamId) : null;
}

function getBracketsData() {
  try {
    if (fs.existsSync(bracketsPath)) {
      const raw = fs.readFileSync(bracketsPath, 'utf8');
      const parsed = JSON.parse(raw);
      // If the file explicitly has an empty v2 tournaments array, honour it (user cleared all)
      if (parsed && parsed.schemaVersion === 2 && Array.isArray(parsed.tournaments) && parsed.tournaments.length === 0) {
        return { schemaVersion: 2, tournaments: [] };
      }
      return bracketsModel.parseBracketsFileContent(raw);
    }
  } catch (e) {
    console.error('brackets read:', e.message);
  }
  return bracketsModel.defaultV2Brackets();
}

function setBracketsData(data) {
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const payload = bracketsModel.normalizeV2Payload(data);
    fs.writeFileSync(bracketsPath, JSON.stringify(payload, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('brackets write:', e.message);
    return false;
  }
}

function attachSeriesFieldsToMatchObj(m, checksum, seriesLookup) {
  if (!m || !seriesLookup || !checksum) return;
  const s = seriesLookup.get(String(checksum));
  if (s && s.demoIds && s.demoIds.length >= 2 && s.bestOf === 3) {
    m.series_demo_ids = s.demoIds;
    m.series_best_of = s.bestOf;
  }
}

function requireAdmin(req, res, next) {
  const token = req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '');
  if (!BRACKETS_ADMIN_PASSWORD || !token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

function requireAdminPanel(req, res, next) {
  const token = req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '');
  if (!ADMIN_PASSWORD || !token || !adminPanelTokens.has(token)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
      cb(null, avatarsDir);
    },
    filename: (req, file, cb) => {
      const steamId = (req.params.steamid || '').replace(/\D/g, '');
      const ext = (file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : file.mimetype === 'image/gif' ? '.gif' : '.jpg');
      cb(null, steamId + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_AVATAR_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Type de fichier non autorisé (JPEG, PNG, WebP, GIF uniquement)'));
  }
});

const uploadTeamLogo = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(teamLogosDir)) fs.mkdirSync(teamLogosDir, { recursive: true });
      cb(null, teamLogosDir);
    },
    filename: (req, file, cb) => {
      const teamName = (req.params.teamname != null) ? decodeURIComponent(String(req.params.teamname)) : '';
      const slug = teamSlug(teamName) || 'team';
      const ext = (file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : file.mimetype === 'image/gif' ? '.gif' : '.jpg');
      cb(null, slug + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_AVATAR_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Type de fichier non autorisé (JPEG, PNG, WebP, GIF uniquement)'));
  }
});

const STEAM_API_KEY = process.env.STEAM_API_KEY || '';
const AVATAR_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const avatarCache = new Map(); // steam_id -> { avatar_url, avatarfull_url, ts }

async function fetchSteamAvatars(steamIds) {
  if (!STEAM_API_KEY || steamIds.length === 0) return {};
  const now = Date.now();
  const toFetch = steamIds.filter((id) => {
    const c = avatarCache.get(id);
    return !c || now - c.ts > AVATAR_CACHE_TTL_MS;
  });
  if (toFetch.length === 0) return Object.fromEntries(steamIds.map((id) => [id, avatarCache.get(id)]));

  const map = {};
  for (let i = 0; i < toFetch.length; i += 100) {
    const batch = toFetch.slice(i, i + 100);
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(STEAM_API_KEY)}&steamids=${batch.join(',')}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      const players = data?.response?.players || [];
      players.forEach((p) => {
        const sid = p.steamid;
        const entry = {
          avatar_url: p.avatarmedium || p.avatar || null,
          avatarfull_url: p.avatarfull || p.avatarmedium || p.avatar || null,
          ts: now
        };
        avatarCache.set(sid, entry);
        map[sid] = entry;
      });
    } catch (err) {
      console.error('Steam GetPlayerSummaries:', err.message);
    }
  }
  return Object.fromEntries(steamIds.map((id) => [id, avatarCache.get(id) || map[id] || null]));
}

const SEASON_ID = process.env.SEASON_ID ? parseInt(process.env.SEASON_ID) : null;

function getRating(kills, rounds, deaths, k1, k2, k3, k4, k5) {
  if (!rounds) return 0;
  const KPR = kills / rounds / 0.679;
  const SPR = (rounds - deaths) / rounds / 0.317;
  const RMK = (k1 + 4 * k2 + 9 * k3 + 16 * k4 + 25 * k5) / rounds / 1.277;
  return +((KPR + 0.7 * SPR + RMK) / 2.7).toFixed(2);
}

const pool = mysql.createPool({
  host:     process.env.MYSQL_HOST     || 'localhost',
  port:     Number(process.env.MYSQL_PORT) || 3306,
  database: process.env.MYSQL_DATABASE || 'get5',
  user:     process.env.MYSQL_USER     || 'get5',
  password: process.env.MYSQL_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
});

app.use(express.static(path.join(__dirname)));
app.use(express.json());

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.post('/api/admin/auth', (req, res) => {
  const password = req.body && req.body.password;
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin non configuré (ADMIN_PASSWORD)' });
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminPanelTokens.add(token);
  setTimeout(() => adminPanelTokens.delete(token), 24 * 60 * 60 * 1000);
  res.json({ token });
});

app.post('/api/admin/avatar/:steamid', requireAdminPanel, (req, res, next) => {
  uploadAvatar.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Fichier trop volumineux (max 5 Mo)' });
      return res.status(400).json({ error: err.message || 'Erreur upload' });
    }
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé' });
    res.json({ ok: true, url: getCustomAvatarUrl(req.params.steamid) });
  });
});

app.delete('/api/admin/avatar/:steamid', requireAdminPanel, (req, res) => {
  const steamId = (req.params.steamid || '').trim();
  const filePath = getAvatarPath(steamId);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Aucune photo personnalisée pour ce joueur' });
  }
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) {
    console.error('delete avatar:', e.message);
    res.status(500).json({ error: 'Erreur suppression' });
  }
});

app.get('/api/avatars/:steamid', (req, res) => {
  const steamId = (req.params.steamid || '').trim();
  const filePath = getAvatarPath(steamId);
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).end();
  res.sendFile(filePath);
});

app.post('/api/admin/team-logo/:teamname', requireAdminPanel, (req, res, next) => {
  const teamName = decodeURIComponent(req.params.teamname || '').trim();
  if (!teamName) return res.status(400).json({ error: 'Nom d\'équipe manquant' });
  uploadTeamLogo.single('logo')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Fichier trop volumineux (max 5 Mo)' });
      return res.status(400).json({ error: err.message || 'Erreur upload' });
    }
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé' });
    res.json({ ok: true, url: getTeamLogoUrl(teamName) });
  });
});

app.delete('/api/admin/team-logo/:teamname', requireAdminPanel, (req, res) => {
  const teamName = decodeURIComponent(req.params.teamname || '').trim();
  const filePath = getTeamLogoPath(teamName);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Aucun logo pour cette équipe' });
  }
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) {
    console.error('delete team logo:', e.message);
    res.status(500).json({ error: 'Erreur suppression' });
  }
});

app.get('/api/team-logos/:slug', (req, res) => {
  const slug = (req.params.slug || '').trim();
  if (!slug) return res.status(404).end();
  if (!fs.existsSync(teamLogosDir)) return res.status(404).end();
  const files = fs.readdirSync(teamLogosDir);
  const found = files.find((f) => f.startsWith(slug + '.') && /\.(jpe?g|png|webp|gif)$/i.test(f));
  if (!found) return res.status(404).end();
  res.sendFile(path.join(teamLogosDir, found));
});

app.get('/brackets', (req, res) => {
  res.sendFile(path.join(__dirname, 'brackets.html'));
});

app.get('/api/brackets', async (req, res) => {
  try {
    const data = getBracketsData();
    let teamsFromDb = [];
    let matchesFromDb = [];
    try {
      const seasonWhere = SEASON_ID ? 'AND m.season_id = ?' : '';
      const seasonParams = SEASON_ID ? [SEASON_ID] : [];
      const [[teamsRes], [mapsRes]] = await Promise.all([
        pool.query(`
          SELECT DISTINCT t.name AS team_name
          FROM team t
          JOIN player_stats ps ON ps.team_id = t.id
          JOIN \`match\` m ON m.id = ps.match_id
          WHERE m.cancelled = 0 AND m.end_time IS NOT NULL ${seasonWhere}
          ORDER BY t.name
        `, seasonParams),
        pool.query(`
          SELECT
            CONCAT(ms.match_id, '_', ms.map_number) AS checksum,
            CAST(ms.match_id AS CHAR)               AS series_id,
            ms.map_number,
            tw.name                                 AS winner_name,
            ms.end_time                             AS analyze_date,
            ms.map_name,
            m.title                                 AS series_title,
            t1.name                                 AS team_a_name,
            ms.team1_score                          AS team_a_score,
            t2.name                                 AS team_b_name,
            ms.team2_score                          AS team_b_score,
            m.max_maps                              AS series_max_maps,
            m.team1_score                           AS series_score_a,
            m.team2_score                           AS series_score_b,
            tw_s.name                               AS series_winner_name,
            m.end_time                              AS series_end_time
          FROM map_stats ms
          JOIN \`match\` m ON m.id = ms.match_id
          LEFT JOIN team tw   ON tw.id   = ms.winner
          LEFT JOIN team tw_s ON tw_s.id = m.winner
          JOIN team t1 ON t1.id = m.team1_id
          JOIN team t2 ON t2.id = m.team2_id
          WHERE m.cancelled = 0 AND m.end_time IS NOT NULL ${seasonWhere}
          ORDER BY m.end_time ASC, m.id, ms.map_number
        `, seasonParams)
      ]);
      teamsFromDb = (teamsRes || []).map((r) => r.team_name);
      const G5_DEFAULT_B = /^Map \{MAPNUMBER\} of \{MAXMAPS\}$/i;

      // Build per-map entries
      const perMapB = {};
      (mapsRes || []).forEach((row) => {
        const mapLabel = `MAP${row.map_number + 1}${row.map_name ? ' · ' + row.map_name : ''}`;
        perMapB[row.checksum] = {
          id: row.checksum,
          winner_name: row.winner_name || null,
          team_a_name: row.team_a_name || null,
          team_b_name: row.team_b_name || null,
          team_a_score: row.team_a_score != null ? row.team_a_score : null,
          team_b_score: row.team_b_score != null ? row.team_b_score : null,
          map_name: row.map_name || null,
          label: `${row.team_a_name || '?'} vs ${row.team_b_name || '?'} · ${mapLabel}`
        };
      });

      // Build series entries (for BO3 bracket cells)
      const seriesB = new Map();
      (mapsRes || []).forEach((row) => {
        if (!seriesB.has(row.series_id)) seriesB.set(row.series_id, { row, mapChecksums: [] });
        seriesB.get(row.series_id).mapChecksums.push(row.checksum);
      });
      const seriesEntries = [];
      let seriesIdx = 0;
      seriesB.forEach(({ row, mapChecksums }) => {
        const rawTitle = row.series_title != null ? String(row.series_title).trim() : '';
        const seriesName = rawTitle !== '' && !G5_DEFAULT_B.test(rawTitle) ? rawTitle : null;
        const label = seriesName ?? `Match ${row.series_id}`;
        seriesEntries.push({
          id: row.series_id,
          winner_name: row.series_winner_name || null,
          team_a_name: row.team_a_name || null,
          team_b_name: row.team_b_name || null,
          map_name: null,
          label,
          series_demo_ids: mapChecksums,
          series_best_of: row.series_max_maps
        });
        seriesIdx++;
      });

      matchesFromDb = Object.values(perMapB);
    } catch (e) {
      console.error('brackets api:', e.message);
    }
    res.json({ ...data, teamsFromDb, matchesFromDb });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/brackets/auth', (req, res) => {
  const password = req.body && req.body.password;
  if (!BRACKETS_ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin brackets non configuré (BRACKETS_ADMIN_PASSWORD)' });
  }
  if (password !== BRACKETS_ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.add(token);
  setTimeout(() => adminTokens.delete(token), 24 * 60 * 60 * 1000);
  res.json({ token });
});

async function fetchWinnerNamesByChecksum(checksums) {
  const ids = (checksums || []).filter((c) => c != null && String(c).trim() !== '').map((c) => String(c).trim());
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT CAST(m.id AS CHAR) AS checksum, t.name AS winner_name
     FROM \`match\` m LEFT JOIN team t ON t.id = m.winner
     WHERE m.id IN (${placeholders})`,
    ids
  );
  const map = new Map();
  (rows || []).forEach((row) => {
    map.set(String(row.checksum), row.winner_name != null ? String(row.winner_name).trim() : '');
  });
  return map;
}

app.post('/api/brackets', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const tournamentIdMeta = String(body.tournamentId || body.section || '').trim();

  let tournamentId = tournamentIdMeta;
  let lane = String(body.lane || '').trim();
  let roundIndex = Number(body.roundIndex);
  let matchIndex = Number(body.matchIndex);
  const { teamA, teamB, winner, demoId, demoIds, bestOf, lowerBracket } = body;

  if (!tournamentId) {
    return res.status(400).json({ error: 'tournamentId ou section requis' });
  }
  const data = getBracketsData();
  const tMeta = data.tournaments.find((t) => t.id === tournamentId);
  if (!tMeta) {
    return res.status(400).json({ error: 'tournoi inconnu' });
  }

  if (tMeta.type === 'swiss') {
    lane = 'swiss';
  } else if (lane === 'grand') {
    /* roundIndex / matchIndex tels qu’envoyés (UI grande finale) */
  } else if (!lane) {
    if (lowerBracket) {
      lane = 'lower';
    } else {
      lane = 'upper';
    }
  }

  if (!Number.isInteger(roundIndex) || roundIndex < 0) {
    return res.status(400).json({ error: 'roundIndex invalide' });
  }
  if (!Number.isInteger(matchIndex) || matchIndex < 0) {
    return res.status(400).json({ error: 'matchIndex invalide' });
  }

  const fields = { teamA, teamB, winner };
  if (bestOf !== undefined) fields.bestOf = bestOf;
  if (demoIds !== undefined) {
    fields.demoIds = demoIds;
  } else if (demoId !== undefined) {
    fields.demoId = demoId;
  }

  const upd = bracketsModel.applyMatchUpdate(data.tournaments, tournamentId, lane, roundIndex, matchIndex, fields);
  if (!upd.ok) {
    return res.status(400).json({ error: upd.error || 'mise à jour impossible' });
  }

  const matchRef = bracketsModel.getMatchRef(tMeta, lane, roundIndex, matchIndex);
  if (matchRef) {
    const bo = bracketsModel.normalizeMatchBestOf(matchRef.bestOf);
    const nDemos = (matchRef.demoIds && matchRef.demoIds.length) ? matchRef.demoIds.length : 0;
    if (bo === 3 && nDemos > 3) {
      return res.status(400).json({ error: 'BO3 : au plus 3 démos (1 à 3 pendant le tournoi, ou aucune pour effacer).' });
    }
    if (bo === 1 && nDemos > 1) {
      return res.status(400).json({ error: 'BO1 : une seule démo autorisée.' });
    }
    try {
      const ids = (matchRef.demoIds && matchRef.demoIds.length)
        ? matchRef.demoIds
        : (matchRef.demoId ? [matchRef.demoId] : []);
      if (ids.length) {
        const winMap = await fetchWinnerNamesByChecksum(ids);
        bracketsModel.applyComputedSeriesWinner(matchRef, winMap);
      }
    } catch (e) {
      console.error('brackets BO winner:', e.message);
    }
  }

  if (!setBracketsData(data)) return res.status(500).json({ error: 'Erreur écriture' });
  res.json({ ok: true, brackets: data });
});

app.post('/api/brackets/tournaments', requireAdmin, (req, res) => {
  const { title, type, teamCount } = req.body || {};
  const titleStr = String(title || '').trim();
  if (!titleStr) return res.status(400).json({ error: 'Titre requis' });

  const data = getBracketsData();
  const baseId = titleStr.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'tournament';
  const id = baseId + '_' + Date.now();

  const { emptyMatch: mkMatch, DEFAULT_SWISS_LAYOUT: SWL } = bracketsModel;
  let raw;
  if (type === 'swiss') {
    const slotCounts = [16, 16, 16, 12, 6];
    raw = {
      id, title: titleStr, type: 'swiss',
      swissRules: { qualifyWins: 3, eliminateLosses: 3 },
      swissLayout: { ...SWL },
      rounds: slotCounts.map((n, i) => ({
        roundIndex: i, title: `Round ${i + 1}`,
        matches: Array.from({ length: n }, mkMatch)
      }))
    };
  } else {
    const n = [4, 8, 16].includes(Number(teamCount)) ? Number(teamCount) : 8;
    let t = n, upperCounts = [];
    while (t > 1) { upperCounts.push(t / 2); t = Math.floor(t / 2); }
    raw = {
      id, title: titleStr, type: 'elimination',
      rounds: upperCounts.map(c => ({ matches: Array.from({ length: c }, mkMatch) })),
      ...(type === 'double' ? { lowerRounds: buildDefaultLowerRounds(n) } : {})
    };
  }

  const updated = bracketsModel.normalizeV2Payload({ ...data, tournaments: [...data.tournaments, raw] });
  if (!setBracketsData(updated)) return res.status(500).json({ error: 'Erreur écriture' });
  res.json(getBracketsData());
});

function buildDefaultLowerRounds(n) {
  const { emptyMatch: mkMatch } = bracketsModel;
  if (n <= 4) return [
    { matches: Array.from({ length: 2 }, mkMatch) },
    { matches: Array.from({ length: 1 }, mkMatch) }
  ];
  if (n <= 8) return [
    { matches: Array.from({ length: 4 }, mkMatch) },
    { matches: Array.from({ length: 4 }, mkMatch) },
    { matches: Array.from({ length: 2 }, mkMatch) },
    { matches: Array.from({ length: 2 }, mkMatch) },
    { matches: Array.from({ length: 1 }, mkMatch) },
    { matches: Array.from({ length: 1 }, mkMatch) }
  ];
  return [
    { matches: Array.from({ length: 8 }, mkMatch) },
    { matches: Array.from({ length: 8 }, mkMatch) },
    { matches: Array.from({ length: 4 }, mkMatch) },
    { matches: Array.from({ length: 4 }, mkMatch) },
    { matches: Array.from({ length: 2 }, mkMatch) },
    { matches: Array.from({ length: 2 }, mkMatch) },
    { matches: Array.from({ length: 1 }, mkMatch) }
  ];
}

app.delete('/api/brackets/tournaments/:id', requireAdmin, (req, res) => {
  const id = (req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id requis' });
  const data = getBracketsData();
  const filtered = data.tournaments.filter(t => t.id !== id);
  if (filtered.length === data.tournaments.length) return res.status(404).json({ error: 'Tournoi introuvable' });
  const payload = { schemaVersion: 2, tournaments: filtered };
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(bracketsPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (e) {
    return res.status(500).json({ error: 'Erreur écriture' });
  }
  res.json({ ...payload, teamsFromDb: [], matchesFromDb: [] });
});

app.get('/api/stats', async (req, res) => {
  try {
    const seasonWhere = SEASON_ID ? 'AND m.season_id = ?' : '';
    const seasonParams = SEASON_ID ? [SEASON_ID] : [];
    const G5_DEFAULT = /^Map \{MAPNUMBER\} of \{MAXMAPS\}$/i;
    const demoIdx = G5API_URL ? null : demoHostFiles.getDemoBasenameIndex(demoHostDir);

    const [[mapRows], [playerRows]] = await Promise.all([
      pool.query(`
        SELECT
          CONCAT(ms.match_id, '_', ms.map_number) AS checksum,
          CAST(ms.match_id AS CHAR)               AS series_id,
          ms.match_id,
          ms.map_number,
          ms.demoFile                             AS demo_path,
          tw.name                                 AS winner_name,
          ms.end_time                             AS analyze_date,
          ms.map_name,
          TIMESTAMPDIFF(SECOND, ms.start_time, ms.end_time) AS duration_seconds,
          t1.name                                 AS team_a_name,
          ms.team1_score                          AS team_a_score,
          t2.name                                 AS team_b_name,
          ms.team2_score                          AS team_b_score,
          m.title                                 AS series_title,
          m.max_maps                              AS series_max_maps,
          m.team1_score                           AS series_score_a,
          m.team2_score                           AS series_score_b,
          tw_s.name                               AS series_winner_name,
          m.end_time                              AS series_end_time
        FROM map_stats ms
        JOIN \`match\` m ON m.id = ms.match_id
        LEFT JOIN team tw   ON tw.id   = ms.winner
        LEFT JOIN team tw_s ON tw_s.id = m.winner
        JOIN team t1 ON t1.id = m.team1_id
        JOIN team t2 ON t2.id = m.team2_id
        WHERE m.cancelled = 0 AND ms.end_time IS NOT NULL ${seasonWhere}
        ORDER BY COALESCE(m.end_time, NOW()) ASC, m.id, ms.map_number
      `, seasonParams),
      pool.query(`
        SELECT
          CONCAT(ms.match_id, '_', ms.map_number, '_', ps.steam_id) AS id,
          CONCAT(ms.match_id, '_', ms.map_number) AS match_checksum,
          ps.steam_id,
          0                                       AS \`index\`,
          t.name                                  AS team_name,
          ps.name,
          ps.kills                                AS kill_count,
          ps.deaths                               AS death_count,
          ps.assists                              AS assist_count,
          ps.headshot_kills                       AS headshot_count,
          ps.damage                               AS damage_health,
          (ps.firstkill_ct + ps.firstkill_t)      AS first_kill_count,
          (ps.firstdeath_ct + ps.firstdeath_t)    AS first_death_count,
          ps.mvp                                  AS mvp_count,
          ps.roundsplayed,
          ps.bomb_plants                          AS bomb_planted_count,
          ps.bomb_defuses                         AS bomb_defused_count,
          ps.kast                                 AS kast_rounds,
          ps.util_damage                          AS utility_damage,
          ps.k1 AS one_kill_count, ps.k2 AS two_kill_count,
          ps.k3 AS three_kill_count, ps.k4 AS four_kill_count, ps.k5 AS five_kill_count,
          CASE WHEN ms.winner = ps.team_id THEN 1 ELSE 0 END AS wins_count
        FROM player_stats ps
        JOIN team t       ON t.id  = ps.team_id
        JOIN map_stats ms ON ms.id = ps.map_id
        JOIN \`match\` m  ON m.id  = ps.match_id
        WHERE m.cancelled = 0 AND ms.end_time IS NOT NULL ${seasonWhere}
        ORDER BY m.id, ms.map_number, ps.steam_id
      `, seasonParams)
    ]);

    // Build per-map match entries
    const perMapEntries = {};
    (mapRows || []).forEach(row => {
      const m = {
        id: row.checksum,
        name: null,
        label: `MAP${row.map_number + 1}${row.map_name ? ' · ' + row.map_name : ''}`,
        winner_name: row.winner_name || null,
        analyze_date: row.analyze_date,
        map_name: row.map_name || null,
        duration_seconds: row.duration_seconds != null ? row.duration_seconds : null,
        team_a_name: row.team_a_name,
        team_a_score: row.team_a_score,
        team_b_name: row.team_b_name,
        team_b_score: row.team_b_score,
      };
      const dl = resolveDemoDownload(demoIdx, row.demo_path);
      if (dl) { m.demo_download_url = dl.url; m.demo_download_filename = dl.filename; }
      perMapEntries[row.checksum] = m;
    });

    // Group by series_id
    const seriesByMatchId = new Map();
    (mapRows || []).forEach(row => {
      if (!seriesByMatchId.has(row.series_id)) seriesByMatchId.set(row.series_id, { row, mapChecksums: [] });
      seriesByMatchId.get(row.series_id).mapChecksums.push(row.checksum);
    });

    const seriesEntries = [];
    seriesByMatchId.forEach(({ row, mapChecksums }) => {
      const rawTitle = row.series_title != null ? String(row.series_title).trim() : '';
      const seriesName = rawTitle !== '' && !G5_DEFAULT.test(rawTitle) ? rawTitle : null;
      const isSeries = mapChecksums.length >= 2;
      const m = {
        id: row.series_id,
        name: seriesName,
        label: seriesName ?? `Match ${row.series_id}`,
        winner_name: row.series_winner_name || null,
        analyze_date: row.series_end_time,
        map_name: isSeries ? null : (row.map_name || null),
        duration_seconds: null,
        team_a_name: row.team_a_name,
        team_a_score: isSeries ? row.series_score_a : row.team_a_score,
        team_b_name: row.team_b_name,
        team_b_score: isSeries ? row.series_score_b : row.team_b_score,
      };
      if (isSeries) {
        m.series_demo_ids = mapChecksums;
        m.series_best_of = row.series_max_maps;
        m.duration_seconds = mapChecksums.reduce((s, ck) => {
          const me = perMapEntries[ck];
          return s + (me && me.duration_seconds != null ? Number(me.duration_seconds) : 0);
        }, 0) || null;
      } else {
        const me = perMapEntries[mapChecksums[0]];
        if (me) {
          m.duration_seconds = me.duration_seconds;
          if (me.demo_download_url) { m.demo_download_url = me.demo_download_url; m.demo_download_filename = me.demo_download_filename; }
        }
      }
      seriesEntries.push(m);
    });

    const matches = [...seriesEntries, ...Object.values(perMapEntries)];

    const players = (playerRows || []).map(row => {
      const rounds = row.roundsplayed || 0;
      const rating = getRating(row.kill_count, rounds, row.death_count, row.one_kill_count, row.two_kill_count, row.three_kill_count, row.four_kill_count, row.five_kill_count);
      return {
        id: row.id,
        match_checksum: row.match_checksum,
        steam_id: row.steam_id,
        index: row.index,
        team_name: row.team_name,
        name: row.name,
        kill_count: row.kill_count,
        death_count: row.death_count,
        assist_count: row.assist_count,
        headshot_count: row.headshot_count,
        damage_health: row.damage_health,
        first_kill_count: row.first_kill_count,
        first_death_count: row.first_death_count,
        mvp_count: row.mvp_count,
        average_damage_per_round: rounds > 0 ? Math.round((row.damage_health / rounds) * 100) / 100 : null,
        average_kill_per_round:   rounds > 0 ? Math.round((row.kill_count   / rounds) * 100) / 100 : null,
        average_death_per_round:  rounds > 0 ? Math.round((row.death_count  / rounds) * 100) / 100 : null,
        utility_damage_per_round: rounds > 0 ? Math.round((row.utility_damage / rounds) * 100) / 100 : null,
        bomb_planted_count: row.bomb_planted_count,
        bomb_defused_count: row.bomb_defused_count,
        kast: row.kast_rounds != null ? Number(row.kast_rounds) : null,
        hltv_rating: rating,
        hltv_rating_2: rating,
        utility_damage: row.utility_damage,
        one_kill_count: row.one_kill_count,
        two_kill_count: row.two_kill_count,
        three_kill_count: row.three_kill_count,
        four_kill_count: row.four_kill_count,
        five_kill_count: row.five_kill_count,
        wins_count: row.wins_count,
      };
    });

    const teamStats = {};
    seriesByMatchId.forEach(({ row }) => {
      const nameA = row.team_a_name, nameB = row.team_b_name;
      if (nameA && !teamStats[nameA]) teamStats[nameA] = { team_name: nameA, wins: 0, losses: 0 };
      if (nameB && !teamStats[nameB]) teamStats[nameB] = { team_name: nameB, wins: 0, losses: 0 };
      const winner = row.series_winner_name ? String(row.series_winner_name).trim().toLowerCase() : null;
      if (winner) {
        if (nameA && winner === nameA.toLowerCase()) { teamStats[nameA].wins++; if (nameB && teamStats[nameB]) teamStats[nameB].losses++; }
        else if (nameB && winner === nameB.toLowerCase()) { teamStats[nameB].wins++; if (nameA && teamStats[nameA]) teamStats[nameA].losses++; }
      }
    });
    const teams = Object.values(teamStats).map(t => {
      const total = t.wins + t.losses;
      return {
        team_name: t.team_name,
        matchCount: total,
        wins: t.wins,
        losses: t.losses,
        winsPct: total > 0 ? (t.wins / total) * 100 : null,
        logo_url: getTeamLogoUrl(t.team_name) || null
      };
    });

    const uniqueSteamIds = [...new Set(players.map((p) => p.steam_id).filter(Boolean))];
    const avatarMap = await fetchSteamAvatars(uniqueSteamIds);
    players.forEach((p) => {
      const a = avatarMap[p.steam_id];
      if (a) {
        p.avatar_url = a.avatar_url || null;
        p.avatarfull_url = a.avatarfull_url || null;
      } else {
        p.avatar_url = null;
        p.avatarfull_url = null;
      }
      p.custom_avatar_url = getCustomAvatarUrl(p.steam_id) || null;
    });

    res.json({ players, matches, teams });
  } catch (err) {
    console.error('GET /api/stats:', err);
    res.status(500).json({ error: 'Erreur base de données', message: err.message });
  }
});

app.get('/api/match/:checksum', async (req, res) => {
  const checksum = (req.params.checksum || '').trim();
  if (!checksum) return res.status(400).json({ error: 'checksum manquant' });
  try {
    const [[matchRows2], [teamRows2], [playerRows2]] = await Promise.all([
      pool.query(`
        SELECT CAST(m.id AS CHAR) AS checksum,
               ms.demoFile AS demo_path,
               tw.name AS winner_name,
               m.end_time AS analyze_date,
               m.title AS name,
               ms.map_name,
               ms_dur.duration_seconds
        FROM \`match\` m
        LEFT JOIN team tw ON tw.id = m.winner
        LEFT JOIN map_stats ms ON ms.match_id = m.id AND ms.map_number = 0
        LEFT JOIN (
          SELECT match_id, SUM(TIMESTAMPDIFF(SECOND, start_time, end_time)) AS duration_seconds
          FROM map_stats WHERE end_time IS NOT NULL GROUP BY match_id
        ) ms_dur ON ms_dur.match_id = m.id
        WHERE m.id = ?
      `, [checksum]),
      pool.query(`
        SELECT t1.name AS name, m.team1_score AS score
        FROM \`match\` m JOIN team t1 ON t1.id = m.team1_id WHERE m.id = ?
        UNION ALL
        SELECT t2.name, m.team2_score
        FROM \`match\` m JOIN team t2 ON t2.id = m.team2_id WHERE m.id = ?
      `, [checksum, checksum]),
      pool.query(`
        SELECT
          CONCAT(ps.match_id, '_', ps.steam_id, '_', ps.team_id) AS id,
          CAST(ps.match_id AS CHAR) AS match_checksum,
          ps.steam_id, 0 AS \`index\`, t.name AS team_name, ps.name,
          SUM(ps.kills) AS kill_count, SUM(ps.deaths) AS death_count,
          SUM(ps.assists) AS assist_count, SUM(ps.headshot_kills) AS headshot_count,
          SUM(ps.damage) AS damage_health,
          SUM(ps.firstkill_ct + ps.firstkill_t) AS first_kill_count,
          SUM(ps.firstdeath_ct + ps.firstdeath_t) AS first_death_count,
          SUM(ps.mvp) AS mvp_count, SUM(ps.roundsplayed) AS roundsplayed,
          SUM(ps.bomb_plants) AS bomb_planted_count, SUM(ps.bomb_defuses) AS bomb_defused_count,
          SUM(ps.kast) AS kast_rounds,
          SUM(ps.util_damage) AS utility_damage,
          SUM(ps.k1) AS one_kill_count, SUM(ps.k2) AS two_kill_count,
          SUM(ps.k3) AS three_kill_count, SUM(ps.k4) AS four_kill_count,
          SUM(ps.k5) AS five_kill_count
        FROM player_stats ps
        JOIN team t ON t.id = ps.team_id
        WHERE ps.match_id = ?
        GROUP BY ps.match_id, ps.steam_id, ps.team_id, ps.name, t.name
        ORDER BY ps.team_id, ps.steam_id
      `, [checksum])
    ]);

    const matchRow = matchRows2 && matchRows2[0];
    if (!matchRow) return res.status(404).json({ error: 'Match introuvable' });

    const sides = (teamRows2 || []).slice(0, 2);
    const teamA = sides[0] || {};
    const teamB = sides[1] || {};
    const dbName = matchRow.name != null && String(matchRow.name).trim() !== '';
    const matchName = dbName ? String(matchRow.name).trim() : null;
    const match = {
      id: matchRow.checksum,
      name: matchName,
      label: matchName ?? (matchRow.analyze_date
        ? `Match · ${new Date(matchRow.analyze_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
        : 'Match'),
      winner_name: matchRow.winner_name,
      analyze_date: matchRow.analyze_date,
      map_name: matchRow.map_name || null,
      duration_seconds: matchRow.duration_seconds != null ? matchRow.duration_seconds : null,
      team_a_name: teamA.name,
      team_a_score: teamA.score,
      team_b_name: teamB.name,
      team_b_score: teamB.score,
    };
    const demoIdxOne = G5API_URL ? null : demoHostFiles.getDemoBasenameIndex(demoHostDir);
    const dlOne = resolveDemoDownload(demoIdxOne, matchRow.demo_path);
    if (dlOne) {
      match.demo_download_url = dlOne.url;
      match.demo_download_filename = dlOne.filename;
    }
    attachSeriesFieldsToMatchObj(match, matchRow.checksum, bracketsModel.buildSeriesDemoLookup(getBracketsData()));

    const players = (playerRows2 || []).map((row) => {
      const rounds = row.roundsplayed || 0;
      return {
        id: row.id,
        match_checksum: row.match_checksum,
        steam_id: row.steam_id,
        index: row.index,
        team_name: row.team_name,
        name: row.name,
        kill_count: row.kill_count,
        death_count: row.death_count,
        assist_count: row.assist_count,
        headshot_count: row.headshot_count,
        damage_health: row.damage_health,
        first_kill_count: row.first_kill_count,
        first_death_count: row.first_death_count,
        mvp_count: row.mvp_count,
        average_damage_per_round: rounds > 0 ? Math.round((row.damage_health / rounds) * 100) / 100 : null,
        average_kill_per_round:   rounds > 0 ? Math.round((row.kill_count   / rounds) * 100) / 100 : null,
        average_death_per_round:  rounds > 0 ? Math.round((row.death_count  / rounds) * 100) / 100 : null,
        utility_damage_per_round: rounds > 0 ? Math.round((row.utility_damage / rounds) * 100) / 100 : null,
        bomb_planted_count: row.bomb_planted_count,
        bomb_defused_count: row.bomb_defused_count,
        kast: row.kast_rounds != null ? Number(row.kast_rounds) : null,
        hltv_rating: getRating(row.kill_count, rounds, row.death_count, row.one_kill_count, row.two_kill_count, row.three_kill_count, row.four_kill_count, row.five_kill_count),
        utility_damage: row.utility_damage,
        one_kill_count: row.one_kill_count,
        two_kill_count: row.two_kill_count,
        three_kill_count: row.three_kill_count,
        four_kill_count: row.four_kill_count,
        five_kill_count: row.five_kill_count,
        custom_avatar_url: getCustomAvatarUrl(row.steam_id) || null
      };
    });

    const matchSteamIds = [...new Set(players.map((p) => p.steam_id).filter(Boolean))];
    const matchAvatarMap = await fetchSteamAvatars(matchSteamIds);
    players.forEach((p) => {
      const a = matchAvatarMap[p.steam_id];
      if (a) {
        p.avatar_url = a.avatar_url || null;
        p.avatarfull_url = a.avatarfull_url || null;
      } else {
        p.avatar_url = null;
        p.avatarfull_url = null;
      }
    });

    res.json({ match, players });
  } catch (err) {
    console.error('GET /api/match/:checksum:', err);
    res.status(500).json({ error: 'Erreur base de données', message: err.message });
  }
});

app.get('/api/demos/download', (req, res) => {
  const server = (req.query.server != null ? String(req.query.server) : '').trim();
  const file = (req.query.file != null ? String(req.query.file) : '').trim();
  if (!demoHostFiles.isSafeDemoFilename(file)) {
    return res.status(400).json({ error: 'Nom de fichier invalide' });
  }
  if (server && !demoHostFiles.isSafeDemoSubdir(server)) {
    return res.status(400).json({ error: 'Dossier serveur invalide' });
  }
  const abs = demoHostFiles.resolveHostedDemoPath(demoHostDir, server, file);
  if (!abs) return res.status(404).json({ error: 'Démo introuvable' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="' + file.replace(/"/g, '') + '"');
  res.sendFile(abs, (err) => {
    if (err && !res.headersSent) {
      console.error('demo download:', err.message);
      res.status(500).end();
    }
  });
});

app.listen(PORT, () => {
  console.log(`HelloView: http://localhost:${PORT}`);
});
