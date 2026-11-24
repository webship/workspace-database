/**
 * Exports: their names, and what an import may take from the backups folder.
 */
import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { stampOf, dumpName, slugOf, listDumps, findDump, importableRe } from '../src/dumps';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'database-dumps-'));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
const touch = (name: string, minutesAgo: number) => {
  const f = path.join(DIR, name);
  fs.writeFileSync(f, 'x');
  const t = new Date(Date.now() - minutesAgo * 60 * 1000);
  fs.utimesSync(f, t, t);
};

const MARIADB = { id: 'mariadb', dumpExt: '.sql.gz' };
const SQLITE = { id: 'sqlite', dumpExt: '.sqlite.gz' };

test('an export is named after the project, the engine and when, to the second (UTC)', () => {
  const d = new Date(Date.UTC(2026, 10, 24, 3, 40, 12));
  assert.strictEqual(stampOf(d), '2026-11-24-03-40-12');
  assert.strictEqual(dumpName('shop', 'mariadb', '.sql.gz', d), 'shop--mariadb--2026-11-24-03-40-12.sql.gz');
  assert.strictEqual(dumpName('shop', 'sqlite', '.sqlite.gz', d, 'database/database.sqlite'), 'shop--sqlite--database_database.sqlite--2026-11-24-03-40-12.sqlite.gz');
  assert.strictEqual(slugOf('.tmp/data.db'), 'tmp_data.db');
  assert.strictEqual(slugOf('../..'), 'db');
});

test('an import lists this project\'s dumps first, then the others; a dump of another engine and a whole-project archive are left out', () => {
  touch('shop--mariadb--2026-11-24-03-00-00.sql.gz', 30);
  touch('shop--db--2026-11-24-02-00-00.sql.gz', 60);                 // the row's own Export
  touch('shop--mariadb--before-import--2026-11-24-03-10-00.sql.gz', 20);
  touch('shop--postgresql--2026-11-24-03-20-00.sql.gz', 10);         // another engine
  touch('blog--mariadb--2026-11-23-10-00-00.sql.gz', 600);
  touch('customer-dump.sql', 5);
  touch('dev---shop--2026-11-24_01-00-00.tar.gz', 90);               // a backup of the whole project
  touch('shop--sqlite--database_database.sqlite--2026-11-24-04-00-00.sqlite.gz', 1);
  const { own, other } = listDumps(DIR, 'shop', MARIADB);
  assert.deepStrictEqual(own.map((d) => d.name), ['shop--mariadb--before-import--2026-11-24-03-10-00.sql.gz', 'shop--mariadb--2026-11-24-03-00-00.sql.gz', 'shop--db--2026-11-24-02-00-00.sql.gz']);
  assert.deepStrictEqual(own.map((d) => d.engine), ['mariadb', 'mariadb', 'db']);
  assert.deepStrictEqual(other.map((d) => d.name), ['customer-dump.sql', 'blog--mariadb--2026-11-23-10-00-00.sql.gz']);
  const lite = listDumps(DIR, 'shop', SQLITE);
  assert.deepStrictEqual(lite.own.map((d) => d.name), ['shop--sqlite--database_database.sqlite--2026-11-24-04-00-00.sqlite.gz']);
  assert.deepStrictEqual(lite.other, []);
  assert.deepStrictEqual(listDumps(path.join(DIR, 'nowhere'), 'shop', MARIADB), { own: [], other: [] });
});

test('an import takes a base name the folder holds for that engine, and nothing else', () => {
  assert.strictEqual(findDump(DIR, 'shop', MARIADB, 'shop--mariadb--2026-11-24-03-00-00.sql.gz')!.own, true);
  assert.strictEqual(findDump(DIR, 'shop', MARIADB, 'customer-dump.sql')!.own, false);
  for (const bad of ['../shop--mariadb--2026-11-24-03-00-00.sql.gz', `${DIR}/customer-dump.sql`, 'shop--postgresql--2026-11-24-03-20-00.sql.gz', 'dev---shop--2026-11-24_01-00-00.tar.gz', '', undefined, 'missing.sql.gz']) {
    assert.strictEqual(findDump(DIR, 'shop', MARIADB, bad), null, String(bad));
  }
  assert.ok(importableRe('.sql.gz').test('a.sql') && importableRe('.sql.gz').test('a.sql.gz') && !importableRe('.sql.gz').test('a.sql.bz2'));
  assert.ok(importableRe('.sqlite.gz').test('a.sqlite.gz') && importableRe('.sqlite.gz').test('data.db') && !importableRe('.sqlite.gz').test('a.sql.gz'));
});
