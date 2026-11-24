# @webship.co/workspace-database

The database family's shared base for [Webship Workspace](https://github.com/webship/workspace) plugins, the
container-based development workspace (DDEV by default). It holds the contract a database engine plugin fills in,
the readers that say which engine and version a project uses, and the **DATABASE** menu on a project row, which
every engine plugin registers through `registerDatabase(api, engine)`.

It is not a plugin itself: it has no manifest, and the dashboard never loads it. The engines are:

| Plugin | Package | Its tool |
| --- | --- | --- |
| MariaDB (DDEV's default) | [`@webship.co/workspace-mariadb`](https://github.com/webship/workspace-mariadb) | `cmd-tools-mariadb.sh` |
| MySQL | [`@webship.co/workspace-mysql`](https://github.com/webship/workspace-mysql) | `cmd-tools-mysql.sh` |
| PostgreSQL | [`@webship.co/workspace-postgresql`](https://github.com/webship/workspace-postgresql) | `cmd-tools-postgresql.sh` |
| SQLite, the light database | [`@webship.co/workspace-sqlite`](https://github.com/webship/workspace-sqlite) | `cmd-tools-sqlite.sh` |

## The DATABASE menu

One button per project row, whatever the engine: the first engine plugin the dashboard loads draws it, and every
engine registered after it joins it. Its caption names the databases the project has (`MariaDB 10.11`,
`PostgreSQL 16 + SQLite`), and its body loads when it opens. For each database:

| Entry | What it runs |
| --- | --- |
| Console | `bash cmd-tools-<engine>.sh <project> --console`, in a screen session: the engine's client |
| Tables and sizes | `--tables --tsv`, drawn as a table in the modal, largest first; "The same in a screen" when it cannot be asked from the dashboard |
| Export to the backups folder | `--export`: `<backups>/<folder>/<project>--<engine>--<when>.sql.gz`, where the row's own Export puts a dump, so the Backups page and the core's import panel list it too |
| Import a dump… | A modal of the dumps that folder holds for this engine, this project's first; Import asks first, then runs `--import <file>`, which exports the database as it is before it imports |
| Running statements | `--running`: what runs now, longest first, and the slow statements the server counted |
| Connection details | `--info`: the engine, version, runtime and service, and how a client on this machine connects |
| Web admin | On DDEV, the official add-ons (Adminer, phpMyAdmin): Add (`--admin <tool>`, which restarts the project), Open (`/<engine>-admin/<tool>/<folder>/<project>`, a redirect to the address DDEV gives the add-on) and Remove (`--admin-remove <tool>`, asked first) |

An entry that does not fit a database yet is said in its place, not offered: the engine says which, and the base
says it for the web admins off DDEV (below).

## Which databases a project has

Read from the project's files alone, so a page of fifty rows can ask for each of them, in the order the Workspace's
runtime layer (`core/scripts/functions/fun-runtime.sh`) reads a project:

| The project carries | Its database | Reached through |
| --- | --- | --- |
| An `x-webship:` block (`compose.yaml`, `.lando.yml`, `.docksal/docksal.yml`), written by a builder run with `--runtime` | The block's `database:`: MariaDB's version (`"10.11"`), or another engine before a colon (`"postgres:16"`) | `ddev <verb>`, which the runtime layer gives its meaning on Docker Compose, Podman, Kubernetes, Lando or Docksal |
| `.ddev/config.yaml` | Its `database:` (and the `config.*.yaml` DDEV merges over it); none when `omit_containers` has `db`; DDEV's default, MariaDB 10.11, when it names none | DDEV |
| A Landofile or a `.docksal/` of the project's own | Not read yet: no database is said | |
| A compose file of the project's own (no `x-webship:` block) | Each service whose image is a database's: `mariadb`, `mysql`, `percona`, `postgres`, `postgis`, `pgvector`, `timescaledb`, their Bitnami builds; the version from the tag | `docker compose`, the way the Docker Compose plugin runs that file's verbs |
| A SQLite file | What `.env` names (`DB_DATABASE` with `DB_CONNECTION=sqlite`, `DATABASE_FILENAME`, a `file:` or `sqlite:` URL), the places the frameworks use (`database/database.sqlite`, `.tmp/data.db`, `db.sqlite3`, `prisma/dev.db`, …), a Drupal site's `sites/<site>/files/.ht.sqlite`, and the SQLite files of a few folders, one level deep; each checked by its header | The project's runtime |

## Runtimes

The entries reach a database the way the Workspace reaches the project:

| | DDEV | Docker Compose, Podman, Kubernetes, Lando, Docksal (a project the Workspace built there) | A compose file of the project's own |
| --- | --- | --- | --- |
| Console, tables, running statements, connection details, export, import | DDEV's verbs (`ddev mysql`, `ddev exec -s db`, `ddev export-db`, `ddev import-db`) | The same verbs, which the runtime layer gives their meaning there | `docker compose exec` on the database's service |
| Web admin | The official DDEV add-ons | Not yet | Not yet |

What was run on a real project of each runtime is in each engine's README: a runtime is called supported there only
once it was. A web admin is a service of its own beside the project: DDEV adds one with its add-ons, and the other
runtimes need the Workspace core to declare a service for a project, which it cannot do yet. There the menu says so
in the web admin's place. The runtime layer builds a project on MariaDB only, so MySQL and PostgreSQL are on DDEV and
in a compose file of the project's own until it builds them too.

## Write an engine

```ts
import type { PluginApi } from '@webship.co/workspace-plugin-api';
import { registerDatabase, serverDetect } from '@webship.co/workspace-database';
import type { DatabaseEngine } from '@webship.co/workspace-database';

export const mariadbEngine: DatabaseEngine = {
  id: 'mariadb',                       // the plugin's name, its route namespace, and the engine in a dump's name
  title: 'MariaDB',
  script: 'cmd-tools-mariadb.sh',      // the tool the plugin installs into the sites folders
  client: 'mariadb',                   // what the console opens, for the menu's words
  detect: serverDetect('mariadb'),     // the project's MariaDB servers (sqliteDetect for SQLite files)
  admins: [{ id: 'adminer', label: 'Adminer', ddevAddon: { repo: 'ddev/ddev-adminer', service: 'adminer' } }],
  dumpExt: '.sql.gz',
  rowsAre: 'as MariaDB estimates them',
};

export function register(api: PluginApi): void {
  registerDatabase(api, mariadbEngine);
}
```

| Key | What it is |
| --- | --- |
| `id`, `title`, `icon` | The engine, as the plugin's name and in sentences; the icon of its section (a Tabler id; the family's own when omitted) |
| `script` | The tool every entry runs: `bash <script> <project> <flags>`, from the workspace folder, with `--service <name>` for a compose file's service and `--file <path>` for a SQLite file |
| `client` | The client the console opens |
| `detect(projectDir)` | The databases of a project that are this engine's: `serverDetect(id)` for a server, `sqliteDetect` for SQLite files |
| `admins` | The web admins it opens: each an official DDEV add-on and the service it adds |
| `verbs` | The entries it offers, in order (all when omitted): `console`, `tables`, `export`, `import`, `running`, `info`, `admin` |
| `fits(db, verb)` | `''` when an entry fits a database, else the sentence said in its place |
| `dumpExt` | `.sql.gz` for a server's dump, `.sqlite.gz` for a SQLite file kept whole |
| `rowsAre`, `menuNote` | What the rows of the tables list are; a line the menu ends with |

The tool takes, besides the project: `--console`, `--tables` (with `--tsv`: name, rows and bytes, separated by
tabs), `--running`, `--info` (the default), `--export` (and `--file <path>`), `--import <file>` (and
`--no-safety-export`), `--query <sql>`, `--admin <tool>`, `--admin-remove <tool>`, `--service <name>`, `--file`.

The engine plugin's own settings file is read by the base for `admin:`, the web admins the menu offers (`both`,
`all` or empty: every one; an id; a list of ids; `none`).

## What comes later

- The version new builds get: the core's builders pass their own `--database` today, so a setting here needs a hook
  in the runtime layer first.
- A web admin on Docker Compose, Podman, Kubernetes, Lando and Docksal, once the core can declare a service for a
  project.
- MySQL and PostgreSQL built by the runtime layer (its `php` stack has one database, MariaDB).
- The database of a Landofile or a `.docksal/` of the project's own.
- A database project of its own: a scratch database of an engine and version, to open a dump in.

## Develop it

```bash
npm install     # builds dist/ (TypeScript)
npm run lint
npm test        # the readers, the dumps, the tables, and the menu and actions against a fake dashboard
```
