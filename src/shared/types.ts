// Shapes returned by the teacher API.

export type ClassSummary = { id: string; name: string; joinCode: string; studentCount: number };

export type Student = { id: string; seat: number; name: string };

export type GroupingSummary = { id: string; name: string; groupCount: number };

export type ClassDetail = {
  id: string;
  name: string;
  joinCode: string;
  students: Student[];
  groupings: GroupingSummary[];
};

export type Group = { id: string; name: string; studentIds: string[] };

export type GroupingDetail = {
  id: string;
  classId: string;
  className: string;
  name: string;
  groups: Group[];
  students: Student[];
};

export type ImportResult = { added: number; updated: number; skipped: number };
