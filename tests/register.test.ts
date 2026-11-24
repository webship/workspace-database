/**
 * registerDatabase: one DATABASE menu per row, shared by every engine plugin of a dashboard, and the actions each
 * engine answers under its own name.
 */
import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { registerDatabase, serverDetect, sqliteDetect, adminsOffered, whyNot, pickDatabase, familyOf, SQLITE_HEADER } from '../src/index';
import type { DatabaseEngine } from '../src/index';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'database-register-'));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function write(rel: string, body: string | Buffer) {
  fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, rel), body);
}
// The workspace: a sites folder with the tools, a DDEV project, a Docker Compose one of the layer, one of its own, a
// project with a SQLite file beside its MariaDB, and a folder of code (no DATABASE menu there).
write('dev/cmd-tools-mariadb.sh', '#!/usr/bin/env bash\n');
write('dev/cmd-tools-sqlite.sh', '#!/usr/bin/env bash\n');
write('dev/shop/.ddev/config.yaml', 'name: shop\ntype: drupal11\ndocroot: web\ndatabase:\n  type: mariadb\n  version: "10.11"\n');
write('dev/shop/.ddev/docker-compose.adminer.yaml', 'services: {}\n');
write('dev/shop/database/database.sqlite', '');
write('dev/docked/compose.yaml', 'name: docked\nx-webship:\n  runtime: docker\n  database: "11.4"\nservices:\n  db:\n    image: mariadb:11.4\n');
write('dev/ownpg/compose.yaml', 'services:\n  pg:\n    image: postgres:16\n  cache:\n    image: redis:7\n');
write('dev/static/.ddev/config.yaml', 'name: static\nomit_containers: [db]\n');
write('dev/lite/data/app.db', Buffer.concat([Buffer.from(SQLITE_HEADER, 'latin1'), Buffer.alloc(200)]));
write('dev/lite/.ddev/config.yaml', 'name: lite\nomit_containers: [db]\n');
fs.mkdirSync(path.join(ROOT, 'backups', 'dev'), { recursive: true });
write('backups/dev/shop--mariadb--2026-11-24-03-00-00.sql.gz', 'x');
write('backups/dev/shop--postgresql--2026-11-24-03-00-00.sql.gz', 'x');

type Calls = { rowMenus: Record<string, { spec: any; fn: any }>; actions: Record<string, any>; fragments: Record<string, any>; pages: any[]; css: string[]; typeActions: any[]; screens: any[]; runs: any[]; contexts: any[] };

/** One dashboard: one lib, shared by the apis it hands its plugins. */
function dashboard(opts: { runs?: (cmd: string, args: string[], cwd: string) => { ok: boolean; code: number; stdout: string; stderr: string }; settings?: Record<string, Record<string, unknown>>; lazy?: boolean } = {}) {
  const calls: Calls = { rowMenus: {}, actions: {}, fragments: {}, pages: [], css: [], typeActions: [], screens: [], runs: [], contexts: [] };
  const lib: any = {
    esc, ROOT, NAME_RE: /^[a-zA-Z0-9_-]+$/,
    workspaceDir: (ws: string) => path.join(ROOT, ws), isValidWorkspace: (ws: string) => ['dev', 'modules'].includes(ws),
    listProjects: (dir: string) => fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory()),
    loadWorkspaces: () => ({ dev: { dir: path.join(ROOT, 'dev'), backupsDir: path.join(ROOT, 'backups', 'dev') } }),
    typeAllows: (ws: string, action: string) => ws === 'dev' && action === 'database',
    iconHtml: (name: string) => `<i data-icon="${name}"></i>`,
    humanSize: (n: number) => `${n} B`, humanTime: () => 'just now', tildePath: (p: string) => p.replace(ROOT, '~'),
    cliError: (t: string) => t.trim().split('\n').slice(-2).join('\n'),
    screenAction: (send: any, o: any) => { calls.screens.push(o); send(`started ${o.verb}`); },
    run: async (cmd: string, args: string[], cwd: string) => { calls.runs.push({ cmd, args, cwd }); return opts.runs ? opts.runs(cmd, args, cwd) : { ok: true, code: 0, stdout: '', stderr: '' }; },
  };
  const apiFor = (name: string) => ({
    name, config: {}, lib,
    capabilities: new Set(opts.lazy === false ? [] : ['row-menu-body']),
    settings: { file: `plugin.${name}.settings.yml`, read: () => (opts.settings || {})[name] || {}, set() {}, setList() {} },
    appliesTo: () => true,
    addRowMenu: (slot: string, spec: any, fn: any) => { calls.rowMenus[slot] = { spec, fn }; },
    addAction: (action: string, fn: any) => { calls.actions[`/actions/p/${name}/${action}`] = fn; },
    addFragment: (fn: any) => { calls.fragments[name] = fn; },
    addPage: (re: RegExp, fn: any) => calls.pages.push({ re, fn }),
    addCss: (f: string) => calls.css.push(f), addTypeAction: (a: string, t: string[]) => calls.typeActions.push([a, t]),
    addAssistantContext: (fn: any) => calls.contexts.push(fn),
  });
  return { calls, lib, apiFor };
}

const MARIADB: DatabaseEngine = {
  id: 'mariadb', title: 'MariaDB', script: 'cmd-tools-mariadb.sh', client: 'mariadb', detect: serverDetect('mariadb'), dumpExt: '.sql.gz', rowsAre: 'the engine\'s estimate',
  admins: [{ id: 'adminer', label: 'Adminer', ddevAddon: { repo: 'ddev/ddev-adminer', service: 'adminer' } }, { id: 'phpmyadmin', label: 'phpMyAdmin', ddevAddon: { repo: 'ddev/ddev-phpmyadmin', service: 'phpmyadmin' } }],
};
const SQLITE: DatabaseEngine = {
  id: 'sqlite', title: 'SQLite', script: 'cmd-tools-sqlite.sh', client: 'sqlite3', detect: sqliteDetect, dumpExt: '.sqlite.gz', admins: [],
  verbs: ['console', 'tables', 'export', 'import', 'info'], fits: (db, verb) => (verb === 'console' && db.runtime !== 'ddev' ? 'No sqlite3 here.' : ''),
};

/** What the DATABASE slot draws for a row of the dev folder. */
const rowOf = (calls: Calls, project: string, allowed = new Set(['database'])) => calls.rowMenus.database.fn({ key: 'dev', project, dir: path.join(ROOT, 'dev'), allowed, meta: {}, vals: () => '' });
const send = () => { const out: any = { html: '', status: 200 }; return { out, send: (html: string, status = 200) => { out.html = html; out.status = status; } }; };
const post = async (calls: Calls, route: string, form: Record<string, string>) => { const s = send(); await calls.actions[route]({ form, workspace: 'dev', pathname: route, send: s.send }); return s.out; };

test('two engine plugins of one dashboard draw ONE DATABASE menu: the first one draws it, and both are in it', () => {
  const { calls, lib, apiFor } = dashboard();
  registerDatabase(apiFor('mariadb') as any, MARIADB);
  registerDatabase(apiFor('sqlite') as any, SQLITE);
  assert.deepStrictEqual(Object.keys(calls.rowMenus), ['database']);
  assert.deepStrictEqual(calls.rowMenus.database.spec, { label: 'DATABASE', row: 0 });
  assert.strictEqual(calls.css.length, 1, 'the stylesheet is added once');
  assert.ok(calls.css[0].endsWith(path.join('css', 'database.css')) && fs.existsSync(calls.css[0]));
  assert.deepStrictEqual(calls.typeActions, [['database', ['sites']], ['database', ['sites']]]);
  assert.strictEqual(calls.contexts.length, 1, 'the assistant hears of the family once');
  assert.match(calls.contexts[0](), /MariaDB \(`cmd-tools-mariadb\.sh`\), SQLite \(`cmd-tools-sqlite\.sh`\)/);
  assert.strictEqual(familyOf({ lib } as any).owner!.engine.id, 'mariadb');
  // A second dashboard (another lib) has a family of its own.
  assert.strictEqual(familyOf({ lib: {} } as any).engines.size, 0);
});

test('a row names its databases in the caption and loads the menu\'s body when it opens; a row with none has no menu', () => {
  const { calls, apiFor } = dashboard();
  registerDatabase(apiFor('mariadb') as any, MARIADB);
  registerDatabase(apiFor('sqlite') as any, SQLITE);
  const shop = rowOf(calls, 'shop');
  assert.strictEqual(shop.caption, 'MariaDB 10.11 + SQLite');
  assert.strictEqual(shop.body, '/fragments/p/mariadb/menu/dev/shop');
  assert.match(shop.html, /<button class="uk-button uk-button-default uk-button-small" type="button" title="MariaDB 10\.11: DDEV, service db; SQLite: database\/database\.sqlite · DDEV">/);
  assert.match(shop.html, /<i data-icon="tabler:database-cog"><\/i> DATABASE/);
  assert.strictEqual(rowOf(calls, 'docked').caption, 'MariaDB 11.4');
  assert.strictEqual(rowOf(calls, 'lite').caption, 'SQLite');
  assert.strictEqual(rowOf(calls, 'static'), null, 'a project without a database has no menu');
  assert.strictEqual(rowOf(calls, 'ownpg'), null, 'PostgreSQL is not an engine of this dashboard');
  assert.strictEqual(rowOf(calls, 'shop', new Set(['build'])), null, 'a folder whose type does not allow it has no menu');
});

test('the body has a section per database: the entries the engine offers, its web admins, and what does not fit said instead', async () => {
  const { calls, apiFor } = dashboard({ settings: { mariadb: { admin: 'both' } } });
  registerDatabase(apiFor('mariadb') as any, MARIADB);
  registerDatabase(apiFor('sqlite') as any, SQLITE);
  const s = send();
  await calls.fragments.mariadb({ send: s.send, rest: 'menu/dev/shop' });
  const html = s.out.html;
  assert.match(html, /data-group="mariadb"><i data-icon="tabler:database"><\/i> MariaDB 10\.11 · DDEV, service db<\/li>/);
  for (const v of ['console', 'export', 'running', 'info']) assert.match(html, new RegExp(`hx-post="/actions/p/mariadb/${v}"`), v);
  assert.match(html, /hx-post="\/actions\/p\/mariadb\/tables-form"[^>]*hx-target="#editor-modal-body"/);
  assert.match(html, /hx-post="\/actions\/p\/mariadb\/import-form"[^>]*hx-target="#editor-modal-body"/);
  assert.match(html, /Console \(mariadb\)/);
  // Adminer is in the project: it opens, and can be removed (after the confirm dialog); phpMyAdmin is offered.
  assert.match(html, /<a href="\/mariadb-admin\/adminer\/dev\/shop" target="_blank" rel="noopener"[^>]*> <i data-icon="tabler:external-link"><\/i> Open Adminer<\/a>|Open Adminer/);
  assert.match(html, /class="uk-text-danger arm-step" hx-post="\/actions\/p\/mariadb\/admin-remove"[^>]*hx-trigger="confirmed-remove"/);
  assert.match(html, /hx-post="\/actions\/p\/mariadb\/admin" hx-vals='\{&quot;workspace&quot;:&quot;dev&quot;,&quot;projectName&quot;:&quot;shop&quot;,&quot;tool&quot;:&quot;phpmyadmin&quot;\}'/);
  // The SQLite file is a section of its own, posting to the SQLite plugin with the file it means.
  assert.match(html, /data-group="sqlite"><i data-icon="tabler:file-database"><\/i> SQLite · database\/database\.sqlite · DDEV<\/li>/);
  assert.match(html, /hx-post="\/actions\/p\/sqlite\/console" hx-vals='\{&quot;workspace&quot;:&quot;dev&quot;,&quot;projectName&quot;:&quot;shop&quot;,&quot;file&quot;:&quot;database\/database\.sqlite&quot;\}'/);
  assert.ok(!/actions\/p\/sqlite\/running/.test(html), 'SQLite offers no running statements');
  // On the layer's Docker Compose the web admin does not fit yet: said, not offered.
  const d = send();
  await calls.fragments.mariadb({ send: d.send, rest: 'menu/dev/docked' });
  assert.match(d.out.html, /MariaDB 11\.4 · Docker Compose, service db/);
  assert.match(d.out.html, /A web admin is a service of its own beside the project: on Docker Compose the Workspace cannot add one yet/);
  assert.ok(!/\/admin"/.test(d.out.html));
  // The SQLite plugin's fragment does not answer the menu: the owner does.
  const o = send();
  await calls.fragments.sqlite({ send: o.send, rest: 'menu/dev/shop' });
  assert.strictEqual(o.out.status, 404);
  const none = send();
  await calls.fragments.mariadb({ send: none.send, rest: 'menu/modules/shop' });
  assert.match(none.out.html, /carry no DATABASE menu/);
});

test('the admin: setting decides which web admins the menu offers', () => {
  assert.deepStrictEqual(adminsOffered(MARIADB, '').map((t) => t.id), ['adminer', 'phpmyadmin']);
  assert.deepStrictEqual(adminsOffered(MARIADB, 'both').map((t) => t.id), ['adminer', 'phpmyadmin']);
  assert.deepStrictEqual(adminsOffered(MARIADB, 'phpmyadmin').map((t) => t.id), ['phpmyadmin']);
  assert.deepStrictEqual(adminsOffered(MARIADB, 'none'), []);
  assert.deepStrictEqual(adminsOffered(MARIADB, 'pgadmin'), []);
});

test('each entry runs the engine\'s tool in a screen, from the folder, with the database it means', async () => {
  const { calls, apiFor } = dashboard();
  registerDatabase(apiFor('mariadb') as any, MARIADB);
  registerDatabase(apiFor('sqlite') as any, SQLITE);
  assert.strictEqual((await post(calls, '/actions/p/mariadb/console', { projectName: 'shop' })).html, 'started mariadb-console');
  assert.deepStrictEqual(calls.screens[0], { workspace: 'dev', project: 'shop', projectDir: path.join(ROOT, 'dev'), ownerDir: path.join(ROOT, 'dev', 'shop'), verb: 'mariadb-console', cmdLine: 'bash cmd-tools-mariadb.sh shop --console', label: 'mariadb console' });
  await post(calls, '/actions/p/mariadb/export', { projectName: 'docked' });
  assert.strictEqual(calls.screens[1].cmdLine, 'bash cmd-tools-mariadb.sh docked --export');
  await post(calls, '/actions/p/sqlite/export', { projectName: 'shop', file: 'database/database.sqlite' });
  assert.strictEqual(calls.screens[2].cmdLine, 'bash cmd-tools-sqlite.sh shop --export --file database/database.sqlite');
  // A console that does not fit is refused with the engine's reason; names that are not the project's are refused.
  write('dev/litedock/compose.yaml', 'x-webship:\n  runtime: docker\n');
  write('dev/litedock/database/database.sqlite', '');
  assert.deepStrictEqual(await post(calls, '/actions/p/sqlite/console', { projectName: 'litedock', file: 'database/database.sqlite' }), { html: '<div class="msg error">No sqlite3 here.</div>', status: 409 });
  assert.strictEqual((await post(calls, '/actions/p/mariadb/console', { projectName: '../etc' })).status, 400);
  assert.strictEqual((await post(calls, '/actions/p/mariadb/console', { projectName: 'static' })).status, 409);
  assert.strictEqual((await post(calls, '/actions/p/sqlite/export', { projectName: 'shop', file: '../../etc/passwd' })).status, 409);
  assert.strictEqual(calls.screens.length, 3);
});

test('tables and sizes: the tool\'s list in the modal, or why it could not, with the same list in a screen', async () => {
  const { calls, apiFor } = dashboard({ runs: (_c, args) => (args.includes('docked')
    ? { ok: false, code: 1, stdout: '', stderr: 'Starting…\nThe project is stopped: start it first.' }
    : { ok: true, code: 0, stdout: 'users\t12\t16384\ncache_data\t300\t1048576\n', stderr: '' }) });
  registerDatabase(apiFor('mariadb') as any, MARIADB);
  const ok = await post(calls, '/actions/p/mariadb/tables-form', { projectName: 'shop' });
  assert.deepStrictEqual(calls.runs[0], { cmd: 'bash', args: ['cmd-tools-mariadb.sh', 'shop', '--tables', '--tsv'], cwd: path.join(ROOT, 'dev') });
  assert.match(ok.html, /Tables and sizes — shop/);
  assert.match(ok.html, /MariaDB 10\.11 · DDEV, service db · 2 tables · 1\.0 MB in all · rows the engine&#39;s estimate/);
  assert.ok(ok.html.indexOf('cache_data') < ok.html.indexOf('users'), 'largest first');
  assert.match(ok.html, /hx-post="\/actions\/p\/mariadb\/tables-form"[^>]*hx-target="#editor-modal-body"/, 'Refresh stays in the modal');
  const bad = await post(calls, '/actions/p/mariadb/tables-form', { projectName: 'docked' });
  assert.match(bad.html, /The tool could not list the tables \(exit 1\)/);
  assert.match(bad.html, /The project is stopped: start it first\./);
  assert.match(bad.html, /hx-post="\/actions\/p\/mariadb\/tables"/);
});

test('import: the dumps the backups folder holds for the engine, this project\'s first; importing needs the confirm and a dump that is there', async () => {
  const { calls, apiFor } = dashboard();
  registerDatabase(apiFor('mariadb') as any, MARIADB);
  const form = await post(calls, '/actions/p/mariadb/import-form', { projectName: 'shop' });
  assert.match(form.html, /Import a dump — shop/);
  assert.match(form.html, /shop--mariadb--2026-11-24-03-00-00\.sql\.gz/);
  assert.ok(!form.html.includes('postgresql'), 'a dump of another engine is not offered');
  assert.match(form.html, /class="uk-button uk-button-primary uk-button-small arm-step" hx-post="\/actions\/p\/mariadb\/import"/);
  assert.match(form.html, /hx-trigger="confirmed-remove"/);
  assert.strictEqual((await post(calls, '/actions/p/mariadb/import', { projectName: 'shop', dump: 'shop--mariadb--2026-11-24-03-00-00.sql.gz' })).status, 400, 'no confirm');
  assert.strictEqual((await post(calls, '/actions/p/mariadb/import', { projectName: 'shop', dump: '../x.sql', confirm: 'yes' })).status, 404);
  assert.strictEqual((await post(calls, '/actions/p/mariadb/import', { projectName: 'shop', dump: 'shop--postgresql--2026-11-24-03-00-00.sql.gz', confirm: 'yes' })).status, 404);
  await post(calls, '/actions/p/mariadb/import', { projectName: 'shop', dump: 'shop--mariadb--2026-11-24-03-00-00.sql.gz', confirm: 'yes' });
  assert.strictEqual(calls.screens[0].cmdLine, `bash cmd-tools-mariadb.sh shop --import ${path.join(ROOT, 'backups', 'dev', 'shop--mariadb--2026-11-24-03-00-00.sql.gz')}`);
});

test('the web admin: added and removed by the tool on DDEV only, and its address is DDEV\'s, as a redirect', async () => {
  const describe = JSON.stringify({ raw: { services: { adminer: { https_url: 'https://shop.ddev.site:9101', status: 'running' } } } });
  const { calls, apiFor } = dashboard({ runs: (cmd) => (cmd === 'ddev' ? { ok: true, code: 0, stdout: describe, stderr: '' } : { ok: true, code: 0, stdout: '', stderr: '' }) });
  registerDatabase(apiFor('mariadb') as any, MARIADB);
  await post(calls, '/actions/p/mariadb/admin', { projectName: 'shop', tool: 'phpmyadmin' });
  assert.strictEqual(calls.screens[0].cmdLine, 'bash cmd-tools-mariadb.sh shop --admin phpmyadmin');
  assert.strictEqual((await post(calls, '/actions/p/mariadb/admin', { projectName: 'shop', tool: 'pgadmin' })).status, 400);
  assert.strictEqual((await post(calls, '/actions/p/mariadb/admin', { projectName: 'docked', tool: 'adminer' })).status, 409, 'not on the layer');
  assert.strictEqual((await post(calls, '/actions/p/mariadb/admin-remove', { projectName: 'shop', tool: 'adminer' })).status, 400, 'no confirm');
  await post(calls, '/actions/p/mariadb/admin-remove', { projectName: 'shop', tool: 'adminer', confirm: 'yes' });
  assert.strictEqual(calls.screens[1].cmdLine, 'bash cmd-tools-mariadb.sh shop --admin-remove adminer');
  const page = calls.pages.find((p) => p.re.test('/mariadb-admin/adminer/dev/shop'));
  assert.ok(page && !page.re.test('/mariadb-admin/pgadmin/dev/shop'));
  const res: any = { head: null, body: '', writeHead(status: number, h: any) { this.head = { status, h }; }, end(b = '') { this.body = b; } };
  await page.fn({ res, match: '/mariadb-admin/adminer/dev/shop'.match(page.re) });
  assert.deepStrictEqual(res.head, { status: 302, h: { Location: 'https://shop.ddev.site:9101' } });
  assert.deepStrictEqual(calls.runs.at(-1), { cmd: 'ddev', args: ['describe', '-j'], cwd: path.join(ROOT, 'dev', 'shop') });
  const res2: any = { head: null, body: '', writeHead(status: number, h: any) { this.head = { status, h }; }, end(b = '') { this.body = b; } };
  await page.fn({ res: res2, match: '/mariadb-admin/phpmyadmin/dev/shop'.match(page.re) });
  assert.strictEqual(res2.head.status, 404);
  assert.match(res2.body, /phpMyAdmin is not added to shop/);
});

test('which database a form means, and what does not fit where', () => {
  const dbs = [
    { engine: 'postgresql', version: '16', via: 'compose' as const, runtime: 'docker', service: 'pg', composeFile: 'compose.yaml' },
    { engine: 'postgresql', version: '15', via: 'compose' as const, runtime: 'docker', service: 'old', composeFile: 'compose.yaml' },
  ];
  assert.strictEqual(pickDatabase(dbs, {})!.service, 'pg');
  assert.strictEqual(pickDatabase(dbs, { service: 'old' })!.version, '15');
  assert.strictEqual(pickDatabase(dbs, { service: 'x;rm' }), null);
  assert.match(whyNot(MARIADB, dbs[0], 'admin'), /on a compose file of the project's own the Workspace cannot add one yet/);
  assert.strictEqual(whyNot(MARIADB, { engine: 'mariadb', version: '', via: 'ddev', runtime: 'ddev', service: 'db' }, 'admin'), '');
});

test('on a dashboard older than the lazy body, the whole menu is drawn in the row', () => {
  const { calls, apiFor } = dashboard({ lazy: false });
  registerDatabase(apiFor('mariadb') as any, MARIADB);
  const html = rowOf(calls, 'shop');
  assert.strictEqual(typeof html, 'string');
  assert.match(html, /<div class="uk-inline act-menu act-menu-database act-menu-database-family">/);
  assert.match(html, /hx-post="\/actions\/p\/mariadb\/console"/);
  assert.match(html, /<span class="act-status uk-text-meta">MariaDB 10\.11<\/span>/);
});
