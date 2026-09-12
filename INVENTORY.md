# NingAcademy Feature and Screen Inventory

Last mapped: 2026-09-02

Scope: the `NingAcademy` repository only. The separate `NingAcademy Games`
repository and its in-game UI are explicitly excluded. Game-assignment setup,
eligibility, and the secure launch transition implemented in this repository
remain in scope.

Statuses are `unreviewed`, `reviewed YYYY-MM-DD`, or `broken`. A status on a
screen row covers every action named in that row unless an action is listed
separately.

## Cross-cutting shell, access, and shared controls

| Feature / screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Root route `/` | Anyone | Follow the automatic redirect to login or the signed-in role home. | `app/page.tsx`, `proxy.ts` | unreviewed |
| Teacher shell on `/teacher/**` | Active teacher with a changed password | Use logo/name to return home; open/close the phone menu; navigate to Dashboard, Students, Classes, Assignments, Exams, or Summaries; log out. | `app/teacher/layout.tsx`, `app/teacher/teacher-nav.tsx` | unreviewed |
| Student shell on `/student/**` | Active student with a changed password | Use logo/name to return home; open/close the phone menu; navigate to Home, Assignments, Exams, or Summaries; log out. | `app/student/layout.tsx`, `app/student/student-nav.tsx` | unreviewed |
| Role/profile route gate | Signed-out, inactive, temporary-password, teacher, and student users | Direct-open public and protected URLs; be redirected to login, password change, or the correct role home as applicable. | `proxy.ts`, `utils/supabase/proxy.ts` | unreviewed |
| Shared due-date control | Teacher on create/edit forms | Enter a local date/time; have the hidden UTC value updated; clear the value. | `app/_components/due-date-input.tsx` | unreviewed |
| Shared file uploader | Teacher or student where embedded | Choose a file; observe validation/upload progress; retry after begin, Storage, or finalize failure; cancel an unfinished intent when applicable. | `app/_components/file-uploader.tsx` | unreviewed |
| Shared audio recorder | Student where embedded | Grant/deny microphone permission; start/stop recording; preview; upload; discard and re-record; choose an existing audio file instead. | `app/_components/audio-recorder.tsx` | unreviewed |
| Shared photo gallery | Teacher or student where embedded | Open an image preview or file in a new tab; use the fallback download-style link for non-previewable files. | `app/_components/photo-gallery.tsx` | unreviewed |
| Practice tab-integrity capture `/api/practice-tab-event` | Student in v1 or v2 vocabulary practice | Leaving or returning to the browser tab automatically records a hidden/visible event; failed delivery must not block answer entry. | `app/api/practice-tab-event/route.ts`, `app/student/vocabulary/practice/[sessionId]/practice-quiz-v1.tsx`, `practice-quiz-v2.tsx` | unreviewed |

No application modal or custom dialog is currently present. Destructive
controls, where listed below, act from their owning screen rather than through a
modal inventory entry.

## Authentication and account bootstrap

Feature status: **unreviewed**. Cycle 1 verified and fixed the teacher/shared
paths on 2026-09-02. Student login routing and student logout remain unreviewed
because the supplied student profiles are absent from the configured project.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Login `/login` | Anyone | Enter username/password; submit Login; see invalid-credential or required-field feedback; wait through the disabled in-flight state. | `app/login/page.tsx`, `app/actions/auth.ts` | unreviewed |
| Initial teacher setup `/setup` | Anyone holding the deployment token, subject to the three-teacher cap | Enter setup token, username, name, and password; submit Create teacher account; see validation/business-failure feedback; continue to login after success. | `app/setup/page.tsx`, `app/actions/setup.ts` | reviewed 2026-09-02 |
| Forced password change `/change-password` | Signed-in user whose profile requires a password change | Enter and confirm a new password; submit Confirm change; see length, mismatch, session, revocation, Auth, or completion feedback; continue to the role home after success. | `app/change-password/page.tsx`, `app/actions/auth.ts` | unreviewed |
| Teacher logout | Signed-in teacher | Submit Logout from desktop or phone navigation and return to login; use browser Back and confirm protected content remains unavailable; confirm the main-site session and game credentials are revoked. | `app/teacher/teacher-nav.tsx`, `app/actions/auth.ts` | reviewed 2026-09-02 |
| Student logout | Signed-in student | Submit Logout from desktop or phone navigation and return to login; use browser Back and confirm protected content remains unavailable; confirm the main-site session and game credentials are revoked. | `app/student/student-nav.tsx`, `app/actions/auth.ts` | unreviewed |

## Teacher dashboard

Feature status: **unreviewed**.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Dashboard `/teacher` | Teacher | Open Students, Classes, pending plain work, pending pronunciation work, or pending exam scores from statistic tiles; open overdue/upcoming work; open affected student profiles; open student/work links from recent activity. | `app/teacher/page.tsx`, `app/teacher/dashboard-stat-tiles.tsx`, `app/teacher/due-reminders-section.tsx`, `app/teacher/recent-activity-feed.tsx` | unreviewed |

## Teacher student management

Feature status: **unreviewed**.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Student list `/teacher/students` | Teacher | Create a student from username/name; copy the one-time temporary password; open a student row/card; enable or disable a student; inspect last-sign-in state. | `app/teacher/students/page.tsx`, `app/teacher/students/create-student-form.tsx`, `app/teacher/students/student-active-toggle.tsx`, `app/teacher/students/last-sign-in-badge.tsx` | unreviewed |
| Student detail `/teacher/students/[id]` | Owning teacher | Rename the student; enable/disable the account; reset and copy the one-time temporary password; open incomplete items; open vocabulary/pronunciation/plain-work statistics; open related exam and lesson-summary details. | `app/teacher/students/[id]/page.tsx` and colocated `*-section.tsx`, `rename-form.tsx`, `reset-password-form.tsx` | unreviewed |

## Class management

Feature status: **unreviewed**.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Class list `/teacher/classes` | Teacher | Create a class; open a class row/card; inspect the empty list. | `app/teacher/classes/page.tsx`, `app/teacher/classes/create-class-form.tsx` | unreviewed |
| Class detail `/teacher/classes/[id]` | Owning teacher | Rename the class; archive it; select un-enrolled students and add them; remove an enrolled student. | `app/teacher/classes/[id]/page.tsx`, `rename-form.tsx`, `archive-button.tsx`, `roster-panel.tsx` | unreviewed |

## Unified assignment discovery and creation hub

Feature status: **unreviewed**.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Teacher assignment list `/teacher/assignments` | Teacher | Open a plain, vocabulary, pronunciation, or game assignment row/card; inspect publish/archive/content-warning and due states; open New assignment. | `app/teacher/assignments/page.tsx` | unreviewed |
| Assignment type picker `/teacher/assignments/new` | Teacher | Choose Vocabulary, Plain, or Game creation. The legacy Reading creation route intentionally has no tile. | `app/teacher/assignments/new/page.tsx` | unreviewed |
| Student assignment list `/student/assignments` | Student | Open an assigned plain, vocabulary, pronunciation, or game row/card; inspect due/overdue and empty states. | `app/student/assignments/page.tsx` | unreviewed |

## Plain assignments and file submissions

Feature status: **unreviewed**.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Create plain assignment `/teacher/assignments/new/plain` | Teacher | Enter title/optional description/due date; select classes and individual students; publish. | `app/teacher/assignments/new/plain/page.tsx`, `create-plain-assignment-form.tsx`, `target-picker.tsx` | unreviewed |
| Teacher plain assignment detail `/teacher/assignments/[id]` | Owning teacher | Edit title/description/due date; publish an unpublished assignment; archive it; select classes/students and assign; cancel a target; attach and open files; inspect student submissions/files/notes; enter score/feedback and save grading. | `app/teacher/assignments/[id]/page.tsx` and colocated plain-assignment components | unreviewed |
| Student plain assignment detail `/student/assignments/[id]` | Assigned student | Read instructions/due state; open attached files; enter an optional note and start a submission; continue an existing draft; inspect attempt number, score, and teacher feedback history. | `app/student/assignments/[id]/page.tsx`, `start-submission-form.tsx`, `attached-files-list.tsx` | unreviewed |
| Submission draft `/student/assignments/[id]/submissions/[submissionId]` | Student who owns the draft | Choose/upload submission files; inspect uploaded files; submit the finished work; inspect the read-only submitted state if direct-opened after completion. | `app/student/assignments/[id]/submissions/[submissionId]/page.tsx`, `upload-submission-file.tsx`, `finish-submission-button.tsx` | unreviewed |

## Vocabulary homework and practice

Feature status: **unreviewed**. Engine v1 and engine v2 are separate review
paths and both remain live.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Create vocabulary assignment `/teacher/assignments/new/vocabulary` | Teacher | Enter title/description; add/remove word rows; edit English, Chinese, image URL, and alternate answers; choose students; choose input mode and visible/audio cues; choose fixed/random order and whether students may override it; set due date; publish. | `app/teacher/assignments/new/vocabulary/page.tsx`, `create-vocabulary-assignment-form.tsx`, `target-picker.tsx`, `app/teacher/vocabulary/word-rows-editor.tsx` | unreviewed |
| Teacher vocabulary detail `/teacher/vocabulary/[id]` | Owning teacher | Edit v1 or v2 settings; upgrade v1 to v2; publish/archive; add words; edit/save/archive/delete each word; expand/collapse per-word overrides; edit prompt/input override; add/remove/save alternate meanings and terms; add/remove/select/save multiple-choice options; assign/unassign students; open practice sessions; play submitted audio; save audio score/feedback. | `app/teacher/vocabulary/[id]/page.tsx` and colocated components | unreviewed |
| Teacher practice review `/teacher/vocabulary/[id]/sessions/[sessionId]` | Owning teacher | Return to assignment detail; inspect per-question attempts, first-attempt accuracy, eventual completion, audio requirements, and tab-away history. | `app/teacher/vocabulary/[id]/sessions/[sessionId]/page.tsx` | unreviewed |
| Legacy student vocabulary list `/student/vocabulary` | Student | Start/resume a v1 or v2 set; open its history/detail link; inspect empty state. | `app/student/vocabulary/page.tsx`, `start-practice-button.tsx` | unreviewed |
| Student vocabulary detail `/student/vocabulary/[id]` | Assigned student | Start/resume practice; open a completed/in-progress session review. | `app/student/vocabulary/[id]/page.tsx`, `start-practice-button.tsx` | unreviewed |
| Practice v1 `/student/vocabulary/practice/[sessionId]` | Student who owns a v1 session | Play a spoken prompt; type and submit one answer per word; view correctness; move to next/complete; end early; return to the vocabulary list; emit hidden/visible tab events automatically. | `app/student/vocabulary/practice/[sessionId]/page.tsx`, `practice-quiz-v1.tsx` | unreviewed |
| Practice v2 `/student/vocabulary/practice/[sessionId]` | Student who owns a v2 session | Choose sequential/random order when allowed; play pronunciation; type and retry English/Chinese answers; choose a multiple-choice answer; record/upload audio; advance; finish; return to the vocabulary list; emit hidden/visible tab events automatically. | `app/student/vocabulary/practice/[sessionId]/page.tsx`, `practice-quiz-v2.tsx` | unreviewed |
| Student practice review `/student/vocabulary/[id]/sessions/[sessionId]` | Student who owns the session | Return to assignment detail; inspect score/completion and per-question attempts. | `app/student/vocabulary/[id]/sessions/[sessionId]/page.tsx` | unreviewed |

## Standalone pronunciation homework (legacy but live)

Feature status: **unreviewed**. The creation route is orphaned from the unified
hub by product decision but remains directly reachable code.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Legacy create pronunciation task `/teacher/assignments/new/reading` | Teacher with the direct URL | Enter title/description/due date; add/remove prompt rows; select classes/students; publish. | `app/teacher/assignments/new/reading/page.tsx`, `create-reading-assignment-form.tsx`, `target-picker.tsx`, `app/teacher/pronunciation/[id]/prompt-rows-editor.tsx` | unreviewed |
| Teacher pronunciation detail `/teacher/pronunciation/[id]` | Owning teacher | Edit details; publish/archive; add prompt rows; edit/save/archive/delete a prompt; assign/unassign classes/students; play submission audio; save score/feedback. | `app/teacher/pronunciation/[id]/page.tsx` and colocated components | unreviewed |
| Student pronunciation detail `/student/pronunciation/[id]` | Assigned student | Read prompts/due state; enter an optional note and start; continue a recording draft; inspect prior attempts, scores, and feedback. | `app/student/pronunciation/[id]/page.tsx`, `start-audio-submission-form.tsx` | unreviewed |
| Pronunciation recording `/student/pronunciation/[id]/submissions/[audioSubmissionId]` | Student who owns the draft | For each prompt, record/stop/preview/upload/re-record or select audio; submit the finished attempt; inspect the read-only submitted state if direct-opened later. | `app/student/pronunciation/[id]/submissions/[audioSubmissionId]/page.tsx`, `prompt-recorder.tsx`, `finish-audio-submission-button.tsx` | unreviewed |

## Exams and scores

Feature status: **unreviewed**.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Teacher exam list `/teacher/exams` and `?archived=1` | Teacher | Switch between active and archived exams; open an exam row/card; open New exam. | `app/teacher/exams/page.tsx` | unreviewed |
| Create exam `/teacher/exams/new` | Teacher | Enter title/description/date/full marks; select classes (which load their rosters) and individual students; create. | `app/teacher/exams/new/page.tsx`, `create-exam-form.tsx`, `target-picker.tsx` | unreviewed |
| Teacher exam detail `/teacher/exams/[id]` | Owning teacher | Edit metadata; archive/unarchive; add students by class/individual selection; open a student profile; enter/save score and feedback; upload/open/delete paper photos/files; remove a student and their exam record. | `app/teacher/exams/[id]/page.tsx` and colocated components | unreviewed |
| Student exam list `/student/exams` | Student | Open an exam row/card; inspect date, score, pending-score, and empty states. | `app/student/exams/page.tsx` | unreviewed |
| Student exam detail `/student/exams/[id]` | Student included in the exam | Inspect score/full marks/feedback and open paper photos/files. | `app/student/exams/[id]/page.tsx` | unreviewed |

## Lesson summaries

Feature status: **unreviewed**.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Teacher summary list `/teacher/summaries` and `?archived=1` | Teacher | Switch between active and archived summaries; open a summary row/card; open New summary. | `app/teacher/summaries/page.tsx` | unreviewed |
| Create summary `/teacher/summaries/new` | Teacher | Enter optional title/content/session date; select classes (which load their rosters) and individual students; create. | `app/teacher/summaries/new/page.tsx`, `create-summary-form.tsx`, `target-picker.tsx` | unreviewed |
| Teacher summary detail `/teacher/summaries/[id]` | Owning teacher | Edit title/content/date; archive/unarchive; attach/open/delete photos/files; add students via class/individual selection; remove a shared-with student. | `app/teacher/summaries/[id]/page.tsx` and colocated components | unreviewed |
| Student summary list `/student/summaries` | Targeted student | Open a summary row/card; inspect dates/excerpts and empty state. | `app/student/summaries/page.tsx` | unreviewed |
| Student summary detail `/student/summaries/[id]` | Targeted student | Read the summary and open attached photos/files. | `app/student/summaries/[id]/page.tsx` | unreviewed |

## Game homework surfaces in NingAcademy

Feature status: **unreviewed**. Actual game screens, multiplayer, and runtime
controls belong to the excluded `NingAcademy Games` repository.

| Screen | Reachable by | User-visible actions | Source | Status |
| --- | --- | --- | --- | --- |
| Create game assignment `/teacher/assignments/new/game` | Teacher | Enter title/description/due date; select classes/students; select vocabulary sources; select question modes; select prerequisite assignments; publish. | `app/teacher/assignments/new/game/page.tsx`, `create-game-assignment-form.tsx` | unreviewed |
| Teacher game assignment detail `/teacher/assignments/[id]` | Owning teacher | Inspect game configuration; replace the unlock-requirement version; choose a student and set audio/text-alternative plus world-effects accommodation; use shared edit/publish/archive/target controls where rendered. | `app/teacher/assignments/[id]/page.tsx`, `game-unlock-requirements-form.tsx`, `game-listening-accommodation-form.tsx` | unreviewed |
| Student game assignment detail `/student/assignments/[id]` | Assigned student | Inspect live locked/unlocked status and each prerequisite; refresh after completing work; activate Enter game when eligible or read the fail-closed error/disabled state. | `app/student/assignments/[id]/page.tsx`, `launch-game-button.tsx` | unreviewed |
| Secure launch transition `POST/GET /student/game/launch` | Eligible student immediately after Enter game | Follow the cookie-backed transition; have the ticket cleared and auto-POSTed to the configured Games exchange endpoint without exposing it in the URL/history; use the no-script submit fallback if present. | `app/actions/game.ts`, `app/student/game/launch/route.ts` | unreviewed |
