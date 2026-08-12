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
;
