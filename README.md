# @webship.co/workspace-database

The database family's shared base for Webship Workspace plugins: the contract a database engine plugin fills in, and the DATABASE menu on a project row (a console in a screen, export and import, tables and sizes, a web admin) that every engine plugin (MariaDB, MySQL, PostgreSQL, SQLite) registers through `registerDatabase(api, engine)`.

The first version is on its way: see the issues of this repository.

Part of the [Webship Workspace](https://github.com/webship/workspace), the container-based development workspace (DDEV by default).
