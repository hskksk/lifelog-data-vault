-- bi_reader can SELECT only relations this migration grants.
-- dbt creates mart views as dbt_runner. postgres is not a superuser on hosted
-- Supabase, so GRANT ON ALL TABLES from postgres stops with
-- "permission denied for table" on those views (the post-hook also skips the
-- grant when bi_reader does not exist yet). Metabase then syncs an empty schema.
-- Become the owner, grant SELECT, and keep security_invoker off.

grant usage on schema mart to bi_reader;

do $fix$
declare
  actor text := current_user;
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
      where n.nspname = 'mart'
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
        where n.nspname = 'mart'
          and c.relkind in ('r', 'v', 'm', 'p', 'f')
          and pg_get_userbyid(c.relowner) = actor
      loop
        execute format('grant select on table mart.%I to bi_reader', rel.relname);
        if rel.relkind = 'v' then
          execute format('alter view mart.%I set (security_invoker = false)', rel.relname);
        end if;
      end loop;
      execute 'alter default privileges in schema mart grant select on tables to bi_reader';
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
          where n.nspname = 'mart'
            and c.relkind in ('r', 'v', 'm', 'p', 'f')
            and pg_get_userbyid(c.relowner) = current_user
        loop
          execute format('grant select on table mart.%I to bi_reader', rel.relname);
          if rel.relkind = 'v' then
            execute format('alter view mart.%I set (security_invoker = false)', rel.relname);
          end if;
        end loop;
        execute 'alter default privileges in schema mart grant select on tables to bi_reader';
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
          raise notice 'bi_reader: grant as % failed (%).', owner_name, sqlerrm;
      end;
    end if;
  end loop;
end
$fix$;
