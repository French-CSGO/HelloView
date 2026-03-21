/**
 * Serveur API + fichiers statiques pour HelloView.
 * Lit la config PostgreSQL depuis .env (PGSQL_HOST, PGSQL_PORT, PGSQL_DATABASE, PGSQL_USER, PGSQL_PASSWORD).
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
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const BRACKETS_ADMIN_PASSWORD = process.env.BRACKETS_ADMIN_PASSWORD || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const adminTokens = new Set();
const adminPanelTokens = new Set();
const dataDir = path.join(__dirname, 'data');
const demoHostDir = path.join(dataDir, 'demo');
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

const pool = new Pool({
  host: process.env.PGSQL_HOST || 'localhost',
  port: Number(process.env.PGSQL_PORT) || 5432,
  database: process.env.PGSQL_DATABASE || 'csdemo',
  user: process.env.PGSQL_USER || 'csdemo',
  password: process.env.PGSQL_PASSWORD
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
      const [teamsRes, matchesRes, teamsByMatchRes] = await Promise.all([
        pool.query(`
          SELECT DISTINCT team_name
          FROM public.players
          WHERE team_name IS NOT NULL AND TRIM(team_name) <> ''
          ORDER BY team_name
        `),
        pool.query(`
          SELECT m.checksum, m.winner_name, m.analyze_date, d.name AS name, d.map_name AS map_name
          FROM public.matches m
          LEFT JOIN public.demos d ON d.checksum = m.checksum
          ORDER BY m.analyze_date ASC
        `),
        pool.query(`
          SELECT match_checksum, name, score, score_first_half, score_second_half
          FROM public.teams
        `)
      ]);
      teamsFromDb = (teamsRes.rows || []).map((r) => r.team_name);
      const teamsByMatch = {};
      (teamsByMatchRes.rows || []).forEach((row) => {
        const key = row.match_checksum;
        if (!teamsByMatch[key]) teamsByMatch[key] = [];
        teamsByMatch[key].push({
          name: row.name,
          score: row.score,
          score_first_half: row.score_first_half,
          score_second_half: row.score_second_half
        });
      });
      const matchesRows = matchesRes.rows || [];
      matchesFromDb = matchesRows.map((row, i) => {
        const sides = teamsByMatch[row.checksum] || [];
        const teamA = sides[0] || {};
        const teamB = sides[1] || {};
        const dbName = row.name != null && String(row.name).trim() !== '';
        const matchName = dbName ? String(row.name).trim() : null;
        const label = matchName ?? (row.analyze_date
          ? `Match ${i + 1} · ${new Date(row.analyze_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
          : `Match ${i + 1}`);
        return {
          id: row.checksum,
          winner_name: row.winner_name || null,
          team_a_name: teamA.name || null,
          team_b_name: teamB.name || null,
          map_name: row.map_name || null,
          label
        };
      });
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
  const r = await pool.query(
    'SELECT checksum, winner_name FROM public.matches WHERE checksum = ANY($1::text[])',
    [ids]
  );
  const map = new Map();
  (r.rows || []).forEach((row) => {
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
    if (bo === 3 && nDemos > 0 && (nDemos < 2 || nDemos > 3)) {
      return res.status(400).json({ error: 'BO3 : renseigner 2 ou 3 démos (ou aucune pour effacer).' });
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

app.get('/api/stats', async (req, res) => {
  try {
    const [playersResult, matchesResult, teamsResult, overridesResult] = await Promise.all([
      pool.query(`
        SELECT id, match_checksum, steam_id, "index", team_name, name,
               kill_count, death_count, assist_count, headshot_count,
               damage_health, damage_armor, first_kill_count, first_death_count, mvp_count,
               average_damage_per_round, average_kill_per_round, average_death_per_round, utility_damage_per_round,
               rank_type, rank, old_rank, wins_count,
               bomb_planted_count, bomb_defused_count, hostage_rescued_count,
               score, kast, hltv_rating, hltv_rating_2,
               utility_damage, trade_kill_count, trade_death_count,
               first_trade_kill_count, first_trade_death_count,
               one_kill_count, two_kill_count, three_kill_count, four_kill_count, five_kill_count,
               inspect_weapon_count, color, crosshair_share_code
        FROM public.players
        ORDER BY match_checksum, "index"
      `),
      pool.query(`
        SELECT m.checksum, m.demo_path, m.winner_name, m.analyze_date, d.name AS name, d.map_name AS map_name,
               d.duration AS duration_seconds
        FROM public.matches m
        LEFT JOIN public.demos d ON d.checksum = m.checksum
        ORDER BY m.analyze_date ASC
      `),
      pool.query(`
        SELECT match_checksum, name, score, score_first_half, score_second_half
        FROM public.teams
      `),
      pool.query(`SELECT steam_id, name FROM public.steam_account_overrides`)
    ]);

    const nameOverrides = {};
    (overridesResult.rows || []).forEach((row) => {
      if (row.steam_id != null && row.name != null) {
        const n = String(row.name).trim();
        if (n !== '') nameOverrides[row.steam_id] = n;
      }
    });

    const teamsByMatch = {};
    (teamsResult.rows || []).forEach(row => {
      const key = row.match_checksum;
      if (!teamsByMatch[key]) teamsByMatch[key] = [];
      teamsByMatch[key].push({
        name: row.name,
        score: row.score,
        score_first_half: row.score_first_half,
        score_second_half: row.score_second_half
      });
    });

    const players = (playersResult.rows || []).map(row => ({
      id: row.id,
      match_checksum: row.match_checksum,
      steam_id: row.steam_id,
      index: row.index,
      team_name: row.team_name,
      name: nameOverrides[row.steam_id] ?? row.name,
      kill_count: row.kill_count,
      death_count: row.death_count,
      assist_count: row.assist_count,
      headshot_count: row.headshot_count,
      damage_health: row.damage_health,
      damage_armor: row.damage_armor,
      first_kill_count: row.first_kill_count,
      first_death_count: row.first_death_count,
      mvp_count: row.mvp_count,
      average_damage_per_round: row.average_damage_per_round,
      average_kill_per_round: row.average_kill_per_round,
      average_death_per_round: row.average_death_per_round,
      utility_damage_per_round: row.utility_damage_per_round,
      rank_type: row.rank_type,
      rank: row.rank,
      old_rank: row.old_rank,
      wins_count: row.wins_count,
      bomb_planted_count: row.bomb_planted_count,
      bomb_defused_count: row.bomb_defused_count,
      hostage_rescued_count: row.hostage_rescued_count,
      score: row.score,
      kast: row.kast,
      hltv_rating: row.hltv_rating,
      hltv_rating_2: row.hltv_rating_2,
      utility_damage: row.utility_damage,
      trade_kill_count: row.trade_kill_count,
      trade_death_count: row.trade_death_count,
      first_trade_kill_count: row.first_trade_kill_count,
      first_trade_death_count: row.first_trade_death_count,
      one_kill_count: row.one_kill_count,
      two_kill_count: row.two_kill_count,
      three_kill_count: row.three_kill_count,
      four_kill_count: row.four_kill_count,
      five_kill_count: row.five_kill_count,
      inspect_weapon_count: row.inspect_weapon_count,
      color: row.color,
      crosshair_share_code: row.crosshair_share_code
    }));

    const matchesRows = matchesResult.rows || [];
    const demoIdx = demoHostFiles.getDemoBasenameIndex(demoHostDir);
    const seriesLookup = bracketsModel.buildSeriesDemoLookup(getBracketsData());
    const matches = matchesRows.map((row, i) => {
      const sides = teamsByMatch[row.checksum] || [];
      const teamA = sides[0] || {};
      const teamB = sides[1] || {};
      const dbName = row.name != null && String(row.name).trim() !== '';
      const matchName = dbName ? String(row.name).trim() : null;
      const label = matchName ?? (row.analyze_date
        ? `Match ${i + 1} · ${new Date(row.analyze_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
        : `Match ${i + 1}`);
      const m = {
        id: row.checksum,
        name: matchName,
        label,
        winner_name: row.winner_name,
        analyze_date: row.analyze_date,
        map_name: row.map_name || null,
        duration_seconds: row.duration_seconds != null ? row.duration_seconds : null,
        team_a_name: teamA.name,
        team_a_score: teamA.score,
        team_a_first_half: teamA.score_first_half,
        team_a_second_half: teamA.score_second_half,
        team_b_name: teamB.name,
        team_b_score: teamB.score,
        team_b_first_half: teamB.score_first_half,
        team_b_second_half: teamB.score_second_half
      };
      const dl = demoHostFiles.demoDownloadForDbPath(demoIdx, row.demo_path);
      if (dl) {
        m.demo_download_url = dl.url;
        m.demo_download_filename = dl.filename;
      }
      attachSeriesFieldsToMatchObj(m, row.checksum, seriesLookup);
      return m;
    });

    const teamNames = [...new Set(players.map(p => p.team_name))].filter(Boolean);
    const matchWinnerByChecksum = {};
    matchesRows.forEach(m => { matchWinnerByChecksum[m.checksum] = m.winner_name; });

    const teams = teamNames.map(team_name => {
      const playedChecksums = [...new Set(players.filter(p => p.team_name === team_name).map(p => p.match_checksum))];
      let wins = 0;
      let losses = 0;
      playedChecksums.forEach(checksum => {
        const winner = matchWinnerByChecksum[checksum];
        if (winner == null) return;
        if (winner === team_name) wins += 1;
        else losses += 1;
      });
      const total = wins + losses;
      const winsPct = total > 0 ? (wins / total) * 100 : null;
      return {
        team_name,
        matchCount: total,
        wins,
        losses,
        winsPct,
        logo_url: getTeamLogoUrl(team_name) || null
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
    const [matchResult, teamsResult, playersResult, overridesResult] = await Promise.all([
      pool.query(`
        SELECT m.checksum, m.demo_path, m.winner_name, m.analyze_date, d.name AS name, d.map_name AS map_name,
               d.duration AS duration_seconds
        FROM public.matches m
        LEFT JOIN public.demos d ON d.checksum = m.checksum
        WHERE m.checksum = $1
      `, [checksum]),
      pool.query(`
        SELECT match_checksum, name, score, score_first_half, score_second_half
        FROM public.teams WHERE match_checksum = $1
      `, [checksum]),
      pool.query(`
        SELECT id, match_checksum, steam_id, "index", team_name, name,
               kill_count, death_count, assist_count, headshot_count,
               damage_health, damage_armor, first_kill_count, first_death_count, mvp_count,
               average_damage_per_round, average_kill_per_round, average_death_per_round, utility_damage_per_round,
               rank_type, rank, old_rank, wins_count,
               bomb_planted_count, bomb_defused_count, hostage_rescued_count,
               score, kast, hltv_rating, hltv_rating_2,
               utility_damage, trade_kill_count, trade_death_count,
               first_trade_kill_count, first_trade_death_count,
               one_kill_count, two_kill_count, three_kill_count, four_kill_count, five_kill_count,
               inspect_weapon_count, color, crosshair_share_code
        FROM public.players WHERE match_checksum = $1
        ORDER BY "index"
      `, [checksum]),
      pool.query(`SELECT steam_id, name FROM public.steam_account_overrides`)
    ]);

    const matchRow = matchResult.rows && matchResult.rows[0];
    if (!matchRow) return res.status(404).json({ error: 'Match introuvable' });

    const nameOverrides = {};
    (overridesResult.rows || []).forEach((row) => {
      if (row.steam_id != null && row.name != null) {
        const n = String(row.name).trim();
        if (n !== '') nameOverrides[row.steam_id] = n;
      }
    });

    const sides = (teamsResult.rows || []).slice(0, 2);
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
      team_a_first_half: teamA.score_first_half,
      team_a_second_half: teamA.score_second_half,
      team_b_name: teamB.name,
      team_b_score: teamB.score,
      team_b_first_half: teamB.score_first_half,
      team_b_second_half: teamB.score_second_half
    };
    const demoIdxOne = demoHostFiles.getDemoBasenameIndex(demoHostDir);
    const dlOne = demoHostFiles.demoDownloadForDbPath(demoIdxOne, matchRow.demo_path);
    if (dlOne) {
      match.demo_download_url = dlOne.url;
      match.demo_download_filename = dlOne.filename;
    }
    attachSeriesFieldsToMatchObj(match, matchRow.checksum, bracketsModel.buildSeriesDemoLookup(getBracketsData()));

    const players = (playersResult.rows || []).map((row) => ({
      id: row.id,
      match_checksum: row.match_checksum,
      steam_id: row.steam_id,
      index: row.index,
      team_name: row.team_name,
      name: nameOverrides[row.steam_id] ?? row.name,
      kill_count: row.kill_count,
      death_count: row.death_count,
      assist_count: row.assist_count,
      headshot_count: row.headshot_count,
      damage_health: row.damage_health,
      damage_armor: row.damage_armor,
      first_kill_count: row.first_kill_count,
      first_death_count: row.first_death_count,
      mvp_count: row.mvp_count,
      average_damage_per_round: row.average_damage_per_round,
      average_kill_per_round: row.average_kill_per_round,
      average_death_per_round: row.average_death_per_round,
      utility_damage_per_round: row.utility_damage_per_round,
      rank_type: row.rank_type,
      rank: row.rank,
      old_rank: row.old_rank,
      wins_count: row.wins_count,
      bomb_planted_count: row.bomb_planted_count,
      bomb_defused_count: row.bomb_defused_count,
      hostage_rescued_count: row.hostage_rescued_count,
      score: row.score,
      kast: row.kast,
      hltv_rating: row.hltv_rating,
      hltv_rating_2: row.hltv_rating_2,
      utility_damage: row.utility_damage,
      trade_kill_count: row.trade_kill_count,
      trade_death_count: row.trade_death_count,
      first_trade_kill_count: row.first_trade_kill_count,
      first_trade_death_count: row.first_trade_death_count,
      one_kill_count: row.one_kill_count,
      two_kill_count: row.two_kill_count,
      three_kill_count: row.three_kill_count,
      four_kill_count: row.four_kill_count,
      five_kill_count: row.five_kill_count,
      inspect_weapon_count: row.inspect_weapon_count,
      color: row.color,
      crosshair_share_code: row.crosshair_share_code,
      custom_avatar_url: getCustomAvatarUrl(row.steam_id) || null
    }));

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
