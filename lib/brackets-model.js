/**
 * Modèle brackets schema v2 : tournois dynamiques (swiss / élimination),
 * rounds nommés, upper / lower / grande finale, liens IN/OUT par match.
 * Lecture legacy { swiss, elite, amateur } convertie à la volée.
 */

const SCHEMA_VERSION = 2;

/** Format d’un match : BO1 (une démo) ou BO3 (2 à 3 démos, 2 manches pour gagner). */
const ALLOWED_MATCH_BEST_OF = [1, 3];

function normalizeMatchBestOf(n) {
  return Number(n) === 3 ? 3 : 1;
}

function winsNeededForBestOf(bestOf) {
  return Math.ceil(normalizeMatchBestOf(bestOf) / 2);
}

function normBracketTeamName(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * Compte les victoires par carte à partir des vainqueurs en base (winner_name).
 * winnerByChecksum: Map checksum -> winner_name brut
 */
function computeSeriesWinner(teamA, teamB, demoIds, winnerByChecksum, bestOf) {
  const need = winsNeededForBestOf(bestOf);
  const aRaw = String(teamA || '').trim();
  const bRaw = String(teamB || '').trim();
  const na = normBracketTeamName(aRaw);
  const nb = normBracketTeamName(bRaw);
  if (!na || !nb) return null;
  let winsA = 0;
  let winsB = 0;
  const ids = Array.isArray(demoIds) ? demoIds : [];
  for (const id of ids) {
    const ck = id != null && String(id).trim() !== '' ? String(id).trim() : '';
    if (!ck) continue;
    const wRaw = winnerByChecksum.get(ck);
    if (wRaw == null || String(wRaw).trim() === '') continue;
    const nw = normBracketTeamName(wRaw);
    if (nw === na) winsA++;
    else if (nw === nb) winsB++;
  }
  if (winsA >= need) return aRaw;
  if (winsB >= need) return bRaw;
  return null;
}

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
  return { teamA: '', teamB: '', winner: null, demoId: null, demoIds: [], bestOf: 1, links: { in: [], out: [] } };
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
  let demoIds = [];
  if (Array.isArray(m.demoIds)) {
    demoIds = m.demoIds.map((x) => (x != null ? String(x).trim() : '')).filter(Boolean);
  }
  if (!demoIds.length && m.demoId != null && String(m.demoId).trim() !== '') {
    demoIds = [String(m.demoId).trim()];
  }
  const demoId = demoIds[0] || null;
  return {
    teamA: m.teamA != null ? String(m.teamA).trim() : '',
    teamB: m.teamB != null ? String(m.teamB).trim() : '',
    winner: m.winner != null && String(m.winner).trim() !== '' ? String(m.winner).trim() : null,
    demoId,
    demoIds,
    bestOf: normalizeMatchBestOf(m.bestOf),
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

const DEFAULT_UPPER_ROUND_TITLES = ['8e de finale', 'Quarts', 'Demi-finales', 'Upper Final'];

/** Gabarit par défaut (16 équipes, double élim classique côté app). Pilotable depuis le JSON via eliminationLayout. */
const DEFAULT_ELIMINATION_LAYOUT = {
  upper: { matchCounts: [8, 4, 2, 1], titles: DEFAULT_UPPER_ROUND_TITLES },
  lower: { matchCounts: [...LOWER_DISPLAY_MATCH_COUNTS], titles: [...DEFAULT_LOWER_ROUND_TITLES] },
  grandFinale: { matchCount: 1, title: 'Grande Finale' }
};

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

function padMatches(matches, count) {
  const n = Math.max(0, Math.floor(Number(count)) || 0);
  const m = (matches || []).map((x) => normalizeMatch(x));
  while (m.length < n) m.push(emptyMatch());
  if (m.length > n) m.length = n;
  return m;
}

/**
 * Lower : enchaînement gauche → droite. m === n → même index ; m === n/2 → fusion binaire ; 1 → 1.
 * Les entrées depuis l’upper (perdants) ne sont pas inférées ici — déclarables en JSON sur links.in.
 */
function inferLowerBracketLinks(rounds) {
  if (!rounds || !rounds.length) return;
  for (let r = 0; r < rounds.length - 1; r++) {
    const list = rounds[r].matches || [];
    const nextLen = (rounds[r + 1].matches || []).length;
    if (!list.length || !nextLen) continue;
    for (let mi = 0; mi < list.length; mi++) {
      const m = list[mi];
      if (!m.links) m.links = { in: [], out: [] };
      const hasOut = m.links.out && m.links.out.length > 0;
      if (hasOut) continue;
      const n = list.length;
      const mNext = nextLen;
      let j = -1;
      if (mNext === n) j = mi;
      else if (n % 2 === 0 && mNext === n / 2) j = Math.floor(mi / 2);
      else if (n === 1 && mNext === 1) j = 0;
      if (j >= 0) {
        m.links.out = [{ lane: 'lower', roundIndex: r + 1, matchIndex: j }];
      }
    }
  }
  for (let r = 1; r < rounds.length; r++) {
    const list = rounds[r].matches || [];
    const prevList = rounds[r - 1].matches || [];
    for (let mi = 0; mi < list.length; mi++) {
      const match = list[mi];
      if (!match.links) match.links = { in: [], out: [] };
      const hasIn = match.links.in && match.links.in.length > 0;
      if (hasIn) continue;
      const inc = [];
      for (let pi = 0; pi < prevList.length; pi++) {
        const outs = (prevList[pi].links && prevList[pi].links.out) || [];
        for (const ref of outs) {
          if (ref.lane === 'lower' && ref.roundIndex === r && ref.matchIndex === mi) {
            inc.push({ lane: 'lower', roundIndex: r - 1, matchIndex: pi });
          }
        }
      }
      if (inc.length) match.links.in = inc;
    }
  }
}

function inferGrandFinaleLinks(upperRounds, lowerRounds, grandFinale) {
  if (!grandFinale || !grandFinale.matches || !grandFinale.matches.length) return;
  const gm = grandFinale.matches[0];
  if (!gm.links) gm.links = { in: [], out: [] };
  if (gm.links.in && gm.links.in.length > 0) return;
  const inc = [];
  if (upperRounds && upperRounds.length > 0) {
    const ur = upperRounds.length - 1;
    inc.push({ lane: 'upper', roundIndex: ur, matchIndex: 0 });
  }
  if (lowerRounds && lowerRounds.length > 0) {
    const lr = lowerRounds.length - 1;
    inc.push({ lane: 'lower', roundIndex: lr, matchIndex: 0 });
  }
  if (inc.length) gm.links.in = inc;
}

function buildEliminationLayoutSnapshot(upperRounds, lowerRounds, grandFinale) {
  const snap = {
    upper: {
      matchCounts: upperRounds.map((r) => (r.matches || []).length),
      titles: upperRounds.map((r) => r.title)
    }
  };
  if (lowerRounds && lowerRounds.length) {
    snap.lower = {
      matchCounts: lowerRounds.map((r) => (r.matches || []).length),
      titles: lowerRounds.map((r) => r.title)
    };
  }
  if (grandFinale && grandFinale.matches && grandFinale.matches.length) {
    snap.grandFinale = {
      matchCount: grandFinale.matches.length,
      title: grandFinale.title
    };
  }
  return snap;
}

function alignEliminationUpperRounds(t) {
  const layout = t.eliminationLayout && t.eliminationLayout.upper;
  let counts = layout && Array.isArray(layout.matchCounts) && layout.matchCounts.length
    ? layout.matchCounts.map((c) => Math.max(0, Math.floor(Number(c)) || 0))
    : null;
  if (!counts || !counts.length) {
    const from = t.upperRounds || t.rounds;
    if (from && from.length) counts = from.map((r) => Math.max(1, (r.matches || []).length));
    else counts = [...DEFAULT_ELIMINATION_LAYOUT.upper.matchCounts];
  } else {
    counts = counts.map((c) => Math.max(0, Math.floor(Number(c)) || 0)).filter((c) => c > 0);
    if (!counts.length) counts = [...DEFAULT_ELIMINATION_LAYOUT.upper.matchCounts];
  }

  const titles = layout && Array.isArray(layout.titles) ? layout.titles : null;
  let src = t.upperRounds || t.rounds || [];
  src = src.map((r) => ({ ...r, matches: r.matches ? [...r.matches] : [] }));
  while (src.length < counts.length) src.push({ matches: [] });
  src = src.slice(0, counts.length);

  return src.map((r, i) => {
    const cnt = counts[i];
    const title = (titles && titles[i] != null && String(titles[i]).trim() !== '')
      ? String(titles[i]).trim()
      : ((r.title != null && String(r.title).trim() !== '') ? String(r.title).trim() : (DEFAULT_UPPER_ROUND_TITLES[i] || `Upper R${i + 1}`));
    return { roundIndex: i, title, matches: padMatches(r.matches, cnt) };
  });
}

function alignEliminationLowerRounds(t) {
  const layoutLower = t.eliminationLayout && t.eliminationLayout.lower;
  let counts = layoutLower && Array.isArray(layoutLower.matchCounts) && layoutLower.matchCounts.length
    ? layoutLower.matchCounts.map((c) => Math.max(0, Math.floor(Number(c)) || 0))
    : null;

  let src = (t.lowerRounds && Array.isArray(t.lowerRounds))
    ? t.lowerRounds.map((r) => ({ ...r, matches: r.matches ? [...r.matches] : [] }))
    : [];

  if (src.length === 5) {
    src.splice(4, 0, { matches: [], title: DEFAULT_LOWER_ROUND_TITLES[4] });
  }

  if (!counts || !counts.length) {
    if (src.length) counts = src.map((r) => Math.max(1, (r.matches || []).length));
    else return null;
  } else {
    counts = counts.filter((c) => c > 0);
    if (!counts.length) return null;
  }

  while (src.length < counts.length) src.push({ matches: [] });
  src = src.slice(0, counts.length);

  const titles = layoutLower && Array.isArray(layoutLower.titles) ? layoutLower.titles : null;
  return src.map((r, i) => {
    const cnt = counts[i];
    const title = (titles && titles[i] != null && String(titles[i]).trim() !== '')
      ? String(titles[i]).trim()
      : ((r.title != null && String(r.title).trim() !== '') ? String(r.title).trim() : (DEFAULT_LOWER_ROUND_TITLES[i] || `Lower R${i + 1}`));
    return { roundIndex: i, title, matches: padMatches(r.matches, cnt) };
  });
}

function alignGrandFinale(t) {
  const gLayout = t.eliminationLayout && t.eliminationLayout.grandFinale;
  let count = gLayout != null && gLayout.matchCount != null ? Math.floor(Number(gLayout.matchCount)) : NaN;
  if (!Number.isFinite(count) || count < 1) {
    count = (t.grandFinale && t.grandFinale.matches && t.grandFinale.matches.length)
      ? t.grandFinale.matches.length
      : DEFAULT_ELIMINATION_LAYOUT.grandFinale.matchCount;
  }
  count = Math.max(1, count);
  const title = (gLayout && gLayout.title != null && String(gLayout.title).trim() !== '')
    ? String(gLayout.title).trim()
    : ((t.grandFinale && t.grandFinale.title != null && String(t.grandFinale.title).trim() !== '')
      ? String(t.grandFinale.title).trim()
      : DEFAULT_ELIMINATION_LAYOUT.grandFinale.title);
  const srcMatches = (t.grandFinale && t.grandFinale.matches) ? t.grandFinale.matches : [];
  return { title, matches: padMatches(srcMatches, count) };
}

function eliminationFromLegacy(id, title, description, upperLegacyRounds, lowerLegacyRounds) {
  const emptyR = (n) => ({ matches: Array.from({ length: n }, () => emptyMatch()) });
  const defUpper = [emptyR(8), emptyR(4), emptyR(2), emptyR(1)];
  const upperSrc = (upperLegacyRounds && upperLegacyRounds.length) ? upperLegacyRounds : defUpper;
  const upperRounds = upperSrc.map((r, i) => ({
    roundIndex: i,
    title: r.title || DEFAULT_UPPER_ROUND_TITLES[i] || `Upper R${i + 1}`,
    matches: (r.matches || []).map((m) => normalizeMatch(m))
  }));
  while (upperRounds.length < 4) {
    const i = upperRounds.length;
    upperRounds.push({
      roundIndex: i,
      title: DEFAULT_UPPER_ROUND_TITLES[i] || `Upper R${i + 1}`,
      matches: Array.from({ length: Math.pow(2, 3 - i) }, () => emptyMatch())
    });
  }

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

  return normalizeEliminationTournament({
    id,
    title,
    description,
    drawBracketLinks: true,
    lowerBracketLabel: 'Lower Bracket (perdants 8e)',
    upperBracketLabel: 'Upper Bracket',
    eliminationLayout: DEFAULT_ELIMINATION_LAYOUT,
    upperRounds,
    lowerRounds,
    grandFinale
  });
}

function legacyToV2(data) {
  const tournaments = [];
  if (data.swiss) {
    const sw = normalizeSwissLegacy(data.swiss);
    tournaments.push(normalizeSwissTournament({
      id: 'swiss',
      title: 'Swiss (32 → Elite / Amateur)',
      description: 'Swiss 32 équipes · 3 victoires = qualifié, 3 défaites = éliminé · 5 rondes max · Appariement par bilan (même W-L).',
      type: 'swiss',
      swissRules: { qualifyWins: 3, eliminateLosses: 3 },
      swissLayout: { ...DEFAULT_SWISS_LAYOUT },
      rounds: sw.rounds.map((r, i) => ({
        roundIndex: r.roundIndex != null ? r.roundIndex : i,
        title: r.title || `Round ${i + 1}`,
        matches: r.matches
      }))
    }));
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
  const legacyTourBo3 = Number(t.bestOf) === 3;
  const rounds = (t.rounds || []).map((r, i) => ({
    roundIndex: r.roundIndex != null ? r.roundIndex : i,
    title: (r.title != null && String(r.title).trim() !== '') ? String(r.title).trim() : `Round ${i + 1}`,
    matches: (r.matches || []).map((m) => normalizeMatch({
      ...m,
      bestOf: legacyTourBo3 ? 3 : (m.bestOf != null && m.bestOf !== '' ? m.bestOf : 1)
    }))
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
  const upperRounds = alignEliminationUpperRounds(t);
  inferUpperBracketLinks(upperRounds);

  const hasLowerLayout = t.eliminationLayout && t.eliminationLayout.lower && Array.isArray(t.eliminationLayout.lower.matchCounts) && t.eliminationLayout.lower.matchCounts.length > 0;
  const hasLowerData = t.lowerRounds != null && Array.isArray(t.lowerRounds) && t.lowerRounds.length > 0;
  const lowerRounds = (hasLowerLayout || hasLowerData) ? alignEliminationLowerRounds(t) : null;
  if (lowerRounds) inferLowerBracketLinks(lowerRounds);

  let grandFinale = null;
  const hasGrandMatches = t.grandFinale && t.grandFinale.matches && t.grandFinale.matches.length > 0;
  const hasGrandLayout = t.eliminationLayout && t.eliminationLayout.grandFinale;
  if (hasGrandMatches || hasGrandLayout) {
    grandFinale = alignGrandFinale(t);
  } else if (lowerRounds && lowerRounds.length) {
    grandFinale = alignGrandFinale({ ...t, grandFinale: { title: 'Grande Finale', matches: [emptyMatch()] } });
  }
  if (grandFinale) {
    if (lowerRounds && lowerRounds.length) inferGrandFinaleLinks(upperRounds, lowerRounds, grandFinale);
    else inferGrandFinaleLinks(upperRounds, null, grandFinale);
  }

  const eliminationLayout = buildEliminationLayoutSnapshot(upperRounds, lowerRounds, grandFinale);

  const legacyTourBo3 = Number(t.bestOf) === 3;
  function ensureRoundMatchesBestOf(rounds) {
    (rounds || []).forEach((r) => {
      (r.matches || []).forEach((m) => {
        m.bestOf = legacyTourBo3 ? 3 : normalizeMatchBestOf(m.bestOf);
      });
    });
  }
  ensureRoundMatchesBestOf(upperRounds);
  ensureRoundMatchesBestOf(lowerRounds);
  if (grandFinale && grandFinale.matches) {
    (grandFinale.matches || []).forEach((m) => {
      m.bestOf = legacyTourBo3 ? 3 : normalizeMatchBestOf(m.bestOf);
    });
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
    eliminationLayout,
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
  if (fields.bestOf !== undefined) m.bestOf = normalizeMatchBestOf(fields.bestOf);
  if (fields.demoIds !== undefined) {
    const arr = Array.isArray(fields.demoIds) ? fields.demoIds : [];
    const seen = new Set();
    m.demoIds = [];
    arr.forEach((x) => {
      const id = x == null ? '' : String(x).trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      m.demoIds.push(id);
    });
    m.demoId = m.demoIds[0] || null;
  } else if (fields.demoId !== undefined) {
    const v = fields.demoId == null || fields.demoId === '' ? null : String(fields.demoId).trim();
    m.demoId = v;
    m.demoIds = v ? [v] : [];
  }
  return { ok: true };
}

/**
 * Met à jour match.winner à partir des vainqueurs par démo (Map checksum -> winner_name).
 * BO3 : 2 manches gagnantes sur les démos renseignées (ordre des cartes).
 */
function applyComputedSeriesWinner(match, winnerByChecksum) {
  if (!match || typeof winnerByChecksum?.get !== 'function') return;
  const ids = (match.demoIds && match.demoIds.length) ? match.demoIds : (match.demoId ? [match.demoId] : []);
  if (!ids.length) return;
  const bo = match.bestOf != null ? normalizeMatchBestOf(match.bestOf) : 1;
  const w = computeSeriesWinner(match.teamA, match.teamB, ids, winnerByChecksum, bo);
  match.winner = w;
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
  DEFAULT_ELIMINATION_LAYOUT,
  ALLOWED_MATCH_BEST_OF,
  emptyMatch,
  normalizeMatch,
  normalizeMatchBestOf,
  winsNeededForBestOf,
  computeSeriesWinner,
  applyComputedSeriesWinner,
  parseBracketsFileContent,
  defaultV2Brackets,
  legacyToV2,
  v2ToLegacyExport,
  normalizeV2Payload,
  applyMatchUpdate,
  getMatchRef,
  isLegacyBrackets,
  inferUpperBracketLinks,
  inferLowerBracketLinks,
  normalizeSwissLegacy,
  normalizeLowerRoundsLegacy
};
