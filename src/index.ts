/**
 * registerDatabase(api, engine): the whole surface of a database plugin.
 *
 * One DATABASE menu on every project row that has a database (its body loads when it opens): for each database
 * of the project, its console in a screen, tables and sizes in a modal, an export into the backups folder, an
 * import of a dump that folder holds, the statements running now, the connection details, and the web admins
 * (the official DDEV add-ons). Every entry runs the engine's tool, `cmd-tools-<engine>.sh`, in a screen session,
 * the way every long action of the dashboard runs. What differs between engines is in the engine.
 */

import fs from 'fs';
import path from 'path';
import type { ActionContext, Form, Html, PluginApi, RowContext } from '@webship.co/workspace-plugin-api';

import type { AdminTool, DatabaseEngine, DatabaseFound, DatabaseVerb } from './engine';
import { familyOf } from './family';
import type { Family, Registered } from './family';
import { serverDatabases, sqliteFiles, projectRuntime } from './detect';
import { listDumps, findDump } from './dumps';
import type { Dump } from './dumps';
import { parseTables, tablesHtml, sizeOf } from './tables';

export * from './engine';
export * from './detect';
export * from './dumps';
export * from './tables';
export { familyOf } from './family';
export type { Family, Registered } from './family';

/** The row menu's slot, its button, and the action a workspace type must allow. */
export const SLOT = 'database';
export const TYPE_ACTION = 'database';

/** Every entry, in the menu's order. */
export const VERBS: DatabaseVerb[] = ['console', 'tables', 'export', 'import', 'running', 'info', 'admin'];

/** The runtimes, as a sentence names them. */
export const RUNTIME_TITLES: Readonly<Record<string, string>> = Object.freeze({
  ddev: 'DDEV', docker: 'Docker Compose', podman: 'Podman', kubernetes: 'Kubernetes', lando: 'Lando', docksal: 'Docksal',
});

/**
 * The DATABASE button's icon: a database with a gear, for a menu that works on the database. The core's RAG menu
 * already wears the plain database (a vector index), and two alike on one row could only be told apart by a hover.
 */
export const BUTTON_ICON = 'tabler:database-cog';

/** The icon of each engine's section: a server for the three servers, a file for SQLite (no logos). */
export const ENGINE_ICONS: Readonly<Record<string, string>> = Object.freeze({
  mariadb: 'tabler:database', mysql: 'tabler:database', postgresql: 'tabler:database', sqlite: 'tabler:file-database',
});

/** The detect function of a server engine: the project's database servers of that engine. */
export function serverDetect(engineId: string): (projectDir: string) => DatabaseFound[] {
  return (projectDir: string) => serverDatabases(projectDir).filter((d) => d.engine === engineId);
}

/** The detect function of SQLite: each SQLite file of the project, reached through the project's own runtime. */
export function sqliteDetect(projectDir: string): DatabaseFound[] {
  const files = sqliteFiles(projectDir);
  if (!files.length) return [];
  const rt = projectRuntime(projectDir);
  return files.map((file) => ({ engine: 'sqlite', version: '', via: 'file' as const, runtime: rt === 'compose' ? 'docker' : rt, service: '', file }));
}

/** The web admins the engine's `admin:` setting asks for: 'none', one id, a list of ids, or all ('', 'all', 'both'). */
export function adminsOffered(engine: Pick<DatabaseEngine, 'admins'>, value: unknown): AdminTool[] {
  const v = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (v === 'none') return [];
  if (!v || v === 'all' || v === 'both') return engine.admins;
  const wanted = v.split(/[\s,]+/).filter(Boolean);
  return engine.admins.filter((t) => wanted.includes(t.id));
}

/** Where a database runs, in words: "DDEV, service db", "Docker Compose (compose.yaml), service postgres", a file. */
export function whereOf(db: DatabaseFound): string {
  if (db.via === 'file') return `${db.file}${db.runtime ? ` · ${RUNTIME_TITLES[db.runtime] || db.runtime}` : ''}`;
  const rt = RUNTIME_TITLES[db.runtime] || db.runtime;
  if (db.via === 'compose') return `${rt} (${db.composeFile}), service ${db.service}`;
  return `${rt}, service ${db.service}`;
}

/** The engine and its version, as the caption says it: "MariaDB 10.11", "SQLite". */
export const titleOf = (engine: Pick<DatabaseEngine, 'title'>, db: DatabaseFound): string => `${engine.title}${db.version ? ` ${db.version}` : ''}`;

/**
 * Why an entry does not fit a database yet, or ''. The web admins are services of their own beside the project,
 * which only DDEV adds today (its official add-ons); on the other runtimes they wait for the core to declare a
 * service for a project. What else does not fit is the engine's to say.
 */
export function whyNot(engine: DatabaseEngine, db: DatabaseFound, verb: DatabaseVerb): string {
  if (verb === 'admin' && db.via !== 'ddev') {
    const where = db.via === 'compose' ? 'a compose file of the project\'s own' : (RUNTIME_TITLES[db.runtime] || db.runtime || 'this runtime');
    return `A web admin is a service of its own beside the project: on ${where} the Workspace cannot add one yet (on DDEV it is the official add-on).`;
  }
  return engine.fits ? engine.fits(db, verb) || '' : '';
}

/** A value for a shell line, in single quotes. */
export const shq = (v: unknown): string => `'${String(v).replace(/'/g, `'\\''`)}'`;

/** A word of a shell line: as it is when it is plain (a name, a flag, a path), else in single quotes. */
export const shArg = (v: unknown): string => (/^[A-Za-z0-9_.\/:=@%+,-]+$/.test(String(v)) ? String(v) : shq(v));

/** The tool's arguments that name one database of a project: a compose file's service, or a SQLite file. */
export function selectArgs(db: DatabaseFound): string[] {
  if (db.via === 'compose' && db.service) return ['--service', db.service];
  if (db.via === 'file' && db.file) return ['--file', db.file];
  return [];
}

/** The same, for a form's values (hx-vals). */
function selectVals(db: DatabaseFound): Record<string, string> {
  if (db.via === 'compose' && db.service) return { service: db.service };
  if (db.via === 'file' && db.file) return { file: db.file };
  return {};
}

const SERVICE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const FILE_RE = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,250}$/;

/** The database of a project a form names (by its service or file), the first when it names none, or null. */
export function pickDatabase(dbs: DatabaseFound[], form: Form): DatabaseFound | null {
  const service = String(form.service || '');
  const file = String(form.file || '');
  if (service) return SERVICE_RE.test(service) ? dbs.find((d) => d.service === service && d.via === 'compose') || null : null;
  if (file) return FILE_RE.test(file) && !file.split('/').includes('..') ? dbs.find((d) => d.file === file) || null : null;
  return dbs[0] || null;
}

/** Is a web admin's DDEV add-on in the project (the compose file it adds)? */
export const adminInstalled = (projectDir: string, t: AdminTool): boolean => fs.existsSync(path.join(projectDir, '.ddev', `docker-compose.${t.ddevAddon.service}.yaml`));

export function registerDatabase(api: PluginApi, engine: DatabaseEngine): void {
  const fam = familyOf(api);
  const me: Registered = { engine, api };
  fam.engines.set(engine.id, me);
  const { esc } = api.lib;

  if (!fam.css && typeof api.addCss === 'function') {
    fam.css = true;
    api.addCss(path.join(__dirname, '..', '..', 'css', 'database.css'));
  }
  if (typeof api.addTypeAction === 'function') api.addTypeAction(TYPE_ACTION, ['sites']);
  if (!fam.owner) {
    fam.owner = me;
    registerMenu(api, fam);
  }
  registerActions(me);
  registerAdminPage(me);
  // One fragment handler per plugin: the menu's body is the owner's to answer.
  api.addFragment(({ send, rest }) => {
    const m = rest.match(/^menu\/([a-z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
    if (m && fam.owner === me) return send(menuBodyFor(fam, m[1], m[2]));
    return send(`<ul class="uk-nav uk-dropdown-nav"><li class="uk-nav-header">${esc(engine.title)}: nothing here.</li></ul>`, 404);
  });
}

// ---- What a project has ---------------------------------------------------------------------------------------------

/** A database of a project, with the engine plugin it belongs to. */
interface Hit { reg: Registered; db: DatabaseFound }

// A page of thirty rows asks once per engine and folder: the answers are kept for five seconds.
const seenAt = new WeakMap<Family, { at: number; map: Map<string, DatabaseFound[]> }>();
function detectCached(fam: Family, reg: Registered, projectDir: string): DatabaseFound[] {
  let c = seenAt.get(fam);
  const now = Date.now();
  if (!c || now - c.at > 5000) { c = { at: now, map: new Map() }; seenAt.set(fam, c); }
  const k = `${reg.engine.id}\u0000${projectDir}`;
  if (!c.map.has(k)) {
    let found: DatabaseFound[] = [];
    try { found = reg.engine.detect(projectDir) || []; } catch (_) { found = []; }
    c.map.set(k, found);
  }
  return c.map.get(k) || [];
}

/** The databases of a project of a workspace folder, by every engine whose tool the folder has and that applies there. */
function hitsOf(fam: Family, key: string, wsDir: string, project: string): Hit[] {
  const out: Hit[] = [];
  for (const reg of fam.engines.values()) {
    if (typeof reg.api.appliesTo === 'function' && !reg.api.appliesTo(key)) continue;
    if (!fs.existsSync(path.join(wsDir, reg.engine.script))) continue;
    for (const db of detectCached(fam, reg, path.join(wsDir, project))) out.push({ reg, db });
  }
  return out;
}

// ---- The DATABASE menu ----------------------------------------------------------------------------------------------

function iconOf(api: PluginApi, name: string, ratio = 0.7): string {
  if (typeof api.lib.iconHtml === 'function') return api.lib.iconHtml(name, ratio);
  return `<span uk-icon="icon: database; ratio: ${ratio}"></span>`;
}

function registerMenu(api: PluginApi, fam: Family): void {
  const { esc } = api.lib;
  const lazy = !!(api.capabilities && api.capabilities.has('row-menu-body'));
  api.addRowMenu(SLOT, { label: 'DATABASE', row: 0 }, ({ key, project, dir, allowed }: RowContext) => {
    if (allowed && allowed.size && !allowed.has(TYPE_ACTION)) return null;
    const hits = hitsOf(fam, key, dir, project);
    if (!hits.length) return null;
    const caption = hits.map((h) => titleOf(h.reg.engine, h.db)).filter((v, i, a) => a.indexOf(v) === i).join(' + ');
    const where = hits.map((h) => `${titleOf(h.reg.engine, h.db)}: ${whereOf(h.db)}`).join('; ');
    const button = `<button class="uk-button uk-button-default uk-button-small" type="button" title="${esc(where)}">${iconOf(api, BUTTON_ICON)} DATABASE <span uk-icon="icon: chevron-down; ratio: .6"></span></button>`;
    const owner = fam.owner ? fam.owner.api.name : api.name;
    if (lazy) {
      return { html: button, body: `/fragments/p/${owner}/menu/${encodeURIComponent(key)}/${encodeURIComponent(project)}`, caption, classes: 'act-menu-database-family' };
    }
    return `<span class="act-with-status"><div class="uk-inline act-menu act-menu-${SLOT} act-menu-database-family">${button}
        <div uk-dropdown="mode: click; pos: bottom-right">${menuBody(fam, key, project, hits)}</div>
      </div><span class="act-status uk-text-meta">${esc(caption)}</span></span>`;
  });
  if (typeof api.addAssistantContext === 'function') {
    api.addAssistantContext(() => {
      const engines = [...fam.engines.values()].map((r) => `${r.engine.title} (\`${r.engine.script}\`)`).join(', ');
      return `Database plugins: a DATABASE menu on a project row, for ${engines}. Each tool runs from the project's workspace folder: `
        + '`bash <folder>/cmd-tools-<engine>.sh <project> --tables` lists the tables and their sizes, `--running` the statements running now, '
        + '`--info` the engine, version, runtime and how to connect, `--export` writes a dump into the backups folder, `--console` opens the client. '
        + 'Those read or copy; `--import <file>` replaces the database (it exports the database as it was first): say so and ask before running it.';
    });
  }
}

function menuBodyFor(fam: Family, key: string, project: string): Html {
  const owner = fam.owner as Registered;
  const { esc, isValidWorkspace, workspaceDir, NAME_RE } = owner.api.lib;
  const none = (why: string) => `<ul class="uk-nav uk-dropdown-nav"><li class="uk-nav-header database-menu-note">${esc(why)}</li></ul>`;
  if (!isValidWorkspace(key) || !NAME_RE.test(project)) return none('No such project.');
  const dir = workspaceDir(key);
  if (owner.api.lib.typeAllows && !owner.api.lib.typeAllows(key, TYPE_ACTION)) return none('This folder\'s projects carry no DATABASE menu.');
  if (!fs.existsSync(path.join(dir, project))) return none('No such project.');
  const hits = hitsOf(fam, key, dir, project);
  if (!hits.length) return none('No database found in this project.');
  return menuBody(fam, key, project, hits);
}

/** The menu's body: a section per database the project has, then each engine's web admins. */
function menuBody(fam: Family, key: string, project: string, hits: Hit[]): Html {
  const owner = (fam.owner as Registered).api;
  const { esc } = owner.lib;
  const projectDir = path.join(owner.lib.workspaceDir(key), project);
  const sections: string[] = [];
  const perEngine = new Map<string, number>();
  for (const { reg, db } of hits) {
    const { engine, api } = reg;
    const n = (perEngine.get(engine.id) || 0) + 1;
    perEngine.set(engine.id, n);
    const group = n === 1 ? engine.id : `${engine.id} ${n}`;
    const post = (action: string) => `/actions/p/${api.name}/${action}`;
    const vals = (extra: Record<string, string> = {}, target = '#webship-workspace-output') =>
      `hx-vals='${esc(JSON.stringify({ workspace: key, projectName: project, ...selectVals(db), ...extra }))}' hx-target="${target}" hx-swap="innerHTML"`;
    const offered = engine.verbs || VERBS;
    const items: string[] = [];
    const note = (text: string) => `<li class="uk-nav-header database-menu-note">${esc(text)}</li>`;
    const entry = (verb: DatabaseVerb, label: string, icon: string, target?: string) => {
      if (!offered.includes(verb)) return;
      const why = whyNot(engine, db, verb);
      if (why) { items.push(note(why)); return; }
      items.push(`<li><a href hx-post="${post(verb === 'tables' || verb === 'import' ? `${verb}-form` : verb)}" ${vals({}, target)} data-entry="${esc(`${engine.id} ${verb}`)}">${iconOf(api, icon)} ${esc(label)}</a></li>`);
    };
    entry('console', `Console (${engine.client})`, 'tabler:terminal-2');
    entry('tables', 'Tables and sizes', 'tabler:table', '#editor-modal-body');
    entry('export', 'Export to the backups folder', 'tabler:database-export');
    entry('import', 'Import a dump…', 'tabler:database-import', '#editor-modal-body');
    entry('running', 'Running statements', 'tabler:clock-play');
    entry('info', 'Connection details', 'tabler:plug-connected');
    sections.push(`<li class="uk-nav-header database-menu-db" data-group="${esc(group)}">${iconOf(api, engine.icon || ENGINE_ICONS[engine.id] || 'tabler:database')} ${esc(titleOf(engine, db))}${db.note ? ` <span class="database-menu-default">(${esc(db.note)})</span>` : ''} · ${esc(whereOf(db))}</li>${items.join('')}`);
    // The web admins of this database's engine.
    if ((engine.verbs || VERBS).includes('admin')) {
      const tools = adminsOffered(engine, readSetting(api, 'admin'));
      if (tools.length) {
        const why = whyNot(engine, db, 'admin');
        const adminItems = why ? [note(why)] : tools.map((t) => {
          if (adminInstalled(projectDir, t)) {
            return `<li><a href="/${esc(engine.id)}-admin/${esc(t.id)}/${esc(key)}/${esc(project)}" target="_blank" rel="noopener" data-entry="${esc(`${engine.id} open ${t.id}`)}">${iconOf(api, 'tabler:external-link')} Open ${esc(t.label)}</a></li>`
              + `<li><a href class="uk-text-danger arm-step" hx-post="${post('admin-remove')}" ${vals({ tool: t.id, confirm: 'yes' })} hx-trigger="confirmed-remove" title="Remove the ${esc(t.label)} add-on from ${esc(project)}" data-entry="${esc(`${engine.id} remove ${t.id}`)}">${iconOf(api, 'tabler:trash')} Remove ${esc(t.label)}</a></li>`;
          }
          return `<li><a href hx-post="${post('admin')}" ${vals({ tool: t.id })} title="Adds the official DDEV add-on ${esc(t.ddevAddon.repo)} to ${esc(project)}, restarts it and says the address" data-entry="${esc(`${engine.id} add ${t.id}`)}">${iconOf(api, 'tabler:world-www')} Add ${esc(t.label)} (DDEV add-on)</a></li>`;
        });
        sections.push(`<li class="uk-nav-divider"></li><li class="uk-nav-header" data-group="${esc(`${group} web admin`)}">Web admin</li>${adminItems.join('')}`);
      }
    }
    if (engine.menuNote) sections.push(note(engine.menuNote));
  }
  return `<ul class="uk-nav uk-dropdown-nav">${sections.join('<li class="uk-nav-divider"></li>')}</ul>`;
}

/** A key of the engine plugin's own settings file, '' when it is not set. */
function readSetting(api: PluginApi, key: string): string {
  try {
    const s = api.settings && typeof api.settings.read === 'function' ? api.settings.read() : {};
    const v = s ? s[key] : undefined;
    return v === undefined || v === null ? '' : String(v);
  } catch (_) {
    return '';
  }
}

// ---- The actions --------------------------------------------------------------------------------------------------

interface Target { dir: string; project: string; db: DatabaseFound; projectDir: string }

function registerActions(me: Registered): void {
  const { engine, api } = me;
  const { esc, workspaceDir, listProjects, isValidWorkspace, NAME_RE, screenAction } = api.lib;
  const post = (action: string) => `/actions/p/${api.name}/${action}`;

  const guard = ({ form, send, workspace }: ActionContext): Target | null => {
    if (!isValidWorkspace(workspace)) { send('<div class="msg error">Unknown workspace.</div>', 400); return null; }
    const dir = workspaceDir(workspace);
    const project = String(form.projectName || '');
    if (!NAME_RE.test(project) || !listProjects(dir).includes(project)) { send('<div class="msg error">Unknown project.</div>', 400); return null; }
    if (!fs.existsSync(path.join(dir, engine.script))) {
      send(`<div class="msg error">This folder has no ${esc(engine.title)} tool (${esc(engine.script)}): install the plugin with this folder active.</div>`, 400);
      return null;
    }
    const projectDir = path.join(dir, project);
    const db = pickDatabase(engine.detect(projectDir), form);
    if (!db) { send(`<div class="msg error">${esc(project)} has no ${esc(engine.title)} database${form.service || form.file ? ' of that name' : ''}.</div>`, 409); return null; }
    return { dir, project, db, projectDir };
  };

  /** The tool's command line for a project and a database. */
  const toolLine = (t: Target, flags: string[]) => ['bash', engine.script, t.project, ...flags, ...selectArgs(t.db)].map(shArg).join(' ');

  const inScreen = (ctx: ActionContext, t: Target, verb: string, flags: string[], label: string) => screenAction(ctx.send, {
    workspace: ctx.workspace, project: t.project, projectDir: t.dir, ownerDir: t.projectDir,
    verb: `${engine.id}-${verb}`, cmdLine: toolLine(t, flags), label: `${engine.id} ${label}`,
  });

  const refuse = (ctx: ActionContext, t: Target, verb: DatabaseVerb): boolean => {
    const why = whyNot(engine, t.db, verb);
    if (why) ctx.send(`<div class="msg error">${esc(why)}</div>`, 409);
    return !!why;
  };

  api.addAction('console', (ctx) => { const t = guard(ctx); if (!t || refuse(ctx, t, 'console')) return; return inScreen(ctx, t, 'console', ['--console'], 'console'); });
  api.addAction('export', (ctx) => { const t = guard(ctx); if (!t || refuse(ctx, t, 'export')) return; return inScreen(ctx, t, 'export', ['--export'], 'export'); });
  api.addAction('running', (ctx) => { const t = guard(ctx); if (!t || refuse(ctx, t, 'running')) return; return inScreen(ctx, t, 'running', ['--running'], 'running statements'); });
  api.addAction('info', (ctx) => { const t = guard(ctx); if (!t || refuse(ctx, t, 'info')) return; return inScreen(ctx, t, 'info', ['--info'], 'connection details'); });
  api.addAction('tables', (ctx) => { const t = guard(ctx); if (!t || refuse(ctx, t, 'tables')) return; return inScreen(ctx, t, 'tables', ['--tables'], 'tables and sizes'); });

  // Tables and sizes, in the modal: the tool asked for its list, drawn as a table. A database that cannot be
  // asked from where the dashboard runs is said, with the same list in a screen instead.
  api.addAction('tables-form', async (ctx) => {
    const t = guard(ctx); if (!t || refuse(ctx, t, 'tables')) return;
    const vals = (extra: Record<string, string> = {}, target = '#webship-workspace-output') =>
      `hx-vals='${esc(JSON.stringify({ workspace: ctx.workspace, projectName: t.project, ...selectVals(t.db), ...extra }))}' hx-target="${target}" hx-swap="innerHTML"`;
    const what = `${titleOf(engine, t.db)} · ${whereOf(t.db)}`;
    const out = await api.lib.run('bash', [engine.script, t.project, '--tables', '--tsv', ...selectArgs(t.db)], t.dir, { timeoutMs: 120 * 1000 });
    const screenButton = `<button class="uk-button uk-button-default uk-button-small" hx-post="${post('tables')}" ${vals()} hx-on::after:request="if (event.detail.successful) UIkit.modal('#editor-modal').hide()">${iconOf(api, 'tabler:terminal-2')} The same in a screen</button>`;
    if (!out.ok) {
      const why = api.lib.cliError ? api.lib.cliError(`${out.stderr || ''}\n${out.stdout || ''}`) : String(out.stderr || out.stdout || '').trim().split('\n').slice(-5).join('\n');
      return ctx.send(`<div class="editor-card database-tables">
          <h3 class="uk-margin-small-bottom">Tables and sizes — ${esc(t.project)}</h3>
          <p class="uk-text-meta">${esc(what)}</p>
          <div class="msg error">The tool could not list the tables${out.code ? ` (exit ${out.code})` : ''}:</div>
          <pre class="database-tool-error">${esc(why || 'no output')}</pre>
          <div class="uk-margin-small-top">${screenButton}</div>
        </div>`);
    }
    const actions = [
      `<button class="uk-button uk-button-default uk-button-small" hx-post="${post('tables-form')}" ${vals({}, '#editor-modal-body')}>${iconOf(api, 'tabler:refresh')} Refresh</button>`,
      `<button class="uk-button uk-button-default uk-button-small" hx-post="${post('console')}" ${vals()} hx-on::after:request="if (event.detail.successful) UIkit.modal('#editor-modal').hide()">${iconOf(api, 'tabler:terminal-2')} Console</button>`,
      `<button class="uk-button uk-button-default uk-button-small" hx-post="${post('export')}" ${vals()} hx-on::after:request="if (event.detail.successful) UIkit.modal('#editor-modal').hide()">${iconOf(api, 'tabler:database-export')} Export</button>`,
      screenButton,
    ].join(' ');
    return ctx.send(tablesHtml({ esc, project: t.project, what, rows: parseTables(out.stdout), rowsAre: engine.rowsAre || 'as the engine counts them', actions }));
  });

  // Import: the dumps the backups folder holds for this engine, this project's first. Importing one asks first,
  // and the tool exports the database as it is before it imports.
  api.addAction('import-form', (ctx) => {
    const t = guard(ctx); if (!t || refuse(ctx, t, 'import')) return;
    const meta = api.lib.loadWorkspaces()[ctx.workspace] || {} as Record<string, unknown>;
    const backupsDir = String((meta as Record<string, unknown>).backupsDir || '');
    const { own, other } = backupsDir ? listDumps(backupsDir, t.project, engine) : { own: [], other: [] };
    const row = (d: Dump) => `
        <li class="database-dump">
          <span class="database-dump-name"><code>${esc(d.name)}</code></span>
          <span class="uk-text-meta">${esc(api.lib.humanTime ? api.lib.humanTime(d.mtime) : d.mtime.toISOString())} · ${esc(api.lib.humanSize ? api.lib.humanSize(d.size) : sizeOf(d.size))}</span>
          <button class="uk-button uk-button-primary uk-button-small arm-step" hx-post="${post('import')}"
            hx-vals='${esc(JSON.stringify({ workspace: ctx.workspace, projectName: t.project, ...selectVals(t.db), dump: d.name, confirm: 'yes' }))}'
            hx-target="#webship-workspace-output" hx-swap="innerHTML" hx-trigger="confirmed-remove"
            title="Replace the ${esc(engine.title)} database of ${esc(t.project)} with ${esc(d.name)}">Import</button>
        </li>`;
    const where = backupsDir && api.lib.tildePath ? api.lib.tildePath(backupsDir) : backupsDir;
    return ctx.send(`
      <div class="editor-card database-import">
        <h3 class="uk-margin-small-bottom">Import a dump — ${esc(t.project)}</h3>
        <p class="uk-text-meta">${esc(titleOf(engine, t.db))} · ${esc(whereOf(t.db))}. The dumps of <code>${esc(where)}</code> this engine can take.
          Importing replaces the database: the tool exports it as it is into the same folder first, and imports only once that export is written.</p>
        ${own.length ? `<h4 class="uk-margin-small">Made for ${esc(t.project)}</h4><ul class="uk-list uk-list-divider">${own.map(row).join('')}</ul>` : `<div class="msg assistant">No dump of ${esc(t.project)} yet: Export to the backups folder makes one.</div>`}
        ${other.length ? `<details class="uk-margin-small-top"><summary>Other dumps in this folder (${other.length})</summary><ul class="uk-list uk-list-divider">${other.map(row).join('')}</ul></details>` : ''}
        <p class="uk-text-meta">A dump elsewhere: <code>bash ${esc(engine.script)} ${esc(t.project)} --import &lt;file&gt;</code> in a terminal, from the folder.</p>
      </div>`);
  });

  api.addAction('import', (ctx) => {
    const t = guard(ctx); if (!t || refuse(ctx, t, 'import')) return;
    if (String(ctx.form.confirm || '') !== 'yes') return ctx.send('<div class="msg error">Importing replaces the database: it needs confirmation.</div>', 400);
    const meta = api.lib.loadWorkspaces()[ctx.workspace] || {} as Record<string, unknown>;
    const backupsDir = String((meta as Record<string, unknown>).backupsDir || '');
    const dump = backupsDir ? findDump(backupsDir, t.project, engine, ctx.form.dump) : null;
    if (!dump) return ctx.send('<div class="msg error">No such dump in this folder\'s backups for this engine.</div>', 404);
    return inScreen(ctx, t, 'import', ['--import', path.join(backupsDir, dump.name)], `import ${dump.name}`);
  });

  // The web admins: the official DDEV add-on, added (with a restart) and removed by the tool.
  const toolOf = (ctx: ActionContext): AdminTool | null => {
    const id = String(ctx.form.tool || '');
    const t = adminsOffered(engine, readSetting(api, 'admin')).find((x) => x.id === id) || null;
    if (!t) ctx.send(`<div class="msg error">${esc(engine.title)} offers no such web admin here (see its <code>admin:</code> setting).</div>`, 400);
    return t;
  };
  api.addAction('admin', (ctx) => {
    const t = guard(ctx); if (!t || refuse(ctx, t, 'admin')) return;
    const tool = toolOf(ctx); if (!tool) return;
    return inScreen(ctx, t, `admin-${tool.id}`, ['--admin', tool.id], `add ${tool.label}`);
  });
  api.addAction('admin-remove', (ctx) => {
    const t = guard(ctx); if (!t || refuse(ctx, t, 'admin')) return;
    if (String(ctx.form.confirm || '') !== 'yes') return ctx.send('<div class="msg error">Removing an add-on restarts the project: it needs confirmation.</div>', 400);
    const tool = toolOf(ctx); if (!tool) return;
    return inScreen(ctx, t, `admin-remove-${tool.id}`, ['--admin-remove', tool.id], `remove ${tool.label}`);
  });
}

// ---- The web admin's address ----------------------------------------------------------------------------------------

/** `/<engine>-admin/<tool>/<folder>/<project>`: the address DDEV gives the add-on's service, as a redirect. */
function registerAdminPage(me: Registered): void {
  const { engine, api } = me;
  if (!engine.admins.length || typeof api.addPage !== 'function') return;
  const { esc, isValidWorkspace, workspaceDir, NAME_RE } = api.lib;
  const ids = engine.admins.map((t) => t.id).join('|');
  api.addPage(new RegExp(`^\\/${engine.id}-admin\\/(${ids})\\/([a-z0-9_-]+)\\/([a-zA-Z0-9_-]+)$`), async ({ res, match }) => {
    const page = (status: number, text: string) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>${esc(engine.title)}</title><p>${text}</p>`);
    };
    const tool = engine.admins.find((t) => t.id === match[1]) as AdminTool;
    const [, , key, project] = match;
    if (!isValidWorkspace(key) || !NAME_RE.test(project)) return page(404, 'No such project.');
    const projectDir = path.join(workspaceDir(key), project);
    if (!fs.existsSync(path.join(projectDir, '.ddev', 'config.yaml'))) return page(404, `${esc(project)} is not a DDEV project: its web admin is DDEV's add-on.`);
    if (!adminInstalled(projectDir, tool)) return page(404, `${esc(tool.label)} is not added to ${esc(project)}: add it from the DATABASE menu.`);
    const out = await api.lib.run('ddev', ['describe', '-j'], projectDir, { timeoutMs: 30 * 1000 });
    let svc: Record<string, unknown> | null = null;
    try { svc = JSON.parse(String(out.stdout || '')).raw.services[tool.ddevAddon.service] || null; } catch (_) { svc = null; }
    const url = svc ? String(svc.https_url || svc.http_url || '') : '';
    if (!url || !/^https?:\/\//.test(url)) return page(503, `${esc(tool.label)} of ${esc(project)} has no address yet: start the project (or restart it, after the add-on was added).`);
    if (svc && svc.status && svc.status !== 'running') return page(503, `${esc(tool.label)} of ${esc(project)} is ${esc(svc.status)}: start the project first. Its address is ${esc(url)}.`);
    res.writeHead(302, { Location: url });
    return res.end();
  });
}
