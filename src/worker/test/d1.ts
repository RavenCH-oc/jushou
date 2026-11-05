/// <reference types="vite/client" />
// A tiny in-memory stand-in for D1, backed by Node's built-in node:sqlite,
// so API tests run real SQL (including ON DELETE CASCADE) without native packages.
// Only the D1 methods the app uses are implemented.
import { DatabaseSync } from "node:sqlite";

const migrations = import.meta.glob("../../../migrations/*.sql", { query: "?raw", import: "default", eager: true });

type Value = string | number | null;

class Statement {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    private params: Value[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new Statement(
      this.db,
      this.sql,
      params.map((p) => (p === undefined ? null : (p as Value))),
    );
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true, meta: {} };
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async run() {
    const { changes } = this.db.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: { changes: Number(changes) } };
  }

  exec() {
    return this.db.prepare(this.sql).all(...this.params);
  }
}

export function createTestDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON"); // D1 enforces foreign keys by default.
  for (const path of Object.keys(migrations).sort()) db.exec(migrations[path] as string);

  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(stmts: Statement[]) {
      db.exec("BEGIN");
      try {
        // Like D1, each result carries how many rows that statement changed.
        const changes = () => Number((db.prepare("SELECT changes() AS n").get() as { n: number }).n);
        const out = stmts.map((s) => {
          const results = s.exec();
          return { results, success: true, meta: /^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql) ? { changes: changes() } : {} };
        });
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return d1 as unknown as D1Database;
}
