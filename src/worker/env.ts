export type Bindings = {
  DB: D1Database;
  TEACHER_PASSWORD?: string;
  SESSION_SECRET?: string;
};

export type AppEnv = { Bindings: Bindings };
