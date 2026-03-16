/**
 * Réinitialise data/brackets.json avec la structure par défaut (même logique que server.js).
 */
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
const bracketsPath = path.join(dataDir, 'brackets.json');

function defaultBrackets() {
  const emptyMatch = () => ({ teamA: '', teamB: '', winner: null, demoId: null });
  const swissRounds = [
    { roundIndex: 0, matches: Array.from({ length: 16 }, emptyMatch) },
    { roundIndex: 1, matches: Array.from({ length: 16 }, emptyMatch) },
    { roundIndex: 2, matches: Array.from({ length: 16 }, emptyMatch) },
    { roundIndex: 3, matches: Array.from({ length: 12 }, emptyMatch) },
    { roundIndex: 4, matches: Array.from({ length: 6 }, emptyMatch) }
  ];
  const elimRound = (n) => ({ matches: Array.from({ length: n }, emptyMatch) });
  const lowerRounds = [elimRound(4), elimRound(4), elimRound(2), elimRound(2), elimRound(1), elimRound(1)];
  return {
    swiss: { rounds: swissRounds },
    elite: { rounds: [elimRound(8), elimRound(4), elimRound(2), elimRound(1)], lowerRounds },
    amateur: { rounds: [elimRound(8), elimRound(4), elimRound(2), elimRound(1)], lowerRounds }
  };
}

const data = defaultBrackets();
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(bracketsPath, JSON.stringify(data, null, 2), 'utf8');
console.log('brackets.json réinitialisé.');
