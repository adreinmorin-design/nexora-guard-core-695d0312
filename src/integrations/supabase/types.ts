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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      approvals: {
        Row: {
          action: string
          approver_id: string | null
          created_at: string
          decided_at: string | null
          execution_result: string | null
          expires_at: string
          id: string
          org_id: string
          payload: Json
          policy_id: string | null
          policy_version: number | null
          reason: string | null
          request_id: string | null
          requester_id: string
          risk: Database["public"]["Enums"]["severity"]
          status: string
          target: string | null
        }
        Insert: {
          action: string
          approver_id?: string | null
          created_at?: string
          decided_at?: string | null
          execution_result?: string | null
          expires_at?: string
          id?: string
          org_id: string
          payload?: Json
          policy_id?: string | null
          policy_version?: number | null
          reason?: string | null
          request_id?: string | null
          requester_id: string
          risk?: Database["public"]["Enums"]["severity"]
          status?: string
          target?: string | null
        }
        Update: {
          action?: string
          approver_id?: string | null
          created_at?: string
          decided_at?: string | null
          execution_result?: string | null
          expires_at?: string
          id?: string
          org_id?: string
          payload?: Json
          policy_id?: string | null
          policy_version?: number | null
          reason?: string | null
          request_id?: string | null
          requester_id?: string
          risk?: Database["public"]["Enums"]["severity"]
          status?: string
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
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
            foreignKeyName: "models_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
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
          cost_usd: number
          created_at: string
          decision: Database["public"]["Enums"]["gov_action"]
          id: string
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
          reason: string | null
          redacted: boolean
          response_preview: string | null
          source: string
          status: string
          user_id: string | null
        }
        Insert: {
          actor_type?: string
          cost_usd?: number
          created_at?: string
          decision: Database["public"]["Enums"]["gov_action"]
          id?: string
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
          reason?: string | null
          redacted?: boolean
          response_preview?: string | null
          source?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          actor_type?: string
          cost_usd?: number
          created_at?: string
          decision?: Database["public"]["Enums"]["gov_action"]
          id?: string
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
          reason?: string | null
          redacted?: boolean
          response_preview?: string | null
          source?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
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
            foreignKeyName: "security_findings_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_org_role: {
        Args: {
          _org: string
          _roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: boolean
      }
      is_org_member: { Args: { _org: string }; Returns: boolean }
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
