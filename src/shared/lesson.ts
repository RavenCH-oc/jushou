// Shapes of the lesson (上課) API, for both the teacher and the student side.
import type { Answer, GradeResult, StudentQuestion } from "./grading";
import type { Question } from "./questions";
import type { Student } from "./types";

export type QuestionStatus = "pending" | "open" | "closed" | "revealed";

// What the live connection says. It never carries data: on any event the
// page fetches the current state again over HTTP.
export type LiveEvent = "question" | "answers" | "roster" | "ended";

// --- Teacher ---

export type ActiveLesson = { id: string; classId: string; className: string };

export type QuestionStats = {
  answered: number;
  correct: number;
  choices?: number[]; // single/multiple: picks per option; truefalse: [對, 錯]
  blanks?: number[]; // fill: how many got each blank right
};

export type LessonQuestion = Question & { status: QuestionStatus; answeredBy: string[]; stats: QuestionStats };

export type LessonStudent = Student & { joined: boolean; bound: boolean };

export type LessonDetail = {
  id: string;
  status: "active" | "ended";
  classId: string;
  className: string;
  joinCode: string;
  setName: string;
  currentQuestionId: string | null;
  students: LessonStudent[];
  questions: LessonQuestion[];
};

export type EssayAnswer = { seat: number; name: string; text: string };

// --- Student ---

export type SeatChoice = { seat: number; name: string; taken: boolean };

export type StudentCurrent = {
  question: StudentQuestion;
  number: number;
  total: number;
  status: "open" | "closed" | "revealed";
  answer: Answer | null; // what this student last sent
  reveal?: { result: GradeResult; question: Question }; // only once the teacher reveals it
};

export type StudentState = {
  className: string;
  lessonId: string | null; // the lesson in progress, if any
  me: { seat: number; name: string } | null; // who this phone is bound to
  seats?: SeatChoice[]; // only while `me` is null
  current: StudentCurrent | null; // the question the teacher pushed last
};
