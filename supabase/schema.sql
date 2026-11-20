-- Ejecutar en SQL Editor con el rol del proyecto. Puede ejecutarse nuevamente.
begin;

create schema if not exists jornada_private;
revoke all on schema jornada_private from public, anon;
grant usage on schema jornada_private to authenticated;

create table if not exists jornada_private.agendas (
    user_id uuid primary key references auth.users (id) on delete cascade,
    revision bigint not null check (revision > 0),
    last_operation uuid not null,
    document jsonb not null check (
        jsonb_typeof(document) = 'object'
        and document ?& array['version', 'goals', 'tasks']
        and document -> 'version' = '1'::jsonb
        and jsonb_typeof(document -> 'goals') = 'array'
        and jsonb_typeof(document -> 'tasks') = 'array'
    ),
    updated_at timestamptz not null default now()
);

alter table jornada_private.agendas enable row level security;
revoke all on table jornada_private.agendas from public, anon, authenticated;
grant select, insert, update on table jornada_private.agendas to authenticated;

drop policy if exists agenda_lectura on jornada_private.agendas;
create policy agenda_lectura on jornada_private.agendas
    for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists agenda_alta on jornada_private.agendas;
create policy agenda_alta on jornada_private.agendas
    for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists agenda_edicion on jornada_private.agendas;
create policy agenda_edicion on jornada_private.agendas
    for update to authenticated using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

-- La API expone solo las funciones en public. La tabla pertenece a un esquema privado.
create or replace function public.jornada_leer()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select coalesce(
        (select jsonb_build_object('revision', a.revision, 'document', a.document)
         from jornada_private.agendas a where a.user_id = (select auth.uid())),
        jsonb_build_object('revision', 0, 'document', null)
    );
$$;

create or replace function public.jornada_guardar(
    p_revision bigint, p_operation uuid, p_document jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
    owner_id uuid := auth.uid();
    saved_revision bigint;
begin
    if owner_id is null then
        raise exception using errcode = '42501', message = 'Se requiere iniciar sesión.';
    end if;
    if p_revision is null or p_revision < 0 or p_operation is null or p_document is null then
        raise exception using errcode = '22023', message = 'Registro incompleto.';
    end if;

    if p_revision = 0 then
        insert into jornada_private.agendas (user_id, revision, last_operation, document)
        values (owner_id, 1, p_operation, p_document)
        on conflict (user_id) do nothing
        returning revision into saved_revision;
    else
        update jornada_private.agendas set
            document = p_document, revision = revision + 1,
            last_operation = p_operation, updated_at = now()
        where user_id = owner_id and revision = p_revision
        returning revision into saved_revision;
    end if;

    if saved_revision is null then
        -- Si se perdió la respuesta anterior, se confirma la misma operación una sola vez.
        select revision into saved_revision from jornada_private.agendas
        where user_id = owner_id and revision = p_revision + 1
            and last_operation = p_operation and document = p_document;
    end if;
    if saved_revision is null then
        raise exception using errcode = 'PT409', message = 'La agenda ya cambió en otra sesión.';
    end if;
    return saved_revision;
end;
$$;

revoke all on function public.jornada_leer() from public, anon, authenticated;
revoke all on function public.jornada_guardar(bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.jornada_leer() to authenticated;
grant execute on function public.jornada_guardar(bigint, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
