// Shared by four consumers (due-items.ts, teacher/vocabulary/[id]/page.tsx,
// teacher/students/[id]/page.tsx, student/_lib/next-due-item.ts) -- not
// teacher-scoped, since the student-side consumer needs it too. Each call
// site still runs its own RLS-scoped queries; this function only
// centralizes the *math*, matching this codebase's established "merge
// RLS-scoped reads in JS" convention rather than introducing a database
// view. One implementation, so a formula fix never has to land four times.
//
// The denominator for accuracy/completion is the session's full typed-word
// count, not "how many were attempted" -- a student who answers 1 of 10
// words correctly and quits must read as ~10% accuracy and not-complete,
// not 100%. A word must be answered correctly on *some* attempt
// (eventuallyCorrectCount === typedWordCount) for typedPassed, which is a
// strictly stronger bar than "every word attempted" -- it also closes the
// case where a student attempts every word, passes 60% first-try accuracy,
// but never retries the words they got wrong. On top of that,
// typedPassed also requires first-*attempt* accuracy >= 60% (a heavy-retry
// session where every word is eventually correct can still legitimately
// read as not-complete if the first-try quality bar isn't met -- confirmed
// as an explicit product decision, not an oversight).
//
// v1 sessions have exactly one attempt per word by construction (the old
// engine has no retry loop), so eventuallyCorrectCount === typedWordCount
// reduces to "every word was both attempted and correct" for them too --
// the same bar as v2, applied uniformly.

export type VocabularySessionCompletionInput = {
  totalWords: number;
  audioWordCount: number;
  completedAt: string | null;
};

export type VocabularyAttemptForCompletion = {
  wordId: string;
  attemptNo: number;
  isCorrect: boolean;
};

export type VocabularySessionCompletion = {
  typedPassed: boolean;
  audioPassed: boolean;
  completedFull: boolean;
  firstAttemptAccuracy: number | null;
};

export function computeVocabularySessionCompletion(
  session: VocabularySessionCompletionInput,
  attempts: VocabularyAttemptForCompletion[],
  audioFileWordIds: string[]
): VocabularySessionCompletion {
  const typedWordCount = session.totalWords - session.audioWordCount;

  const firstAttemptCorrectCount = attempts.filter((a) => a.attemptNo === 1 && a.isCorrect).length;
  const firstAttemptAccuracy = typedWordCount > 0 ? firstAttemptCorrectCount / typedWordCount : null;

  const eventuallyCorrectCount = new Set(attempts.filter((a) => a.isCorrect).map((a) => a.wordId)).size;
  const typedPassed =
    typedWordCount === 0 ||
    (eventuallyCorrectCount === typedWordCount && firstAttemptAccuracy !== null && firstAttemptAccuracy >= 0.6);

  const audioPassed =
    session.audioWordCount === 0 || new Set(audioFileWordIds).size === session.audioWordCount;

  const completedFull = session.completedAt !== null && typedPassed && audioPassed;

  return { typedPassed, audioPassed, completedFull, firstAttemptAccuracy };
}

// Assignment-level completion across multiple practice sessions for the
// same (student, set) pair: once truly completed once, it stays completed
// for reporting purposes even if a later, lower-scoring review session
// exists -- reporting is never "only look at the latest session."
export function isVocabularySetCompleteForStudent(
  sessions: { session: VocabularySessionCompletionInput; attempts: VocabularyAttemptForCompletion[]; audioFileWordIds: string[] }[]
): boolean {
  return sessions.some((s) => computeVocabularySessionCompletion(s.session, s.attempts, s.audioFileWordIds).completedFull);
}
