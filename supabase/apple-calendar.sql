-- Ejecutar una vez en SQL Editor del proyecto Supabase de Work Hub.
begin;

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
        'events', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', e->>'id', 'calendarId', e->>'calendarId', 'kind', e->>'kind',
                'title', e->>'title', 'allDay', e->'allDay',
                'startDate', e->>'startDate', 'endDate', e->>'endDate',
                'startTime', e->>'startTime', 'endTime', e->>'endTime',
                'location', e->>'location', 'description', e->>'description',
                'updatedAt', e->>'updatedAt', 'sequence', e->'sequence'
            ) order by e->>'startDate', e->>'startTime', e->>'id')
            from jsonb_array_elements(a.document->'events') as event_item(e)
            where e->>'calendarId' = p_calendar_id
        ), '[]'::jsonb)
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
notify pgrst, 'reload schema';
commit;
