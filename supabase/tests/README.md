# Database authorization regression tests

`authorization.test.sql` exercises real PostgreSQL grants, RLS policies,
`auth.uid()` context, and RPC authorization for the reviewed core objects. All
fixtures are synthetic and every change is enclosed in a transaction that is
rolled back.

`personal_english.test.sql` applies the same transaction/identity pattern to
the Personal Word Library, including normalized upsert behavior, provenance,
archive/re-add, grant surfaces, and cross-student isolation.

Run the suite only against a disposable, fully migrated local Supabase:

```sh
npx supabase start
npx supabase db reset --local --no-seed
npm run test:auth
npm run test:personal-english
```

Both scripts pass `--local` deliberately. Do not replace it with `--linked`,
and do not point either test at staging or Production. A Docker-compatible
local container runtime is required by Supabase CLI; for the repository owner's
Docker-free computer, these suites run only in the disposable GitHub Actions
Supabase stack.
