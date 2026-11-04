export type Bindings = {
  DB: D1Database;
  LESSON_HUB: DurableObjectNamespace;
  TEACHER_PASSWORD?: string;
  SESSION_SECRET?: string;
};

export type AppEnv = { Bindings: Bindings };
