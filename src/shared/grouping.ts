export type SplitBy = { groupCount: number } | { groupSize: number };

export function groupCountFor(studentCount: number, split: SplitBy): number {
  if ("groupCount" in split) return split.groupCount;
  return Math.max(1, Math.ceil(studentCount / split.groupSize));
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deal shuffled students round-robin, so group sizes differ by at most 1.
export function randomGroups<T>(items: T[], groupCount: number, random?: () => number): T[][] {
  const groups: T[][] = Array.from({ length: groupCount }, () => []);
  shuffle(items, random).forEach((item, i) => groups[i % groupCount].push(item));
  return groups;
}

export function defaultGroupName(index: number): string {
  return `第 ${index + 1} 組`;
}
