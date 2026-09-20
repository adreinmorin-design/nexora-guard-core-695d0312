-- Credentials live in Vault, never in client-readable rows. All RPCs are invoker,
-- service-role-only and additionally bind the operation to an organization admin.
create table public.email_mailboxes (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 email text not null,
 secret_id uuid not null,
 verified_at timestamptz not null default now(),
 last_operation_at timestamptz,
 unique(org_id,user_id)
);
alter table public.email_mailboxes enable row level security;
revoke all on public.email_mailboxes from public, anon, authenticated;
grant all on public.email_mailboxes to service_role;

create table public.email_deliveries (
 id uuid primary key,
 mailbox_id uuid not null references public.email_mailboxes(id) on delete cascade,
 status text not null check (status in ('sending','accepted','unknown')),
 created_at timestamptz not null default now()
);
create index email_deliveries_mailbox_time on public.email_deliveries(mailbox_id,created_at);
alter table public.email_deliveries enable row level security;
revoke all on public.email_deliveries from public, anon, authenticated;
grant all on public.email_deliveries to service_role;

create function public.nexora_mailbox(p_action text,p_org uuid,p_actor uuid,p_email text default null,p_password text default null,p_request uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare m public.email_mailboxes; s uuid; credential text;
begin
 if not exists (select 1 from public.org_members where org_id=p_org and user_id=p_actor and role in ('org_admin','platform_admin')) then
   raise exception 'Mailbox access denied';
 end if;
 -- Serialize even initial connection creation and credential rotation.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text || p_actor::text,0));
 select * into m from public.email_mailboxes where org_id=p_org and user_id=p_actor for update;
 if p_action='connect-attempt' then
   if (select count(*) from public.audit_events where org_id=p_org and actor_id=p_actor and action='mailbox.connect_attempt' and created_at>now()-interval '1 hour')>=10 then
     raise exception 'Too many connection attempts; try again later';
   end if;
   insert into public.audit_events(org_id,actor_id,actor_type,source,action,resource)
     values(p_org,p_actor,'user','console','mailbox.connect_attempt','mailbox');
   return jsonb_build_object('allowed',true);
 elsif p_action='status' then
   if m.id is null then return jsonb_build_object('connected',false); end if;
   return jsonb_build_object('connected',true,'email',m.email,'verifiedAt',m.verified_at,'id',m.id);
 elsif p_action='save' then
   if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_password is null or length(p_password)<1 or length(p_password)>512 then raise exception 'Invalid mailbox'; end if;
   if m.id is null then
     select vault.create_secret(p_password) into s;
     insert into public.email_mailboxes(org_id,user_id,email,secret_id) values(p_org,p_actor,p_email,s) returning * into m;
   else
     perform vault.update_secret(m.secret_id,p_password);
     update public.email_mailboxes set email=p_email,verified_at=now() where id=m.id;
   end if;
   insert into public.audit_events(org_id,actor_id,actor_type,source,action,resource,resource_id)
     values(p_org,p_actor,'user','console','mailbox.connected','mailbox',m.id);
   return jsonb_build_object('connected',true);
 elsif p_action='disconnect' then
   if m.id is not null then
     delete from public.email_mailboxes where id=m.id;
     delete from vault.secrets where id=m.secret_id;
     insert into public.audit_events(org_id,actor_id,actor_type,source,action,resource,resource_id)
       values(p_org,p_actor,'user','console','mailbox.disconnected','mailbox',m.id);
   end if;
   return jsonb_build_object('connected',false);
 elsif p_action in ('credentials','reserve') then
   if m.id is null then raise exception 'Connect your mailbox first'; end if;
   if m.last_operation_at > now()-interval '2 seconds' then raise exception 'Wait a moment before retrying'; end if;
   if p_action='reserve' then
     if p_request is null then raise exception 'Request id required'; end if;
     if exists(select 1 from public.email_deliveries where id=p_request) then raise exception 'Send already attempted; do not retry'; end if;
     if (select count(*) from public.email_deliveries where mailbox_id=m.id and created_at>now()-interval '24 hours')>=50 then
       raise exception 'Daily send limit reached';
     end if;
     insert into public.email_deliveries(id,mailbox_id,status) values(p_request,m.id,'sending');
     insert into public.audit_events(org_id,actor_id,actor_type,source,action,resource,resource_id)
       values(p_org,p_actor,'user','console','mailbox.send_requested','mailbox',m.id);
   end if;
   update public.email_mailboxes set last_operation_at=now() where id=m.id;
   select decrypted_secret into credential from vault.decrypted_secrets where id=m.secret_id;
   if credential is null then raise exception 'Mailbox secret unavailable'; end if;
   return jsonb_build_object('email',m.email,'password',credential,'id',m.id);
 else raise exception 'Unknown mailbox operation';
 end if;
end $$;
revoke all on function public.nexora_mailbox(text,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.nexora_mailbox(text,uuid,uuid,text,text,uuid) to service_role;
