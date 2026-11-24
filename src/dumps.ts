/**
 * Exports, where they are kept and what an import may take.
 *
 * An export goes where the row's own "Export the database" puts one: the workspace's backups folder of the
 * project's folder (`<backups>/<folder>/`), so the dashboard's Backups page and its own import panel list it too.
 * Its name says the project, the engine and when: `<project>--<engine>--<YYYY-MM-DD-HH-MM-SS>.sql.gz`. An import
 * takes only a file that folder already holds, named by its base name and matched against what is there: no path
 * from a browser reaches a command line.
 */

import fs from 'fs';
import path from 'path';

/** The engines of the family, as dump names carry them. */
export const ENGINE_IDS = ['mariadb', 'mysql', 'postgresql', 'sqlite'];

/** When, in a dump's name: UTC, to the second. */
export function stampOf(d: Date = new Date()): string {
  return d.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/** A safe part of a file name: what a SQLite file's path becomes in its dump's name. */
export function slugOf(text: string): string {
  return String(text || '').replace(/^\.+/, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/\.{2,}/g, '.')
    .replace(/^[._]+|[._]+$/g, '').slice(0, 60) || 'db';
}

/** The name of an export: `<project>--<engine>--[<what>--]<when><ext>`. */
export function dumpName(project: string, engine: string, ext: string, d: Date = new Date(), what = ''): string {
  return `${project}--${engine}--${what ? `${slugOf(what)}--` : ''}${stampOf(d)}${ext}`;
}

/** The files an engine imports: SQL dumps (plain or gzipped) for a server, SQLite files (whole or gzipped) for a file. */
export function importableRe(dumpExt: string): RegExp {
  return dumpExt === '.sqlite.gz' ? /\.(sqlite3?|db3?)(\.gz)?$/i : /\.sql(\.gz)?$/i;
}

export interface Dump {
  name: string;
  size: number;
  mtime: Date;
  /** Made for this project: its name starts with `<project>--`. */
  own: boolean;
  /** The engine its name carries, 'db' for the row's own export, '' when it says none. */
  engine: string;
}

/** The engine a dump's name carries after `<project>--`. */
function engineInName(name: string, project: string): string {
  const rest = name.startsWith(`${project}--`) ? name.slice(project.length + 2) : name.replace(/^.*?--(?=(?:mariadb|mysql|postgresql|sqlite|db)--)/, '');
  const m = rest.match(/^(mariadb|mysql|postgresql|sqlite|db)--/);
  return m ? m[1] : '';
}

/**
 * The dumps of a backups folder an engine may import into a project, newest first: `own` (made for this project)
 * and `other`. A dump whose name carries another engine is left out: a PostgreSQL dump is not a MariaDB one.
 */
export function listDumps(backupsDir: string, project: string, engine: { id: string; dumpExt: string }): { own: Dump[]; other: Dump[] } {
  const re = importableRe(engine.dumpExt);
  let names: string[] = [];
  try {
    names = fs.readdirSync(backupsDir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.') && re.test(e.name)).map((e) => e.name);
  } catch (_) {
    return { own: [], other: [] };
  }
  const own: Dump[] = [];
  const other: Dump[] = [];
  for (const name of names) {
    const tagged = engineInName(name, project);
    if (tagged && tagged !== 'db' && tagged !== engine.id) continue;
    // The row's own export ("--db--") is a server's dump: never a SQLite file's.
    if (tagged === 'db' && engine.dumpExt === '.sqlite.gz') continue;
    let st: fs.Stats;
    try { st = fs.statSync(path.join(backupsDir, name)); } catch (_) { continue; }
    const d: Dump = { name, size: st.size, mtime: st.mtime, own: name.startsWith(`${project}--`), engine: tagged };
    (d.own ? own : other).push(d);
  }
  const newest = (a: Dump, b: Dump) => b.mtime.getTime() - a.mtime.getTime();
  return { own: own.sort(newest), other: other.sort(newest) };
}

/** The dump a request named, or null: a base name, matched against what the folder holds for this engine. */
export function findDump(backupsDir: string, project: string, engine: { id: string; dumpExt: string }, name: unknown): Dump | null {
  const wanted = String(name || '');
  if (!wanted || path.basename(wanted) !== wanted) return null;
  const { own, other } = listDumps(backupsDir, project, engine);
  return [...own, ...other].find((d) => d.name === wanted) || null;
}
