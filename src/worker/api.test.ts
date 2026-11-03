import { beforeEach, describe, expect, it } from "vitest";
import app from "./index";
import type { Bindings } from "./env";
import { createTestDb } from "./test/d1";
import type { ClassDetail, ClassSummary, GroupingDetail, GroupingSummary, ImportResult } from "../shared/types";

let env: Bindings;
let cookie: string;

beforeEach(async () => {
  env = { DB: createTestDb(), TEACHER_PASSWORD: "pw", SESSION_SECRET: "test-secret" };
  const res = await app.request(
    "/api/teacher/login",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw" }) },
    env,
  );
  cookie = (res.headers.get("Set-Cookie") ?? "").split(";")[0];
});

async function api<T = unknown>(method: string, path: string, body?: unknown, withCookie = true) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withCookie) headers.Cookie = cookie;
  const res = await app.request(
    `/api/teacher${path}`,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body) },
    env,
  );
  return { status: res.status, data: (await res.json()) as T };
}

async function classWithStudents(n: number) {
  const { data: cls } = await api<ClassSummary>("POST", "/classes", { name: "高二孝班" });
  const rows = Array.from({ length: n }, (_, i) => ({ seat: i + 1, name: `學生${i + 1}` }));
  if (n) await api("POST", `/classes/${cls.id}/students/import`, { rows, onConflict: "skip" });
  return cls;
}

async function count(table: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("auth", () => {
  it("returns 401 for every new endpoint without login", async () => {
    const routes: [string, string][] = [
      ["GET", "/classes"],
      ["POST", "/classes"],
      ["GET", "/classes/x"],
      ["PATCH", "/classes/x"],
      ["DELETE", "/classes/x"],
      ["POST", "/classes/x/join-code"],
      ["POST", "/classes/x/students"],
      ["POST", "/classes/x/students/import"],
      ["PATCH", "/students/x"],
      ["DELETE", "/students/x"],
      ["POST", "/classes/x/groupings"],
      ["GET", "/groupings/x"],
      ["PATCH", "/groupings/x"],
      ["DELETE", "/groupings/x"],
      ["PATCH", "/groups/x"],
      ["PUT", "/groupings/x/members/y"],
      ["POST", "/groupings/x/shuffle"],
      ["POST", "/groupings/x/copy"],
    ];
    for (const [method, path] of routes) {
      const { status } = await api(method, path, method === "GET" ? undefined : {}, false);
      expect(status, `${method} ${path}`).toBe(401);
    }
  });
});

describe("classes", () => {
  it("creates a class with a 6-digit join code and lists it", async () => {
    const { status, data } = await api<ClassSummary>("POST", "/classes", { name: "  高二孝班 " });
    expect(status).toBe(201);
    expect(data.name).toBe("高二孝班");
    expect(data.joinCode).toMatch(/^\d{6}$/);
    const { data: list } = await api<ClassSummary[]>("GET", "/classes");
    expect(list).toEqual([{ ...data, studentCount: 0 }]);
  });

  it("validates the class name", async () => {
    expect((await api<{ error: string }>("POST", "/classes", { name: " " })).data.error).toBe("請填寫班級名稱。");
    expect((await api("POST", "/classes", { name: "班".repeat(41) })).status).toBe(400);
    expect((await api("POST", "/classes", {})).status).toBe(400);
  });

  it("renames and regenerates the join code", async () => {
    const cls = await classWithStudents(0);
    expect((await api("PATCH", `/classes/${cls.id}`, { name: "高二忠班" })).status).toBe(200);
    const { data } = await api<{ joinCode: string }>("POST", `/classes/${cls.id}/join-code`);
    expect(data.joinCode).toMatch(/^\d{6}$/);
    const { data: detail } = await api<ClassDetail>("GET", `/classes/${cls.id}`);
    expect(detail.name).toBe("高二忠班");
    expect(detail.joinCode).toBe(data.joinCode);
  });

  it("deleting a class removes its students, groupings, groups and members", async () => {
    const keep = await classWithStudents(3);
    await api("POST", `/classes/${keep.id}/groupings`, { name: "保留", mode: "random", groupCount: 1 });
    const cls = await classWithStudents(10);
    await api("POST", `/classes/${cls.id}/groupings`, { name: "A", mode: "random", groupCount: 3 });
    await api("POST", `/classes/${cls.id}/groupings`, { name: "B", mode: "manual", groupCount: 2 });

    expect((await api("DELETE", `/classes/${cls.id}`)).status).toBe(200);
    expect(await count("classes")).toBe(1);
    expect(await count("students")).toBe(3);
    expect(await count("groupings")).toBe(1);
    expect(await count("groups")).toBe(1);
    expect(await count("group_members")).toBe(3);
    expect((await api("GET", `/classes/${cls.id}`)).status).toBe(404);
  });
});

describe("students", () => {
  it("imports a roster, then updates or skips existing seats", async () => {
    const cls = await classWithStudents(0);
    const rows = [
      { seat: 1, name: "王小明" },
      { seat: 2, name: "李小華" },
    ];
    let res = await api<ImportResult>("POST", `/classes/${cls.id}/students/import`, { rows, onConflict: "skip" });
    expect(res.data).toEqual({ added: 2, updated: 0, skipped: 0 });

    const again = [
      { seat: 2, name: "李大華" },
      { seat: 3, name: "陳大文" },
    ];
    res = await api<ImportResult>("POST", `/classes/${cls.id}/students/import`, { rows: again, onConflict: "skip" });
    expect(res.data).toEqual({ added: 1, updated: 0, skipped: 1 });
    res = await api<ImportResult>("POST", `/classes/${cls.id}/students/import`, { rows: again, onConflict: "update" });
    expect(res.data).toEqual({ added: 0, updated: 2, skipped: 0 });

    const { data } = await api<ClassDetail>("GET", `/classes/${cls.id}`);
    expect(data.students.map((s) => [s.seat, s.name])).toEqual([
      [1, "王小明"],
      [2, "李大華"],
      [3, "陳大文"],
    ]);
  });

  it("rejects invalid or duplicate import rows without saving anything", async () => {
    const cls = await classWithStudents(0);
    const bad = [
      { seat: 1, name: "王小明" },
      { seat: 1, name: "李小華" },
    ];
    expect((await api("POST", `/classes/${cls.id}/students/import`, { rows: bad, onConflict: "skip" })).status).toBe(400);
    const noName = [{ seat: 1, name: "" }];
    expect((await api("POST", `/classes/${cls.id}/students/import`, { rows: noName, onConflict: "skip" })).status).toBe(400);
    const badSeat = [{ seat: 1.5, name: "王" }];
    expect((await api("POST", `/classes/${cls.id}/students/import`, { rows: badSeat, onConflict: "skip" })).status).toBe(400);
    expect(await count("students")).toBe(0);
  });

  it("adds, edits and deletes one student; seats stay unique per class", async () => {
    const cls = await classWithStudents(2);
    const other = await classWithStudents(0);
    expect((await api("POST", `/classes/${cls.id}/students`, { seat: 2, name: "重複" })).status).toBe(409);
    expect((await api("POST", `/classes/${other.id}/students`, { seat: 2, name: "別班可以" })).status).toBe(201);
    const { data: s } = await api<{ id: string }>("POST", `/classes/${cls.id}/students`, { seat: 3, name: "新同學" });
    expect((await api("PATCH", `/students/${s.id}`, { seat: 1, name: "新同學" })).status).toBe(409);
    expect((await api("PATCH", `/students/${s.id}`, { seat: 4, name: "改名" })).status).toBe(200);
    expect((await api("DELETE", `/students/${s.id}`)).status).toBe(200);
    expect((await api<ClassDetail>("GET", `/classes/${cls.id}`)).data.students).toHaveLength(2);
  });
});

describe("groupings", () => {
  async function detail(id: string) {
    return (await api<GroupingDetail>("GET", `/groupings/${id}`)).data;
  }

  function assertEachStudentOnce(g: GroupingDetail) {
    const placed = g.groups.flatMap((x) => x.studentIds);
    expect(new Set(placed).size).toBe(placed.length);
  }

  it("random by group count: balanced and each student in one group", async () => {
    const cls = await classWithStudents(30);
    const { status, data } = await api<GroupingSummary>("POST", `/classes/${cls.id}/groupings`, {
      name: "報告分組",
      mode: "random",
      groupCount: 4,
    });
    expect(status).toBe(201);
    const g = await detail(data.id);
    expect(g.groups.map((x) => x.name)).toEqual(["第 1 組", "第 2 組", "第 3 組", "第 4 組"]);
    expect(g.groups.map((x) => x.studentIds.length).sort()).toEqual([7, 7, 8, 8]);
    assertEachStudentOnce(g);
  });

  it("random by group size", async () => {
    const cls = await classWithStudents(30);
    const { data } = await api<GroupingSummary>("POST", `/classes/${cls.id}/groupings`, {
      name: "四人一組",
      mode: "random",
      groupSize: 4,
    });
    expect(data.groupCount).toBe(8);
    const sizes = (await detail(data.id)).groups.map((x) => x.studentIds.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("rejects bad random settings", async () => {
    const cls = await classWithStudents(3);
    const post = (body: object) => api("POST", `/classes/${cls.id}/groupings`, { name: "x", mode: "random", ...body });
    expect((await post({ groupCount: 4 })).status).toBe(400);
    expect((await post({ groupCount: 2, groupSize: 2 })).status).toBe(400);
    expect((await post({ groupSize: 0 })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    const empty = await classWithStudents(0);
    expect((await api("POST", `/classes/${empty.id}/groupings`, { name: "x", mode: "random", groupCount: 1 })).status).toBe(400);
  });

  it("manual grouping starts empty; moving keeps a student in one group", async () => {
    const cls = await classWithStudents(5);
    const { data } = await api<GroupingSummary>("POST", `/classes/${cls.id}/groupings`, {
      name: "手動",
      mode: "manual",
      groupCount: 2,
    });
    let g = await detail(data.id);
    expect(g.groups.flatMap((x) => x.studentIds)).toEqual([]);
    const [a, b] = g.groups;
    const s = g.students[0].id;

    await api("PUT", `/groupings/${g.id}/members/${s}`, { groupId: a.id });
    await api("PUT", `/groupings/${g.id}/members/${s}`, { groupId: b.id });
    g = await detail(data.id);
    expect(g.groups[0].studentIds).toEqual([]);
    expect(g.groups[1].studentIds).toEqual([s]);

    await api("PUT", `/groupings/${g.id}/members/${s}`, { groupId: null });
    g = await detail(data.id);
    expect(g.groups.flatMap((x) => x.studentIds)).toEqual([]);
  });

  it("refuses to move a student into a group from another grouping or class", async () => {
    const cls = await classWithStudents(2);
    const other = await classWithStudents(2);
    const g1 = await detail((await api<GroupingSummary>("POST", `/classes/${cls.id}/groupings`, { name: "a", mode: "manual", groupCount: 1 })).data.id);
    const g2 = await detail((await api<GroupingSummary>("POST", `/classes/${cls.id}/groupings`, { name: "b", mode: "manual", groupCount: 1 })).data.id);
    const otherStudent = (await api<ClassDetail>("GET", `/classes/${other.id}`)).data.students[0].id;
    expect((await api("PUT", `/groupings/${g1.id}/members/${g1.students[0].id}`, { groupId: g2.groups[0].id })).status).toBe(404);
    expect((await api("PUT", `/groupings/${g1.id}/members/${otherStudent}`, { groupId: g1.groups[0].id })).status).toBe(404);
  });

  it("renames, shuffles, copies and deletes", async () => {
    const cls = await classWithStudents(9);
    const { data } = await api<GroupingSummary>("POST", `/classes/${cls.id}/groupings`, {
      name: "原本",
      mode: "manual",
      groupCount: 3,
    });
    let g = await detail(data.id);
    expect((await api("PATCH", `/groupings/${g.id}`, { name: "改名" })).status).toBe(200);
    expect((await api("PATCH", `/groups/${g.groups[0].id}`, { name: "紅隊" })).status).toBe(200);

    expect((await api("POST", `/groupings/${g.id}/shuffle`)).status).toBe(200);
    g = await detail(data.id);
    expect(g.name).toBe("改名");
    expect(g.groups[0].name).toBe("紅隊");
    expect(g.groups.map((x) => x.studentIds.length)).toEqual([3, 3, 3]);
    assertEachStudentOnce(g);

    const { data: copy } = await api<GroupingSummary>("POST", `/groupings/${g.id}/copy`);
    const c = await detail(copy.id);
    expect(c.name).toBe("改名（複本）");
    expect(c.groups.map((x) => [x.name, x.studentIds])).toEqual(g.groups.map((x) => [x.name, x.studentIds]));

    // Editing the copy leaves the original alone.
    await api("PUT", `/groupings/${c.id}/members/${c.groups[0].studentIds[0]}`, { groupId: null });
    expect((await detail(g.id)).groups[0].studentIds).toHaveLength(3);

    expect((await api("DELETE", `/groupings/${g.id}`)).status).toBe(200);
    expect((await api("GET", `/groupings/${g.id}`)).status).toBe(404);
    expect((await api<ClassDetail>("GET", `/classes/${cls.id}`)).data.groupings.map((x) => x.id)).toEqual([c.id]);
  });

  it("deleting a student removes them from groups", async () => {
    const cls = await classWithStudents(4);
    const { data } = await api<GroupingSummary>("POST", `/classes/${cls.id}/groupings`, { name: "a", mode: "random", groupCount: 2 });
    const g = await detail(data.id);
    await api("DELETE", `/students/${g.students[0].id}`);
    expect((await detail(data.id)).groups.flatMap((x) => x.studentIds)).toHaveLength(3);
  });
});
