# Core authorization regression tests

`authorization.test.sql` exercises real PostgreSQL grants, RLS policies,
`auth.uid()` context, and RPC authorization for the reviewed core objects. All
fixtures are synthetic and every change is enclosed in a transaction that is
rolled back.

Run the suite only against a disposable, fully migrated local Supabase:

```sh
npx supabase start
npx supabase db reset --local --no-seed
npm run test:auth
```

`npm run test:auth` passes `--local` deliberately. Do not replace it with
`--linked`, and do not point the test at staging or Production. A Docker-
compatible local container runtime is required by Supabase CLI.
