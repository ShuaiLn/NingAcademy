create or replace function public.create_vocabulary_set_with_words(
  p_title text,
  p_description text,
  p_words jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_id uuid;
  v_set_id uuid;
  v_word jsonb;
  v_position integer := 0;
begin
  if not private.is_ready_profile() then
    raise exception 'account is not active or must change password first' using errcode = '28000';
  end if;

  v_teacher_id := private.current_teacher_id();
  if v_teacher_id is null then
    raise exception 'caller is not an active teacher' using errcode = '28000';
  end if;

  if p_words is null or jsonb_typeof(p_words) <> 'array' or jsonb_array_length(p_words) = 0 then
    raise exception 'p_words must be a non-empty json array' using errcode = '22023';
  end if;

  insert into public.vocabulary_sets (teacher_id, title, description)
  values (v_teacher_id, p_title, nullif(p_description, ''))
  returning id into v_set_id;

  for v_word in select * from jsonb_array_elements(p_words)
  loop
    insert into public.vocabulary_words (set_id, term, meaning, image_url, sort_order)
    values (
      v_set_id,
      v_word ->> 'term',
      v_word ->> 'meaning',
      nullif(v_word ->> 'imageUrl', ''),
      v_position
    );
    v_position := v_position + 1;
  end loop;

  return v_set_id;
end;
$$;
;
