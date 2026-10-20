export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      agent_calls: {
        Row: {
          agent_id: string
          created_at: string
          idempotency_key: string
          org_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          idempotency_key: string
          org_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          idempotency_key?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_calls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_calls_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_capabilities: {
        Row: {
          agent_id: string
          capability: string
          created_at: string
          granted_by: string
          id: string
          org_id: string
        }
        Insert: {
          agent_id: string
          capability: string
          created_at?: string
          granted_by: string
          id?: string
          org_id: string
        }
        Update: {
          agent_id?: string
          capability?: string
          created_at?: string
          granted_by?: string
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_capabilities_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_capabilities_org_agent_fk"
            columns: ["org_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "agent_capabilities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_connections: {
        Row: {
          agent_id: string | null
          approved_by: string | null
          client_name: string
          created_at: string
          device_hash: string
          expires_at: string
          last_polled_at: string | null
          org_id: string | null
          scopes: string[]
          status: string
          user_code: string
        }
        Insert: {
          agent_id?: string | null
          approved_by?: string | null
          client_name: string
          created_at?: string
          device_hash: string
          expires_at?: string
          last_polled_at?: string | null
          org_id?: string | null
          scopes: string[]
          status?: string
          user_code: string
        }
        Update: {
          agent_id?: string | null
          approved_by?: string | null
          client_name?: string
          created_at?: string
          device_hash?: string
          expires_at?: string
          last_polled_at?: string | null
          org_id?: string | null
          scopes?: string[]
          status?: string
          user_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_connections_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          created_at: string
          credential_expires_at: string | null
          description: string | null
          id: string
          last_used_at: string | null
          name: string
          org_id: string
          owner_id: string
          slug: string
          status: Database["public"]["Enums"]["lifecycle_status"]
          token_hash: string | null
          token_prefix: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          credential_expires_at?: string | null
          description?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          org_id: string
          owner_id: string
          slug: string
          status?: Database["public"]["Enums"]["lifecycle_status"]
          token_hash?: string | null
          token_prefix?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          credential_expires_at?: string | null
          description?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          org_id?: string
          owner_id?: string
          slug?: string
          status?: Database["public"]["Enums"]["lifecycle_status"]
          token_hash?: string | null
          token_prefix?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          action: string
          approval_scope: Json
          approver_id: string | null
          consumed_at: string | null
          consumed_execution_id: string | null
          created_at: string
          decided_at: string | null
          decision_token: string
          execution_result: string | null
          expires_at: string
          id: string
          idempotency_key: string | null
          intent_id: string | null
          org_id: string
          original_execution_id: string | null
          payload: Json
          policy_id: string | null
          policy_revalidated_at: string | null
          policy_version: number | null
          reason: string | null
          request_id: string | null
          requester_id: string
          risk: Database["public"]["Enums"]["severity"]
          single_use: boolean
          status: string
          target: string | null
        }
        Insert: {
          action: string
          approval_scope?: Json
          approver_id?: string | null
          consumed_at?: string | null
          consumed_execution_id?: string | null
          created_at?: string
          decided_at?: string | null
          decision_token?: string
          execution_result?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string | null
          intent_id?: string | null
          org_id: string
          original_execution_id?: string | null
          payload?: Json
          policy_id?: string | null
          policy_revalidated_at?: string | null
          policy_version?: number | null
          reason?: string | null
          request_id?: string | null
          requester_id: string
          risk?: Database["public"]["Enums"]["severity"]
          single_use?: boolean
          status?: string
          target?: string | null
        }
        Update: {
          action?: string
          approval_scope?: Json
          approver_id?: string | null
          consumed_at?: string | null
          consumed_execution_id?: string | null
          created_at?: string
          decided_at?: string | null
          decision_token?: string
          execution_result?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string | null
          intent_id?: string | null
          org_id?: string
          original_execution_id?: string | null
          payload?: Json
          policy_id?: string | null
          policy_revalidated_at?: string | null
          policy_version?: number | null
          reason?: string | null
          request_id?: string | null
          requester_id?: string
          risk?: Database["public"]["Enums"]["severity"]
          single_use?: boolean
          status?: string
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_org_request_fk"
            columns: ["org_id", "request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "approvals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          decision: Database["public"]["Enums"]["gov_action"] | null
          id: string
          metadata: Json
          org_id: string
          policy_id: string | null
          policy_version: number | null
          request_id: string | null
          resource: string
          resource_id: string | null
          result: string
          risk: Database["public"]["Enums"]["severity"]
          source: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          decision?: Database["public"]["Enums"]["gov_action"] | null
          id?: string
          metadata?: Json
          org_id: string
          policy_id?: string | null
          policy_version?: number | null
          request_id?: string | null
          resource: string
          resource_id?: string | null
          result?: string
          risk?: Database["public"]["Enums"]["severity"]
          source?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          decision?: Database["public"]["Enums"]["gov_action"] | null
          id?: string
          metadata?: Json
          org_id?: string
          policy_id?: string | null
          policy_version?: number | null
          request_id?: string | null
          resource?: string
          resource_id?: string | null
          result?: string
          risk?: Database["public"]["Enums"]["severity"]
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          active: boolean
          agent_limit: number | null
          annual_price_usd: number | null
          audit_retention_days: number | null
          mcp_server_limit: number | null
          monthly_price_usd: number | null
          monthly_request_limit: number | null
          name: string
          plan_key: string
          seat_limit: number | null
        }
        Insert: {
          active?: boolean
          agent_limit?: number | null
          annual_price_usd?: number | null
          audit_retention_days?: number | null
          mcp_server_limit?: number | null
          monthly_price_usd?: number | null
          monthly_request_limit?: number | null
          name: string
          plan_key: string
          seat_limit?: number | null
        }
        Update: {
          active?: boolean
          agent_limit?: number | null
          annual_price_usd?: number | null
          audit_retention_days?: number | null
          mcp_server_limit?: number | null
          monthly_price_usd?: number | null
          monthly_request_limit?: number | null
          name?: string
          plan_key?: string
          seat_limit?: number | null
        }
        Relationships: []
      }
      billing_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          last_event_at: string | null
          last_event_id: string | null
          org_id: string
          plan_key: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          last_event_at?: string | null
          last_event_id?: string | null
          org_id: string
          plan_key: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          last_event_at?: string | null
          last_event_id?: string | null
          org_id?: string
          plan_key?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_subscriptions_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["plan_key"]
          },
        ]
      }
      budgets: {
        Row: {
          action_on_exceed: Database["public"]["Enums"]["gov_action"]
          created_at: string
          id: string
          limit_usd: number
          name: string
          org_id: string
          period: string
          scope: string
          scope_ref: string | null
          status: Database["public"]["Enums"]["lifecycle_status"]
        }
        Insert: {
          action_on_exceed?: Database["public"]["Enums"]["gov_action"]
          created_at?: string
          id?: string
          limit_usd: number
          name: string
          org_id: string
          period?: string
          scope?: string
          scope_ref?: string | null
          status?: Database["public"]["Enums"]["lifecycle_status"]
        }
        Update: {
          action_on_exceed?: Database["public"]["Enums"]["gov_action"]
          created_at?: string
          id?: string
          limit_usd?: number
          name?: string
          org_id?: string
          period?: string
          scope?: string
          scope_ref?: string | null
          status?: Database["public"]["Enums"]["lifecycle_status"]
        }
        Relationships: [
          {
            foreignKeyName: "budgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      device_ai_inventory: {
        Row: {
          active: boolean
          agent_id: string
          app_name: string
          created_at: string
          device_fingerprint: string
          device_label: string | null
          first_seen: string
          id: string
          last_seen: string
          observation_key: string
          observation_type: string
          org_id: string
          platform: string
          vendor: string | null
          version: string | null
        }
        Insert: {
          active?: boolean
          agent_id: string
          app_name: string
          created_at?: string
          device_fingerprint: string
          device_label?: string | null
          first_seen?: string
          id?: string
          last_seen?: string
          observation_key: string
          observation_type: string
          org_id: string
          platform: string
          vendor?: string | null
          version?: string | null
        }
        Update: {
          active?: boolean
          agent_id?: string
          app_name?: string
          created_at?: string
          device_fingerprint?: string
          device_label?: string | null
          first_seen?: string
          id?: string
          last_seen?: string
          observation_key?: string
          observation_type?: string
          org_id?: string
          platform?: string
          vendor?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_ai_inventory_org_agent_fk"
            columns: ["org_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "device_ai_inventory_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_deliveries: {
        Row: {
          created_at: string
          id: string
          mailbox_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id: string
          mailbox_id: string
          status: string
        }
        Update: {
          created_at?: string
          id?: string
          mailbox_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_mailbox_id_fkey"
            columns: ["mailbox_id"]
            isOneToOne: false
            referencedRelation: "email_mailboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      email_mailboxes: {
        Row: {
          email: string
          id: string
          last_operation_at: string | null
          org_id: string
          secret_id: string
          user_id: string
          verified_at: string
        }
        Insert: {
          email: string
          id?: string
          last_operation_at?: string | null
          org_id: string
          secret_id: string
          user_id: string
          verified_at?: string
        }
        Update: {
          email?: string
          id?: string
          last_operation_at?: string | null
          org_id?: string
          secret_id?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_mailboxes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_events: {
        Row: {
          actor_type: string
          agent_id: string | null
          created_at: string
          detail: Json
          execution_id: string
          id: number
          org_id: string
          request_id: string | null
          stage: string
          status: string
          summary: string
        }
        Insert: {
          actor_type: string
          agent_id?: string | null
          created_at?: string
          detail?: Json
          execution_id: string
          id?: number
          org_id: string
          request_id?: string | null
          stage: string
          status: string
          summary: string
        }
        Update: {
          actor_type?: string
          agent_id?: string | null
          created_at?: string
          detail?: Json
          execution_id?: string
          id?: number
          org_id?: string
          request_id?: string | null
          stage?: string
          status?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_events_agent_fk"
            columns: ["org_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "execution_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_events_request_fk"
            columns: ["org_id", "request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      gateway_reservations: {
        Row: {
          created_at: string
          idempotency_key: string
          org_id: string
          reserved_usd: number
          settled: boolean
        }
        Insert: {
          created_at?: string
          idempotency_key: string
          org_id: string
          reserved_usd: number
          settled?: boolean
        }
        Update: {
          created_at?: string
          idempotency_key?: string
          org_id?: string
          reserved_usd?: number
          settled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "gateway_reservations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_audit_events: {
        Row: {
          actor_id: string | null
          agent_id: string | null
          application_id: string | null
          attributes: Json
          chain_position: number
          created_at: string
          decision: string
          decision_engine_version: string
          enforcement_point: string
          evaluated_context_hash: string
          event_hash: string
          event_id: string
          event_timestamp: string
          execution_id: string
          intent_id: string
          org_id: string
          parent_event_id: string | null
          parent_span_id: string | null
          policy_id: string | null
          policy_version: number | null
          previous_event_hash: string | null
          reason: string
          rule_id: string | null
          span_id: string
          trace_id: string
        }
        Insert: {
          actor_id?: string | null
          agent_id?: string | null
          application_id?: string | null
          attributes?: Json
          chain_position: number
          created_at?: string
          decision: string
          decision_engine_version: string
          enforcement_point: string
          evaluated_context_hash: string
          event_hash: string
          event_id: string
          event_timestamp: string
          execution_id: string
          intent_id: string
          org_id: string
          parent_event_id?: string | null
          parent_span_id?: string | null
          policy_id?: string | null
          policy_version?: number | null
          previous_event_hash?: string | null
          reason: string
          rule_id?: string | null
          span_id: string
          trace_id: string
        }
        Update: {
          actor_id?: string | null
          agent_id?: string | null
          application_id?: string | null
          attributes?: Json
          chain_position?: number
          created_at?: string
          decision?: string
          decision_engine_version?: string
          enforcement_point?: string
          evaluated_context_hash?: string
          event_hash?: string
          event_id?: string
          event_timestamp?: string
          execution_id?: string
          intent_id?: string
          org_id?: string
          parent_event_id?: string | null
          parent_span_id?: string | null
          policy_id?: string | null
          policy_version?: number | null
          previous_event_hash?: string | null
          reason?: string
          rule_id?: string | null
          span_id?: string
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_audit_events_org_id_execution_id_fkey"
            columns: ["org_id", "execution_id"]
            isOneToOne: false
            referencedRelation: "governed_executions"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "governance_audit_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_audit_events_org_id_intent_id_fkey"
            columns: ["org_id", "intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      governance_audit_heads: {
        Row: {
          chain_position: number
          event_hash: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          chain_position?: number
          event_hash?: string | null
          org_id: string
          updated_at?: string
        }
        Update: {
          chain_position?: number
          event_hash?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "governance_audit_heads_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_risk_thresholds: {
        Row: {
          created_at: string
          id: string
          max_violations: number | null
          org_id: string
          policy_id: string | null
          policy_version: number | null
          severity: Database["public"]["Enums"]["severity"]
          status: string
          terminate_at_score: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          max_violations?: number | null
          org_id: string
          policy_id?: string | null
          policy_version?: number | null
          severity: Database["public"]["Enums"]["severity"]
          status?: string
          terminate_at_score?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          max_violations?: number | null
          org_id?: string
          policy_id?: string | null
          policy_version?: number | null
          severity?: Database["public"]["Enums"]["severity"]
          status?: string
          terminate_at_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "governance_risk_thresholds_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      governed_executions: {
        Row: {
          accumulated_risk_score: number
          actor_id: string | null
          actor_type: string
          agent_id: string | null
          application_id: string | null
          data_classification: string
          destination_sensitivity: string
          finalized_at: string | null
          governance_outcome: string | null
          id: string
          intent_id: string
          org_id: string
          policy_evasion_indicators: Json
          severity: Database["public"]["Enums"]["severity"]
          started_at: string
          tool_sensitivity: string
          trace_id: string
          violation_count: number
          workflow_outcome: string | null
        }
        Insert: {
          accumulated_risk_score?: number
          actor_id?: string | null
          actor_type: string
          agent_id?: string | null
          application_id?: string | null
          data_classification?: string
          destination_sensitivity?: string
          finalized_at?: string | null
          governance_outcome?: string | null
          id?: string
          intent_id: string
          org_id: string
          policy_evasion_indicators?: Json
          severity?: Database["public"]["Enums"]["severity"]
          started_at?: string
          tool_sensitivity?: string
          trace_id: string
          violation_count?: number
          workflow_outcome?: string | null
        }
        Update: {
          accumulated_risk_score?: number
          actor_id?: string | null
          actor_type?: string
          agent_id?: string | null
          application_id?: string | null
          data_classification?: string
          destination_sensitivity?: string
          finalized_at?: string | null
          governance_outcome?: string | null
          id?: string
          intent_id?: string
          org_id?: string
          policy_evasion_indicators?: Json
          severity?: Database["public"]["Enums"]["severity"]
          started_at?: string
          tool_sensitivity?: string
          trace_id?: string
          violation_count?: number
          workflow_outcome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "governed_executions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governed_executions_org_id_intent_id_fkey"
            columns: ["org_id", "intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      intent_lineage_events: {
        Row: {
          actor_id: string | null
          child_intent_id: string
          confidence: number
          created_at: string
          event_type: string
          evidence: Json
          id: string
          org_id: string
          parent_intent_id: string
          reason: string
          supersedes_event_id: string | null
        }
        Insert: {
          actor_id?: string | null
          child_intent_id: string
          confidence: number
          created_at?: string
          event_type: string
          evidence?: Json
          id?: string
          org_id: string
          parent_intent_id: string
          reason: string
          supersedes_event_id?: string | null
        }
        Update: {
          actor_id?: string | null
          child_intent_id?: string
          confidence?: number
          created_at?: string
          event_type?: string
          evidence?: Json
          id?: string
          org_id?: string
          parent_intent_id?: string
          reason?: string
          supersedes_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intent_lineage_events_org_id_child_intent_id_fkey"
            columns: ["org_id", "child_intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "intent_lineage_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intent_lineage_events_org_id_parent_intent_id_fkey"
            columns: ["org_id", "parent_intent_id"]
            isOneToOne: false
            referencedRelation: "intents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "intent_lineage_events_supersedes_event_id_fkey"
            columns: ["supersedes_event_id"]
            isOneToOne: false
            referencedRelation: "intent_lineage_events"
            referencedColumns: ["id"]
          },
        ]
      }
      intents: {
        Row: {
          accumulated_risk_score: number
          application_id: string | null
          created_at: string
          created_by_actor_id: string | null
          id: string
          lineage_context: Json
          objective_fingerprint: string
          objective_summary: string | null
          org_id: string
          quarantine_reason: string | null
          quarantined_at: string | null
          risk_state: Json
          severity: Database["public"]["Enums"]["severity"]
          status: string
          violation_count: number
        }
        Insert: {
          accumulated_risk_score?: number
          application_id?: string | null
          created_at?: string
          created_by_actor_id?: string | null
          id?: string
          lineage_context?: Json
          objective_fingerprint: string
          objective_summary?: string | null
          org_id: string
          quarantine_reason?: string | null
          quarantined_at?: string | null
          risk_state?: Json
          severity?: Database["public"]["Enums"]["severity"]
          status?: string
          violation_count?: number
        }
        Update: {
          accumulated_risk_score?: number
          application_id?: string | null
          created_at?: string
          created_by_actor_id?: string | null
          id?: string
          lineage_context?: Json
          objective_fingerprint?: string
          objective_summary?: string | null
          org_id?: string
          quarantine_reason?: string | null
          quarantined_at?: string | null
          risk_state?: Json
          severity?: Database["public"]["Enums"]["severity"]
          status?: string
          violation_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "intents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_servers: {
        Row: {
          auth_mode: string
          created_at: string
          created_by: string
          id: string
          name: string
          org_id: string
          status: Database["public"]["Enums"]["lifecycle_status"]
          transport: string
          updated_at: string
          url: string
        }
        Insert: {
          auth_mode?: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          org_id: string
          status?: Database["public"]["Enums"]["lifecycle_status"]
          transport?: string
          updated_at?: string
          url: string
        }
        Update: {
          auth_mode?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          org_id?: string
          status?: Database["public"]["Enums"]["lifecycle_status"]
          transport?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_servers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_tool_grants: {
        Row: {
          agent_id: string
          created_at: string
          granted_by: string
          id: string
          org_id: string
          requires_approval: boolean
          tool_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          granted_by: string
          id?: string
          org_id: string
          requires_approval?: boolean
          tool_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          granted_by?: string
          id?: string
          org_id?: string
          requires_approval?: boolean
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_tool_grants_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_tool_grants_org_agent_fk"
            columns: ["org_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mcp_tool_grants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_tool_grants_org_tool_fk"
            columns: ["org_id", "tool_id"]
            isOneToOne: false
            referencedRelation: "mcp_tools"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mcp_tool_grants_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "mcp_tools"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_tools: {
        Row: {
          created_at: string
          definition_hash: string | null
          description: string | null
          id: string
          input_schema: Json
          org_id: string
          remote_name: string | null
          required_capability: string
          risk: Database["public"]["Enums"]["severity"]
          server_id: string | null
          status: Database["public"]["Enums"]["lifecycle_status"]
          tool_name: string
        }
        Insert: {
          created_at?: string
          definition_hash?: string | null
          description?: string | null
          id?: string
          input_schema?: Json
          org_id: string
          remote_name?: string | null
          required_capability: string
          risk?: Database["public"]["Enums"]["severity"]
          server_id?: string | null
          status?: Database["public"]["Enums"]["lifecycle_status"]
          tool_name: string
        }
        Update: {
          created_at?: string
          definition_hash?: string | null
          description?: string | null
          id?: string
          input_schema?: Json
          org_id?: string
          remote_name?: string | null
          required_capability?: string
          risk?: Database["public"]["Enums"]["severity"]
          server_id?: string | null
          status?: Database["public"]["Enums"]["lifecycle_status"]
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_tools_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_tools_org_server_fk"
            columns: ["org_id", "server_id"]
            isOneToOne: false
            referencedRelation: "mcp_servers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "mcp_tools_server_id_fkey"
            columns: ["server_id"]
            isOneToOne: false
            referencedRelation: "mcp_servers"
            referencedColumns: ["id"]
          },
        ]
      }
      models: {
        Row: {
          classification: string
          context_window: number | null
          created_at: string
          display_name: string
          id: string
          input_cost_per_1k: number
          model_key: string
          org_id: string
          output_cost_per_1k: number
          provider_id: string
          status: Database["public"]["Enums"]["lifecycle_status"]
        }
        Insert: {
          classification?: string
          context_window?: number | null
          created_at?: string
          display_name: string
          id?: string
          input_cost_per_1k?: number
          model_key: string
          org_id: string
          output_cost_per_1k?: number
          provider_id: string
          status?: Database["public"]["Enums"]["lifecycle_status"]
        }
        Update: {
          classification?: string
          context_window?: number | null
          created_at?: string
          display_name?: string
          id?: string
          input_cost_per_1k?: number
          model_key?: string
          org_id?: string
          output_cost_per_1k?: number
          provider_id?: string
          status?: Database["public"]["Enums"]["lifecycle_status"]
        }
        Relationships: [
          {
            foreignKeyName: "models_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "models_org_provider_fk"
            columns: ["org_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "models_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      org_ai_controls: {
        Row: {
          agents_enabled: boolean
          console_enabled: boolean
          execution_enabled: boolean
          max_request_cost_usd: number | null
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agents_enabled?: boolean
          console_enabled?: boolean
          execution_enabled?: boolean
          max_request_cost_usd?: number | null
          org_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agents_enabled?: boolean
          console_enabled?: boolean
          execution_enabled?: boolean
          max_request_cost_usd?: number | null
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_ai_controls_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          status?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      paddle_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          occurred_at: string
          org_id: string
          processed_at: string
          provider_subscription_id: string
          result: string
        }
        Insert: {
          event_id: string
          event_type: string
          occurred_at: string
          org_id: string
          processed_at?: string
          provider_subscription_id: string
          result: string
        }
        Update: {
          event_id?: string
          event_type?: string
          occurred_at?: string
          org_id?: string
          processed_at?: string
          provider_subscription_id?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "paddle_webhook_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          action: Database["public"]["Enums"]["gov_action"]
          conditions: Json
          created_at: string
          created_by: string
          description: string | null
          effective_from: string
          id: string
          name: string
          org_id: string
          priority: number
          scope: string
          status: Database["public"]["Enums"]["lifecycle_status"]
          updated_at: string
          version: number
        }
        Insert: {
          action: Database["public"]["Enums"]["gov_action"]
          conditions?: Json
          created_at?: string
          created_by: string
          description?: string | null
          effective_from?: string
          id?: string
          name: string
          org_id: string
          priority?: number
          scope?: string
          status?: Database["public"]["Enums"]["lifecycle_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          action?: Database["public"]["Enums"]["gov_action"]
          conditions?: Json
          created_at?: string
          created_by?: string
          description?: string | null
          effective_from?: string
          id?: string
          name?: string
          org_id?: string
          priority?: number
          scope?: string
          status?: Database["public"]["Enums"]["lifecycle_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_versions: {
        Row: {
          change_note: string | null
          created_at: string
          created_by: string
          id: string
          org_id: string
          policy_id: string
          snapshot: Json
          version: number
        }
        Insert: {
          change_note?: string | null
          created_at?: string
          created_by: string
          id?: string
          org_id: string
          policy_id: string
          snapshot: Json
          version: number
        }
        Update: {
          change_note?: string | null
          created_at?: string
          created_by?: string
          id?: string
          org_id?: string
          policy_id?: string
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "policy_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_versions_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      providers: {
        Row: {
          created_at: string
          credential_state: string
          id: string
          name: string
          org_id: string
          region: string | null
          status: Database["public"]["Enums"]["lifecycle_status"]
          vendor: string
        }
        Insert: {
          created_at?: string
          credential_state?: string
          id?: string
          name: string
          org_id: string
          region?: string | null
          status?: Database["public"]["Enums"]["lifecycle_status"]
          vendor: string
        }
        Update: {
          created_at?: string
          credential_state?: string
          id?: string
          name?: string
          org_id?: string
          region?: string | null
          status?: Database["public"]["Enums"]["lifecycle_status"]
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "providers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          actor_type: string
          agent_id: string | null
          cost_usd: number
          created_at: string
          decision: Database["public"]["Enums"]["gov_action"]
          id: string
          idempotency_key: string | null
          input_tokens: number
          latency_ms: number
          matched_rules: Json
          model: string | null
          org_id: string
          output_tokens: number
          policy_id: string | null
          policy_version: number | null
          prompt_preview: string | null
          provider: string | null
          provider_request_id: string | null
          provider_response_id: string | null
          reason: string | null
          redacted: boolean
          response_preview: string | null
          source: string
          status: string
          user_id: string | null
        }
        Insert: {
          actor_type?: string
          agent_id?: string | null
          cost_usd?: number
          created_at?: string
          decision: Database["public"]["Enums"]["gov_action"]
          id?: string
          idempotency_key?: string | null
          input_tokens?: number
          latency_ms?: number
          matched_rules?: Json
          model?: string | null
          org_id: string
          output_tokens?: number
          policy_id?: string | null
          policy_version?: number | null
          prompt_preview?: string | null
          provider?: string | null
          provider_request_id?: string | null
          provider_response_id?: string | null
          reason?: string | null
          redacted?: boolean
          response_preview?: string | null
          source?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          actor_type?: string
          agent_id?: string | null
          cost_usd?: number
          created_at?: string
          decision?: Database["public"]["Enums"]["gov_action"]
          id?: string
          idempotency_key?: string | null
          input_tokens?: number
          latency_ms?: number
          matched_rules?: Json
          model?: string | null
          org_id?: string
          output_tokens?: number
          policy_id?: string | null
          policy_version?: number | null
          prompt_preview?: string | null
          provider?: string | null
          provider_request_id?: string | null
          provider_response_id?: string | null
          reason?: string | null
          redacted?: boolean
          response_preview?: string | null
          source?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      security_findings: {
        Row: {
          affected_resource: string | null
          category: string
          confidence: number | null
          created_at: string
          detection_source: string
          evidence: Json
          id: string
          org_id: string
          remediation: string | null
          request_id: string | null
          severity: Database["public"]["Enums"]["severity"]
          status: string
          title: string
        }
        Insert: {
          affected_resource?: string | null
          category: string
          confidence?: number | null
          created_at?: string
          detection_source?: string
          evidence?: Json
          id?: string
          org_id: string
          remediation?: string | null
          request_id?: string | null
          severity: Database["public"]["Enums"]["severity"]
          status?: string
          title: string
        }
        Update: {
          affected_resource?: string | null
          category?: string
          confidence?: number | null
          created_at?: string
          detection_source?: string
          evidence?: Json
          id?: string
          org_id?: string
          remediation?: string | null
          request_id?: string | null
          severity?: Database["public"]["Enums"]["severity"]
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_findings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_findings_org_request_fk"
            columns: ["org_id", "request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "security_findings_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_invocations: {
        Row: {
          agent_id: string
          created_at: string
          decision: string
          id: string
          idempotency_key: string
          org_id: string
          reason: string | null
          status: string
          tool_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          decision?: string
          id?: string
          idempotency_key: string
          org_id: string
          reason?: string | null
          status?: string
          tool_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          decision?: string
          id?: string
          idempotency_key?: string
          org_id?: string
          reason?: string | null
          status?: string
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_invocations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_invocations_org_agent_fk"
            columns: ["org_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "tool_invocations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_invocations_org_tool_fk"
            columns: ["org_id", "tool_id"]
            isOneToOne: false
            referencedRelation: "mcp_tools"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "tool_invocations_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "mcp_tools"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      nexora_agent_finding: {
        Args: {
          p_agent: string
          p_finding: string
          p_org: string
          p_status: string
        }
        Returns: undefined
      }
      nexora_agent_usage: {
        Args: { p_org: string }
        Returns: {
          agent_id: string
          cost_usd: number
          input_tokens: number
          last_used_at: string
          output_tokens: number
          request_count: number
        }[]
      }
      nexora_append_governance_event: {
        Args: {
          p_actor_id: string
          p_agent_id: string
          p_application_id: string
          p_attributes: Json
          p_decision: string
          p_decision_engine_version: string
          p_enforcement_point: string
          p_evaluated_context_hash: string
          p_event_hash: string
          p_event_id: string
          p_event_timestamp: string
          p_execution_id: string
          p_expected_previous_hash: string
          p_intent_id: string
          p_org: string
          p_parent_event_id: string
          p_parent_span_id: string
          p_policy_id: string
          p_policy_version: number
          p_reason: string
          p_rule_id: string
          p_span_id: string
          p_trace_id: string
        }
        Returns: number
      }
      nexora_apply_paddle_event: {
        Args: {
          p_cancel_at_period_end: boolean
          p_customer: string
          p_event_id: string
          p_event_type: string
          p_occurred_at: string
          p_org: string
          p_period_end: string
          p_period_start: string
          p_plan_key: string
          p_signed_identity: boolean
          p_status: string
          p_subscription: string
        }
        Returns: Json
      }
      nexora_billing_usage: { Args: { p_org: string }; Returns: Json }
      nexora_claim_agent: {
        Args: {
          p_actor?: string
          p_agent: string
          p_hash?: string
          p_key: string
        }
        Returns: Json
      }
      nexora_consent_connection: {
        Args: {
          p_actor: string
          p_allow: boolean
          p_code: string
          p_org: string
          p_scopes: string[]
        }
        Returns: string
      }
      nexora_decide_approval: {
        Args: {
          p_actor: string
          p_decision: string
          p_id: string
          p_org: string
        }
        Returns: Json
      }
      nexora_exchange_connection: {
        Args: { p_hash: string; p_prefix: string; p_token_hash: string }
        Returns: Json
      }
      nexora_mailbox: {
        Args: {
          p_action: string
          p_actor: string
          p_email?: string
          p_org: string
          p_password?: string
          p_request?: string
        }
        Returns: Json
      }
      nexora_monthly_spend: { Args: { p_org: string }; Returns: number }
      nexora_record_execution_risk: {
        Args: {
          p_evasion_indicator: string
          p_execution: string
          p_intent: string
          p_org: string
          p_policy: string
          p_policy_version: number
          p_score: number
          p_severity: Database["public"]["Enums"]["severity"]
        }
        Returns: Json
      }
      nexora_reserve: {
        Args: { p_cost: number; p_key: string; p_org: string }
        Returns: Json
      }
      nexora_revoke_connection: {
        Args: { p_actor: string; p_agent: string; p_org: string }
        Returns: undefined
      }
      nexora_rotate_agent: {
        Args: {
          p_actor: string
          p_agent: string
          p_hash: string
          p_org: string
          p_prefix: string
        }
        Returns: undefined
      }
      nexora_settle: {
        Args: { p_key: string; p_org: string }
        Returns: undefined
      }
      nexora_start_connection: {
        Args: {
          p_code: string
          p_hash: string
          p_name: string
          p_scopes: string[]
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "platform_admin"
        | "org_admin"
        | "security_admin"
        | "governance_admin"
        | "agent_admin"
        | "security_analyst"
        | "auditor"
        | "developer"
        | "viewer"
      gov_action: "ALLOW" | "LOG" | "REDACT" | "REQUIRE_APPROVAL" | "BLOCK"
      lifecycle_status: "draft" | "active" | "suspended" | "archived"
      severity: "critical" | "high" | "medium" | "low" | "info"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "platform_admin",
        "org_admin",
        "security_admin",
        "governance_admin",
        "agent_admin",
        "security_analyst",
        "auditor",
        "developer",
        "viewer",
      ],
      gov_action: ["ALLOW", "LOG", "REDACT", "REQUIRE_APPROVAL", "BLOCK"],
      lifecycle_status: ["draft", "active", "suspended", "archived"],
      severity: ["critical", "high", "medium", "low", "info"],
    },
  },
} as const
