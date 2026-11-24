/**
 * Tables and sizes: what an engine's tool prints with `--tables --tsv`, and the modal that shows it.
 *
 * The tool prints one line per table: its name, its rows and its size in bytes, separated by tabs. Rows are the
 * engine's own count where it keeps one cheaply (MariaDB, MySQL and PostgreSQL keep an estimate; SQLite is counted),
 * and empty where it has none. A line that is not one of these (a notice of the runtime) is not a table.
 */

export interface TableRow { name: string; rows: number | null; bytes: number | null }

const num = (v: string): number | null => (/^\d+$/.test(v) ? Number(v) : null);

/** The tables in a tool's `--tables --tsv` output, largest first. */
export function parseTables(text: string): TableRow[] {
  const out: TableRow[] = [];
  for (const line of String(text || '').split('\n')) {
    const cells = line.replace(/\r$/, '').split('\t');
    if (cells.length !== 3 || !cells[0] || line.startsWith('#')) continue;
    const [name, rows, bytes] = cells;
    if (!/^(\d*|NULL)$/i.test(rows) || !/^(\d*|NULL)$/i.test(bytes)) continue;
    out.push({ name, rows: num(rows), bytes: num(bytes) });
  }
  return out.sort((a, b) => (b.bytes || 0) - (a.bytes || 0) || a.name.localeCompare(b.name));
}

/** A size people read: 0 B, 12 KB, 3.4 MB. */
export function sizeOf(bytes: number | null): string {
  if (bytes === null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${i === 0 ? v : v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** A count people read: 1,234,567. */
export const countOf = (n: number | null): string => (n === null ? '' : n.toLocaleString('en-US'));

export interface TablesView {
  esc: (s: unknown) => string;
  project: string;
  /** "MariaDB 10.11 on DDEV". */
  what: string;
  rows: TableRow[];
  /** What the engine's rows are: "estimated by MariaDB", "counted". */
  rowsAre: string;
  /** The buttons under the table (Refresh, Console, Export), already drawn. */
  actions: string;
  /** The tables a modal shows at most; the rest are counted. */
  limit?: number;
}

/** The modal's body: what database, how many tables and how big, and the tables, largest first. */
export function tablesHtml(v: TablesView): string {
  const { esc } = v;
  const limit = v.limit || 500;
  const total = v.rows.reduce((s, r) => s + (r.bytes || 0), 0);
  const max = v.rows.reduce((m, r) => Math.max(m, r.bytes || 0), 0) || 1;
  const shown = v.rows.slice(0, limit);
  const body = shown.map((r) => `
        <tr>
          <td class="database-table-name"><code>${esc(r.name)}</code></td>
          <td class="uk-text-right">${esc(countOf(r.rows))}</td>
          <td class="uk-text-right uk-text-nowrap">${esc(sizeOf(r.bytes))}</td>
          <td class="database-table-bar"><meter min="0" max="${max}" value="${r.bytes || 0}" aria-label="${esc(r.name)}: ${esc(sizeOf(r.bytes))}"></meter></td>
        </tr>`).join('');
  const more = v.rows.length > shown.length ? `<p class="uk-text-meta">And ${v.rows.length - shown.length} more, the smallest: the tool lists them all.</p>` : '';
  return `
    <div class="editor-card database-tables">
      <h3 class="uk-margin-small-bottom">Tables and sizes — ${esc(v.project)}</h3>
      <p class="uk-text-meta database-tables-what">${esc(v.what)} · ${v.rows.length} table${v.rows.length === 1 ? '' : 's'} · ${esc(sizeOf(total))} in all · rows ${esc(v.rowsAre)}</p>
      ${v.rows.length ? `<div class="uk-overflow-auto"><table class="uk-table uk-table-small uk-table-divider uk-table-hover database-tables-list">
        <caption class="uk-text-meta uk-text-left">Largest first</caption>
        <thead><tr><th scope="col">Table</th><th scope="col" class="uk-text-right">Rows</th><th scope="col" class="uk-text-right">Size</th><th scope="col"><span class="uk-hidden-visually">Share of the largest</span></th></tr></thead>
        <tbody>${body}
        </tbody>
      </table></div>${more}` : '<div class="msg assistant">The database has no tables yet.</div>'}
      <div class="uk-margin-small-top database-tables-actions">${v.actions}</div>
    </div>`;
}
