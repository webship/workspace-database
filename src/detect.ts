/**
 * Which databases a project folder has, read from its files alone: no process is started, so a page of fifty
 * rows can ask for each of them.
 *
 * A project's runtime is read the way the Workspace's runtime layer reads it (core/scripts/functions/fun-runtime.sh,
 * rt_find_project), for the folder itself: an `x-webship:` block (in compose.yaml, .lando.yml or
 * .docksal/docksal.yml), written by a builder run with `--runtime`, first; then DDEV's `.ddev/config.yaml`; then a
 * Landofile or a `.docksal/` of the project's own. A folder with none of them and a compose file of its own is a
 * Docker Compose project the layer does not run: its database is a service of that file.
 */

import fs from 'fs';
import path from 'path';
import { load, FAILSAFE_SCHEMA, YAML11_SCHEMA } from 'js-yaml';

import type { DatabaseFound } from './engine';

/** A file's text, or '' when it cannot be read. */
function read(file: string): string {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; }
}

/** A YAML document as plain strings (8.0 stays "8.0"), or null when the text is not YAML: a broken file must not blank a row. */
function yamlStrings(text: string): any {
  if (!text) return null;
  try { return load(text, { schema: FAILSAFE_SCHEMA }); } catch (_) { return null; }
}

/** A YAML document with anchors and merge keys resolved, as compose files use them. */
function yamlMerged(text: string): any {
  if (!text) return null;
  try { return load(text, { schema: YAML11_SCHEMA }); } catch (_) { return null; }
}

const isMap = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The engine's id for a name a runtime gives it: DDEV's and Lando's 'postgres' is 'postgresql'. */
export function engineName(type: string): string {
  const t = String(type || '').toLowerCase().trim();
  if (t === 'postgres' || t === 'postgresql' || t === 'pgsql') return 'postgresql';
  return t;
}

// ---- DDEV -------------------------------------------------------------------------------------------------------

/** DDEV's database when a project's config names none: MariaDB 10.11 (DDEV 1.23 and later). */
export const DDEV_DEFAULT = Object.freeze({ type: 'mariadb', version: '10.11' });

export interface DdevDatabase {
  /** 'mariadb', 'mysql', 'postgres' as DDEV writes it. */
  type: string;
  version: string;
  /** `omit_containers: [db]`: the project has no database. */
  omitted: boolean;
  /** Nothing in the project's config names the database: DDEV's default. */
  fromDefault: boolean;
  /** The project's name for DDEV. */
  name: string;
  docroot: string;
}

/** The database of a DDEV project: `.ddev/config.yaml`, then the `config.*.yaml` DDEV merges over it, in its order. */
export function readDdev(projectDir: string): DdevDatabase | null {
  const dir = path.join(projectDir, '.ddev');
  const main = read(path.join(dir, 'config.yaml'));
  if (!main) return null;
  let extra: string[] = [];
  try { extra = fs.readdirSync(dir).filter((f) => /^config\..+\.ya?ml$/.test(f)).sort(); } catch (_) { extra = []; }
  let type = '';
  let version = '';
  let omitted = false;
  let name = '';
  let docroot = '';
  for (const text of [main, ...extra.map((f) => read(path.join(dir, f)))]) {
    const doc = yamlStrings(text);
    if (!isMap(doc)) continue;
    if (isMap(doc.database)) {
      if (doc.database.type) type = String(doc.database.type).trim();
      if (doc.database.version) version = String(doc.database.version).trim();
    }
    if (Array.isArray(doc.omit_containers)) omitted = doc.omit_containers.map((c: unknown) => String(c).trim()).includes('db');
    if (doc.name) name = String(doc.name).trim();
    if (doc.docroot !== undefined) docroot = String(doc.docroot).trim();
  }
  const fromDefault = !type && !version;
  const t = type || DDEV_DEFAULT.type;
  return { type: t, version: version || (t === DDEV_DEFAULT.type ? DDEV_DEFAULT.version : ''), omitted, fromDefault, name: name || path.basename(projectDir), docroot };
}

// ---- The runtime layer ------------------------------------------------------------------------------------------

/** The files that carry an `x-webship:` block, in the order the runtime layer reads them. */
export const LAYER_FILES = ['compose.yaml', '.lando.yml', '.docksal/docksal.yml'];

/** The runtime layer's database when a block names none: MariaDB 10.11, the `php` stack's. */
export const LAYER_DEFAULT = Object.freeze({ engine: 'mariadb', version: '10.11' });

export interface WebshipBlock { file: string; runtime: string; database: string; name: string; type: string; docroot: string }

/** The `x-webship:` block of a project the Workspace built on another runtime than DDEV, or null. */
export function readWebshipBlock(projectDir: string): WebshipBlock | null {
  for (const file of LAYER_FILES) {
    const text = read(path.join(projectDir, file));
    if (!/^x-webship:/m.test(text)) continue;
    const doc = yamlStrings(text);
    const b = isMap(doc) ? doc['x-webship'] : null;
    if (!isMap(b) || !b.runtime) continue;
    const s = (k: string) => (b[k] === undefined || b[k] === null ? '' : String(b[k]).trim());
    return { file, runtime: s('runtime'), database: s('database'), name: s('name') || (isMap(doc) && doc.name ? String(doc.name) : ''), type: s('type'), docroot: s('docroot') };
  }
  return null;
}

/**
 * The engine and version a block's `database:` names. The layer writes the version of its MariaDB ("10.11"); a
 * value with an engine before a colon ("mysql:8.0", "postgres:16") names another engine, the way `ddev config
 * --database=` does.
 */
export function layerEngine(value: string): { engine: string; version: string } {
  const v = String(value || '').trim();
  if (!v) return { ...LAYER_DEFAULT };
  const m = v.match(/^([a-z][a-z0-9]*):(.*)$/i);
  if (m) return { engine: engineName(m[1]), version: m[2].trim() };
  return { engine: 'mariadb', version: v };
}

// ---- A compose file of the project's own --------------------------------------------------------------------------

/** The compose files Docker Compose reads, in its order. */
export const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];

export interface ComposeService { name: string; image: string }

/** A compose file the Workspace did not write (no `x-webship:` block) and its services, or null. */
export function readOwnCompose(projectDir: string): { file: string; services: ComposeService[] } | null {
  for (const file of COMPOSE_FILES) {
    const text = read(path.join(projectDir, file));
    if (!text || /^x-webship:/m.test(text)) continue;
    const doc = yamlMerged(text);
    if (!isMap(doc) || !isMap(doc.services)) continue;
    const services: ComposeService[] = [];
    for (const [name, raw] of Object.entries(doc.services)) {
      if (!isMap(raw)) continue;
      // A merge key a schema left as it is: its values under the service's own.
      const svc = isMap(raw['<<']) ? { ...raw['<<'], ...raw } : raw;
      if (typeof svc.image === 'string' && svc.image.trim()) services.push({ name, image: svc.image.trim() });
    }
    return { file, services };
  }
  return null;
}

/**
 * The engine and version of a container image, or null for an image that is not a database's: the official
 * images, their Bitnami and Docksal builds, and the PostgreSQL ones with an extension inside (PostGIS, pgvector,
 * TimescaleDB). The version is the tag's: `postgres:16-alpine` is 16, `mysql:8.0.36` is 8.0, `pgvector/pgvector:pg16`
 * is 16; `latest` or no tag says none.
 */
export function engineOfImage(image: string): { engine: string; version: string } | null {
  const ref = String(image || '').trim().toLowerCase().replace(/@sha256:[0-9a-f]+$/, '');
  if (!ref) return null;
  const slash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  const repo = colon > slash ? ref.slice(0, colon) : ref;
  const tag = colon > slash ? ref.slice(colon + 1) : '';
  const name = repo.slice(repo.lastIndexOf('/') + 1);
  let engine = '';
  if (name === 'mariadb') engine = 'mariadb';
  else if (['mysql', 'mysql-server', 'percona', 'percona-server'].includes(name)) engine = 'mysql';
  else if (['postgres', 'postgresql', 'postgis', 'pgvector', 'timescaledb', 'timescaledb-ha'].includes(name)) engine = 'postgresql';
  if (!engine) return null;
  const m = tag.replace(/^pg/, '').match(/^(\d+)(?:\.(\d+))?/);
  let version = '';
  if (m) version = engine === 'postgresql' && Number(m[1]) >= 10 ? m[1] : (m[2] !== undefined ? `${m[1]}.${m[2]}` : m[1]);
  return { engine, version };
}

// ---- The project's runtime ----------------------------------------------------------------------------------------

/**
 * The runtime of a project folder, as the layer decides it for the folder itself: the block's runtime, 'ddev',
 * 'lando' or 'docksal' for a file of the project's own, 'compose' for a compose file the layer does not run, or ''.
 */
export function projectRuntime(projectDir: string): string {
  const block = readWebshipBlock(projectDir);
  if (block) return block.runtime;
  if (fs.existsSync(path.join(projectDir, '.ddev', 'config.yaml'))) return 'ddev';
  if (fs.existsSync(path.join(projectDir, '.lando.yml')) || fs.existsSync(path.join(projectDir, '.lando.yaml'))) return 'lando';
  if (fs.existsSync(path.join(projectDir, '.docksal', 'docksal.env')) || fs.existsSync(path.join(projectDir, '.docksal', 'docksal.yml'))) return 'docksal';
  if (readOwnCompose(projectDir)) return 'compose';
  return '';
}

/**
 * The database servers of a project folder: the layer's (one `db`), DDEV's (one `db`, none when it is omitted), or
 * the database services of a compose file of the project's own (any number). A Landofile or a `.docksal/` of the
 * project's own is run by the layer too, but which engine it holds is not read yet: none is said for it.
 */
export function serverDatabases(projectDir: string): DatabaseFound[] {
  const block = readWebshipBlock(projectDir);
  if (block) {
    const { engine, version } = layerEngine(block.database);
    return [{ engine, version, via: 'layer', runtime: block.runtime, service: 'db', ...(block.database ? {} : { note: 'the runtime layer\'s default' }) }];
  }
  const ddev = readDdev(projectDir);
  if (ddev) {
    if (ddev.omitted) return [];
    return [{ engine: engineName(ddev.type), version: ddev.version, via: 'ddev', runtime: 'ddev', service: 'db', ...(ddev.fromDefault ? { note: 'DDEV\'s default' } : {}) }];
  }
  const rt = projectRuntime(projectDir);
  if (rt === 'lando' || rt === 'docksal') return [];
  const own = readOwnCompose(projectDir);
  if (!own) return [];
  const out: DatabaseFound[] = [];
  for (const s of own.services) {
    const e = engineOfImage(s.image);
    if (e) out.push({ engine: e.engine, version: e.version, via: 'compose', runtime: 'docker', service: s.name, composeFile: own.file });
  }
  return out;
}

// ---- SQLite files ---------------------------------------------------------------------------------------------------

/** The 16 bytes every SQLite 3 database file starts with. */
export const SQLITE_HEADER = 'SQLite format 3\u0000';

/** Where the frameworks that default to SQLite keep their file, relative to the project. */
export const SQLITE_PLACES = [
  'database/database.sqlite',      // Laravel
  '.tmp/data.db',                  // Strapi
  'db.sqlite3',                    // Django, Wagtail
  'payload.db',                    // Payload
  'prisma/dev.db',                 // Prisma (Next.js and others)
  'var/data.db',                   // Symfony
  'storage/development.sqlite3',   // Rails
  'db/development.sqlite3',        // Rails, older
  'content/data/ghost-local.db',   // Ghost
  'content/data/ghost-dev.db',
  'content/data/ghost.db',
  'instance/app.db',               // Flask
];

/** Folders a SQLite file is often kept in, looked into without going deeper. */
export const SQLITE_FOLDERS = ['', 'database', 'data', 'db', 'storage', 'var', '.tmp', 'prisma', 'instance', 'content/data'];

const SQLITE_EXT = /\.(sqlite3?|db3?|s3db|sl3)$/i;

/** Is the file a SQLite database: its header, or an empty file at a place a framework names (Laravel starts with one)? */
function isSqlite(file: string, emptyIsOne: boolean): boolean {
  let fd: number | null = null;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    if (st.size === 0) return emptyIsOne;
    if (st.size < 100) return false;
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    return buf.toString('latin1') === SQLITE_HEADER;
  } catch (_) {
    return false;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch (_) { /* closed */ }
  }
}

/** What a project's `.env` says its SQLite file is: Laravel's DB_DATABASE, Strapi's DATABASE_FILENAME, a `file:`/`sqlite:` URL. */
export function sqliteFromEnv(projectDir: string): string[] {
  const text = read(path.join(projectDir, '.env'));
  if (!text) return [];
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  const out: string[] = [];
  if (/^sqlite$/i.test(env.DB_CONNECTION || '') && env.DB_DATABASE) out.push(env.DB_DATABASE);
  if (/^sqlite$/i.test(env.DATABASE_CLIENT || '') && env.DATABASE_FILENAME) out.push(env.DATABASE_FILENAME);
  for (const key of ['DATABASE_URL', 'DATABASE_URI']) {
    const v = env[key] || '';
    let m = v.match(/^file:(.+)$/i);
    // Prisma reads `file:` relative to its schema's folder.
    if (m) { out.push(key === 'DATABASE_URL' && fs.existsSync(path.join(projectDir, 'prisma')) ? path.join('prisma', m[1]) : m[1]); continue; }
    m = v.match(/^sqlite:\/\/\/(.+)$/i);
    if (m) out.push(m[1].replace(/^%kernel\.project_dir%\//, ''));
  }
  return out;
}

/** A path a project gives, relative to the project: an absolute one in the container (/var/www/html, /app, /var/www) is the project's root there. */
function relativeTo(projectDir: string, given: string): string {
  let p = String(given || '').trim();
  p = p.replace(/^\/(?:var\/www\/html|app|var\/www)\//, '');
  if (path.isAbsolute(p)) {
    const rel = path.relative(projectDir, p);
    return rel.startsWith('..') ? '' : rel;
  }
  p = path.normalize(p).replace(/^(\.\/)+/, '');
  return p.startsWith('..') ? '' : p;
}

/**
 * The SQLite databases a project folder keeps, relative to it: what its `.env` names, the places the frameworks use,
 * a Drupal site's `sites/<site>/files/.ht.sqlite`, and the SQLite files of a few common folders (one level, never
 * deeper, never node_modules or vendor). At most `max`, the named ones first.
 */
export function sqliteFiles(projectDir: string, max = 8): string[] {
  const named: string[] = [];
  for (const p of sqliteFromEnv(projectDir)) { const rel = relativeTo(projectDir, p); if (rel) named.push(rel); }
  const ddev = readDdev(projectDir);
  const block = readWebshipBlock(projectDir);
  const docroot = (block && block.docroot) || (ddev && ddev.docroot) || '';
  const drupal: string[] = [];
  for (const root of [...new Set([docroot, 'web', 'docroot', ''])]) {
    const sites = path.join(projectDir, root, 'sites');
    let names: string[] = [];
    try { names = fs.readdirSync(sites); } catch (_) { continue; }
    for (const site of names) drupal.push(path.join(root, 'sites', site, 'files', '.ht.sqlite'));
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const take = (rel: string, emptyIsOne: boolean) => {
    if (out.length >= max || !rel) return;
    const abs = path.join(projectDir, rel);
    let real = abs;
    try { real = fs.realpathSync(abs); } catch (_) { return; }
    if (seen.has(real) || !isSqlite(abs, emptyIsOne)) return;
    seen.add(real);
    out.push(rel.split(path.sep).join('/'));
  };
  for (const rel of named) take(rel, true);
  for (const rel of SQLITE_PLACES) take(rel, true);
  for (const rel of drupal) take(rel, false);
  for (const folder of SQLITE_FOLDERS) {
    let names: string[] = [];
    try { names = fs.readdirSync(path.join(projectDir, folder)).sort(); } catch (_) { continue; }
    for (const n of names) if (SQLITE_EXT.test(n)) take(path.join(folder, n), false);
  }
  return out;
}
