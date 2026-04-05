// Compute lexical Jaccard-overlap agreement across juror responses.
//
// Not a semantic measure — just a cheap signal of whether the jurors are
// saying vaguely the same thing. Low agreement is a hint to the caller
// that synthesis is doing real work; high agreement means the jurors
// converged on their own.

export function calculateAgreement(responses: string[]): number {
  if (responses.length <= 1) return 1;

  const wordSets = responses.map((r) =>
    new Set(
      r
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3),
    ),
  );

  let totalOverlap = 0;
  let pairs = 0;
  for (let i = 0; i < wordSets.length; i++) {
    for (let j = i + 1; j < wordSets.length; j++) {
      const a = wordSets[i];
      const b = wordSets[j];
      const intersection = new Set([...a].filter((w) => b.has(w)));
      const union = new Set([...a, ...b]);
      totalOverlap += union.size > 0 ? intersection.size / union.size : 0;
      pairs++;
    }
  }

  return pairs > 0 ? Math.round((totalOverlap / pairs) * 100) / 100 : 1;
}
