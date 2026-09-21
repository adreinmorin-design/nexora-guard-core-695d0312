begin;

create or replace function private.nexora_reject_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'audit_events are immutable'
    using errcode = '42501';
end;
$$;

revoke all on function private.nexora_reject_audit_mutation() from public;
revoke all on function private.nexora_reject_audit_mutation() from anon;
revoke all on function private.nexora_reject_audit_mutation() from authenticated;

drop trigger if exists audit_events_immutable on public.audit_events;
create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function private.nexora_reject_audit_mutation();

revoke update, delete, truncate on public.audit_events from anon;
revoke update, delete, truncate on public.audit_events from authenticated;
revoke update, delete, truncate on public.audit_events from service_role;

commit;
