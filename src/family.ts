/**
 * The engines of one dashboard, shared by every engine plugin of the family.
 *
 * Each engine is a plugin of its own (MariaDB, MySQL, PostgreSQL, SQLite), and a project row has one DATABASE menu
 * whatever its engine: the first engine plugin the dashboard loads draws the menu, under its own route namespace,
 * and every engine registered after it joins that menu. Its entries post to each engine's own actions.
 *
 * The record is kept per dashboard (its `lib`, which every plugin of a dashboard is handed) and under a global
 * symbol, so two copies of this package (two engine plugins built against different versions of it) still share it.
 */

import type { PluginApi } from '@webship.co/workspace-plugin-api';

import type { DatabaseEngine } from './engine';

export interface Registered { engine: DatabaseEngine; api: PluginApi }

export interface Family {
  /** The engines, by id, in the order they registered. */
  engines: Map<string, Registered>;
  /** The plugin that drew the DATABASE menu, and answers its body. */
  owner: Registered | null;
  /** The family's stylesheet was added. */
  css: boolean;
}

const KEY = Symbol.for('@webship.co/workspace-database:families');

/** The family of the dashboard this api belongs to. */
export function familyOf(api: PluginApi): Family {
  const g = globalThis as unknown as Record<symbol, WeakMap<object, Family> | undefined>;
  let all = g[KEY];
  if (!all) { all = new WeakMap(); g[KEY] = all; }
  const key = (api && (api.lib as object)) || api;
  let f = all.get(key);
  if (!f) { f = { engines: new Map(), owner: null, css: false }; all.set(key, f); }
  return f;
}
