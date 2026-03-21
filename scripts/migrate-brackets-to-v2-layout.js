#!/usr/bin/env node
/**
 * Lit data/brackets.json (legacy ou v2), réécrit en schema v2 avec eliminationLayout,
 * sans liens inferrés sur les matchs (reconstruits au chargement).
 *
 * Usage : node scripts/migrate-brackets-to-v2-layout.js
 */
const fs = require('fs');
const path = require('path');
const bracketsModel = require('../lib/brackets-model');

const bracketsPath = path.join(__dirname, '..', 'data', 'brackets.json');
const raw = fs.readFileSync(bracketsPath, 'utf8');
const parsed = bracketsModel.parseBracketsFileContent(raw);

function matchPayload(m) {
  return {
    teamA: m.teamA != null ? m.teamA : '',
    teamB: m.teamB != null ? m.teamB : '',
    winner: m.winner != null ? m.winner : null,
    demoId: m.demoId != null ? m.demoId : null
  };
}

const tournaments = (parsed.tournaments || []).map((t) => {
  if (t.type === 'swiss') {
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      type: 'swiss',
      swissRules: t.swissRules,
      swissLayout: t.swissLayout,
      rounds: (t.rounds || []).map((r) => ({
        roundIndex: r.roundIndex,
        title: r.title,
        matches: (r.matches || []).map(matchPayload)
      }))
    };
  }
  const out = {
    id: t.id,
    title: t.title,
    description: t.description,
    type: 'elimination',
    drawBracketLinks: t.drawBracketLinks !== false,
    lowerBracketLabel: t.lowerBracketLabel,
    upperBracketLabel: t.upperBracketLabel,
    eliminationLayout: t.eliminationLayout,
    upperRounds: (t.upperRounds || []).map((r) => ({
      roundIndex: r.roundIndex,
      title: r.title,
      matches: (r.matches || []).map(matchPayload)
    }))
  };
  if (t.lowerRounds && t.lowerRounds.length) {
    out.lowerRounds = t.lowerRounds.map((r) => ({
      roundIndex: r.roundIndex,
      title: r.title,
      matches: (r.matches || []).map(matchPayload)
    }));
  }
  if (t.grandFinale && t.grandFinale.matches && t.grandFinale.matches.length) {
    out.grandFinale = {
      title: t.grandFinale.title,
      matches: t.grandFinale.matches.map(matchPayload)
    };
  }
  return out;
});

const payload = { schemaVersion: bracketsModel.SCHEMA_VERSION, tournaments };
fs.writeFileSync(bracketsPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log('Écrit', bracketsPath, '—', tournaments.length, 'tournoi(s).');
