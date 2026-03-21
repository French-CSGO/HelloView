#!/usr/bin/env node
/**
 * Convertit un fichier brackets.json legacy { swiss, elite, amateur }
 * vers le schéma v2 { schemaVersion, tournaments } sur la sortie standard.
 *
 * Usage :
 *   node scripts/brackets-legacy-to-v2.js /chemin/vers/brackets.json > brackets.v2.json
 *
 * Pour régénérer data/brackets.json et data/players.json depuis data/import/ :
 *   node scripts/import-to-data.js
 *
 * Ne modifie pas les fichiers sources ; redirigez la sortie vers un nouveau fichier
 * puis remplacez sur l’instance de production si besoin.
 */

const fs = require('fs');
const path = require('path');
const bracketsModel = require('../lib/brackets-model');

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/brackets-legacy-to-v2.js <chemin/brackets.json>');
  process.exit(1);
}
const abs = path.resolve(process.cwd(), input);
if (!fs.existsSync(abs)) {
  console.error('Fichier introuvable:', abs);
  process.exit(1);
}
const raw = fs.readFileSync(abs, 'utf8');
const v2 = bracketsModel.parseBracketsFileContent(raw);
process.stdout.write(JSON.stringify(v2, null, 2) + '\n');
