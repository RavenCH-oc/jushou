// Stands in for the LessonHub Durable Object in tests: records each
// broadcast instead of sending it, so tests can check who was told what.
export type Broadcast = { lesson: string; t: string; to: string };

export function createFakeHub() {
  const calls: Broadcast[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (lesson: string) => ({
      fetch: async (_url: string, init: { body: string }) => {
        calls.push({ lesson, ...JSON.parse(init.body) });
        return new Response("ok");
      },
    }),
  };
  return { calls, namespace: namespace as unknown as DurableObjectNamespace };
}
