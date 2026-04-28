export type ClientSegment = "popular" | "premium";
export type ClientStatus = "on-target" | "attention" | "critical" | "no-data";
export type SyncStatus = "success" | "error";

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
    };
  };
}
