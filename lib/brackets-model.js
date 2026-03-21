/**
 * Modèle brackets schema v2 : tournois dynamiques (swiss / élimination),
 * rounds nommés, upper / lower / grande finale, liens IN/OUT par match.
 * Lecture legacy { swiss, elite, amateur } convertie à la volée.
 */

const SCHEMA_VERSION = 2;

const DEFAULT_SWISS_LAYOUT = {
  slots: 16,
  roundBlocks: {
    0: [[0, 16]],
    1: [[0, 8], [8, 16]],
    2: [[0, 4], [4, 12], [12, 16]],
    3: [[0, 6], [6, 12]],
    4: [[0, 6]]
  },
  wlLabels: {
    0: ['0-0'],
    1: ['1-0', '0-1'],
    2: ['2-0', '1-1', '0-2'],
    3: ['2-1', '1-2'],
    4: ['2-2']
  }
};

function emptyMatch() {
  return { teamA: '', teamB: '', winner: null, demoId: null, links: { in: [], out: [] } };
}

function normalizeLinkRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  const roundIndex = Number(ref.roundIndex);
  const matchIndex = Number(ref.matchIndex);
  if (!Number.isInteger(roundIndex) || roundIndex < 0) return null;
  if (!Number.isInteger(matchIndex) || matchIndex < 0) return null;
  const lane = ref.lane === 'lower' || ref.lane === 'grand' ? ref.lane : 'upper';
  return { lane, roundIndex, matchIndex };
}

function normalizeLinks(links) {
  const rawIn = links && Array.isArray(links.in) ? links.in : [];
  const rawOut = links && Array.isArray(links.out) ? links.out : [];
  return {
    in: rawIn.map(normalizeLinkRef).filter(Boolean),
    out: rawOut.map(normalizeLinkRef).filter(Boolean)
  };
}

function normalizeMatch(m) {
  if (!m || typeof m !== 'object') return emptyMatch();
  return {
    teamA: m.teamA != null ? String(m.teamA).trim() : '',
    teamB: m.teamB != null ? String(m.teamB).trim() : '',
    winner: m.winner != null && String(m.winner).trim() !== '' ? String(m.winner).trim() : null,
    demoId: m.demoId != null && String(m.demoId).trim() !== '' ? String(m.demoId).trim() : null,
    links: normalizeLinks(m.links)
  };
}

function normalizeSwissLegacy(swiss) {
  if (!swiss || !swiss.rounds) return { rounds: [] };
  const matchCounts = [16, 16, 16, 12, 6];
  const teams = (swiss.teams && Array.isArray(swiss.teams)) ? swiss.teams : [];
  const toMatch = (legacy) => {
    if (legacy && (legacy.teamA != null || legacy.teamAIndex != null || legacy.teamB != null || legacy.teamBIndex != null)) {
      const nameA = legacy.teamA != null ? String(legacy.teamA).trim()
        : (legacy.teamAIndex != null && teams[legacy.teamAIndex] ? teams[legacy.teamAIndex].name : '');
      const nameB = legacy.teamB != null ? String(legacy.teamB).trim()
        : (legacy.teamBIndex != null && teams[legacy.teamBIndex] ? teams[legacy.teamBIndex].name : '');
      let winner = null;
      if (legacy.winner != null && String(legacy.winner).trim() !== '') winner = String(legacy.winner).trim();
      else if (legacy.winnerIndex != null && teams[legacy.winnerIndex]) winner = teams[legacy.winnerIndex].name || null;
      return normalizeMatch({
        teamA: nameA || '',
        teamB: nameB || '',
        winner,
        demoId: legacy.demoId != null ? String(legacy.demoId).trim() : null,
        links: legacy.links
      });
    }
    return emptyMatch();
  };
  const rounds = swiss.rounds || [];
  return {
    rounds: matchCounts.map((count, ri) => {
      const r = rounds[ri] || { matches: [] };
      const matches = (r.matches || []).slice(0, count).map(toMatch);
      while (matches.length < count) matches.push(emptyMatch());
      return { roundIndex: ri, matches };
    })
  };
}

/** Titres par défaut : deux derniers rounds = même format (1 match) qu’un Lower Final, en doublon avant la grande finale. */
const DEFAULT_LOWER_ROUND_TITLES = ['Lower R1', 'Lower R2', 'Lower R3', 'Lower R4', 'Lower R5', 'Lower Final'];

/** Effectifs des 6 rounds lower affichés (hors grande finale). */
const LOWER_DISPLAY_MATCH_COUNTS = [4, 4, 2, 2, 1, 1];

/** Lower fichier legacy : R1–R4 (4,4,2,2), Lower R5 (1), Lower Final (1), grande finale = lr[6] séparée en v2. */
function normalizeLowerRoundsLegacy(lowerRounds) {
  const targetSeven = [4, 4, 2, 2, 1, 1, 1];
  const raw = Array.isArray(lowerRounds) ? lowerRounds.slice() : [];
  let expanded;

  if (raw.length === 6) {
    expanded = raw.slice();
    expanded.splice(4, 0, { matches: [] });
  } else if (raw.length === 3) {
    const newToOld = { 0: 0, 2: 1, 4: 2 };
    const sixCounts = [4, 4, 2, 2, 1, 1];
    expanded = sixCounts.map((count, ri) => {
      const oldRi = newToOld[ri];
      const existing = (oldRi != null && raw[oldRi] && raw[oldRi].matches)
        ? raw[oldRi].matches
        : (raw[ri] && raw[ri].matches ? raw[ri].matches : []);
      const matches = Array.from({ length: count }, (_, i) => {
        const ex = existing[i];
        if (ex && (ex.teamA !== undefined || ex.teamB !== undefined || ex.winner !== undefined)) {
          return normalizeMatch({ ...ex, links: ex.links });
        }
        return emptyMatch();
      });
      return { matches };
    });
    expanded.splice(4, 0, { matches: [] });
  } else {
    expanded = raw.slice();
    if (expanded.length > 7) expanded.length = 7;
    while (expanded.length < 7) expanded.push({ matches: [] });
  }

  return targetSeven.map((count, ri) => {
    const r = expanded[ri] || { matches: [] };
    const existing = r.matches || [];
    const matches = Array.from({ length: count }, (_, i) => {
      const ex = existing[i];
      if (ex && (ex.teamA !== undefined || ex.teamB !== undefined || ex.winner !== undefined)) {
        return normalizeMatch({ ...ex, links: ex.links });
      }
      return emptyMatch();
    });
    return { roundIndex: ri, matches };
  });
}

/**
 * Garantit 6 rounds lower avec les bons nombres de matchs.
 * Ancien v2 à 5 entrées : insertion d’un Lower R5 (1 match) avant l’ex-« Lower Final ».
 */
function normalizeLowerRoundsV2(lowerRoundsInput) {
  if (!lowerRoundsInput || !Array.isArray(lowerRoundsInput) || lowerRoundsInput.length === 0) return null;
  let rounds = lowerRoundsInput.map((r) => ({ ...r, matches: r.matches ? [...r.matches] : [] }));

  if (rounds.length > 6) {
    rounds = rounds.slice(0, 6);
  }

  if (rounds.length === 5) {
    rounds.splice(4, 0, { matches: [], title: DEFAULT_LOWER_ROUND_TITLES[4] });
  }

  while (rounds.length < 6) {
    rounds.push({ matches: [] });
  }

  return rounds.map((r, i) => {
    const count = LOWER_DISPLAY_MATCH_COUNTS[i];
    const title = (r.title != null && String(r.title).trim() !== '')
      ? String(r.title).trim()
      : (DEFAULT_LOWER_ROUND_TITLES[i] || `Lower R${i + 1}`);
    const raw = r.matches || [];
    const matches = Array.from({ length: count }, (_, j) => {
      const ex = raw[j];
      if (ex && (ex.teamA !== undefined || ex.teamB !== undefined || ex.winner !== undefined)) {
        return normalizeMatch({ ...ex, links: ex.links });
      }
      return emptyMatch();
    });
    return { roundIndex: i, title, matches };
  });
}

function inferUpperBracketLinks(rounds) {
  if (!rounds || !rounds.length) return;
  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r];
    const list = round.matches || [];
    for (let mi = 0; mi < list.length; mi++) {
      const m = list[mi];
      if (!m.links) m.links = { in: [], out: [] };
      const hasIn = (m.links.in && m.links.in.length > 0);
      const hasOut = (m.links.out && m.links.out.length > 0);
      if (!hasOut && r < rounds.length - 1) {
        m.links.out = [{ lane: 'upper', roundIndex: r + 1, matchIndex: Math.floor(mi / 2) }];
      }
      if (!hasIn && r > 0) {
        const prevN = (rounds[r - 1].matches || []).length;
        const a = mi * 2;
        const b = mi * 2 + 1;
        const inc = [];
        if (a < prevN) inc.push({ lane: 'upper', roundIndex: r - 1, matchIndex: a });
        if (b < prevN) inc.push({ lane: 'upper', roundIndex: r - 1, matchIndex: b });
        m.links.in = inc;
      }
    }
  }
}

function eliminationFromLegacy(id, title, description, upperLegacyRounds, lowerLegacyRounds) {
  const emptyR = (n) => ({ matches: Array.from({ length: n }, () => emptyMatch()) });
  const defUpper = [emptyR(8), emptyR(4), emptyR(2), emptyR(1)];
  const upperSrc = (upperLegacyRounds && upperLegacyRounds.length) ? upperLegacyRounds : defUpper;
  const upperRounds = upperSrc.map((r, i) => ({
    roundIndex: i,
    title: r.title || ['8e de finale', 'Quarts', 'Demi-finales', 'Upper Final'][i] || `Upper R${i + 1}`,
    matches: (r.matches || []).map((m) => normalizeMatch(m))
  }));
  while (upperRounds.length < 4) {
    const i = upperRounds.length;
    upperRounds.push({ roundIndex: i, title: `Upper R${i + 1}`, matches: Array.from({ length: Math.pow(2, 3 - i) }, () => emptyMatch()) });
  }
  inferUpperBracketLinks(upperRounds);

  const lr = normalizeLowerRoundsLegacy(lowerLegacyRounds);
  const lowerRounds = lr.slice(0, 6).map((r, i) => ({
    roundIndex: i,
    title: r.title || DEFAULT_LOWER_ROUND_TITLES[i] || `Lower R${i + 1}`,
    matches: (r.matches || []).map((m) => normalizeMatch(m))
  }));
  const grandRound = lr[6];
  const grandFinale = grandRound && grandRound.matches && grandRound.matches.length
    ? {
        title: grandRound.title || 'Grande Finale',
        matches: grandRound.matches.map((m) => normalizeMatch(m))
      }
    : { title: 'Grande Finale', matches: [emptyMatch()] };

  return {
    id,
    title,
    description,
    type: 'elimination',
    drawBracketLinks: true,
    lowerBracketLabel: 'Lower Bracket (perdants 8e)',
    upperBracketLabel: 'Upper Bracket',
    upperRounds,
    lowerRounds,
    grandFinale
  };
}

function legacyToV2(data) {
  const tournaments = [];
  if (data.swiss) {
    const sw = normalizeSwissLegacy(data.swiss);
    tournaments.push({
      id: 'swiss',
      title: 'Swiss (32 → Elite / Amateur)',
      description: 'Swiss 32 équipes · 3 victoires = qualifié, 3 défaites = éliminé · 5 rondes max · Appariement par bilan (même W-L).',
      type: 'swiss',
      swissRules: { qualifyWins: 3, eliminateLosses: 3 },
      swissLayout: { ...DEFAULT_SWISS_LAYOUT },
      rounds: sw.rounds.map((r, i) => ({
        roundIndex: r.roundIndex != null ? r.roundIndex : i,
        title: r.title || `Round ${i + 1}`,
        matches: r.matches.map((m) => normalizeMatch(m))
      }))
    });
  }
  if (data.elite) {
    tournaments.push(eliminationFromLegacy(
      'elite',
      'Arbre Elite (16)',
      'Élimination directe · 8e, quarts, demies, finale',
      data.elite.rounds,
      data.elite.lowerRounds
    ));
  }
  if (data.amateur) {
    tournaments.push(eliminationFromLegacy(
      'amateur',
      'Arbre Amateur (16)',
      'Élimination directe · 8e, quarts, demies, finale',
      data.amateur.rounds,
      data.amateur.lowerRounds
    ));
  }
  return { schemaVersion: SCHEMA_VERSION, tournaments };
}

function normalizeSwissTournament(t) {
  const layout = {
    slots: Number(t.swissLayout?.slots) > 0 ? Number(t.swissLayout.slots) : DEFAULT_SWISS_LAYOUT.slots,
    roundBlocks: t.swissLayout?.roundBlocks || DEFAULT_SWISS_LAYOUT.roundBlocks,
    wlLabels: t.swissLayout?.wlLabels || DEFAULT_SWISS_LAYOUT.wlLabels
  };
  const rules = {
    qualifyWins: Number(t.swissRules?.qualifyWins) >= 0 ? Number(t.swissRules.qualifyWins) : 3,
    eliminateLosses: Number(t.swissRules?.eliminateLosses) >= 0 ? Number(t.swissRules.eliminateLosses) : 3
  };
  const rounds = (t.rounds || []).map((r, i) => ({
    roundIndex: r.roundIndex != null ? r.roundIndex : i,
    title: (r.title != null && String(r.title).trim() !== '') ? String(r.title).trim() : `Round ${i + 1}`,
    matches: (r.matches || []).map((m) => normalizeMatch(m))
  }));
  return {
    id: String(t.id || 'tournament').trim() || 'tournament',
    title: String(t.title || 'Tournoi').trim() || 'Tournoi',
    description: String(t.description || '').trim(),
    type: 'swiss',
    swissRules: rules,
    swissLayout: layout,
    rounds
  };
}

function normalizeEliminationTournament(t) {
  const upperRounds = (t.upperRounds || t.rounds || []).map((r, i) => ({
    roundIndex: r.roundIndex != null ? r.roundIndex : i,
    title: (r.title != null && String(r.title).trim() !== '') ? String(r.title).trim() : `Upper R${i + 1}`,
    matches: (r.matches || []).map((m) => normalizeMatch(m))
  }));
  inferUpperBracketLinks(upperRounds);

  const hasLower = t.lowerRounds != null && Array.isArray(t.lowerRounds) && t.lowerRounds.length > 0;
  const lowerRounds = hasLower ? normalizeLowerRoundsV2(t.lowerRounds) : null;

  let grandFinale = null;
  if (t.grandFinale && t.grandFinale.matches && t.grandFinale.matches.length) {
    grandFinale = {
      title: String(t.grandFinale.title || 'Grande Finale').trim() || 'Grande Finale',
      matches: t.grandFinale.matches.map((m) => normalizeMatch(m))
    };
  }

  return {
    id: String(t.id || 'tournament').trim() || 'tournament',
    title: String(t.title || 'Tournoi').trim() || 'Tournoi',
    description: String(t.description || '').trim(),
    type: 'elimination',
    drawBracketLinks: t.drawBracketLinks !== false,
    lowerBracketLabel: (t.lowerBracketLabel != null && String(t.lowerBracketLabel).trim() !== '')
      ? String(t.lowerBracketLabel).trim()
      : 'Lower Bracket (perdants 8e)',
    upperBracketLabel: (t.upperBracketLabel != null && String(t.upperBracketLabel).trim() !== '')
      ? String(t.upperBracketLabel).trim()
      : 'Upper Bracket',
    upperRounds,
    lowerRounds,
    grandFinale
  };
}

function normalizeTournament(t) {
  if (!t || typeof t !== 'object') return null;
  if (t.type === 'swiss') return normalizeSwissTournament(t);
  return normalizeEliminationTournament(t);
}

function normalizeV2Payload(data) {
  if (!data || typeof data !== 'object') return defaultV2Brackets();
  const tournaments = (Array.isArray(data.tournaments) ? data.tournaments : [])
    .map(normalizeTournament)
    .filter(Boolean);
  if (tournaments.length === 0) return defaultV2Brackets();
  return { schemaVersion: SCHEMA_VERSION, tournaments };
}

function defaultV2Brackets() {
  const emptyMatchFn = () => emptyMatch();
  const swissRounds = [
    { roundIndex: 0, title: 'Round 1', matches: Array.from({ length: 16 }, emptyMatchFn) },
    { roundIndex: 1, title: 'Round 2', matches: Array.from({ length: 16 }, emptyMatchFn) },
    { roundIndex: 2, title: 'Round 3', matches: Array.from({ length: 16 }, emptyMatchFn) },
    { roundIndex: 3, title: 'Round 4', matches: Array.from({ length: 12 }, emptyMatchFn) },
    { roundIndex: 4, title: 'Round 5', matches: Array.from({ length: 6 }, emptyMatchFn) }
  ];
  const elimRound = (n) => ({ matches: Array.from({ length: n }, emptyMatchFn) });
  const lowerLegacy = [elimRound(4), elimRound(4), elimRound(2), elimRound(2), elimRound(1), elimRound(1), elimRound(1)];
  const legacy = {
    swiss: { rounds: swissRounds.map((r) => ({ roundIndex: r.roundIndex, matches: r.matches })) },
    elite: { rounds: [elimRound(8), elimRound(4), elimRound(2), elimRound(1)], lowerRounds: lowerLegacy },
    amateur: { rounds: [elimRound(8), elimRound(4), elimRound(2), elimRound(1)], lowerRounds: lowerLegacy }
  };
  return legacyToV2(legacy);
}

function isLegacyBrackets(data) {
  if (!data || typeof data !== 'object') return true;
  if (data.schemaVersion === SCHEMA_VERSION && Array.isArray(data.tournaments)) return false;
  return !!(data.swiss || data.elite || data.amateur);
}

/**
 * Charge depuis disque : JSON brut → toujours schema v2 normalisé (sans DB).
 */
function parseBracketsFileContent(rawJson) {
  let data;
  try {
    data = JSON.parse(rawJson);
  } catch {
    return defaultV2Brackets();
  }
  if (isLegacyBrackets(data)) {
    if (data.swiss) data.swiss = normalizeSwissLegacy(data.swiss);
    if (data.elite) data.elite = { ...data.elite, lowerRounds: normalizeLowerRoundsLegacy(data.elite.lowerRounds) };
    if (data.amateur) data.amateur = { ...data.amateur, lowerRounds: normalizeLowerRoundsLegacy(data.amateur.lowerRounds) };
    return legacyToV2(data);
  }
  return normalizeV2Payload(data);
}

function getMatchRef(tournament, lane, roundIndex, matchIndex) {
  if (tournament.type === 'swiss' || lane === 'swiss') {
    const rounds = tournament.rounds || [];
    if (!rounds[roundIndex]) return null;
    const matches = rounds[roundIndex].matches || [];
    return matches[matchIndex] || null;
  }
  if (lane === 'grand' && tournament.grandFinale) {
    return tournament.grandFinale.matches[matchIndex] || null;
  }
  const rounds = lane === 'lower' ? tournament.lowerRounds : tournament.upperRounds;
  if (!rounds || !rounds[roundIndex]) return null;
  const matches = rounds[roundIndex].matches || [];
  return matches[matchIndex] || null;
}

function applyMatchUpdate(tournaments, tournamentId, lane, roundIndex, matchIndex, fields) {
  const t = tournaments.find((x) => x.id === tournamentId);
  if (!t) return { ok: false, error: 'tournoi introuvable' };
  const m = getMatchRef(t, lane, roundIndex, matchIndex);
  if (!m) return { ok: false, error: 'match introuvable' };
  if (fields.teamA !== undefined) m.teamA = String(fields.teamA ?? '').trim();
  if (fields.teamB !== undefined) m.teamB = String(fields.teamB ?? '').trim();
  if (fields.winner !== undefined) m.winner = fields.winner == null || fields.winner === '' ? null : String(fields.winner).trim();
  if (fields.demoId !== undefined) m.demoId = fields.demoId == null || fields.demoId === '' ? null : String(fields.demoId).trim();
  return { ok: true };
}

/** Pour migration / inspection : v2 → forme legacy (sans liens). */
function v2ToLegacyExport(v2) {
  const out = {};
  (v2.tournaments || []).forEach((t) => {
    if (t.id === 'swiss' && t.type === 'swiss') {
      out.swiss = {
        rounds: (t.rounds || []).map((r) => ({
          roundIndex: r.roundIndex,
          matches: (r.matches || []).map(({ teamA, teamB, winner, demoId }) => ({ teamA, teamB, winner, demoId }))
        }))
      };
    } else if (t.type === 'elimination') {
      const lower = [];
      (t.lowerRounds || []).forEach((r) => {
        lower.push({ matches: (r.matches || []).map(({ teamA, teamB, winner, demoId }) => ({ teamA, teamB, winner, demoId })) });
      });
      if (t.grandFinale && t.grandFinale.matches) {
        lower.push({ matches: t.grandFinale.matches.map(({ teamA, teamB, winner, demoId }) => ({ teamA, teamB, winner, demoId })) });
      }
      out[t.id] = {
        rounds: (t.upperRounds || []).map((r) => ({
          matches: (r.matches || []).map(({ teamA, teamB, winner, demoId }) => ({ teamA, teamB, winner, demoId }))
        })),
        lowerRounds: lower
      };
    }
  });
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_SWISS_LAYOUT,
  emptyMatch,
  normalizeMatch,
  parseBracketsFileContent,
  defaultV2Brackets,
  legacyToV2,
  v2ToLegacyExport,
  normalizeV2Payload,
  applyMatchUpdate,
  isLegacyBrackets,
  inferUpperBracketLinks,
  normalizeSwissLegacy,
  normalizeLowerRoundsLegacy
};
