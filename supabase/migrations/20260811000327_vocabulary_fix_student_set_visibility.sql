-- Phase 2 bugfix: vocabulary_sets_select_own_or_assigned never actually
-- admitted a student
--
-- The EXISTS subquery's join condition was written as `t.set_id = id`,
-- intending the bare `id` to mean the outer `vocabulary_sets.id`. But
-- `vocabulary_targets` (aliased `t`) has its own `id` primary key column,
-- which shadows the outer reference -- Postgres silently resolved the
-- unqualified `id` to `t.id` instead, so the predicate was really
-- `t.set_id = t.id`, which is never true for real data (a target's own
-- primary key is never equal to the set_id it points to). This made the
-- whole "student sees an assigned, published set" branch of the policy
-- permanently false. Caught by an end-to-end browser test, not by
-- inspection -- the direct predicate evaluated fine when written out by
-- hand, only the actual planner-resolved SQL exposed the shadowing.
drop policy "vocabulary_sets_select_own_or_assigned" on public.vocabulary_sets;

create policy "vocabulary_sets_select_own_or_assigned"
on public.vocabulary_sets
for select
to authenticated
using (
  private.is_ready_profile()
  and (
    teacher_id = private.current_teacher_id()
    or (
      published_at is not null
      and archived_at is null
      and exists (
        select 1
        from public.vocabulary_targets t
        where t.set_id = vocabulary_sets.id
          and t.student_id = private.current_student_id()
          and t.revoked_at is null
      )
    )
  )
);
