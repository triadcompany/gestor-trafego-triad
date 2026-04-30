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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      app_config: {
        Row: {
          id: string
          key: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          value: string
        }
        Update: {
          id?: string
          key?: string
          value?: string
        }
        Relationships: []
      }
      client_notes: {
        Row: {
          id: string
          client_id: string
          content: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          content: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          content?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      report_log: {
        Row: {
          id: string
          client_id: string
          period_type: string
          period_start: string
          status: string
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          period_type: string
          period_start: string
          status?: string
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          period_type?: string
          period_start?: string
          status?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          cpl_max: number
          cpl_min: number
          created_at: string
          id: string
          meta_ad_account_id: string
          meta_balance: number | null
          meta_page_id: string | null
          meta_whatsapp_number: string | null
          monthly_budget: number | null
          name: string
          payment_method: string
          pix_active: boolean
          pix_cycle: string | null
          pix_reference_day: number | null
          segment: string
        }
        Insert: {
          active?: boolean
          cpl_max?: number
          cpl_min?: number
          created_at?: string
          id?: string
          meta_ad_account_id: string
          meta_balance?: number | null
          meta_page_id?: string | null
          meta_whatsapp_number?: string | null
          monthly_budget?: number | null
          name: string
          payment_method?: string
          pix_active?: boolean
          pix_cycle?: string | null
          pix_reference_day?: number | null
          segment?: string
        }
        Update: {
          active?: boolean
          cpl_max?: number
          cpl_min?: number
          created_at?: string
          id?: string
          meta_ad_account_id?: string
          meta_balance?: number | null
          meta_page_id?: string | null
          meta_whatsapp_number?: string | null
          monthly_budget?: number | null
          name?: string
          payment_method?: string
          pix_active?: boolean
          pix_cycle?: string | null
          pix_reference_day?: number | null
          segment?: string
        }
        Relationships: []
      }
      metrics_daily: {
        Row: {
          client_id: string
          cpl: number | null
          date: string
          id: string
          leads: number
          spend: number
          updated_at: string
        }
        Insert: {
          client_id: string
          cpl?: number | null
          date: string
          id?: string
          leads?: number
          spend?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          cpl?: number | null
          date?: string
          id?: string
          leads?: number
          spend?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "metrics_daily_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_log: {
        Row: {
          client_id: string | null
          id: string
          message: string | null
          status: string
          synced_at: string
        }
        Insert: {
          client_id?: string | null
          id?: string
          message?: string | null
          status: string
          synced_at?: string
        }
        Update: {
          client_id?: string | null
          id?: string
          message?: string | null
          status?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_templates: {
        Row: {
          id: string
          name: string
          greeting: string | null
          pre_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          greeting?: string | null
          pre_message?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          greeting?: string | null
          pre_message?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          full_name: string
          created_at: string
        }
        Insert: {
          id: string
          full_name: string
          created_at?: string
        }
        Update: {
          full_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          id: string
          title: string
          status: string
          due_date: string | null
          client_id: string | null
          assigned_to: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          status?: string
          due_date?: string | null
          client_id?: string | null
          assigned_to?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          title?: string
          status?: string
          due_date?: string | null
          client_id?: string | null
          assigned_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_conversations: {
        Row: {
          id: string
          title: string | null
          created_by: string | null
          created_at: string
          last_msg_at: string
        }
        Insert: {
          id?: string
          title?: string | null
          created_by?: string | null
          created_at?: string
          last_msg_at?: string
        }
        Update: {
          title?: string | null
          last_msg_at?: string
        }
        Relationships: []
      }
      agent_messages: {
        Row: {
          id: string
          conversation_id: string
          role: string
          content: string | null
          tool_calls: Json | null
          tool_results: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          role: string
          content?: string | null
          tool_calls?: Json | null
          tool_results?: Json | null
          created_at?: string
        }
        Update: {
          content?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "agent_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_organization_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
