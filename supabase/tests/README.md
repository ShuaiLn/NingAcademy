# Database authorization regression tests

`authorization.test.sql` exercises real PostgreSQL grants, RLS policies,
`auth.uid()` context, and RPC authorization for the reviewed core objects. All
fixtures are synthetic and every change is enclosed in a transaction that is
rolled back.

`personal_english.test.sql` applies the same transaction/identity pattern to
the Personal Word Library, including normalized upsert behavior, provenance,
archive/re-add, grant surfaces, and cross-student isolation.

`personal_english_ocr.test.sql`, `personal_english_ocr_security.test.sql`, and
`personal_english_ocr_migration_order.test.sql` separately cover the Phase 2
bulk contract, privacy/RLS/ACL surface, and ordered migration history. The
two-session Node/Postgres harness is `scripts/phase2/test-concurrency.mjs`.
Every SQL test is either named in the P-1 workflow or recorded in
`scripts/phase2/sql-test-exemptions.json`; the retained Games test is the only
exemption.

Run the suite only against a disposable, fully migrated local Supabase:

```sh
npx supabase start
npx supabase db reset --local --no-seed
npm run test:auth
npm run test:personal-english
npm run test:phase2-db
```

Both scripts pass `--local` deliberately. Do not replace it with `--linked`,
and do not point either test at staging or Production. A Docker-compatible
local container runtime is required by Supabase CLI; for the repository owner's
Docker-free computer, these suites run only in the disposable GitHub Actions
Supabase stack.
