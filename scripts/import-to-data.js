#!/usr/bin/env node
/**
 * Convertit les fichiers d’import legacy vers les JSON d’affichage dans data/.
 *
 * - data/import/brackets.json → { swiss, elite, amateur } ou déjà v2 → data/brackets.json
 *   (schemaVersion 2, tournois normalisés, même pipeline que le serveur).
 * - data/import/players.json → { matches, players } (sans version) → data/players.json
 *   avec statsFileVersion, équipes dérivées si besoin, matchs enrichis (noms d’équipes).
 *
 * Usage :
 *   node scripts/import-to-data.js
 *   node scripts/import-to-data.js --dry-run
 *   node scripts/import-to-data.js --import-dir chemin/import --out-dir chemin/sortie
 *
 * Variables d’environnement (optionnel) :
 *   HELLOVIEW_IMPORT_DIR, HELLOVIEW_DATA_DIR
 */

const fs = require('fs');
const path = require('path');
const bracketsModel = require('../lib/brackets-model');
const statsFileModel = require('../lib/stats-file-model');

const root = path.join(__dirname, '..');

function parseArgs(argv) {
  const out = { dryRun: false, importDir: null, outDir: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--import-dir' && argv[i + 1]) {
      out.importDir = path.resolve(argv[++i]);
    } else if (a === '--out-dir' && argv[i + 1]) {
      out.outDir = path.resolve(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/import-to-data.js [--dry-run] [--import-dir DIR] [--out-dir DIR]

Lit par défaut :
  \${HELLOVIEW_IMPORT_DIR:-data/import}/brackets.json
  \${HELLOVIEW_IMPORT_DIR:-data/import}/players.json

Écrit :
  \${HELLOVIEW_DATA_DIR:-data}/brackets.json
  \${HELLOVIEW_DATA_DIR:-data}/players.json
`);
    process.exit(0);
  }

  const importDir = args.importDir
    || (process.env.HELLOVIEW_IMPORT_DIR && path.resolve(root, process.env.HELLOVIEW_IMPORT_DIR))
    || path.join(root, 'data', 'import');
  const outDir = args.outDir
    || (process.env.HELLOVIEW_DATA_DIR && path.resolve(root, process.env.HELLOVIEW_DATA_DIR))
    || path.join(root, 'data');

  const inBrackets = path.join(importDir, 'brackets.json');
  const inPlayers = path.join(importDir, 'players.json');
  const outBrackets = path.join(outDir, 'brackets.json');
  const outPlayers = path.join(outDir, 'players.json');

  const errors = [];
  if (!fs.existsSync(inBrackets)) errors.push('manquant: ' + inBrackets);
  if (!fs.existsSync(inPlayers)) errors.push('manquant: ' + inPlayers);
  if (errors.length) {
    console.error('Erreur :\n' + errors.join('\n'));
    process.exit(1);
  }

  const rawBrackets = fs.readFileSync(inBrackets, 'utf8');
  const rawPlayers = fs.readFileSync(inPlayers, 'utf8');

  const bracketsV2 = bracketsModel.normalizeV2Payload(
    bracketsModel.parseBracketsFileContent(rawBrackets)
  );
  const statsPayload = statsFileModel.parseStatsFileContent(rawPlayers);

  const bracketsJson = JSON.stringify(bracketsV2, null, 2) + '\n';
  const playersJson = JSON.stringify(statsPayload, null, 2) + '\n';

  console.log('Brackets → schemaVersion', bracketsV2.schemaVersion, '·', (bracketsV2.tournaments || []).length, 'tournoi(s)');
  console.log('Players  → statsFileVersion', statsPayload.statsFileVersion,
    '·', statsPayload.players.length, 'joueur(s) ·',
    statsPayload.matches.length, 'match(s) ·',
    statsPayload.teams.length, 'équipe(s)');

  if (args.dryRun) {
    console.log('--dry-run : aucun fichier écrit.');
    return;
  }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outBrackets, bracketsJson, 'utf8');
  fs.writeFileSync(outPlayers, playersJson, 'utf8');
  console.log('Écrit :', outBrackets);
  console.log('Écrit :', outPlayers);
}

main();
