-- Metabase reads raw_vault so business_vault models can be designed from the hubs,
-- links, and satellites. staging and ops stay closed. Data API stays closed.
-- Objects there are owned by dbt_runner. Grant as that owner.

grant usage on schema raw_vault to bi_reader;
revoke create on schema raw_vault from bi_reader;

alter role bi_reader set search_path = mart, business_vault, raw_vault;

comment on role bi_reader is
  'Metabase. SELECT on schemas mart, business_vault, and raw_vault. Password: Vault bi_reader_password. Session pooler port 5432.';

alter default privileges for role postgres in schema raw_vault
  grant select on tables to bi_reader;

do $fix$
declare
  actor text := current_user;
  schema_name text := 'raw_vault';
  owner_name text;
  rel record;
  already_member boolean;
begin
  for owner_name in
    select distinct owner_role
    from (
      select pg_get_userbyid(c.relowner) as owner_role
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = schema_name
        and c.relkind in ('r', 'v', 'm', 'p', 'f')
      union
      select 'dbt_runner'
      where to_regrole('dbt_runner') is not null
    ) owners
    where owner_role is not null
  loop
    if owner_name = actor then
      for rel in
        select c.relname, c.relkind
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = schema_name
          and c.relkind in ('r', 'v', 'm', 'p', 'f')
          and pg_get_userbyid(c.relowner) = actor
      loop
        execute format('grant select on table %I.%I to bi_reader', schema_name, rel.relname);
        execute format(
          'revoke insert, update, delete, truncate, references, trigger on table %I.%I from bi_reader',
          schema_name, rel.relname
        );
        if rel.relkind = 'v' then
          execute format('alter view %I.%I set (security_invoker = false)', schema_name, rel.relname);
        end if;
      end loop;
      execute format(
        'alter default privileges in schema %I grant select on tables to bi_reader',
        schema_name
      );
    else
      begin
        select exists (
          select 1
          from pg_auth_members m
          join pg_roles granted on granted.oid = m.roleid
          join pg_roles member on member.oid = m.member
          where granted.rolname = owner_name
            and member.rolname = actor
        ) into already_member;

        execute format('grant %I to %I', owner_name, actor);
        execute format('set local role %I', owner_name);
        for rel in
          select c.relname, c.relkind
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = schema_name
            and c.relkind in ('r', 'v', 'm', 'p', 'f')
            and pg_get_userbyid(c.relowner) = current_user
        loop
          execute format('grant select on table %I.%I to bi_reader', schema_name, rel.relname);
          execute format(
            'revoke insert, update, delete, truncate, references, trigger on table %I.%I from bi_reader',
            schema_name, rel.relname
          );
          if rel.relkind = 'v' then
            execute format('alter view %I.%I set (security_invoker = false)', schema_name, rel.relname);
          end if;
        end loop;
        execute format(
          'alter default privileges in schema %I grant select on tables to bi_reader',
          schema_name
        );
        execute 'reset role';
        if not already_member then
          execute format('revoke %I from %I', owner_name, actor);
        end if;
      exception
        when insufficient_privilege then
          begin
            execute 'reset role';
          exception
            when others then
              null;
          end;
          raise notice 'bi_reader: grant as % on % failed (%).', owner_name, schema_name, sqlerrm;
      end;
    end if;
  end loop;
end
$fix$;
