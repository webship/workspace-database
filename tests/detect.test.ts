/**
 * Which databases a project folder has, from its files alone: DDEV's config, the runtime layer's x-webship block,
 * a compose file of the project's own, and SQLite files.
 */
import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readDdev, readWebshipBlock, layerEngine, engineOfImage, readOwnCompose, serverDatabases, projectRuntime, sqliteFiles, sqliteFromEnv, engineName, SQLITE_HEADER } from '../src/detect';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'database-detect-'));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));
let n = 0;
/** A project folder with these files (path -> text, or a Buffer). */
function project(files: Record<string, string | Buffer>): string {
  const dir = path.join(ROOT, `p${(n += 1)}`);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const sqlite = (): Buffer => Buffer.concat([Buffer.from(SQLITE_HEADER, 'latin1'), Buffer.alloc(4080)]);

test('DDEV: the database block, its default, an override file, and a project that omits its database', () => {
  const pg = project({ '.ddev/config.yaml': 'name: shop\ntype: php\ndocroot: web\ndatabase:\n    type: postgres\n    version: "16"\n' });
  assert.deepStrictEqual(serverDatabases(pg), [{ engine: 'postgresql', version: '16', via: 'ddev', runtime: 'ddev', service: 'db' }]);
  const plain = project({ '.ddev/config.yaml': 'name: blog\ntype: wordpress\n' });
  const d = readDdev(plain)!;
  assert.deepStrictEqual([d.type, d.version, d.fromDefault, d.name], ['mariadb', '10.11', true, 'blog']);
  assert.deepStrictEqual(serverDatabases(plain), [{ engine: 'mariadb', version: '10.11', via: 'ddev', runtime: 'ddev', service: 'db', note: 'DDEV\'s default' }]);
  // An unquoted 8.0 stays 8.0, and a config.<name>.yaml DDEV merges over config.yaml wins.
  const over = project({ '.ddev/config.yaml': 'name: app\ndatabase:\n  type: mariadb\n  version: 10.11\n', '.ddev/config.zz.yaml': 'database:\n  type: mysql\n  version: 8.0\n' });
  assert.deepStrictEqual(serverDatabases(over).map((x) => [x.engine, x.version]), [['mysql', '8.0']]);
  const none = project({ '.ddev/config.yaml': 'name: static\nomit_containers: [db]\n' });
  assert.strictEqual(readDdev(none)!.omitted, true);
  assert.deepStrictEqual(serverDatabases(none), []);
  assert.strictEqual(readDdev(project({ 'README.md': '' })), null);
  assert.deepStrictEqual(serverDatabases(project({ '.ddev/config.yaml': ': not yaml: [' })).map((x) => x.engine), ['mariadb'], 'a broken file is DDEV\'s default, never a crash');
});

test('the runtime layer: the x-webship block names the runtime and MariaDB\'s version, or another engine before a colon', () => {
  const docker = project({ 'compose.yaml': 'name: shop\nx-webship:\n  runtime: docker\n  stack: php\n  type: drupal11\n  docroot: "web"\n  database: "10.11"\n  port: 38001\nservices:\n  db:\n    image: mariadb:10.11\n' });
  assert.deepStrictEqual(readWebshipBlock(docker), { file: 'compose.yaml', runtime: 'docker', database: '10.11', name: 'shop', type: 'drupal11', docroot: 'web' });
  assert.deepStrictEqual(serverDatabases(docker), [{ engine: 'mariadb', version: '10.11', via: 'layer', runtime: 'docker', service: 'db' }]);
  assert.strictEqual(projectRuntime(docker), 'docker');
  const k8s = project({ 'compose.yaml': 'name: shop\nx-webship:\n  runtime: kubernetes\n  database: "11.4"\n', '.ddev/config.yaml': 'name: shop\n' });
  assert.deepStrictEqual(serverDatabases(k8s).map((x) => [x.engine, x.version, x.runtime, x.via]), [['mariadb', '11.4', 'kubernetes', 'layer']], 'the block wins over a .ddev/ a template shipped');
  const lando = project({ '.lando.yml': 'name: shop\nx-webship:\n  runtime: lando\n  database: "10.11"\nrecipe: lamp\n' });
  assert.deepStrictEqual(serverDatabases(lando).map((x) => [x.runtime, x.service]), [['lando', 'db']]);
  const docksal = project({ '.docksal/docksal.yml': 'x-webship:\n  runtime: docksal\n  name: shop\n  database: "10.11"\n', '.docksal/docksal.env': 'DOCKSAL_STACK=default\n' });
  assert.deepStrictEqual(serverDatabases(docksal).map((x) => x.runtime), ['docksal']);
  assert.deepStrictEqual(layerEngine(''), { engine: 'mariadb', version: '10.11' });
  assert.deepStrictEqual(layerEngine('postgres:16'), { engine: 'postgresql', version: '16' });
  assert.deepStrictEqual(layerEngine('mysql:8.4'), { engine: 'mysql', version: '8.4' });
  assert.deepStrictEqual(serverDatabases(project({ 'compose.yaml': 'x-webship:\n  runtime: podman\n' })).map((x) => [x.version, x.note]), [['10.11', 'the runtime layer\'s default']]);
});

test('an image says its engine and version, and an image that is no database says none', () => {
  const cases: [string, string, string][] = [
    ['mariadb:11.4', 'mariadb', '11.4'], ['mariadb', 'mariadb', ''], ['docker.io/library/mariadb:10.11.9-jammy', 'mariadb', '10.11'],
    ['bitnami/mariadb:latest', 'mariadb', ''], ['mysql:8.0.36', 'mysql', '8.0'], ['mysql:8', 'mysql', '8'], ['percona/percona-server:8.0', 'mysql', '8.0'],
    ['postgres:16-alpine', 'postgresql', '16'], ['postgres:16.4', 'postgresql', '16'], ['postgis/postgis:16-3.4', 'postgresql', '16'],
    ['pgvector/pgvector:pg17', 'postgresql', '17'], ['bitnami/postgresql:15', 'postgresql', '15'], ['postgres:9.6', 'postgresql', '9.6'],
    ['registry.example.com:5000/team/postgres:14', 'postgresql', '14'], ['postgres@sha256:0123abcd', 'postgresql', ''],
  ];
  for (const [image, engine, version] of cases) assert.deepStrictEqual(engineOfImage(image), { engine, version }, image);
  for (const image of ['redis:7', 'node:22', 'axllent/mailpit', 'nginx', 'mongo:7', 'adminer', '']) assert.strictEqual(engineOfImage(image), null, image);
  assert.strictEqual(engineName('postgres'), 'postgresql');
});

test('a compose file of the project\'s own: each database service, with the file and its name; a merge key is followed', () => {
  const own = project({ 'docker-compose.yml': 'x-db: &db\n  image: postgres:16-alpine\nservices:\n  app:\n    image: node:22\n  pg:\n    <<: *db\n  cache:\n    image: redis:7\n  legacy:\n    image: mysql:5.7\n' });
  assert.deepStrictEqual(readOwnCompose(own)!.services.map((s) => s.name), ['app', 'pg', 'cache', 'legacy']);
  assert.deepStrictEqual(serverDatabases(own), [
    { engine: 'postgresql', version: '16', via: 'compose', runtime: 'docker', service: 'pg', composeFile: 'docker-compose.yml' },
    { engine: 'mysql', version: '5.7', via: 'compose', runtime: 'docker', service: 'legacy', composeFile: 'docker-compose.yml' },
  ]);
  assert.strictEqual(projectRuntime(own), 'compose');
  // A Landofile of the project's own: the layer runs it, but its engine is not read yet, so nothing is said for it.
  assert.deepStrictEqual(serverDatabases(project({ '.lando.yml': 'name: x\nrecipe: lamp\nconfig:\n  database: mysql:8.0\n', 'compose.yaml': 'services:\n  db:\n    image: mysql:8.0\n' })), []);
  assert.strictEqual(readOwnCompose(project({ 'compose.yaml': 'name: x\nx-webship:\n  runtime: docker\nservices:\n  db:\n    image: mariadb:10.11\n' })), null, 'the layer\'s own file is not a file of the project\'s own');
  assert.strictEqual(readOwnCompose(project({ 'compose.yaml': 'services: [' })), null);
});

test('SQLite: the frameworks\' places, an empty Laravel file, what .env names, a Drupal site\'s file, and only real databases', () => {
  const dir = project({
    'database/database.sqlite': '',                       // Laravel makes it empty, then migrates into it
    'data/app.db': sqlite(),                              // the header: a database
    'data/notes.db': 'not a database at all, just text that is long enough to be read as one'.repeat(3),
    'web/sites/default/files/.ht.sqlite': sqlite(),       // Drupal on SQLite
    'storage/app.sqlite': sqlite(),
    '.env': 'APP_NAME=x\nDB_CONNECTION=sqlite\nDB_DATABASE=/var/www/html/storage/app.sqlite\n',
    'node_modules/pkg/test.db': sqlite(),                 // never looked into
    '.ddev/config.yaml': 'name: x\ndocroot: web\n',
  });
  assert.deepStrictEqual(sqliteFiles(dir), ['storage/app.sqlite', 'database/database.sqlite', 'web/sites/default/files/.ht.sqlite', 'data/app.db']);
  assert.deepStrictEqual(sqliteFiles(dir, 2), ['storage/app.sqlite', 'database/database.sqlite']);
  const prisma = project({ 'prisma/schema.prisma': '', 'prisma/dev.db': sqlite(), '.env': 'DATABASE_URL="file:./dev.db"\n' });
  assert.deepStrictEqual(sqliteFromEnv(prisma), ['prisma/dev.db']);
  assert.deepStrictEqual(sqliteFiles(prisma), ['prisma/dev.db'], 'named once, though .env and the places both find it');
  const strapi = project({ '.tmp/data.db': sqlite(), '.env': 'DATABASE_CLIENT=sqlite\nDATABASE_FILENAME=.tmp/data.db\n' });
  assert.deepStrictEqual(sqliteFiles(strapi), ['.tmp/data.db']);
  assert.deepStrictEqual(sqliteFromEnv(project({ '.env': 'DATABASE_URL=sqlite:///%kernel.project_dir%/var/data.db\n' })), ['var/data.db']);
  assert.deepStrictEqual(sqliteFiles(project({ '.env': 'DB_CONNECTION=sqlite\nDB_DATABASE=../../etc/passwd\n' })), [], 'a path out of the project is not taken');
  assert.deepStrictEqual(sqliteFiles(project({ 'README.md': 'no data' })), []);
});
