// 互評 (peer review) of 簡答 answers during a lesson: random, one reviews one, anonymous.
// Scores are for the teacher's reference only and never count toward any total.

export const REVIEW_MAX_SCORE = 5;
export const REVIEW_MAX_LENGTH = 200;

// Seat everyone who answered in a shuffled circle; each reviews the next one.
// So everyone reviews exactly one and is reviewed by exactly one, never themselves.
export function assignReviews(studentIds: string[], random = Math.random): { reviewer: string; reviewee: string }[] {
  if (studentIds.length < 2) return [];
  const ring = [...studentIds];
  for (let i = ring.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ring[i], ring[j]] = [ring[j], ring[i]];
  }
  return ring.map((reviewer, i) => ({ reviewer, reviewee: ring[(i + 1) % ring.length] }));
}

// Characters as a person counts them (an emoji is one).
export const commentLength = (text: string) => Array.from(text.trim()).length;

// Returns an error message to show, or null when the review can be saved.
export function checkReview(score: unknown, comment: unknown): string | null {
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > REVIEW_MAX_SCORE) {
    return `分數要是 1 到 ${REVIEW_MAX_SCORE} 分。`;
  }
  if (typeof comment !== "string" || commentLength(comment) === 0) return "請寫一句評語再送出。";
  if (commentLength(comment) > REVIEW_MAX_LENGTH) return `評語最多 ${REVIEW_MAX_LENGTH} 個字，請縮短一點。`;
  return null;
}
