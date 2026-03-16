#!/usr/bin/env node
/**
 * Parse players.sql (COPY block) and output JSON for the frontend.
 * Run: node scripts/parse-players.js < players.sql > data/players.json
 */
const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, '..', 'players.sql');
const outPath = path.join(__dirname, '..', 'data', 'players.json');

const cols = [
  'id', 'match_checksum', 'steam_id', 'index', 'team_name', 'name',
  'kill_count', 'death_count', 'assist_count', 'headshot_count',
  'damage_health', 'damage_armor', 'first_kill_count', 'first_death_count', 'mvp_count',
  'average_damage_per_round', 'average_kill_per_round', 'average_death_per_round', 'utility_damage_per_round',
  'rank_type', 'rank', 'old_rank', 'wins_count',
  'bomb_planted_count', 'bomb_defused_count', 'hostage_rescued_count',
  'score', 'kast', 'hltv_rating', 'hltv_rating_2',
  'utility_damage', 'trade_kill_count', 'trade_death_count', 'first_trade_kill_count', 'first_trade_death_count',
  'one_kill_count', 'two_kill_count', 'three_kill_count', 'four_kill_count', 'five_kill_count',
  'inspect_weapon_count', 'color', 'crosshair_share_code'
];

const numKeys = new Set([
  'id', 'index', 'kill_count', 'death_count', 'assist_count', 'headshot_count',
  'damage_health', 'damage_armor', 'first_kill_count', 'first_death_count', 'mvp_count',
  'average_damage_per_round', 'average_kill_per_round', 'average_death_per_round', 'utility_damage_per_round',
  'rank_type', 'rank', 'old_rank', 'wins_count',
  'bomb_planted_count', 'bomb_defused_count', 'hostage_rescued_count',
  'score', 'kast', 'hltv_rating', 'hltv_rating_2',
  'utility_damage', 'trade_kill_count', 'trade_death_count', 'first_trade_kill_count', 'first_trade_death_count',
  'one_kill_count', 'two_kill_count', 'three_kill_count', 'four_kill_count', 'five_kill_count',
  'inspect_weapon_count', 'color'
]);

const raw = fs.readFileSync(sqlPath, 'utf8');
const copyStart = raw.indexOf('COPY public.players');
const copyEnd = raw.indexOf('\n\\.\n', copyStart);
const block = raw.slice(copyStart, copyEnd);
const lines = block.split('\n').slice(1);

const players = [];
for (const line of lines) {
  if (!line.trim()) continue;
  const parts = line.split('\t');
  const row = {};
  cols.forEach((c, i) => {
    let v = parts[i];
    if (numKeys.has(c) && v !== undefined && v !== '') {
      const n = Number(v);
      row[c] = Number.isNaN(n) ? v : n;
    } else {
      row[c] = v;
    }
  });
  players.push(row);
}

// Build matches list (unique match_checksum)
const matchIds = [...new Set(players.map(p => p.match_checksum))];
const matches = matchIds.map((checksum, i) => ({ id: checksum, label: `Match ${i + 1}` }));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ players, matches }, null, 2), 'utf8');
console.error('Wrote', players.length, 'players to', outPath);
