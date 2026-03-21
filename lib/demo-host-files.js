/**
 * Indexe les fichiers .dem sous data/demo/ (un sous-dossier par serveur).
 * Correspondance avec matches.demo_path en comparant uniquement le nom de fichier (insensible à la casse).
 */

const fs = require('fs');
const path = require('path');

const INDEX_TTL_MS = 60 * 1000;

/** @type {{ map: Map<string, { server: string, file: string }>, builtAt: number }} */
let cache = { map: new Map(), builtAt: 0 };

function isSafeDemoSubdir(name) {
  if (name == null || name === '') return true;
  const s = String(name);
  if (s.length > 120 || s.includes('..')) return false;
  return !/[/\\]/.test(s);
}

function isSafeDemoFilename(name) {
  if (!name || String(name).length > 220) return false;
  const s = String(name);
  if (s.includes('..') || /[/\\]/.test(s)) return false;
  return /\.dem$/i.test(s);
}

/**
 * Extrait le nom de fichier depuis un chemin Windows ou POSIX (ex. CSV demo_path).
 * @param {string | null | undefined} demoPath
 * @returns {string | null}
 */
function demoPathBasename(demoPath) {
  if (demoPath == null || demoPath === '') return null;
  const s = String(demoPath).trim().replace(/\\/g, '/');
  const parts = s.split('/').filter((p) => p !== '');
  if (!parts.length) return null;
  return parts[parts.length - 1] || null;
}

/**
 * @param {string} demoRoot chemin absolu vers data/demo
 * @returns {Map<string, { server: string, file: string }>} clé = basename en minuscules
 */
function buildDemoBasenameIndex(demoRoot) {
  const map = new Map();
  if (!demoRoot || !fs.existsSync(demoRoot)) return map;

  let entries;
  try {
    entries = fs.readdirSync(demoRoot, { withFileTypes: true });
  } catch {
    return map;
  }

  for (const ent of entries) {
    if (ent.isDirectory()) {
      const sub = path.join(demoRoot, ent.name);
      if (!isSafeDemoSubdir(ent.name)) continue;
      let files;
      try {
        files = fs.readdirSync(sub, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile() || !f.name.toLowerCase().endsWith('.dem')) continue;
        const key = f.name.toLowerCase();
        if (!map.has(key)) map.set(key, { server: ent.name, file: f.name });
      }
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.dem')) {
      const key = ent.name.toLowerCase();
      if (!map.has(key)) map.set(key, { server: '', file: ent.name });
    }
  }
  return map;
}

/**
 * @param {string} demoRoot
 * @returns {Map<string, { server: string, file: string }>}
 */
function getDemoBasenameIndex(demoRoot) {
  const now = Date.now();
  if (now - cache.builtAt < INDEX_TTL_MS && cache.map.size >= 0) {
    return cache.map;
  }
  cache = { map: buildDemoBasenameIndex(demoRoot), builtAt: now };
  return cache.map;
}

function invalidateDemoIndex() {
  cache.builtAt = 0;
}

/**
 * @param {string} demoRoot
 * @param {string} server sous-dossier ou '' pour fichier à la racine de demo/
 * @param {string} file nom du fichier .dem
 * @returns {string | null} chemin absolu résolu ou null
 */
function resolveHostedDemoPath(demoRoot, server, file) {
  if (!demoRoot || !fs.existsSync(demoRoot)) return null;
  if (!isSafeDemoFilename(file)) return null;
  if (server != null && server !== '' && !isSafeDemoSubdir(server)) return null;

  const absRoot = path.resolve(demoRoot);
  const rel = server && String(server).trim() !== ''
    ? path.join(absRoot, server, file)
    : path.join(absRoot, file);

  const absFile = path.resolve(rel);
  if (!absFile.toLowerCase().startsWith(absRoot.toLowerCase() + path.sep) && absFile !== absRoot) {
    return null;
  }
  if (!fs.existsSync(absFile) || !fs.statSync(absFile).isFile()) return null;
  return absFile;
}

/**
 * @param {Map<string, { server: string, file: string }>} index
 * @param {string | null | undefined} demoPath colonne matches.demo_path
 * @returns {{ url: string, filename: string } | null}
 */
function demoDownloadForDbPath(index, demoPath) {
  const base = demoPathBasename(demoPath);
  if (!base) return null;
  const entry = index.get(base.toLowerCase());
  if (!entry) return null;
  const params = new URLSearchParams();
  if (entry.server) params.set('server', entry.server);
  params.set('file', entry.file);
  return {
    url: '/api/demos/download?' + params.toString(),
    filename: entry.file
  };
}

module.exports = {
  demoPathBasename,
  buildDemoBasenameIndex,
  getDemoBasenameIndex,
  invalidateDemoIndex,
  resolveHostedDemoPath,
  isSafeDemoSubdir,
  isSafeDemoFilename,
  demoDownloadForDbPath,
  INDEX_TTL_MS
};
