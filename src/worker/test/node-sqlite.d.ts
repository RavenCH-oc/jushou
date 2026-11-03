// Minimal types for Node's built-in SQLite module (used only by tests),
// so we don't need @types/node.
declare module "node:sqlite" {
  type Value = string | number | null;
  export class StatementSync {
    all(...params: Value[]): unknown[];
    get(...params: Value[]): unknown;
    run(...params: Value[]): { changes: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
