export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      briefs: {
        Row: {
          created_at: string;
          data: Json;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at: string;
          data: Json;
          id?: string;
          updated_at: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      chat_messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          model: string | null;
          role: string;
          session_id: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at: string;
          id: string;
          model?: string | null;
          role: string;
          session_id: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          model?: string | null;
          role?: string;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chat_messages_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'chat_sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      chat_sessions: {
        Row: {
          created_at: string;
          id: string;
          last_message_at: string;
          search_vector: string | null;
          service_id: string | null;
          system_prompt: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          created_at: string;
          id: string;
          last_message_at: string;
          search_vector?: string | null;
          service_id?: string | null;
          system_prompt?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_message_at?: string;
          search_vector?: string | null;
          service_id?: string | null;
          system_prompt?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      content_annotations: {
        Row: {
          basic_structure: string | null;
          canonical_url: string | null;
          created_at: string;
          goal: string | null;
          id: string;
          impressions: string | null;
          kw: string | null;
          main_kw: string | null;
          needs: string | null;
          normalized_url: string | null;
          opening_proposal: string | null;
          persona: string | null;
          prep: string | null;
          session_id: string | null;
          updated_at: string;
          user_id: string;
          wp_categories: number[] | null;
          wp_category_names: string[] | null;
          wp_content_text: string | null;
          wp_excerpt: string | null;
          wp_post_id: number | null;
          wp_post_title: string | null;
          wp_post_type: string;
        };
        Insert: {
          basic_structure?: string | null;
          canonical_url?: string | null;
          created_at?: string;
          goal?: string | null;
          id?: string;
          impressions?: string | null;
          kw?: string | null;
          main_kw?: string | null;
          needs?: string | null;
          normalized_url?: string | null;
          opening_proposal?: string | null;
          persona?: string | null;
          prep?: string | null;
          session_id?: string | null;
          updated_at?: string;
          user_id: string;
          wp_categories?: number[] | null;
          wp_category_names?: string[] | null;
          wp_content_text?: string | null;
          wp_excerpt?: string | null;
          wp_post_id?: number | null;
          wp_post_title?: string | null;
          wp_post_type?: string;
        };
        Update: {
          basic_structure?: string | null;
          canonical_url?: string | null;
          created_at?: string;
          goal?: string | null;
          id?: string;
          impressions?: string | null;
          kw?: string | null;
          main_kw?: string | null;
          needs?: string | null;
          normalized_url?: string | null;
          opening_proposal?: string | null;
          persona?: string | null;
          prep?: string | null;
          session_id?: string | null;
          updated_at?: string;
          user_id?: string;
          wp_categories?: number[] | null;
          wp_category_names?: string[] | null;
          wp_content_text?: string | null;
          wp_excerpt?: string | null;
          wp_post_id?: number | null;
          wp_post_title?: string | null;
          wp_post_type?: string;
        };
        Relationships: [];
      };
      employee_invitations: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          invitation_token: string;
          owner_user_id: string;
          used_at: string | null;
          used_by_user_id: string | null;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          id?: string;
          invitation_token: string;
          owner_user_id: string;
          used_at?: string | null;
          used_by_user_id?: string | null;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          invitation_token?: string;
          owner_user_id?: string;
          used_at?: string | null;
          used_by_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'employee_invitations_owner_user_id_fkey';
            columns: ['owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employee_invitations_used_by_user_id_fkey';
            columns: ['used_by_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      google_ads_credentials: {
        Row: {
          access_token: string;
          access_token_expires_at: string;
          created_at: string;
          customer_id: string | null;
          google_account_email: string | null;
          id: string;
          manager_customer_id: string | null;
          refresh_token: string;
          scope: string[];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          access_token: string;
          access_token_expires_at: string;
          created_at?: string;
          customer_id?: string | null;
          google_account_email?: string | null;
          id?: string;
          manager_customer_id?: string | null;
          refresh_token: string;
          scope?: string[];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          access_token?: string;
          access_token_expires_at?: string;
          created_at?: string;
          customer_id?: string | null;
          google_account_email?: string | null;
          id?: string;
          manager_customer_id?: string | null;
          refresh_token?: string;
          scope?: string[];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'google_ads_credentials_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      gsc_article_evaluation_history: {
        Row: {
          content_annotation_id: string;
          created_at: string;
          current_position: number | null;
          error_code: string | null;
          error_message: string | null;
          evaluation_date: string;
          id: string;
          is_read: boolean;
          outcome: string | null;
          outcome_type: string;
          previous_position: number | null;
          suggestion_applied: boolean;
          suggestion_summary: string | null;
          user_id: string;
        };
        Insert: {
          content_annotation_id: string;
          created_at?: string;
          current_position?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          evaluation_date: string;
          id?: string;
          is_read?: boolean;
          outcome?: string | null;
          outcome_type?: string;
          previous_position?: number | null;
          suggestion_applied?: boolean;
          suggestion_summary?: string | null;
          user_id: string;
        };
        Update: {
          content_annotation_id?: string;
          created_at?: string;
          current_position?: number | null;
          error_code?: string | null;
          error_message?: string | null;
          evaluation_date?: string;
          id?: string;
          is_read?: boolean;
          outcome?: string | null;
          outcome_type?: string;
          previous_position?: number | null;
          suggestion_applied?: boolean;
          suggestion_summary?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gsc_article_evaluation_history_content_annotation_id_fkey';
            columns: ['content_annotation_id'];
            isOneToOne: false;
            referencedRelation: 'content_annotations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'gsc_article_evaluation_history_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      gsc_article_evaluations: {
        Row: {
          base_evaluation_date: string;
          content_annotation_id: string;
          created_at: string;
          current_suggestion_stage: number;
          cycle_days: number;
          evaluation_hour: number;
          id: string;
          last_evaluated_on: string | null;
          last_seen_position: number | null;
          property_uri: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          base_evaluation_date: string;
          content_annotation_id: string;
          created_at?: string;
          current_suggestion_stage?: number;
          cycle_days?: number;
          evaluation_hour?: number;
          id?: string;
          last_evaluated_on?: string | null;
          last_seen_position?: number | null;
          property_uri: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          base_evaluation_date?: string;
          content_annotation_id?: string;
          created_at?: string;
          current_suggestion_stage?: number;
          cycle_days?: number;
          evaluation_hour?: number;
          id?: string;
          last_evaluated_on?: string | null;
          last_seen_position?: number | null;
          property_uri?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gsc_article_evaluations_content_annotation_id_fkey';
            columns: ['content_annotation_id'];
            isOneToOne: false;
            referencedRelation: 'content_annotations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'gsc_article_evaluations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      gsc_credentials: {
        Row: {
          access_token: string | null;
          access_token_expires_at: string | null;
          created_at: string | null;
          ga4_conversion_events: string[] | null;
          ga4_last_synced_at: string | null;
          ga4_property_id: string | null;
          ga4_property_name: string | null;
          ga4_threshold_engagement_sec: number | null;
          ga4_threshold_read_rate: number | null;
          google_account_email: string | null;
          id: string;
          last_synced_at: string | null;
          permission_level: string | null;
          property_display_name: string | null;
          property_type: string | null;
          property_uri: string | null;
          refresh_token: string;
          scope: string[] | null;
          updated_at: string | null;
          user_id: string;
          verified: boolean | null;
        };
        Insert: {
          access_token?: string | null;
          access_token_expires_at?: string | null;
          created_at?: string | null;
          ga4_conversion_events?: string[] | null;
          ga4_last_synced_at?: string | null;
          ga4_property_id?: string | null;
          ga4_property_name?: string | null;
          ga4_threshold_engagement_sec?: number | null;
          ga4_threshold_read_rate?: number | null;
          google_account_email?: string | null;
          id?: string;
          last_synced_at?: string | null;
          permission_level?: string | null;
          property_display_name?: string | null;
          property_type?: string | null;
          property_uri?: string | null;
          refresh_token: string;
          scope?: string[] | null;
          updated_at?: string | null;
          user_id: string;
          verified?: boolean | null;
        };
        Update: {
          access_token?: string | null;
          access_token_expires_at?: string | null;
          created_at?: string | null;
          ga4_conversion_events?: string[] | null;
          ga4_last_synced_at?: string | null;
          ga4_property_id?: string | null;
          ga4_property_name?: string | null;
          ga4_threshold_engagement_sec?: number | null;
          ga4_threshold_read_rate?: number | null;
          google_account_email?: string | null;
          id?: string;
          last_synced_at?: string | null;
          permission_level?: string | null;
          property_display_name?: string | null;
          property_type?: string | null;
          property_uri?: string | null;
          refresh_token?: string;
          scope?: string[] | null;
          updated_at?: string | null;
          user_id?: string;
          verified?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: 'gsc_credentials_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      ga4_page_metrics_daily: {
        Row: {
          bounce_rate: number;
          created_at: string;
          cv_event_count: number;
          date: string;
          engagement_time_sec: number;
          id: string;
          imported_at: string;
          is_partial: boolean;
          is_sampled: boolean;
          normalized_path: string;
          page_path: string;
          property_id: string;
          scroll_90_event_count: number;
          sessions: number;
          updated_at: string;
          user_id: string;
          users: number;
        };
        Insert: {
          bounce_rate?: number;
          created_at?: string;
          cv_event_count?: number;
          date: string;
          engagement_time_sec?: number;
          id?: string;
          imported_at?: string;
          is_partial?: boolean;
          is_sampled?: boolean;
          normalized_path?: string;
          page_path: string;
          property_id: string;
          scroll_90_event_count?: number;
          sessions?: number;
          updated_at?: string;
          user_id: string;
          users?: number;
        };
        Update: {
          bounce_rate?: number;
          created_at?: string;
          cv_event_count?: number;
          date?: string;
          engagement_time_sec?: number;
          id?: string;
          imported_at?: string;
          is_partial?: boolean;
          is_sampled?: boolean;
          normalized_path?: string;
          page_path?: string;
          property_id?: string;
          scroll_90_event_count?: number;
          sessions?: number;
          updated_at?: string;
          user_id?: string;
          users?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'ga4_page_metrics_daily_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      gsc_page_metrics: {
        Row: {
          clicks: number;
          content_annotation_id: string | null;
          ctr: number;
          date: string;
          id: string;
          imported_at: string;
          impressions: number;
          normalized_url: string | null;
          position: number;
          property_uri: string;
          search_type: string;
          url: string;
          user_id: string;
        };
        Insert: {
          clicks?: number;
          content_annotation_id?: string | null;
          ctr?: number;
          date: string;
          id?: string;
          imported_at?: string;
          impressions?: number;
          normalized_url?: string | null;
          position?: number;
          property_uri: string;
          search_type?: string;
          url: string;
          user_id: string;
        };
        Update: {
          clicks?: number;
          content_annotation_id?: string | null;
          ctr?: number;
          date?: string;
          id?: string;
          imported_at?: string;
          impressions?: number;
          normalized_url?: string | null;
          position?: number;
          property_uri?: string;
          search_type?: string;
          url?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gsc_page_metrics_content_annotation_id_fkey';
            columns: ['content_annotation_id'];
            isOneToOne: false;
            referencedRelation: 'content_annotations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'gsc_page_metrics_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      gsc_query_metrics: {
        Row: {
          clicks: number;
          content_annotation_id: string | null;
          created_at: string;
          ctr: number;
          date: string;
          id: string;
          imported_at: string;
          impressions: number;
          normalized_url: string;
          position: number;
          property_type: string;
          property_uri: string;
          query: string;
          query_normalized: string;
          search_type: string;
          updated_at: string;
          url: string;
          user_id: string;
        };
        Insert: {
          clicks: number;
          content_annotation_id?: string | null;
          created_at?: string;
          ctr?: number;
          date: string;
          id?: string;
          imported_at?: string;
          impressions: number;
          normalized_url: string;
          position?: number;
          property_type: string;
          property_uri: string;
          query: string;
          query_normalized: string;
          search_type: string;
          updated_at?: string;
          url: string;
          user_id: string;
        };
        Update: {
          clicks?: number;
          content_annotation_id?: string | null;
          created_at?: string;
          ctr?: number;
          date?: string;
          id?: string;
          imported_at?: string;
          impressions?: number;
          normalized_url?: string;
          position?: number;
          property_type?: string;
          property_uri?: string;
          query?: string;
          query_normalized?: string;
          search_type?: string;
          updated_at?: string;
          url?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gsc_query_metrics_content_annotation_id_fkey';
            columns: ['content_annotation_id'];
            isOneToOne: false;
            referencedRelation: 'content_annotations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'gsc_query_metrics_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_templates: {
        Row: {
          content: string;
          created_at: string | null;
          created_by: string | null;
          display_name: string;
          id: string;
          name: string;
          updated_at: string | null;
          updated_by: string | null;
          variables: Json | null;
          version: number | null;
        };
        Insert: {
          content: string;
          created_at?: string | null;
          created_by?: string | null;
          display_name: string;
          id?: string;
          name: string;
          updated_at?: string | null;
          updated_by?: string | null;
          variables?: Json | null;
          version?: number | null;
        };
        Update: {
          content?: string;
          created_at?: string | null;
          created_by?: string | null;
          display_name?: string;
          id?: string;
          name?: string;
          updated_at?: string | null;
          updated_by?: string | null;
          variables?: Json | null;
          version?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_templates_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'prompt_templates_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_versions: {
        Row: {
          content: string;
          created_at: string | null;
          created_by: string | null;
          id: string;
          template_id: string | null;
          version: number;
        };
        Insert: {
          content: string;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          template_id?: string | null;
          version: number;
        };
        Update: {
          content?: string;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          template_id?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_versions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'prompt_versions_template_id_fkey';
            columns: ['template_id'];
            isOneToOne: false;
            referencedRelation: 'prompt_templates';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          full_name: string | null;
          id: string;
          last_login_at: string | null;
          line_display_name: string;
          line_picture_url: string | null;
          line_status_message: string | null;
          line_user_id: string;
          owner_previous_role: string | null;
          owner_user_id: string | null;
          role: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at: string;
          full_name?: string | null;
          id: string;
          last_login_at?: string | null;
          line_display_name: string;
          line_picture_url?: string | null;
          line_status_message?: string | null;
          line_user_id: string;
          owner_previous_role?: string | null;
          owner_user_id?: string | null;
          role?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at: string;
        };
        Update: {
          created_at?: string;
          full_name?: string | null;
          id?: string;
          last_login_at?: string | null;
          line_display_name?: string;
          line_picture_url?: string | null;
          line_status_message?: string | null;
          line_user_id?: string;
          owner_previous_role?: string | null;
          owner_user_id?: string | null;
          role?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'users_owner_user_id_fkey';
            columns: ['owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      wordpress_settings: {
        Row: {
          created_at: string | null;
          id: string;
          updated_at: string | null;
          user_id: string;
          wp_access_token: string | null;
          wp_application_password: string | null;
          wp_client_id: string | null;
          wp_client_secret: string | null;
          wp_content_types: string[];
          wp_refresh_token: string | null;
          wp_site_id: string | null;
          wp_site_url: string | null;
          wp_token_expires_at: string | null;
          wp_type: string;
          wp_username: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          updated_at?: string | null;
          user_id: string;
          wp_access_token?: string | null;
          wp_application_password?: string | null;
          wp_client_id?: string | null;
          wp_client_secret?: string | null;
          wp_content_types?: string[];
          wp_refresh_token?: string | null;
          wp_site_id?: string | null;
          wp_site_url?: string | null;
          wp_token_expires_at?: string | null;
          wp_type?: string;
          wp_username?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          updated_at?: string | null;
          user_id?: string;
          wp_access_token?: string | null;
          wp_application_password?: string | null;
          wp_client_id?: string | null;
          wp_client_secret?: string | null;
          wp_content_types?: string[];
          wp_refresh_token?: string | null;
          wp_site_id?: string | null;
          wp_site_url?: string | null;
          wp_token_expires_at?: string | null;
          wp_type?: string;
          wp_username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'wordpress_settings_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_employee_invitation: {
        Args: { p_token: string; p_user_id: string };
        Returns: {
          error: string;
          success: boolean;
        }[];
      };
      delete_employee_and_restore_owner: {
        Args: { p_employee_id: string; p_owner_id: string };
        Returns: {
          error: string;
          success: boolean;
        }[];
      };
      delete_user_fully: {
        Args: { p_user_id: string };
        Returns: {
          error: string;
          success: boolean;
        }[];
      };
      get_accessible_user_ids: {
        Args: { p_user_id: string };
        Returns: string[];
      };
      get_database_size: {
        Args: never;
        Returns: {
          database_size_bytes: number;
          database_size_pretty: string;
        }[];
      };
      get_gsc_query_analysis: {
        Args: {
          p_comp_end_date: string;
          p_comp_start_date: string;
          p_end_date: string;
          p_normalized_url: string;
          p_property_uri: string;
          p_start_date: string;
          p_user_id: string;
        };
        Returns: {
          avg_ctr: number;
          avg_position: number;
          clicks: number;
          clicks_change: number;
          impressions: number;
          position_change: number;
          query: string;
          query_normalized: string;
          word_count: number;
        }[];
      };
      get_gsc_query_summary: {
        Args: {
          p_end_date: string;
          p_normalized_url: string;
          p_property_uri: string;
          p_start_date: string;
          p_user_id: string;
        };
        Returns: {
          avg_position: number;
          total_clicks: number;
          total_impressions: number;
          total_queries: number;
        }[];
      };
      get_sessions_with_messages: {
        Args: { p_limit?: number; p_user_id: string };
        Returns: {
          last_message_at: string;
          messages: Json;
          session_id: string;
          title: string;
        }[];
      };
      get_table_sizes: {
        Args: { table_names?: string[] };
        Returns: {
          size_bytes: number;
          size_pretty: string;
          table_name: string;
        }[];
      };
      get_user_google_search_count: {
        Args: { p_line_user_id: string };
        Returns: number;
      };
      upsert_brief: {
        Args: { p_data: Json; p_now: string; p_user_id: string };
        Returns: undefined;
      };
      upsert_user_profile: {
        Args: {
          p_line_display_name: string;
          p_line_picture_url: string | null;
          p_line_status_message: string | null;
          p_line_user_id: string;
          p_now: string;
        };
        Returns: {
          created_at: string;
          full_name: string | null;
          id: string;
          last_login_at: string | null;
          line_display_name: string;
          line_picture_url: string | null;
          line_status_message: string | null;
          line_user_id: string;
          owner_previous_role: string | null;
          owner_user_id: string | null;
          role: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
        }[];
      };
      increment_google_search_count: {
        Args: { user_id: string };
        Returns: undefined;
      };
      increment_google_search_count_by_line_id: {
        Args: { p_line_user_id: string };
        Returns: undefined;
      };
      normalize_keyword: { Args: { input_text: string }; Returns: string };
      normalize_to_path: { Args: { input_text: string }; Returns: string };
      normalize_url: { Args: { url: string }; Returns: string };
      search_chat_sessions: {
        Args: { p_limit?: number; p_query: string; p_user_id: string };
        Returns: {
          canonical_url: string;
          last_message_at: string;
          session_id: string;
          similarity_score: number;
          title: string;
          wp_post_title: string;
        }[];
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { '': string }; Returns: string[] };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
