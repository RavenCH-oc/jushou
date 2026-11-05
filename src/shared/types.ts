// Shapes returned by the teacher API.
import type { Question } from "./questions";

export type ClassSummary = { id: string; name: string; joinCode: string; studentCount: number };

export type Student = { id: string; seat: number; name: string };

export type GroupingSummary = { id: string; name: string; groupCount: number };

export type ClassDetail = {
  id: string;
  name: string;
  joinCode: string;
  students: Student[];
  groupings: GroupingSummary[];
  inLesson: boolean; // a lesson of this class is in progress
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

export type QuestionSetSummary = { id: string; name: string; questionCount: number; updatedAt: string };

export type QuestionSetDetail = { id: string; name: string; updatedAt: string; questions: Question[] };
