# P-1 Assignment Model Report

Status: **Git model audited; Production confirmation pending**  
Decision for rev2.1 §3.5.1: **方案 B**

## Evidence boundary

This conclusion came from the 20-file audit snapshot (19 deployable migrations plus the then-active frozen game draft) and the server/UI query paths that currently read and complete work. The frozen draft has since been archived under `supabase/drafts/` after read-only checks proved it was never recorded in either accessible shared environment. That queue change does not alter the audited assignment-model conclusion.

The archived `supabase/drafts/20260813230000_game_phase0_contract.sql` is treated as an unapproved pre-P-1 game draft, not an active migration. Its proposed `assignments.assignment_kind in ('plain','game')` addition is documented separately below and is not used to pretend that vocabulary and pronunciation are children of `assignments`.

## Identity, students, and classes

- `auth.users -> public.profiles`: the profile owns username, display name, active state, and the constrained `teacher | student` role.
- `public.teachers(id) -> profiles(id)` and `public.students(id) -> profiles(id)` specialize the identity. Each student also has one `students.teacher_id`.
- `public.classes` belongs to a teacher.
- `public.enrollments` links a class to a student, retains `enrolled_at`/`unenrolled_at`, and is unique on `(class_id, student_id)`.
- Class assignment is dynamic: an active class target is resolved through the current active enrollment. It is not expanded into permanent student target rows.

Primary DDL: `20260810164324_core_auth.sql` and `20260811051226_classes_assignments_reading.sql`.

## Three independent assignment systems

| Concern             | Plain assignment                 | Vocabulary                                                 | Pronunciation / reading          |
| ------------------- | -------------------------------- | ---------------------------------------------------------- | -------------------------------- |
| Parent              | `public.assignments`             | `public.vocabulary_sets`                                   | `public.pronunciation_tasks`     |
| Content             | description + `assignment_files` | `vocabulary_words` and mode/audio configuration            | `pronunciation_task_words`       |
| Target table        | `assignment_targets`             | `vocabulary_targets`                                       | `pronunciation_targets`          |
| Target shape        | exactly one of class or student  | student only                                               | exactly one of class or student  |
| Due date            | `assignments.due_at`             | `vocabulary_sets.due_at`                                   | `pronunciation_tasks.due_at`     |
| Publish/assign path | assignment-specific RPCs         | vocabulary-specific RPCs                                   | pronunciation-specific RPCs      |
| Attempt/completion  | `submissions.submitted_at`       | qualifying `practice_sessions` + attempts/audio            | `audio_submissions.submitted_at` |
| Historical snapshot | submission/file attempt          | frozen `practice_session_words` plus attempt answer copies | audio submission/file attempt    |

### Plain assignments and submissions

`public.assignments` is teacher-owned and independently published/archived. `assignment_targets` references `assignment_id` and either `class_id` or `student_id`, enforced by an exactly-one constraint and partial unique indexes. Class visibility is resolved through `enrollments`.

`public.submissions` stores numbered attempts per `(assignment, student)`. A partial unique index allows one unfinished draft; `create_submission()` resumes or creates it, and `finish_submission()` sets `submitted_at`. Scores, feedback, and grading time live on the submission, while `submission_files` retain attempt attachments.

### Vocabulary

`public.vocabulary_sets` is a separate teacher-owned parent. `vocabulary_targets` references `set_id` and a student directly; it does not reference `assignments`, `assignment_targets`, or classes. `due_at` was added directly to `vocabulary_sets`.

Practice history is also independent:

- `practice_sessions` identifies student, set, start/completion, and frozen counts/config;
- `practice_session_words` freezes the word content and correct answer for that session;
- `vocabulary_attempts` records per-word attempts and answer copies;
- vocabulary v2 adds its own audio submission/file records and retry behavior.

Current application completion logic treats a set as complete when at least one session satisfies the configured typed/audio requirements. Typed work requires every typed word to become correct and at least 60% first-attempt accuracy; required audio words must also have files. This is not `submissions.submitted_at`.

### Pronunciation / reading

`public.pronunciation_tasks` is a third teacher-owned parent with its own content rows, `due_at`, publish flow, and `pronunciation_targets`. Its target shape mirrors plain assignments but references `task_id`, not `assignment_id`.

Student work is stored as numbered `audio_submissions` plus `audio_submission_files`. `create_audio_submission()` and `finish_audio_submission()` are distinct from plain submission RPCs; finishing requires attached audio. The repository convention also explicitly treats standalone pronunciation and vocabulary-v2 audio as separate systems.

## §3.5.1 decision

方案 A requires evidence that vocabulary and pronunciation are dispatched through a `public.assignments` row and only keep their content in related tables. That condition is false:

- neither `vocabulary_sets` nor `pronunciation_tasks` has an `assignment_id` parent;
- each owns its own publish/archive/due fields;
- each has its own target rows and visibility helpers;
- each has a distinct completion/history model;
- current due-item code queries all three parent tables and all three completion paths separately.

方案 B's premise—three independent assignment families with separate targets, due dates, permissions, and completion—is exactly what the tracked model implements. Therefore **rev2.1 must proceed with方案 B after P-1 passes**.

This is a model-selection decision only. It does **not** authorize creating the方案 B registry, any game table, or any RPC during P-1.

## Existing game draft caveat

The archived pre-P-1 game draft proposed only `plain | game` on `public.assignments` and attached game configuration to a game-kind assignment. It did not migrate vocabulary or pronunciation into `assignments`; therefore it cannot satisfy方案 A's condition. It remains frozen outside the active migration queue.

No `game_unlock_requirements`, `game_assignment_versions`, or `get_game_access_status` object was added by this P-1 work.

## Production confirmation

Run `31915313767`'s manual read-only Production export verified the real parent, target, due-date, permission, RLS, RPC-signature, and completion structures used for this decision.方案 B is therefore confirmed rather than provisional.

P-1 remains closed for separate migration-history/FK/ACL reconciliation documented in `MIGRATION_DRIFT_REPORT.md`; those items do not reopen the assignment-model decision. Any future Production-only change that affects this model must still be recorded before formal game schema design.

## Post-P-1 staging implementation update

After the staging baseline passed,方案 B was implemented by
`20260815170000_game_unlock_scheme_b.sql`. The three parents remain independent;
`public.assignables` is only a narrow registry/identity layer. Immutable
`game_assignment_versions` and `game_unlock_requirements` snapshot teacher
configuration, `game_assignment_completion_status` records server evaluations,
and `get_game_access_status(uuid)` derives the student from the authenticated
session. Game-kind assignments are structurally excluded from the registry.

This update supersedes the earlier historical statements that no registry/RPC
had yet been authorized. Deployment is staging-only; Production remains
unchanged.
