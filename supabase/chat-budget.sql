-- Ejecutar una vez en SQL Editor del proyecto. También se puede volver a ejecutar.
begin;

create schema if not exists jornada_private;
revoke all on schema jornada_private from public, anon;
grant usage on schema jornada_private to authenticated;

create table if not exists jornada_private.chat_budget_references (
    user_id uuid primary key references auth.users(id) on delete cascade,
    usd numeric not null check (usd >= 0),
    effective_at bigint not null check (effective_at between 1 and 9007199254740991),
    changed_at bigint not null check (changed_at between 1 and 9007199254740991)
);
create table if not exists jornada_private.chat_budget_entries (
    user_id uuid not null references auth.users(id) on delete cascade,
    attempt_id text not null check (length(attempt_id) between 1 and 200),
    recorded_at bigint not null check (recorded_at between 1 and 9007199254740991),
    usd numeric not null check (usd >= 0),
    complete boolean not null,
    ok boolean not null,
    model text not null check (length(model) <= 120),
    primary key (user_id, attempt_id)
);
create index if not exists chat_budget_entries_by_date
    on jornada_private.chat_budget_entries(user_id, recorded_at desc, attempt_id desc);

alter table jornada_private.chat_budget_references enable row level security;
alter table jornada_private.chat_budget_entries enable row level security;
revoke all on jornada_private.chat_budget_references, jornada_private.chat_budget_entries from public, anon, authenticated;
grant select, insert, update on jornada_private.chat_budget_references, jornada_private.chat_budget_entries to authenticated;

drop policy if exists chat_budget_owner on jornada_private.chat_budget_references;
create policy chat_budget_owner on jornada_private.chat_budget_references to authenticated
    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists chat_budget_owner on jornada_private.chat_budget_entries;
create policy chat_budget_owner on jornada_private.chat_budget_entries to authenticated
    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function public.workhub_chat_budget_sync(
    p_reference jsonb default null, p_entries jsonb default '[]'::jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    owner_id uuid := auth.uid();
    item jsonb;
    summary jsonb;
begin
    if owner_id is null then
        raise exception using errcode = '42501', message = 'Se requiere iniciar sesión.';
    end if;
    if p_reference is not null and p_reference <> 'null'::jsonb then
        if (jsonb_typeof(p_reference->'usd') = 'number' and jsonb_typeof(p_reference->'at') = 'number'
            and jsonb_typeof(p_reference->'changedAt') = 'number') is not true then
            raise exception using errcode = '22023', message = 'Referencia de saldo incompleta.';
        end if;
        insert into jornada_private.chat_budget_references as r (user_id, usd, effective_at, changed_at)
        values (owner_id, (p_reference->>'usd')::numeric, (p_reference->>'at')::bigint, (p_reference->>'changedAt')::bigint)
        on conflict (user_id) do update set usd = excluded.usd, effective_at = excluded.effective_at, changed_at = excluded.changed_at
        where (excluded.changed_at, excluded.effective_at, excluded.usd) > (r.changed_at, r.effective_at, r.usd);
    end if;
    if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) > 100 then
        raise exception using errcode = '22023', message = 'Se admiten hasta 100 consumos por lote.';
    end if;
    -- Un orden estable evita que dos lotes solapados bloqueen las filas en distinto orden.
    for item in select value from jsonb_array_elements(p_entries) order by value->>'id' loop
        if (jsonb_typeof(item->'id') = 'string' and jsonb_typeof(item->'at') = 'number'
            and jsonb_typeof(item->'usd') = 'number' and jsonb_typeof(item->'complete') = 'boolean'
            and jsonb_typeof(item->'ok') = 'boolean' and jsonb_typeof(item->'model') = 'string') is not true then
            raise exception using errcode = '22023', message = 'Registro de consumo incompleto.';
        end if;
        insert into jornada_private.chat_budget_entries as e (user_id, attempt_id, recorded_at, usd, complete, ok, model)
        values (owner_id, item->>'id', (item->>'at')::bigint, (item->>'usd')::numeric,
                (item->>'complete')::boolean, (item->>'ok')::boolean, item->>'model')
        on conflict (user_id, attempt_id) do update set
            usd = case when excluded.complete then excluded.usd else greatest(e.usd, excluded.usd) end,
            complete = excluded.complete,
            ok = case when excluded.complete then excluded.ok else e.ok or excluded.ok end,
            model = coalesce(nullif(excluded.model, ''), e.model)
        where not e.complete;
    end loop;

    with reference as (
        select usd, effective_at from jornada_private.chat_budget_references where user_id = owner_id
    ), latest_model as (
        select coalesce((select model from jornada_private.chat_budget_entries
            where user_id = owner_id and model <> '' order by recorded_at desc, attempt_id desc limit 1), '') as name
    ), sample as (
        select count(*) as n, sum(recent.usd) as total from (
            select usd from jornada_private.chat_budget_entries
            where user_id = owner_id and complete and ok and usd > 0 and model = (select name from latest_model)
            order by recorded_at desc, attempt_id desc limit 30
        ) recent
    ), totals as (
        select coalesce(sum(usd), 0) as spent, count(*) filter (where not complete) as missing
        from jornada_private.chat_budget_entries
        where user_id = owner_id and recorded_at > coalesce((select effective_at from reference), 0)
    ), budget as (
        select totals.*, case when missing = 0 then (select greatest(0, usd - spent) from reference) end as balance
        from totals
    ) select jsonb_build_object(
        'ref', (select jsonb_build_object('usd', usd, 'at', effective_at) from reference),
        'model', name, 'sample', n, 'average', total / nullif(n, 0),
        'spent', spent, 'missing', missing, 'balance', balance,
        'count', case when balance = 0 then 0 when balance > 0 and n >= 3 then div(balance * n, total) end
    ) into summary from budget, sample, latest_model;
    return summary;
end;
$$;

revoke all on function public.workhub_chat_budget_sync(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.workhub_chat_budget_sync(jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
