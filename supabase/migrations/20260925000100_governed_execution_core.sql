begin;

-- First-class intent and governed execution records.
create table public.intents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by_actor_id uuid,
  application_id text,
  objective_fingerprint text not null check (length(objective_fingerprint) between 16 and 128),
  objective_summary text,
  status text not null default 'active'
    check (status in ('active','flagged','quarantined','cleared')),
  violation_count integer not null default 0 check (violation_count >= 0),
  severity public.severity not null default 'info',
  accumulated_risk_score numeric(10,4) not null default 0 check (accumulated_risk_score >= 0),
  risk_state jsonb not null default '{}'::jsonb,
  quarantine_reason text,
  quarantined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, id)
);

alter table public.intents enable row level security;
revoke all on public.intents from public, anon, authenticated;
grant select on public.intents to authenticated;
grant all on public.intents to service_role;
create policy "members read intents"
  on public.intents for select to authenticated
  using (private.is_org_member(org_id));
create index intents_org_created_idx on public.intents(org_id, created_at desc);
create index intents_fingerprint_idx on public.intents(org_id, objective_fingerprint);

create table public.governed_executions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  intent_id uuid not null,
  trace_id text not null check (trace_id ~ '^[a-f0-9]{32}$'),
  actor_id uuid,
  actor_type text not null check (actor_type in ('user','agent','service','application')),
  agent_id uuid,
  application_id text,
  workflow_outcome text
    check (workflow_outcome is null or workflow_outcome in (
      'COMPLETED',
      'COMPLETED_WITH_POLICY_BLOCK',
      'COMPLETED_WITH_REDACTION',
      'DENIED_BEFORE_EXECUTION',
      'FAILED_EXECUTION',
      'CANCELLED',
      'TERMINATED'
    )),
  governance_outcome text,
  violation_count integer not null default 0 check (violation_count >= 0),
  severity public.severity not null default 'info',
  data_classification text not null default 'unclassified',
  tool_sensitivity text not null default 'none',
  destination_sensitivity text not null default 'internal',
  policy_evasion_indicators jsonb not null default '[]'::jsonb,
  accumulated_risk_score numeric(10,4) not null default 0 check (accumulated_risk_score >= 0),
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (org_id, id),
  unique (org_id, trace_id),
  foreign key (org_id, intent_id) references public.intents(org_id, id)
);

alter table public.governed_executions enable row level security;
revoke all on public.governed_executions from public, anon, authenticated;
grant select on public.governed_executions to authenticated;
grant all on public.governed_executions to service_role;
create policy "members read governed executions"
  on public.governed_executions for select to authenticated
  using (private.is_org_member(org_id));
create index governed_executions_intent_idx
  on public.governed_executions(org_id, intent_id, started_at desc);

-- Immutable intent-lineage history. Adjudication is another event, never a rewrite.
create table public.intent_lineage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  parent_intent_id uuid not null,
  child_intent_id uuid not null,
  event_type text not null check (event_type in (
    'LINKED',
    'INHERITED_QUARANTINE',
    'ADJUDICATED_FALSE_POSITIVE',
    'ADJUDICATED_CONFIRMED'
  )),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  reason text not null,
  supersedes_event_id uuid references public.intent_lineage_events(id),
  actor_id uuid,
  created_at timestamptz not null default now(),
  check (parent_intent_id <> child_intent_id),
  foreign key (org_id, parent_intent_id) references public.intents(org_id, id),
  foreign key (org_id, child_intent_id) references public.intents(org_id, id)
);

alter table public.intent_lineage_events enable row level security;
revoke all on public.intent_lineage_events from public, anon, authenticated;
grant select on public.intent_lineage_events to authenticated;
grant all on public.intent_lineage_events to service_role;
create policy "members read intent lineage"
  on public.intent_lineage_events for select to authenticated
  using (private.is_org_member(org_id));
create index intent_lineage_child_idx
  on public.intent_lineage_events(org_id, child_intent_id, created_at desc);

-- OTel-compatible governance events with a deterministic tamper-evident chain.
create table public.governance_audit_heads (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  chain_position bigint not null default 0 check (chain_position >= 0),
  event_hash text,
  updated_at timestamptz not null default now(),
  check (event_hash is null or event_hash ~ '^[a-f0-9]{64}$')
);
alter table public.governance_audit_heads enable row level security;
revoke all on public.governance_audit_heads from public, anon, authenticated;
grant all on public.governance_audit_heads to service_role;

create table public.governance_audit_events (
  event_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  trace_id text not null check (trace_id ~ '^[a-f0-9]{32}$'),
  span_id text not null check (span_id ~ '^[a-f0-9]{16}$'),
  parent_span_id text check (parent_span_id is null or parent_span_id ~ '^[a-f0-9]{16}$'),
  execution_id uuid not null,
  intent_id uuid not null,
  parent_event_id uuid,
  actor_id uuid,
  agent_id uuid,
  application_id text,
  policy_id uuid,
  policy_version integer,
  rule_id text,
  enforcement_point text not null check (enforcement_point in (
    'PRE_EXECUTION',
    'PRE_MODEL_INVOCATION',
    'PRE_TOOL_INVOCATION',
    'POST_TOOL_EXECUTION',
    'PRE_RESPONSE'
  )),
  decision text not null check (decision in (
    'ALLOW',
    'ALLOW_WITH_TRANSFORMATION',
    'DENY_ACTION',
    'DENY_EXECUTION',
    'REQUIRE_APPROVAL',
    'QUARANTINE'
  )),
  reason text not null,
  evaluated_context_hash text not null check (evaluated_context_hash ~ '^[a-f0-9]{64}$'),
  decision_engine_version text not null,
  attributes jsonb not null default '{}'::jsonb,
  event_timestamp timestamptz not null,
  chain_position bigint not null check (chain_position > 0),
  previous_event_hash text check (previous_event_hash is null or previous_event_hash ~ '^[a-f0-9]{64}$'),
  event_hash text not null check (event_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (org_id, chain_position),
  unique (org_id, event_hash),
  foreign key (org_id, execution_id) references public.governed_executions(org_id, id),
  foreign key (org_id, intent_id) references public.intents(org_id, id)
);

alter table public.governance_audit_events enable row level security;
revoke all on public.governance_audit_events from public, anon, authenticated;
grant select on public.governance_audit_events to authenticated;
grant insert on public.governance_audit_events to service_role;
create policy "members read governance evidence"
  on public.governance_audit_events for select to authenticated
  using (private.is_org_member(org_id));
create index governance_audit_trace_idx
  on public.governance_audit_events(org_id, trace_id, chain_position);
create index governance_audit_execution_idx
  on public.governance_audit_events(org_id, execution_id, chain_position);
create index governance_audit_intent_idx
  on public.governance_audit_events(org_id, intent_id, chain_position);

-- Reuse the existing immutable-event trigger for both evidence stores.
drop trigger if exists governance_audit_events_immutable on public.governance_audit_events;
create trigger governance_audit_events_immutable
before update or delete on public.governance_audit_events
for each row execute function private.nexora_reject_audit_mutation();

drop trigger if exists intent_lineage_events_immutable on public.intent_lineage_events;
create trigger intent_lineage_events_immutable
before update or delete on public.intent_lineage_events
for each row execute function private.nexora_reject_audit_mutation();

revoke update, delete, truncate on public.governance_audit_events from service_role;
revoke update, delete, truncate on public.intent_lineage_events from service_role;

-- Risk termination is tenant-configurable and can be tied to an exact policy
-- version. There is intentionally no universal retry/violation threshold.
create table public.governance_risk_thresholds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  policy_id uuid,
  policy_version integer,
  severity public.severity not null,
  terminate_at_score numeric(10,4) check (terminate_at_score is null or terminate_at_score > 0),
  max_violations integer check (max_violations is null or max_violations > 0),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  check ((policy_id is null and policy_version is null) or (policy_id is not null and policy_version is not null)),
  check (terminate_at_score is not null or max_violations is not null)
);

alter table public.governance_risk_thresholds enable row level security;
revoke all on public.governance_risk_thresholds from public, anon, authenticated;
grant select on public.governance_risk_thresholds to authenticated;
grant all on public.governance_risk_thresholds to service_role;
create policy "members read governance risk thresholds"
  on public.governance_risk_thresholds for select to authenticated
  using (private.is_org_member(org_id));
create index governance_risk_threshold_lookup_idx
  on public.governance_risk_thresholds(org_id, policy_id, policy_version, severity)
  where status = 'active';

create or replace function public.nexora_record_execution_risk(
  p_org uuid,
  p_execution uuid,
  p_intent uuid,
  p_policy uuid,
  p_policy_version integer,
  p_severity public.severity,
  p_score numeric,
  p_evasion_indicator text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $
declare
  e public.governed_executions;
  i public.intents;
  threshold public.governance_risk_thresholds;
  next_execution_score numeric;
  next_intent_score numeric;
  next_execution_violations integer;
  next_intent_violations integer;
  should_terminate boolean := false;
begin
  if p_score is null or p_score <= 0 or p_score::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Invalid risk score';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_execution::text, 9117));

  select * into e
    from public.governed_executions
    where org_id = p_org and id = p_execution and intent_id = p_intent
    for update;
  if not found or e.finalized_at is not null then
    raise exception 'Governed execution unavailable for risk update';
  end if;

  select * into i
    from public.intents
    where org_id = p_org and id = p_intent
    for update;
  if not found then raise exception 'Intent unavailable for risk update'; end if;

  next_execution_score := e.accumulated_risk_score + p_score;
  next_intent_score := i.accumulated_risk_score + p_score;
  next_execution_violations := e.violation_count + 1;
  next_intent_violations := i.violation_count + 1;

  select * into threshold
    from public.governance_risk_thresholds t
    where t.org_id = p_org
      and t.status = 'active'
      and t.severity = p_severity
      and (
        (t.policy_id = p_policy and t.policy_version = p_policy_version)
        or (t.policy_id is null and t.policy_version is null)
      )
    order by
      case when t.policy_id = p_policy and t.policy_version = p_policy_version then 0 else 1 end,
      t.created_at desc
    limit 1;

  if found then
    should_terminate :=
      (threshold.terminate_at_score is not null and next_intent_score >= threshold.terminate_at_score)
      or (threshold.max_violations is not null and next_intent_violations >= threshold.max_violations);
  end if;

  update public.governed_executions
    set violation_count = next_execution_violations,
        severity = p_severity,
        accumulated_risk_score = next_execution_score,
        policy_evasion_indicators =
          case
            when p_evasion_indicator is null or length(trim(p_evasion_indicator)) = 0
              then policy_evasion_indicators
            when policy_evasion_indicators @> to_jsonb(array[p_evasion_indicator]::text[])
              then policy_evasion_indicators
            else policy_evasion_indicators || to_jsonb(p_evasion_indicator)
          end,
        workflow_outcome = case when should_terminate then 'TERMINATED' else workflow_outcome end,
        governance_outcome = case when should_terminate then 'QUARANTINE' else governance_outcome end,
        finalized_at = case when should_terminate then now() else finalized_at end
    where org_id = p_org and id = p_execution;

  update public.intents
    set violation_count = next_intent_violations,
        severity = p_severity,
        accumulated_risk_score = next_intent_score,
        status = case when should_terminate then 'quarantined' else
          case when status = 'active' then 'flagged' else status end end,
        quarantine_reason = case when should_terminate
          then 'Policy-defined accumulated risk threshold reached.' else quarantine_reason end,
        quarantined_at = case when should_terminate then now() else quarantined_at end
    where org_id = p_org and id = p_intent;

  insert into public.audit_events(
    org_id, actor_type, action, resource, resource_id, policy_id, policy_version,
    risk, result, metadata
  ) values (
    p_org, 'service', 'governance.risk_updated', 'governed_execution', p_execution::text,
    p_policy, p_policy_version, p_severity,
    case when should_terminate then 'terminated' else 'recorded' end,
    jsonb_build_object(
      'executionRiskScore', next_execution_score,
      'intentRiskScore', next_intent_score,
      'executionViolationCount', next_execution_violations,
      'intentViolationCount', next_intent_violations,
      'evasionIndicator', p_evasion_indicator,
      'thresholdId', threshold.id
    )
  );

  return jsonb_build_object(
    'terminated', should_terminate,
    'intentQuarantined', should_terminate,
    'executionRiskScore', next_execution_score,
    'intentRiskScore', next_intent_score,
    'executionViolationCount', next_execution_violations,
    'intentViolationCount', next_intent_violations,
    'thresholdId', threshold.id
  );
end;
$;

revoke all on function public.nexora_record_execution_risk(
  uuid,uuid,uuid,uuid,integer,public.severity,numeric,text
) from public, anon, authenticated;
grant execute on function public.nexora_record_execution_risk(
  uuid,uuid,uuid,uuid,integer,public.severity,numeric,text
) to service_role;

-- Scoped approvals bind to the original intent/execution and are consumed by a
-- fresh governed execution. Existing approvals remain readable during migration.
alter table public.approvals
  add column if not exists intent_id uuid references public.intents(id),
  add column if not exists original_execution_id uuid,
  add column if not exists approval_scope jsonb not null default '{}'::jsonb,
  add column if not exists single_use boolean not null default true,
  add column if not exists consumed_execution_id uuid;

-- Server-only append primitive. The application computes the SHA-256 hash over
-- canonical event data; this RPC serializes chain advancement and refuses forks.
create or replace function public.nexora_append_governance_event(
  p_org uuid,
  p_event_id uuid,
  p_trace_id text,
  p_span_id text,
  p_parent_span_id text,
  p_execution_id uuid,
  p_intent_id uuid,
  p_parent_event_id uuid,
  p_actor_id uuid,
  p_agent_id uuid,
  p_application_id text,
  p_policy_id uuid,
  p_policy_version integer,
  p_rule_id text,
  p_enforcement_point text,
  p_decision text,
  p_reason text,
  p_evaluated_context_hash text,
  p_event_timestamp timestamptz,
  p_decision_engine_version text,
  p_attributes jsonb,
  p_expected_previous_hash text,
  p_event_hash text
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_position bigint;
  current_hash text;
  next_position bigint;
begin
  if p_event_hash !~ '^[a-f0-9]{64}$'
     or p_evaluated_context_hash !~ '^[a-f0-9]{64}$'
     or p_trace_id !~ '^[a-f0-9]{32}$'
     or p_span_id !~ '^[a-f0-9]{16}$' then
    raise exception 'Invalid governance event integrity fields';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org::text, 4021));
  insert into public.governance_audit_heads(org_id)
    values (p_org)
    on conflict (org_id) do nothing;

  select chain_position, event_hash
    into current_position, current_hash
    from public.governance_audit_heads
    where org_id = p_org
    for update;

  if current_hash is distinct from p_expected_previous_hash then
    raise exception 'Governance audit chain head changed';
  end if;

  next_position := current_position + 1;

  insert into public.governance_audit_events(
    event_id, org_id, trace_id, span_id, parent_span_id,
    execution_id, intent_id, parent_event_id, actor_id, agent_id,
    application_id, policy_id, policy_version, rule_id, enforcement_point,
    decision, reason, evaluated_context_hash, decision_engine_version,
    attributes, event_timestamp, chain_position, previous_event_hash, event_hash
  ) values (
    p_event_id, p_org, p_trace_id, p_span_id, p_parent_span_id,
    p_execution_id, p_intent_id, p_parent_event_id, p_actor_id, p_agent_id,
    p_application_id, p_policy_id, p_policy_version, p_rule_id, p_enforcement_point,
    p_decision, p_reason, p_evaluated_context_hash, p_decision_engine_version,
    coalesce(p_attributes, '{}'::jsonb), p_event_timestamp, next_position,
    current_hash, p_event_hash
  );

  update public.governance_audit_heads
    set chain_position = next_position, event_hash = p_event_hash, updated_at = now()
    where org_id = p_org;

  return next_position;
end;
$$;

revoke all on function public.nexora_append_governance_event(
  uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,text,uuid,integer,text,text,text,text,text,timestamptz,text,jsonb,text,text
) from public, anon, authenticated;
grant execute on function public.nexora_append_governance_event(
  uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,uuid,text,uuid,integer,text,text,text,text,text,timestamptz,text,jsonb,text,text
) to service_role;

commit;
