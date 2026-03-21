/**
 * Réinitialise data/brackets.json avec la structure par défaut (schema v2, lib/brackets-model.js).
 */
const path = require('path');
const fs = require('fs');
const bracketsModel = require('../lib/brackets-model');

const dataDir = path.join(__dirname, '..', 'data');
const bracketsPath = path.join(dataDir, 'brackets.json');

const data = bracketsModel.defaultV2Brackets();
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(bracketsPath, JSON.stringify(data, null, 2), 'utf8');
console.log('brackets.json réinitialisé (schema v2).');
