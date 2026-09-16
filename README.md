# Nexora

NEXORA — MASTER LOVABLE BUILD PROMPT



Product



Build NEXORA, an enterprise-grade AI Security, Governance & Control Plane.



NEXORA sits between organizations and the AI systems they use.



It governs:



- AI model access

- LLM/API traffic

- AI applications

- autonomous agents

- MCP servers and tools

- sensitive data

- organizational policies

- model/provider selection

- budgets and quotas

- security controls

- human approvals

- auditability

- AI security testing

- usage and cost



NEXORA is not merely an LLM proxy.



The long-term product is a security and governance control plane for enterprise AI.



Core positioning



NEXORA

AI Security, Governance & Control Plane



Primary tagline:



Control every model. Govern every agent. Secure every action.



Alternative supporting statement:



«NEXORA gives organizations centralized security, governance, cost control, and visibility across every AI model, application, and autonomous agent.»



The product should look and feel like a serious enterprise security platform — somewhere between an API gateway, SIEM, cloud security console, IAM platform, and AI governance platform.



Do NOT make it look like a consumer chatbot.



---



1. FIRST: INSPECT THE EXISTING PROJECT



Before making major changes:



1. Inspect the existing Lovable project.

2. Identify the current architecture.

3. Identify existing database/schema.

4. Identify authentication.

5. Identify existing API integrations.

6. Identify reusable UI components.

7. Identify existing security controls.

8. Identify existing Safe LLM Lane functionality if it has been imported or recreated.

9. Identify technical debt and architectural weaknesses.

10. Do NOT blindly overwrite useful existing functionality.



Produce an internal implementation plan before making large structural changes.



Preserve useful functionality where possible.



If functionality needs to be replaced, migrate it rather than creating duplicate competing implementations.



---



2. BRAND



Rename the application throughout the product to:



NEXORA



Do not use:



- Safe LLM Lane

- Aegis

- AegisCore

- SentinelCore



The brand should appear as:



NEXORA



with the product descriptor:



AI Security, Governance & Control Plane



Visual identity should communicate:



- enterprise security

- trust

- control

- intelligence

- infrastructure

- precision

- modern AI

- reliability



Avoid:



- cartoonish AI imagery

- robot mascots

- generic chatbot graphics

- excessive gradients

- consumer SaaS styling

- gimmicky AI language



Use a restrained enterprise-security aesthetic.



---



3. CORE ARCHITECTURE



The architecture must separate:



AI reasoning



from:



deterministic security enforcement



This distinction is fundamental.



LLMs and agents may recommend actions.



They must NOT be trusted to enforce the policies governing themselves.



Security-critical decisions must happen server-side.



The core architecture is:



                    ┌─────────────────────────┐

                    │       NEXORA            │

                    │  Control Plane           │

                    └────────────┬────────────┘

                                 │

        ┌────────────────────────┼────────────────────────┐

        │                        │                        │

        ▼                        ▼                        ▼

   AI Gateway              Agent Gateway             MCP Gateway

        │                        │                        │

        ▼                        ▼                        ▼

  Models / APIs            Agent Tools             MCP Servers

        │                        │                        │

        └────────────────────────┼────────────────────────┘

                                 │

                         Deterministic

                         Policy Engine

                                 │

        ┌────────────────────────┼────────────────────────┐

        ▼                        ▼                        ▼

      DLP                    Security                Cost/Quota

   / PII Scan                Controls                  Controls

        │                        │                        │

        └────────────────────────┼────────────────────────┘

                                 │

                         Allow / Redact /

                       Block / Approval / Rewrite

                                 │

                                 ▼

                         Authorized Execution



---



4. SECURITY INVARIANTS



These are non-negotiable.



Implement the architecture so that:



Tenant isolation



A tenant must never be able to access another tenant's:



- users

- agents

- policies

- prompts

- requests

- logs

- providers

- models

- budgets

- API keys

- audit events

- tools

- MCP servers

- security findings



Never trust tenant IDs supplied by the browser.



Resolve tenant authorization server-side.



---



Server-side enforcement



The browser must NEVER be authoritative for:



- authorization

- budgets

- quotas

- model restrictions

- provider credentials

- security policy decisions

- agent capabilities

- MCP permissions

- approval decisions



---



Provider credential security



Provider API keys must never be exposed to:



- browser JavaScript

- client-side storage

- frontend network responses

- logs

- audit records



Store credentials securely server-side.



---



Blocked request invariant



If a policy says BLOCK:



request → policy engine → BLOCK



The request must not reach the external model provider.



---



Redaction invariant



If a request is redacted:



original request

        ↓

DLP

        ↓

redacted request

        ↓

provider



The original sensitive content must not accidentally be forwarded.



---



Agent privilege invariant



Agents must not inherit unrestricted human privileges.



Each agent must have:



- identity

- owner

- tenant

- role

- capability set

- tool permissions

- data permissions

- rate limits

- budget

- model restrictions

- approval requirements

- lifecycle state



---



Self-governance invariant



Agents cannot silently modify:



- their own permissions

- their own policies

- their own budgets

- their own capabilities

- their own approval requirements

- their own security controls



High-risk policy changes require appropriate authorization.



---



5. MAIN PRODUCT MODULES



Create the following architecture.



NEXORA Gateway



Central AI traffic gateway.



Responsibilities:



- authentication

- tenant resolution

- authorization

- request normalization

- provider routing

- model selection

- policy evaluation

- DLP

- prompt-injection detection

- cost controls

- quota enforcement

- logging

- response inspection

- provider execution



---



NEXORA Policy



Central deterministic governance engine.



Support policies for:



- model restrictions

- provider restrictions

- data classification

- PII

- secrets

- prompt injection

- budget

- quotas

- rate limits

- geography

- user roles

- teams

- agents

- applications

- tools

- MCP

- approval requirements

- prohibited actions



Policies should be:



- versioned

- auditable

- tenant-scoped

- enabled/disabled

- testable

- prioritized

- deterministic



---



NEXORA Guard



AI security layer.



Initial controls:



PII detection



Detect categories such as:



- names

- email addresses

- phone numbers

- addresses

- SSNs

- financial identifiers

- credentials

- API keys

- tokens

- secrets

- sensitive enterprise identifiers



Support actions:



- ALLOW

- REDACT

- BLOCK

- REQUIRE_APPROVAL

- LOG



Do not claim perfect detection.



Display confidence and detection source where appropriate.



---



Prompt injection protection



Detect:



- direct prompt injection

- instruction override attempts

- system prompt extraction

- policy manipulation

- jailbreak attempts

- malicious tool instructions

- indirect prompt injection indicators

- data exfiltration attempts



Architecture must treat detection as a security signal rather than blindly trusting an LLM classifier.



---



Secrets detection



Detect common:



- API keys

- access tokens

- private keys

- passwords

- connection strings

- cloud credentials



---



6. NEXORA Agents



Create an enterprise agent registry.



Every agent receives a unique identity.



Agent records should include:



- agent ID

- name

- description

- owner

- organization

- team

- status

- trust level

- capabilities

- permitted models

- permitted providers

- permitted tools

- permitted data sources

- budget

- rate limit

- approval policy

- risk classification

- created date

- last activity

- version



Agent states:



- Draft

- Active

- Suspended

- Quarantined

- Revoked



---



7. AGENT CAPABILITIES



Implement capability-based authorization.



Example:



agent:

  support-agent



capabilities:

  read_customer_profile

  create_support_ticket



denied:

  delete_customer

  export_customer_database

  modify_billing

  execute_shell



Do not use simple frontend role checks as the primary authorization mechanism.



Every sensitive action must be authorized server-side.



---



8. NEXORA MCP



Build an MCP security/control layer.



Every MCP server must have:



- identity

- owner

- tenant

- endpoint

- authentication method

- capabilities

- risk level

- allowed agents

- allowed users

- allowed tools

- status

- audit configuration



Every MCP tool invocation should pass through:



Agent identity

        ↓

Tenant authorization

        ↓

Capability check

        ↓

Tool authorization

        ↓

Policy evaluation

        ↓

DLP/security inspection

        ↓

Approval if required

        ↓

Execution

        ↓

Audit



Implement protection against:



- unauthorized tool invocation

- confused deputy

- privilege escalation

- malicious tool parameters

- cross-tenant access

- excessive tool permissions

- tool poisoning

- indirect prompt injection

- data exfiltration

- unauthorized destructive actions



---



9. HUMAN APPROVAL



Build a first-class approval system.



Risky operations can require human approval.



Example:



Agent

  ↓

Action

  ↓

NEXORA

  ↓

Policy

  ↓

REQUIRE_APPROVAL

  ↓

Human

  ↓

Approve / Reject

  ↓

Execution



Approval records must include:



- requester

- agent

- tenant

- action

- target

- risk

- reason

- policy

- timestamp

- approver

- decision

- expiration

- execution result



Approval enforcement must happen server-side.



---



10. NEXORA Gateway — PROVIDERS



Create provider abstraction.



Initial providers:



- OpenAI

- Anthropic

- Google Gemini



Architecture must allow:



- Azure OpenAI

- AWS Bedrock

- Vertex AI

- open-source models

- private enterprise models

- custom providers



Normalize requests and responses.



Track:



- tenant

- user

- application

- agent

- provider

- model

- request ID

- tokens

- estimated cost

- latency

- status

- policy decision

- security findings

- timestamp



Provider credentials remain server-side.



---



11. COST GOVERNANCE



Create:



Budgets & Quotas



Support:



- organization budget

- team budget

- user budget

- application budget

- agent budget

- model budget

- provider budget

- daily quota

- monthly quota

- request rate limit

- token limit



Actions when exceeded:



- BLOCK

- REQUIRE_APPROVAL

- FALLBACK_MODEL

- ALERT

- LOG



Never trust frontend calculations.



Cost must be calculated server-side.



---



12. MODEL GOVERNANCE



Create a model registry.



Each model should have:



- provider

- model ID

- capabilities

- context window

- pricing metadata

- security classification

- allowed tenants

- allowed teams

- allowed agents

- status



Support policies such as:



Finance agents cannot use consumer models.



Production agents cannot use unapproved models.



Restricted data cannot be sent to providers without an approved data-processing posture.



High-cost models require approval.



---



13. AUDIT



Build a comprehensive audit system.



Audit events should include:



- event ID

- tenant

- actor

- actor type

- user ID

- agent ID

- action

- resource

- resource ID

- decision

- policy ID

- policy version

- request ID

- source

- timestamp

- result

- risk level



Avoid unnecessarily storing:



- passwords

- secrets

- raw API keys

- sensitive personal information

- complete raw prompts when not necessary



Provide search and filtering.



Filters:



- tenant

- actor

- agent

- action

- decision

- severity

- policy

- provider

- model

- date range



---



14. SECURITY CENTER



Create:



Security



with:



- Threats

- Findings

- Security Tests

- Attack Simulation

- Incidents

- Risk

- Policies



Security findings should support:



- severity

- status

- affected resource

- tenant

- evidence

- detection source

- remediation

- owner

- timestamp



Severity:



- Critical

- High

- Medium

- Low

- Informational



---



15. SECURITY TESTING



Create a built-in AI security testing framework.



Tests should cover:



Authorization



- IDOR

- horizontal privilege escalation

- vertical privilege escalation

- cross-tenant access

- broken object authorization



AI security



- prompt injection

- indirect prompt injection

- jailbreaks

- system prompt extraction

- data exfiltration

- malicious instructions



Agent security



- capability escalation

- unauthorized tool calls

- excessive agency

- confused deputy

- malicious tool arguments

- unsafe autonomous execution



Governance



- budget bypass

- quota bypass

- model restriction bypass

- provider restriction bypass

- policy conflict

- policy precedence errors

- approval bypass



MCP



- unauthorized MCP server

- unauthorized tool

- malicious tool

- tenant boundary violation

- credential exposure

- tool parameter abuse



Tests should generate reproducible results.



---



16. ATTACK SIMULATION



Create a controlled attack simulation environment.



Users should be able to run security scenarios against NEXORA's own enforcement layer.



Example scenarios:



Cross-Tenant Access Attempt

Prompt Injection

PII Exfiltration

Secret Exfiltration

Unauthorized Model

Budget Bypass

Agent Capability Escalation

MCP Tool Abuse

Approval Bypass

Policy Conflict



Each simulation should produce:



- attack

- expected result

- actual result

- PASS/FAIL

- evidence

- timestamp

- affected policy

- remediation recommendation



This must be a safe internal test framework.



Do not create uncontrolled offensive tooling against third-party systems.



---



17. OBSERVABILITY



Create:



Observability



with:



- Requests

- Usage

- Cost

- Latency

- Errors

- Providers

- Models

- Agents

- Security Events



Dashboard metrics:



- requests

- blocked requests

- redacted requests

- approvals

- security events

- token usage

- estimated spend

- provider latency

- error rate

- top models

- top agents

- policy violations



---



18. DASHBOARD



Create an enterprise security dashboard.



Top-level cards:



AI Requests

Blocked

Security Findings

Active Agents

Spend

Policy Violations

Pending Approvals

Risk Score



Add:



AI Traffic



Request volume and decision distribution.



Security



Threats and findings.



Cost



Spend by:



- tenant

- team

- model

- provider

- agent



Agents



Active agents and high-risk activity.



Policies



Policy violations and enforcement trends.



---



19. NAVIGATION



Primary navigation:



Overview



AI Gateway

  Requests

  Providers

  Models



Governance

  Policies

  DLP

  Model Controls

  Budgets & Quotas



Agents

  Registry

  Tasks

  Tools

  Approvals

  MCP



Security

  Threats

  Findings

  Security Tests

  Attack Simulation



Observability

  Usage

  Cost

  Latency

  Errors



Audit



Administration

  Organizations

  Users

  Teams

  Roles

  API Keys

  Integrations

  Settings



---



20. API DESIGN



Use a versioned API.



Base:



/api/v1/



Resources:



/auth

/organizations

/users

/teams

/roles

/policies

/providers

/models

/requests

/agents

/tools

/tasks

/approvals

/security

/audit

/usage

/budgets

/mcp



Do not create frontend-only mock APIs for core security functionality.



Where backend functionality is not yet implemented, clearly mark it:



NOT_CONFIGURED



or:



COMING_SOON



Never pretend an integration works when it does not.



---



21. DATABASE / MULTI-TENANCY



Design the database around organizations/tenants.



Core entities:



Organization

User

Team

Role

Permission



Provider

Model



Policy

PolicyVersion

PolicyRule



Agent

AgentCapability

AgentToolPermission



MCPServer

MCPTool



Request

Response

SecurityFinding



Budget

Quota



Approval



AuditEvent



SecurityTest

SecurityTestRun

AttackSimulation



Every tenant-owned resource must have explicit tenant ownership.



Use database-level protections where supported.



Do not rely solely on application code for tenant isolation.



---



22. ROLE-BASED ACCESS CONTROL



Initial roles:



Platform Administrator



Global platform administration.



Organization Administrator



Organization configuration.



Security Administrator



Security controls and findings.



AI Governance Administrator



Policies, models, providers, budgets.



Agent Administrator



Agent registration and capabilities.



Security Analyst



Security findings and investigations.



Auditor



Read-only audit/compliance access.



Developer



Use approved AI resources and inspect permitted information.



Viewer



Read-only limited access.



Implement least privilege.



---



23. POLICY ENGINE



Policies must support:



IF

    conditions



THEN

    action



Example:



IF

    agent = finance-agent

    AND data_classification = restricted



THEN

    BLOCK



Another:



IF

    model = high_cost_model

    AND monthly_spend > threshold



THEN

    REQUIRE_APPROVAL



Another:



IF

    prompt_contains = PII



THEN

    REDACT



Policies should have:



- priority

- version

- effective date

- status

- scope

- conditions

- action

- creator

- last modified

- change history



---



24. POLICY CONFLICT RESOLUTION



Define deterministic policy precedence.



For example:



Explicit DENY

    >

Security BLOCK

    >

Mandatory approval

    >

Redaction

    >

Allow



Do not allow an LLM to decide policy precedence.



Policy evaluation must be deterministic and explainable.



For every decision provide:



Decision

Reason

Policy

Policy Version

Matched Rules

Evidence



Example:



BLOCKED



Policy:

Restricted Data Protection v4



Reason:

Detected SSN



Matched rule:

PII-001



Action:

BLOCK



Provider:

Anthropic



Model:

Claude



---



25. AI-ASSISTED FEATURES



AI can assist with:



- policy recommendations

- security finding summaries

- threat analysis

- anomaly investigation

- log summarization

- remediation suggestions

- security test generation



But AI must NOT directly override deterministic controls.



Architecture:



AI recommends

      ↓

Deterministic engine evaluates

      ↓

Authorized action



Never:



AI says allow

      ↓

Automatically allow



---



26. INTEGRATIONS



Design integration architecture for:



- OpenAI

- Anthropic

- Google

- Microsoft

- AWS

- GitHub

- Slack

- Jira

- SIEM platforms

- MCP

- enterprise identity providers



Future identity integrations:



- Microsoft Entra ID

- Okta

- Google Workspace



Support SSO/OIDC architecture.



Never hard-code provider-specific assumptions into the entire application.



Use adapter interfaces.



---



27. MICROSOFT ENTRA INTEGRATI

ON



Design the architecture to support:



- tenant connection

- users

- groups

- roles

- sign-in activity

- audit logs

- directory information

- privileged activity

- security signals



Use Microsoft Graph through secure server-side integration.



Never expose Microsoft Graph credentials to the browser.



Do not assume a tenant is authorized merely because an object ID exists.



Verify authorization and tenant ownership server-side.



---



28. REQUEST LIFECYCLE



Implement this conceptual request pipeline:



1. Receive request



2. Authenticate



3. Resolve tenant



4. Authorize user/application/agent



5. Identify requested provider/model



6. Load applicable policy



7. Inspect data



8. Detect PII/secrets



9. Detect prompt injection



10. Evaluate model/provider restrictions



11. Evaluate budget/quota



12. Determine decision



13. ALLOW

    OR

    REDACT

    OR

    BLOCK

    OR

    REQUIRE_APPROVAL



14. Execute provider request if authorized



15. Inspect response



16. Record usage/cost



17. Record security events



18. Record audit event



19. Return response



---



29. RESPONSE SECURITY



Do not only inspect prompts.



Inspect model responses for:



- PII

- secrets

- sensitive data

- policy violations

- unsafe content where applicable

- data leakage



Support:



- ALLOW

- REDACT

- BLOCK

- LOG



--

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f46c7dc2-f8c6-4710-96bb-07ffc11e5270).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
