/**
 * Tables and sizes: the tool's tab-separated lines, and the modal drawn from them.
 */
import test from 'node:test';
import assert from 'node:assert';

import { parseTables, sizeOf, countOf, tablesHtml } from '../src/tables';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

test('the tool\'s lines are the tables, largest first; a notice of the runtime and a NULL are not taken for numbers', () => {
  const text = [
    'Running on docker: http://127.0.0.1:38001',
    'cache_render\t120\t5242880',
    'node\t7\t49152',
    'users\t\t16384',
    'watchdog\tNULL\t1048576',
    '# a comment\t1\t2',
    'bad\tx\t1',
    '',
  ].join('\n');
  const rows = parseTables(text);
  assert.deepStrictEqual(rows.map((r) => r.name), ['cache_render', 'watchdog', 'node', 'users']);
  assert.deepStrictEqual(rows.map((r) => r.rows), [120, null, 7, null]);
  assert.deepStrictEqual(parseTables(''), []);
});

test('sizes and counts as people read them', () => {
  assert.strictEqual(sizeOf(0), '0 B');
  assert.strictEqual(sizeOf(1536), '1.5 KB');
  assert.strictEqual(sizeOf(5242880), '5.0 MB');
  assert.strictEqual(sizeOf(25 * 1024 * 1024), '25 MB');
  assert.strictEqual(sizeOf(null), '');
  assert.strictEqual(countOf(1234567), '1,234,567');
  assert.strictEqual(countOf(null), '');
});

test('the modal says what database, how many tables and how big, escapes every name, and marks each table\'s share', () => {
  const html = tablesHtml({ esc, project: 'shop', what: 'MariaDB 10.11 · DDEV, service db', rows: parseTables('a<b>\t3\t2048\nnode\t1\t1024\n'), rowsAre: 'the engine\'s estimate', actions: '<button>Refresh</button>' });
  assert.match(html, /<h3 class="uk-margin-small-bottom">Tables and sizes — shop<\/h3>/);
  assert.match(html, /MariaDB 10\.11 · DDEV, service db · 2 tables · 3\.0 KB in all · rows the engine&#39;s estimate/);
  assert.match(html, /<code>a&lt;b&gt;<\/code>/);
  assert.ok(!html.includes('<b>'), 'a table name is text, never markup');
  assert.match(html, /<meter min="0" max="2048" value="2048" aria-label="a&lt;b&gt;: 2\.0 KB"><\/meter>/);
  assert.match(html, /<th scope="col">Table<\/th>/);
  assert.match(html, /<button>Refresh<\/button>/);
  const empty = tablesHtml({ esc, project: 'new', what: 'PostgreSQL 16', rows: [], rowsAre: 'counted', actions: '' });
  assert.match(empty, /The database has no tables yet\./);
  const many = tablesHtml({ esc, project: 'big', what: 'x', rows: parseTables(Array.from({ length: 12 }, (_, i) => `t${i}\t1\t${i}`).join('\n')), rowsAre: 'counted', actions: '', limit: 10 });
  assert.strictEqual((many.match(/<tr>/g) || []).length, 10 + 1, 'ten tables and the head');
  assert.match(many, /And 2 more, the smallest/);
});
