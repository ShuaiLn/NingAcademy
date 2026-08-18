#!/usr/bin/env node

// Prints one declared-pending migration filename per line, sourced from
// approved-pending-migrations.mjs. The P-1 workflow's replay-prefix step
// consumes this to know exactly which migration file(s) to exclude when
// building the baseline it compares Production against -- so that exclusion
// list can never drift out of sync with what
// compare-migration-history.mjs's --allow-declared-pending mode accepts.

import { approvedPendingMigrations } from "./approved-pending-migrations.mjs";

for (const migration of approvedPendingMigrations) {
  process.stdout.write(`${migration.filename}\n`);
}
