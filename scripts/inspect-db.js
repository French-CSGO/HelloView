#!/usr/bin/env node
/**
 * Inspecte le schéma de la base csdemo (PostgreSQL).
 * Usage:
 *   node scripts/inspect-db.js                      → rapport schéma + échantillons
 *   node scripts/inspect-db.js --export TABLE        → exporte toute la table en JSON (stdout)
 *   node scripts/inspect-db.js -e TABLE              → idem
 *   node scripts/inspect-db.js --export-all [fichier]  → exporte toute la base en un fichier JSON
 * Lit .env à la racine du projet (PGSQL_*) ou variables PG*.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Client } = require('pg');

const args = process.argv.slice(2);
const exportTableIndex = args.findIndex((a) => a === '--export' || a === '-e');
const exportTable = exportTableIndex >= 0 && args[exportTableIndex + 1] ? args[exportTableIndex + 1] : null;
const exportAllIndex = args.findIndex((a) => a === '--export-all' || a === '--dump');
const exportAll = exportAllIndex >= 0;
const exportAllFile = exportAll && args[exportAllIndex + 1] && !args[exportAllIndex + 1].startsWith('-')
  ? args[exportAllIndex + 1]
  : path.join(__dirname, '..', 'db-export.json');

const client = new Client({
  host: process.env.PGSQL_HOST || process.env.PGHOST || 'localhost',
  port: Number(process.env.PGSQL_PORT || process.env.PGPORT || 5432),
  database: process.env.PGSQL_DATABASE || process.env.PGDATABASE || 'csdemo',
  user: process.env.PGSQL_USER || process.env.PGUSER || 'csdemo',
  password: process.env.PGSQL_PASSWORD || process.env.PGPASSWORD
});

function safeTableName(name) {
  return /^[a-z_][a-z0-9_]*$/i.test(name) ? name : `"${name}"`;
}

async function exportFullTable(tableName) {
  try {
    await client.connect();
  } catch (e) {
    console.error('Connexion PostgreSQL impossible:', e.message);
    process.exit(1);
  }
  try {
    const safeName = safeTableName(tableName);
    const res = await client.query(`SELECT * FROM public.${safeName}`);
    process.stdout.write(JSON.stringify(res.rows, null, 2));
  } catch (e) {
    console.error('Export impossible:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

async function exportAllTables(outPath) {
  try {
    await client.connect();
  } catch (e) {
    console.error('Connexion PostgreSQL impossible:', e.message);
    process.exit(1);
  }
  try {
    const tablesRes = await client.query(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name
    `);
    const dump = {};
    for (const { table_name } of tablesRes.rows) {
      const safeName = safeTableName(table_name);
      const res = await client.query(`SELECT * FROM public.${safeName}`);
      dump[table_name] = res.rows;
    }
    fs.writeFileSync(outPath, JSON.stringify(dump, null, 2), 'utf8');
    console.error('Export terminé :', outPath);
  } catch (e) {
    console.error('Export impossible:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

async function main() {
  if (exportTable) {
    return exportFullTable(exportTable);
  }
  if (exportAll) {
    return exportAllTables(exportAllFile);
  }

  try {
    await client.connect();
  } catch (e) {
    console.error('Connexion PostgreSQL impossible:', e.message);
    process.exit(1);
  }

  try {
    const tables = await client.query(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name
    `);
    console.log('=== Tables (public) ===');
    console.log(tables.rows.map(r => r.table_name).join(', ') || '(aucune)');

    const columns = await client.query(`
      SELECT table_name, column_name, data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position
    `);
    console.log('\n=== Colonnes par table ===');
    let cur = '';
    for (const r of columns.rows) {
      if (r.table_name !== cur) {
        cur = r.table_name;
        console.log('\n' + cur + ':');
      }
      console.log('  -', r.column_name, '(' + r.data_type + ')');
    }

    const matchTables = await client.query(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND ( table_name ILIKE '%match%' OR table_name ILIKE '%game%' OR table_name ILIKE '%round%' )
       ORDER BY table_name
    `);
    console.log('\n=== Tables liées aux matchs ===');
    console.log(matchTables.rows.length ? matchTables.rows.map(r => r.table_name).join(', ') : '(aucune table match/game/round)');

    if (matchTables.rows.length > 0) {
      for (const { table_name } of matchTables.rows) {
        const safeName = /^[a-z_][a-z0-9_]*$/i.test(table_name) ? table_name : `"${table_name}"`;
        const sample = await client.query(`SELECT * FROM public.${safeName} LIMIT 2`).catch(err => ({ rows: [], err }));
        if (sample.err) console.log('\n--- Table', table_name, ':', sample.err.message);
        else {
          console.log('\n--- Aperçu table', table_name, '(2 lignes) ---');
          console.log(JSON.stringify(sample.rows, null, 2));
        }
      }
    }

    const checksums = await client.query('SELECT DISTINCT match_checksum FROM public.players ORDER BY 1 LIMIT 10');
    console.log('\n=== match_checksum distincts (players) ===');
    console.log(checksums.rows.map(r => r.match_checksum).join(', '));

    console.log('\n=== Contenu utile pour les noms de match ===');
    const matchList = await client.query(`
      SELECT m.checksum, m.demo_path, m.analyze_date, m.winner_name, d.name AS demo_name, d.map_name AS demo_map
      FROM public.matches m
      LEFT JOIN public.demos d ON d.checksum = m.checksum
      ORDER BY m.analyze_date ASC
      LIMIT 30
    `).catch(err => ({ rows: [], err }));
    if (matchList.err) console.log('matches+demos:', matchList.err.message);
    else {
      console.log('\n--- matches + demos (checksum, demo_path, analyze_date, winner_name, demo_name, demo_map) ---');
      console.log(JSON.stringify(matchList.rows, null, 2));
    }

    const commentsList = await client.query('SELECT checksum, comment FROM public.comments ORDER BY checksum LIMIT 30').catch(err => ({ rows: [], err }));
    if (commentsList.err) console.log('comments:', commentsList.err.message);
    else {
      console.log('\n--- comments (checksum, comment) ---');
      console.log(JSON.stringify(commentsList.rows, null, 2));
    }

    const demosList = await client.query('SELECT checksum, name, map_name, date FROM public.demos ORDER BY date DESC NULLS LAST LIMIT 30').catch(err => ({ rows: [], err }));
    if (demosList.err) console.log('demos:', demosList.err.message);
    else {
      console.log('\n--- demos (checksum, name, map_name, date) ---');
      console.log(JSON.stringify(demosList.rows, null, 2));
    }

    const tagsList = await client.query('SELECT id, name, color FROM public.tags ORDER BY id LIMIT 50').catch(err => ({ rows: [], err }));
    if (tagsList.err) console.log('tags:', tagsList.err.message);
    else {
      console.log('\n--- tags (id, name, color) ---');
      console.log(JSON.stringify(tagsList.rows, null, 2));
    }

    const checksumTagsList = await client.query('SELECT checksum, tag_id FROM public.checksum_tags ORDER BY checksum LIMIT 50').catch(err => ({ rows: [], err }));
    if (checksumTagsList.err) console.log('checksum_tags:', checksumTagsList.err.message);
    else {
      console.log('\n--- checksum_tags (checksum, tag_id) ---');
      console.log(JSON.stringify(checksumTagsList.rows, null, 2));
    }

    const overridesList = await client.query('SELECT steam_id, name FROM public.steam_account_overrides ORDER BY steam_id').catch(err => ({ rows: [], err }));
    if (overridesList.err) console.log('steam_account_overrides:', overridesList.err.message);
    else {
      console.log('\n--- steam_account_overrides (steam_id, name) - surcharge des noms joueurs ---');
      console.log(JSON.stringify(overridesList.rows, null, 2));
    }
  } catch (e) {
    console.error(e.message);
  } finally {
    await client.end();
  }
}

main();
