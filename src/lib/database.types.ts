export type ClientSegment = "popular" | "premium";
export type ClientStatus = "on-target" | "attention" | "critical" | "no-data";
export type SyncStatus = "success" | "error";
export type PeriodType = "semanal" | "mensal";
export type ReportStatus = "pendente" | "enviado";
export type PixCycle = "semanal" | "quinzenal" | "mensal";
export type TaskStatus = "pendente" | "em_andamento" | "concluida";

export interface Database {
  public: {
    Tables: {
      clients: {
        Row: {
          id: string;
          name: string;
          meta_ad_account_id: string;
          meta_page_id: string | null;
          segment: ClientSegment;
          cpl_min: number;
          cpl_max: number;
          active: boolean;
          created_at: string;
          meta_balance: number | null;
          payment_method: "pix" | "cartao";
          monthly_budget: number | null;
          pix_cycle: PixCycle | null;
          pix_reference_day: number | null;
          pix_active: boolean;
        };
        Insert: Omit<Database["public"]["Tables"]["clients"]["Row"], "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["clients"]["Insert"]>;
      };
      metrics_daily: {
        Row: {
          id: string;
          client_id: string;
          date: string;
          spend: number;
          leads: number;
          cpl: number | null;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["metrics_daily"]["Row"], "id" | "updated_at"> & {
          id?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["metrics_daily"]["Insert"]>;
      };
      sync_log: {
        Row: {
          id: string;
          client_id: string | null;
          synced_at: string;
          status: SyncStatus;
          message: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["sync_log"]["Row"], "id" | "synced_at"> & {
          id?: string;
          synced_at?: string;
        };
        Update: never;
      };
      app_config: {
        Row: {
          id: string;
          key: string;
          value: string;
        };
        Insert: Omit<Database["public"]["Tables"]["app_config"]["Row"], "id"> & { id?: string };
        Update: Partial<Database["public"]["Tables"]["app_config"]["Insert"]>;
      };
      client_notes: {
        Row: {
          id: string;
          client_id: string;
          content: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          content: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          content?: string;
          updated_at?: string;
        };
      };
      report_log: {
        Row: {
          id: string;
          client_id: string;
          period_type: PeriodType;
          period_start: string;
          status: ReportStatus;
          sent_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          period_type: PeriodType;
          period_start: string;
          status?: ReportStatus;
          sent_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: ReportStatus;
          sent_at?: string | null;
        };
      };
      agent_conversations: {
        Row: {
          id: string;
          title: string | null;
          created_by: string | null;
          created_at: string;
          last_msg_at: string;
        };
        Insert: { id?: string; title?: string | null; created_by?: string | null; created_at?: string; last_msg_at?: string };
        Update: { title?: string | null; last_msg_at?: string };
      };
      agent_messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: "user" | "assistant" | "tool";
          content: string | null;
          tool_calls: unknown | null;
          tool_results: unknown | null;
          created_at: string;
        };
        Insert: { id?: string; conversation_id: string; role: "user" | "assistant" | "tool"; content?: string | null; tool_calls?: unknown | null; tool_results?: unknown | null; created_at?: string };
        Update: { content?: string | null };
      };
      conversation_templates: {
        Row: {
          id: string;
          name: string;
          greeting: string | null;
          pre_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          greeting?: string | null;
          pre_message?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          greeting?: string | null;
          pre_message?: string | null;
        };
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          created_at?: string;
        };
        Update: {
          full_name?: string;
        };
      };
      sales: {
        Row: { id: string; client_id: string; date: string; value: number | null; obs: string | null; created_at: string };
        Insert: { id?: string; client_id: string; date: string; value?: number | null; obs?: string | null; created_at?: string };
        Update: { date?: string; value?: number | null; obs?: string | null };
      };
      sales_goals: {
        Row: { id: string; client_id: string; month: string; goal: number; created_at: string };
        Insert: { id?: string; client_id: string; month: string; goal: number; created_at?: string };
        Update: { goal?: number };
      };
      google_calendar_tokens: {
        Row: {
          id: string;
          user_id: string;
          access_token: string;
          refresh_token: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: { id?: string; user_id: string; access_token: string; refresh_token?: string | null; expires_at: string; created_at?: string };
        Update: { access_token?: string; refresh_token?: string | null; expires_at?: string };
      };
      tags: {
        Row: {
          id: string;
          name: string;
          color: string;
          created_at: string;
        };
        Insert: { id?: string; name: string; color?: string; created_at?: string };
        Update: { name?: string; color?: string };
      };
      client_tags: {
        Row: { client_id: string; tag_id: string };
        Insert: { client_id: string; tag_id: string };
        Update: never;
      };
      tasks: {
        Row: {
          id: string;
          title: string;
          status: TaskStatus;
          due_date: string | null;
          client_id: string | null;
          assigned_to: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          status?: TaskStatus;
          due_date?: string | null;
          client_id?: string | null;
          assigned_to?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          title?: string;
          status?: TaskStatus;
          due_date?: string | null;
          client_id?: string | null;
          assigned_to?: string | null;
        };
      };
    };
  };
}
