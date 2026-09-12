# NingAcademy Feature and UI Maturity Audit

Last updated: 2026-09-02

## Project context

- Project / repo: `Z:\Works\Computer Science\NingAcademy` only.
  `Z:\Works\Computer Science\NingAcademy Games` is explicitly out of scope.
- Stack: Next.js 16.3 App Router, React 19, TypeScript, Tailwind CSS,
  Supabase Postgres/Auth/Storage, and Vercel deployment conventions.
- UI exercise path: `npm run dev` against the Supabase project configured in
  the uncommitted `.env.local`, driven in headless Microsoft Edge through a
  no-save Playwright installation. No browser package or credentials were
  committed.
- Test accounts: teacher `audit_teacher_260902` was created and verified
  through `/setup` with the owner-authorized deployment token. Its password is
  intentionally not stored in this file. **Student coverage remains BLOCKED**:
  read-only profile lookup confirmed that `test2`, `test3`, and `Ning` do not
  exist in the Supabase project selected by this repository's `.env.local`, and
  all three supplied logins returned the generic invalid-credentials message.
- Provisional viewport matrix pending owner confirmation: narrow phone
  360x800, tablet 768x1024, laptop 1440x900, very wide 1920x1080.
- Languages/locales: Chinese UI (`zh-CN`); Latin text also appears in
  usernames, file names, URLs, and the NingAcademy/Games product names.
- Users and goals: teachers manage students/classes and create, assign,
  review, and grade work; students complete assigned work and review grades,
  exam results, and lesson summaries.
- Sensitive UI data: student names and usernames, account state and last sign
  in, one-time temporary passwords, class membership, assigned work,
  submissions, recordings, paper/submission photos, scores, feedback, lesson
  summaries, and practice-integrity tab events.

## Accepted product constraints (do not file as defects)

1. Vocabulary practice engines v1 and v2 intentionally coexist; v1 remains
   live for existing sets/sessions.
2. Standalone pronunciation homework is legacy but functional. Its direct
   creation route is intentionally absent from the unified New Assignment hub.
3. Game Host cheating is an accepted risk under the Host-authoritative WebRTC
   design.
4. NingAcademy's game surface ends at configuration, eligibility, and secure
   launch. The actual game UI lives in the separately scoped Games app.
5. A teacher-facing general game report is not wired. The existing per-student
   listening accommodation form is in scope where it is rendered.
6. The teacher dashboard's due-item query intentionally uses a 90-day overdue
   lookback at the accepted current scale.

## Cycle log

### Cycle 0 — inventory and readiness (2026-09-02)

- Budget: repository-wide inventory only; no feature audit or fixes begun.
- Result: `INVENTORY.md` created from the complete App Router and interactive
  component surface.
- UI verification status: **BLOCKED** before the first feature cycle because
  the required role-separated test accounts are unavailable. Static source
  review was used only to build the inventory and did not mark any feature as
  reviewed or create findings.
- Needed to start Cycle 1: disposable credentials for at least one teacher and
  two students with intentionally different assignments/visibility (or a
  documented, non-production fixture procedure). A second teacher is strongly
  preferred for cross-teacher ownership checks.

### Cycle 1 — authentication and account bootstrap (2026-09-02)

- Budget: one feature (login, setup, password change, logout, and their route
  transitions), at most three findings and three fixes.
- Coverage: **PARTIALLY VERIFIED**. Shared/teacher behavior is verified.
  Student-success routing and student logout are **BLOCKED** by missing
  fixtures, so the feature remains `unreviewed` in `INVENTORY.md`.
- Account mutation: created active teacher `audit_teacher_260902`, logged in,
  changed its password through the UI, proved the old password stopped working,
  and proved the new password persisted. No student or `Ning` account was
  created, reset, or changed.

#### Closed finding 1 — P2 — auth errors were silent to screen readers

- Confidence: **VERIFIED**, then **IMPLEMENTED AND VERIFIED**.
- Anchor: `app/login/page.tsx:41`, `app/setup/page.tsx:39`,
  `app/change-password/page.tsx:43`.
- Reproduction before the fix: open `/login`, enter a whitespace username and
  any password, then submit. Expected: the visible validation failure is
  announced. Actual: `请输入用户名和密码` appeared in a plain `<p>` with no
  `role` or live-region attribute, and focus returned to `<body>`. Setup and
  password-change failures used the same inaccessible pattern.
- Fix: all three dynamic error messages now use `role="alert"` and
  `aria-live="assertive"`.
- Exact recheck output:
  `loginError={text:"请输入用户名和密码",ariaLive:"assertive"}`,
  `changePasswordError={text:"新密码至少需要 8 位",ariaLive:"assertive"}`.

#### Closed finding 2 — P2 — successful auth transitions left a stale `/` URL

- Confidence: **VERIFIED**, then **IMPLEMENTED AND VERIFIED**.
- Anchor: `app/actions/auth.ts:11`, `app/actions/auth.ts:45`,
  `app/actions/auth.ts:107`.
- Reproduction before the fix: log in as the audit teacher. Expected: the
  teacher dashboard at `/teacher`. Actual: the dashboard rendered while the
  address bar remained `/`; a hard refresh then changed it to `/teacher`.
  Successful password change had the same intermediate `/` URL.
- Fix: validate the active profile and role in both actions, honor the forced
  password-change route, and redirect directly to `/teacher` or `/student`.
  Unknown roles fail closed instead of being cast to a known role.
- Exact recheck output:
  `loginSuccess={url:"http://localhost:3000/teacher",h1:"仪表盘"}` and
  `changed={url:"http://localhost:3000/teacher",h1:"仪表盘",errors:[]}`.

#### Closed finding 3 — P2 — duplicate setup usernames looked retryable

- Confidence: **VERIFIED**, then **IMPLEMENTED AND VERIFIED**.
- Anchor: `app/actions/setup.ts:72`.
- Reproduction before the fix: open `/setup` with the valid deployment token
  and submit the already-created `audit_teacher_260902` username. Expected: an
  instruction to choose another username. Actual: `创建账号失败，请稍后重试`,
  which makes a permanent duplicate look transient.
- Fix: map Supabase Auth's `email_exists`/`user_already_exists` codes to
  `用户名已被使用，请换一个`; other failures remain generic and the internal
  audit log retains the provider detail.
- Exact recheck output:
  `setupDuplicate={text:"用户名已被使用，请换一个",ariaLive:"assertive"}`.

#### Function matrix result

- Login: required fields, whitespace, hostile `<script>` input, incorrect
  credentials, generic credential privacy, in-flight feedback, and synthetic
  double-submit were exercised. During the delayed submit the button read
  `登录中…`, was disabled, and only one POST was sent.
- Persistence/navigation: the teacher session survived hard refresh; direct
  access to `/student` redirected to `/teacher`; logout returned to `/login`;
  browser Back after logout stayed on login and exposed no teacher content.
- Setup: wrong token, invalid username, blank name, short password, duplicate
  username, successful creation, and successful login of the created account
  were exercised. The account cap itself was not forced because doing so would
  consume additional teacher slots.
- Password change: browser and server short-password validation, mismatch,
  success, old-password rejection, and new-password login were exercised.
- Offline: an interrupted login reached Next.js's recoverable
  `This page couldn’t load` screen with Reload and Back controls. It did not
  claim success or leave a permanently disabled submit button.
- Cross-student/cross-teacher object ownership is outside this feature cycle and
  also requires the missing role-separated fixtures.

#### UI matrix result

- Viewports: `/login` and `/setup` were rendered and screenshot at 360x800,
  768x1024, 1440x900, and 1920x1080. Every document's scroll width equaled its
  viewport width; no form/footer overlap occurred.
- States: initial, client-validation, server-error, loading, and success were
  forced. Empty and partial-data states do not apply to these forms.
- Keyboard/semantics: tab order followed every field then the submit button;
  Enter/native submit worked; every user field had a programmatic label;
  required-field validation focused the invalid field. Dynamic errors now have
  alert semantics.
- Content stress/security: whitespace, invalid identifiers, long-form hostile
  syntax, and duplicate values were escaped and rejected without rendering an
  injected script or exposing whether an arbitrary username exists at login.
- Screenshot evidence (not committed):
  `%TEMP%\ningacademy-ui-audit-20260902\login-*.png`,
  `setup-*.png`, `login-error.png`, `login-offline.png`, and
  `setup-duplicate-fixed.png`.

#### Verification commands

```text
npm run typecheck
> tsc --noEmit
exit 0

npm run build
> next build
Compiled successfully; 27 static pages generated
exit 0

npm run lint
> eslint .
0 errors, 3 pre-existing warnings (two no-img-element, one unused Edge Function argument)
exit 0

npm test
> supabase test db --local supabase/tests/authorization.test.sql
BLOCKED: ECONNREFUSED 127.0.0.1:54322; local Supabase/Docker was not running
exit 1
```

No automated regression test was required because all three fixes are P2. Each
exact reproduction was rerun through the UI after implementation. A durable
role-aware E2E suite remains infeasible until disposable student fixtures and a
non-production reset procedure exist.

## Open findings

None from completed coverage. Cycle 1's three verified findings were fixed and
reproduced successfully after the changes.
