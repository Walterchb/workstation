-- Ejecutar una vez en SQL Editor del proyecto Supabase de Work Hub.
begin;

-- Selecciona los campos publicados del evento. Las funciones públicas validan el enlace primero.
create or replace function jornada_private.workhub_calendar_events(
    p_events jsonb, p_calendar_id text, p_category_id text
)
returns jsonb
language sql immutable security invoker
set search_path = ''
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', e->>'id', 'calendarId', e->>'calendarId', 'kind', e->>'kind',
        'categoryId', e->>'categoryId', 'reminderMinutes', e->'reminderMinutes',
        'title', e->>'title', 'allDay', e->'allDay',
        'startDate', e->>'startDate', 'endDate', e->>'endDate',
        'startTime', e->>'startTime', 'endTime', e->>'endTime',
        'location', e->>'location', 'description', e->>'description',
        'updatedAt', e->>'updatedAt', 'sequence', e->'sequence'
    ) order by e->>'startDate', e->>'startTime', e->>'id'), '[]'::jsonb)
    from jsonb_array_elements(p_events) as event_item(e)
    where e->>'calendarId' = p_calendar_id
      and (p_category_id is null or coalesce(e->>'categoryId', '') = p_category_id);
$$;
revoke all on function jornada_private.workhub_calendar_events(jsonb,text,text) from public, anon, authenticated;

-- La cuenta activa o revoca el enlace mediante jornada_guardar y sus permisos existentes.
-- Esta lectura no delega acceso general a la tabla privada ni expone el documento completo.
create or replace function public.workhub_calendar_feed(
    p_owner_id uuid, p_calendar_id text, p_token text
)
returns jsonb
language sql stable strict security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'calendar', jsonb_build_object('id', c->>'id', 'name', c->>'name', 'color', c->>'color'),
        'categories', coalesce((
            select jsonb_agg(jsonb_build_object('id', cat->>'id', 'name', cat->>'name', 'color', cat->>'color'))
            from jsonb_array_elements(a.document->'eventCategories') as category_item(cat)
            where exists (
                select 1 from jsonb_array_elements(a.document->'events') as assigned_item(ev)
                where ev->>'calendarId' = p_calendar_id and ev->>'categoryId' = cat->>'id'
            )
        ), '[]'::jsonb),
        'events', jornada_private.workhub_calendar_events(a.document->'events', p_calendar_id, null)
    )
    from jornada_private.agendas as a
    cross join lateral jsonb_array_elements(a.document->'calendars') as calendar_item(c)
    where a.user_id = p_owner_id
      and p_token ~ '^[0-9a-f]{64}$'
      and c->>'id' = p_calendar_id
      and c->>'appleToken' = p_token
    limit 1;
$$;

revoke all on function public.workhub_calendar_feed(uuid,text,text) from public, anon, authenticated;
grant execute on function public.workhub_calendar_feed(uuid,text,text) to anon;
-- Cada enlace de categoría tiene un token propio. El token general no se acepta aquí.
create or replace function public.workhub_calendar_category_feed(
    p_owner_id uuid, p_calendar_id text, p_category_id text, p_token text
)
returns jsonb
language sql stable strict security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'calendar', jsonb_build_object(
            'id', c->>'id',
            'name', (c->>'name') || ' · ' || coalesce(cat->>'name', 'Sin categoría'),
            'color', coalesce(cat->>'color', '#687F8A')
        ),
        'categories', case when cat is null then '[]'::jsonb else
            jsonb_build_array(jsonb_build_object('id', cat->>'id', 'name', cat->>'name', 'color', cat->>'color')) end,
        'events', jornada_private.workhub_calendar_events(a.document->'events', p_calendar_id, p_category_id)
    )
    from jornada_private.agendas as a
    cross join lateral jsonb_array_elements(a.document->'calendars') as calendar_item(c)
    left join lateral jsonb_array_elements(a.document->'eventCategories') as category_item(cat)
        on p_category_id <> '' and cat->>'id' = p_category_id
    where a.user_id = p_owner_id
      and p_token ~ '^[0-9a-f]{64}$'
      and c->>'id' = p_calendar_id
      and c->'appleCategoryTokens'->>('c:' || p_category_id) = p_token
      and (p_category_id = '' or cat is not null)
    limit 1;
$$;

revoke all on function public.workhub_calendar_category_feed(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.workhub_calendar_category_feed(uuid,text,text,text) to anon;
notify pgrst, 'reload schema';
commit;
