/**
 * What a database engine is, to the dashboard.
 *
 * A project keeps its data in a database: a server in a container of its own (MariaDB, MySQL, PostgreSQL), or a
 * file (SQLite). The DATABASE menu on the project's row, the tables and import modals, the web admin jump and the
 * actions are the family's (registerDatabase). An engine says which databases of a project are its own, which web
 * admins it opens, and which entries do not fit a database yet. Each engine plugin also installs its tool,
 * `cmd-tools-<engine>.sh`, into the sites folders: every entry of the menu runs it in a screen session, and a person
 * runs the same tool in a terminal.
 */

/** How a database is reached. */
export type DatabaseVia =
  /** A DDEV project's `db` service: `ddev mysql`, `ddev psql`, `ddev export-db`, `ddev exec -s db`. */
  | 'ddev'
  /** A project the Workspace built on another runtime (the `x-webship` block): the same verbs, through the runtime layer. */
  | 'layer'
  /** A database service of a compose file of the project's own, which the runtime layer does not know. */
  | 'compose'
  /** A SQLite database: a file in the project. */
  | 'file';

/** One database of a project, as the readers find it. */
export interface DatabaseFound {
  /** The engine: 'mariadb', 'mysql', 'postgresql', 'sqlite'. */
  engine: string;
  /** The version the project asks for ('10.11', '8.0', '16'), or '' when nothing says. */
  version: string;
  via: DatabaseVia;
  /** The project's runtime: 'ddev', 'docker', 'podman', 'kubernetes', 'lando', 'docksal'. '' for a file. */
  runtime: string;
  /** The service it runs in: 'db', or the name a compose file of the project's own gives it. '' for a file. */
  service: string;
  /** The compose file of the project's own (via 'compose'), relative to the project. */
  composeFile?: string;
  /** A SQLite database: its file, relative to the project. */
  file?: string;
  /** Where the version comes from when no file of the project says it: "DDEV's default". */
  note?: string;
}

/** A web admin an engine can open on a database. */
export interface AdminTool {
  /** 'adminer', 'phpmyadmin'. Also the value of the engine's `admin:` setting. */
  id: string;
  /** 'Adminer'. */
  label: string;
  /** The official DDEV add-on: its repository, and the name of the service it adds to the project. */
  ddevAddon: { repo: string; service: string };
}

/** The entries of the DATABASE menu, each run by the engine's tool. */
export type DatabaseVerb = 'console' | 'tables' | 'export' | 'import' | 'running' | 'info' | 'admin';

export interface DatabaseEngine {
  /** The plugin's name, its settings key and route namespace, and the engine's id in a dump's name: 'mariadb'. */
  id: string;
  /** The engine in sentences: 'MariaDB'. */
  title: string;
  /** The icon of its section in the menu: a Tabler icon id. Omitted: the family's own (ENGINE_ICONS). */
  icon?: string;
  /** The per-workspace tool the plugin installs: 'cmd-tools-mariadb.sh'. */
  script: string;
  /** The client its console opens, for the menu's words: 'mariadb', 'mysql', 'psql', 'sqlite3'. */
  client: string;
  /** The databases of a project folder that are this engine's: none, one, or a few SQLite files. */
  detect: (projectDir: string) => DatabaseFound[];
  /** The web admins it can open, in the order the menu offers them. */
  admins: AdminTool[];
  /** The entries it offers, in the menu's order. Omitted: all of them. */
  verbs?: DatabaseVerb[];
  /** '' when an entry fits a database, else the sentence that says why it does not yet (shown instead of the entry). */
  fits?: (db: DatabaseFound, verb: DatabaseVerb) => string;
  /** The ending of its exports, after `<project>--<engine>--<when>`: '.sql.gz', or '.sqlite.gz' for a file kept whole. */
  dumpExt: string;
  /** What the rows of its tables list are, for the modal: "the engine's estimate", "counted". */
  rowsAre?: string;
  /** A line the menu ends with, for what stays on the command line. */
  menuNote?: string;
}
