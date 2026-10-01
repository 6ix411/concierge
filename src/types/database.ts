export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action: string;
          admin_id: string;
          created_at: string;
          id: string;
          metadata: NonNullable<Json>;
          reason: string | null;
          target_id: string | null;
          target_type: string;
        };
        Insert: {
          action: string;
          admin_id: string;
          created_at?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          reason?: string | null;
          target_id?: string | null;
          target_type: string;
        };
        Update: {
          action?: string;
          admin_id?: string;
          created_at?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          reason?: string | null;
          target_id?: string | null;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_actions_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_conversations: {
        Row: {
          created_at: string;
          id: string;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          title?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_conversations_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_messages: {
        Row: {
          ai_conversation_id: string;
          content: string;
          created_at: string;
          id: string;
          metadata: NonNullable<Json>;
          recommended_business_ids: string[];
          role: Database["public"]["Enums"]["ai_message_role"];
        };
        Insert: {
          ai_conversation_id: string;
          content: string;
          created_at?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          recommended_business_ids?: string[];
          role: Database["public"]["Enums"]["ai_message_role"];
        };
        Update: {
          ai_conversation_id?: string;
          content?: string;
          created_at?: string;
          id?: string;
          metadata?: NonNullable<Json>;
          recommended_business_ids?: string[];
          role?: Database["public"]["Enums"]["ai_message_role"];
        };
        Relationships: [
          {
            foreignKeyName: "ai_messages_ai_conversation_id_fkey";
            columns: ["ai_conversation_id"];
            isOneToOne: false;
            referencedRelation: "ai_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_events: {
        Row: {
          actor_id: string | null;
          actor_role: string;
          booking_id: string;
          created_at: string;
          event: string;
          from_status: Database["public"]["Enums"]["booking_status"] | null;
          id: string;
          metadata: NonNullable<Json>;
          note: string | null;
          to_status: Database["public"]["Enums"]["booking_status"] | null;
        };
        Insert: {
          actor_id?: string | null;
          actor_role: string;
          booking_id: string;
          created_at?: string;
          event: string;
          from_status?: Database["public"]["Enums"]["booking_status"] | null;
          id?: string;
          metadata?: NonNullable<Json>;
          note?: string | null;
          to_status?: Database["public"]["Enums"]["booking_status"] | null;
        };
        Update: {
          actor_id?: string | null;
          actor_role?: string;
          booking_id?: string;
          created_at?: string;
          event?: string;
          from_status?: Database["public"]["Enums"]["booking_status"] | null;
          id?: string;
          metadata?: NonNullable<Json>;
          note?: string | null;
          to_status?: Database["public"]["Enums"]["booking_status"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "booking_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_events_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_items: {
        Row: {
          booking_id: string;
          created_at: string;
          id: string;
          kind: string;
          name: string;
          quantity: number;
          service_id: string | null;
          total_minor: number | null;
          unit_price_minor: number;
        };
        Insert: {
          booking_id: string;
          created_at?: string;
          id?: string;
          kind?: string;
          name: string;
          quantity?: number;
          service_id?: string | null;
          total_minor?: never;
          unit_price_minor: number;
        };
        Update: {
          booking_id?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          name?: string;
          quantity?: number;
          service_id?: string | null;
          total_minor?: never;
          unit_price_minor?: number;
        };
        Relationships: [
          {
            foreignKeyName: "booking_items_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_items_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "business_services";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          accepted_at: string | null;
          address_line: string | null;
          area: string | null;
          business_id: string;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          change_actor_id: string | null;
          change_note: string | null;
          city: string | null;
          commission_rate_bps: number;
          completed_at: string | null;
          confirmed_at: string | null;
          created_at: string;
          currency: string;
          customer_id: string;
          customer_notes: string | null;
          guests: number | null;
          id: string;
          needs_quote: boolean;
          platform_fee_minor: number;
          quote_notes: string | null;
          reference: string;
          scheduled_end: string | null;
          scheduled_start: string | null;
          state: string | null;
          status: Database["public"]["Enums"]["booking_status"];
          subtotal_minor: number;
          total_minor: number;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          address_line?: string | null;
          area?: string | null;
          business_id: string;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          change_actor_id?: string | null;
          change_note?: string | null;
          city?: string | null;
          commission_rate_bps?: number;
          completed_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          currency?: string;
          customer_id: string;
          customer_notes?: string | null;
          guests?: number | null;
          id?: string;
          needs_quote?: boolean;
          platform_fee_minor?: number;
          quote_notes?: string | null;
          reference?: string;
          scheduled_end?: string | null;
          scheduled_start?: string | null;
          state?: string | null;
          status?: Database["public"]["Enums"]["booking_status"];
          subtotal_minor?: number;
          total_minor?: number;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          address_line?: string | null;
          area?: string | null;
          business_id?: string;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          change_actor_id?: string | null;
          change_note?: string | null;
          city?: string | null;
          commission_rate_bps?: number;
          completed_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          currency?: string;
          customer_id?: string;
          customer_notes?: string | null;
          guests?: number | null;
          id?: string;
          needs_quote?: boolean;
          platform_fee_minor?: number;
          quote_notes?: string | null;
          reference?: string;
          scheduled_end?: string | null;
          scheduled_start?: string | null;
          state?: string | null;
          status?: Database["public"]["Enums"]["booking_status"];
          subtotal_minor?: number;
          total_minor?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_cancelled_by_fkey";
            columns: ["cancelled_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_change_actor_id_fkey";
            columns: ["change_actor_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      business_availability: {
        Row: {
          business_id: string;
          created_at: string;
          day_of_week: number | null;
          end_time: string | null;
          id: string;
          is_available: boolean;
          specific_date: string | null;
          start_time: string | null;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          day_of_week?: number | null;
          end_time?: string | null;
          id?: string;
          is_available?: boolean;
          specific_date?: string | null;
          start_time?: string | null;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          day_of_week?: number | null;
          end_time?: string | null;
          id?: string;
          is_available?: boolean;
          specific_date?: string | null;
          start_time?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_availability_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      business_portfolio: {
        Row: {
          business_id: string;
          caption: string | null;
          created_at: string;
          id: string;
          media_type: Database["public"]["Enums"]["portfolio_media_type"];
          sort_order: number;
          storage_path: string;
        };
        Insert: {
          business_id: string;
          caption?: string | null;
          created_at?: string;
          id?: string;
          media_type: Database["public"]["Enums"]["portfolio_media_type"];
          sort_order?: number;
          storage_path: string;
        };
        Update: {
          business_id?: string;
          caption?: string | null;
          created_at?: string;
          id?: string;
          media_type?: Database["public"]["Enums"]["portfolio_media_type"];
          sort_order?: number;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_portfolio_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      business_services: {
        Row: {
          business_id: string;
          category_id: string | null;
          created_at: string;
          currency: string;
          description: string | null;
          duration_minutes: number | null;
          id: string;
          is_active: boolean;
          is_addon: boolean;
          is_package: boolean;
          name: string;
          package_includes: string[];
          price_minor: number | null;
          pricing_type: Database["public"]["Enums"]["pricing_type"];
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          duration_minutes?: number | null;
          id?: string;
          is_active?: boolean;
          is_addon?: boolean;
          is_package?: boolean;
          name: string;
          package_includes?: string[];
          price_minor?: number | null;
          pricing_type?: Database["public"]["Enums"]["pricing_type"];
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          category_id?: string | null;
          created_at?: string;
          currency?: string;
          description?: string | null;
          duration_minutes?: number | null;
          id?: string;
          is_active?: boolean;
          is_addon?: boolean;
          is_package?: boolean;
          name?: string;
          package_includes?: string[];
          price_minor?: number | null;
          pricing_type?: Database["public"]["Enums"]["pricing_type"];
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_services_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_services_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "service_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      business_verifications: {
        Row: {
          business_id: string;
          created_at: string;
          document_number: string | null;
          document_path: string;
          document_type: Database["public"]["Enums"]["verification_document_type"];
          id: string;
          notes: string | null;
          request_id: string | null;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["verification_status"];
          submitted_by: string;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          document_number?: string | null;
          document_path: string;
          document_type: Database["public"]["Enums"]["verification_document_type"];
          id?: string;
          notes?: string | null;
          request_id?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["verification_status"];
          submitted_by: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          document_number?: string | null;
          document_path?: string;
          document_type?: Database["public"]["Enums"]["verification_document_type"];
          id?: string;
          notes?: string | null;
          request_id?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["verification_status"];
          submitted_by?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_verifications_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_verifications_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "verification_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_verifications_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_verifications_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      businesses: {
        Row: {
          accepting_bookings: boolean;
          address_line: string | null;
          booking_window_days: number;
          city: string | null;
          commission_rate_bps: number | null;
          cover_path: string | null;
          created_at: string;
          description: string | null;
          email: string | null;
          id: string;
          is_verified: boolean;
          latitude: number | null;
          logo_path: string | null;
          longitude: number | null;
          max_bookings_per_day: number | null;
          min_notice_hours: number;
          name: string;
          owner_id: string;
          phone: string | null;
          primary_category_id: string | null;
          rating_avg: number;
          rating_count: number;
          reviewed_at: string | null;
          slug: string;
          state: string | null;
          status: Database["public"]["Enums"]["business_status"];
          status_reason: string | null;
          submitted_at: string | null;
          updated_at: string;
          verified_at: string | null;
          website: string | null;
        };
        Insert: {
          accepting_bookings?: boolean;
          address_line?: string | null;
          booking_window_days?: number;
          city?: string | null;
          commission_rate_bps?: number | null;
          cover_path?: string | null;
          created_at?: string;
          description?: string | null;
          email?: string | null;
          id?: string;
          is_verified?: boolean;
          latitude?: number | null;
          logo_path?: string | null;
          longitude?: number | null;
          max_bookings_per_day?: number | null;
          min_notice_hours?: number;
          name: string;
          owner_id: string;
          phone?: string | null;
          primary_category_id?: string | null;
          rating_avg?: number;
          rating_count?: number;
          reviewed_at?: string | null;
          slug: string;
          state?: string | null;
          status?: Database["public"]["Enums"]["business_status"];
          status_reason?: string | null;
          submitted_at?: string | null;
          updated_at?: string;
          verified_at?: string | null;
          website?: string | null;
        };
        Update: {
          accepting_bookings?: boolean;
          address_line?: string | null;
          booking_window_days?: number;
          city?: string | null;
          commission_rate_bps?: number | null;
          cover_path?: string | null;
          created_at?: string;
          description?: string | null;
          email?: string | null;
          id?: string;
          is_verified?: boolean;
          latitude?: number | null;
          logo_path?: string | null;
          longitude?: number | null;
          max_bookings_per_day?: number | null;
          min_notice_hours?: number;
          name?: string;
          owner_id?: string;
          phone?: string | null;
          primary_category_id?: string | null;
          rating_avg?: number;
          rating_count?: number;
          reviewed_at?: string | null;
          slug?: string;
          state?: string | null;
          status?: Database["public"]["Enums"]["business_status"];
          status_reason?: string | null;
          submitted_at?: string | null;
          updated_at?: string;
          verified_at?: string | null;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "businesses_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "businesses_primary_category_id_fkey";
            columns: ["primary_category_id"];
            isOneToOne: false;
            referencedRelation: "service_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          booking_id: string;
          business_id: string;
          created_at: string;
          customer_id: string;
          id: string;
          last_message_at: string | null;
          status: Database["public"]["Enums"]["conversation_status"];
          updated_at: string;
        };
        Insert: {
          booking_id: string;
          business_id: string;
          created_at?: string;
          customer_id: string;
          id?: string;
          last_message_at?: string | null;
          status?: Database["public"]["Enums"]["conversation_status"];
          updated_at?: string;
        };
        Update: {
          booking_id?: string;
          business_id?: string;
          created_at?: string;
          customer_id?: string;
          id?: string;
          last_message_at?: string | null;
          status?: Database["public"]["Enums"]["conversation_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_profiles: {
        Row: {
          address_line: string | null;
          city: string | null;
          created_at: string;
          preferences: NonNullable<Json>;
          state: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          address_line?: string | null;
          city?: string | null;
          created_at?: string;
          preferences?: NonNullable<Json>;
          state?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          address_line?: string | null;
          city?: string | null;
          created_at?: string;
          preferences?: NonNullable<Json>;
          state?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_profiles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      disputes: {
        Row: {
          booking_id: string;
          created_at: string;
          description: string | null;
          id: string;
          opened_by: string;
          outcome: string | null;
          previous_booking_status: Database["public"]["Enums"]["booking_status"] | null;
          reason: string;
          refund_due_minor: number;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          status: Database["public"]["Enums"]["dispute_status"];
          updated_at: string;
        };
        Insert: {
          booking_id: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          opened_by: string;
          outcome?: string | null;
          previous_booking_status?: Database["public"]["Enums"]["booking_status"] | null;
          reason: string;
          refund_due_minor?: number;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database["public"]["Enums"]["dispute_status"];
          updated_at?: string;
        };
        Update: {
          booking_id?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          opened_by?: string;
          outcome?: string | null;
          previous_booking_status?: Database["public"]["Enums"]["booking_status"] | null;
          reason?: string;
          refund_due_minor?: number;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database["public"]["Enums"]["dispute_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "disputes_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "disputes_opened_by_fkey";
            columns: ["opened_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "disputes_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          attachment_path: string | null;
          attachment_type: string | null;
          body: string | null;
          conversation_id: string;
          created_at: string;
          hidden_at: string | null;
          id: string;
          is_flagged: boolean;
          sender_id: string;
        };
        Insert: {
          attachment_path?: string | null;
          attachment_type?: string | null;
          body?: string | null;
          conversation_id: string;
          created_at?: string;
          hidden_at?: string | null;
          id?: string;
          is_flagged?: boolean;
          sender_id: string;
        };
        Update: {
          attachment_path?: string | null;
          attachment_type?: string | null;
          body?: string | null;
          conversation_id?: string;
          created_at?: string;
          hidden_at?: string | null;
          id?: string;
          is_flagged?: boolean;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          data: NonNullable<Json>;
          id: string;
          read_at: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          read_at?: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          read_at?: string | null;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount_minor: number;
          booking_id: string;
          created_at: string;
          currency: string;
          failure_reason: string | null;
          id: string;
          paid_at: string | null;
          payer_id: string;
          provider: Database["public"]["Enums"]["payment_provider"];
          provider_payload: Json | null;
          provider_reference: string | null;
          reference: string;
          refunded_minor: number;
          status: Database["public"]["Enums"]["payment_status"];
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          booking_id: string;
          created_at?: string;
          currency?: string;
          failure_reason?: string | null;
          id?: string;
          paid_at?: string | null;
          payer_id: string;
          provider: Database["public"]["Enums"]["payment_provider"];
          provider_payload?: Json | null;
          provider_reference?: string | null;
          reference: string;
          refunded_minor?: number;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          booking_id?: string;
          created_at?: string;
          currency?: string;
          failure_reason?: string | null;
          id?: string;
          paid_at?: string | null;
          payer_id?: string;
          provider?: Database["public"]["Enums"]["payment_provider"];
          provider_payload?: Json | null;
          provider_reference?: string | null;
          reference?: string;
          refunded_minor?: number;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      payouts: {
        Row: {
          amount_minor: number;
          booking_id: string | null;
          business_id: string;
          commission_minor: number;
          created_at: string;
          currency: string;
          failure_reason: string | null;
          gross_minor: number;
          id: string;
          paid_at: string | null;
          provider: Database["public"]["Enums"]["payment_provider"] | null;
          provider_reference: string | null;
          status: Database["public"]["Enums"]["payout_status"];
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          booking_id?: string | null;
          business_id: string;
          commission_minor: number;
          created_at?: string;
          currency?: string;
          failure_reason?: string | null;
          gross_minor: number;
          id?: string;
          paid_at?: string | null;
          provider?: Database["public"]["Enums"]["payment_provider"] | null;
          provider_reference?: string | null;
          status?: Database["public"]["Enums"]["payout_status"];
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          booking_id?: string | null;
          business_id?: string;
          commission_minor?: number;
          created_at?: string;
          currency?: string;
          failure_reason?: string | null;
          gross_minor?: number;
          id?: string;
          paid_at?: string | null;
          provider?: Database["public"]["Enums"]["payment_provider"] | null;
          provider_reference?: string | null;
          status?: Database["public"]["Enums"]["payout_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payouts_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payouts_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_settings: {
        Row: {
          description: string | null;
          key: string;
          updated_at: string;
          updated_by: string | null;
          value: NonNullable<Json>;
        };
        Insert: {
          description?: string | null;
          key: string;
          updated_at?: string;
          updated_by?: string | null;
          value: NonNullable<Json>;
        };
        Update: {
          description?: string | null;
          key?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      reviews: {
        Row: {
          booking_id: string;
          business_id: string;
          business_replied_at: string | null;
          business_reply: string | null;
          comment: string | null;
          created_at: string;
          customer_id: string;
          id: string;
          rating: number;
          status: Database["public"]["Enums"]["review_status"];
          updated_at: string;
        };
        Insert: {
          booking_id: string;
          business_id: string;
          business_replied_at?: string | null;
          business_reply?: string | null;
          comment?: string | null;
          created_at?: string;
          customer_id: string;
          id?: string;
          rating: number;
          status?: Database["public"]["Enums"]["review_status"];
          updated_at?: string;
        };
        Update: {
          booking_id?: string;
          business_id?: string;
          business_replied_at?: string | null;
          business_reply?: string | null;
          comment?: string | null;
          created_at?: string;
          customer_id?: string;
          id?: string;
          rating?: number;
          status?: Database["public"]["Enums"]["review_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey";
            columns: ["booking_id"];
            isOneToOne: true;
            referencedRelation: "bookings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      service_areas: {
        Row: {
          area: string | null;
          business_id: string;
          city: string | null;
          created_at: string;
          id: string;
          state: string;
        };
        Insert: {
          area?: string | null;
          business_id: string;
          city?: string | null;
          created_at?: string;
          id?: string;
          state: string;
        };
        Update: {
          area?: string | null;
          business_id?: string;
          city?: string | null;
          created_at?: string;
          id?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_areas_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      service_categories: {
        Row: {
          created_at: string;
          description: string | null;
          icon: string | null;
          id: string;
          is_active: boolean;
          name: string;
          parent_id: string | null;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          icon?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          parent_id?: string | null;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          icon?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          parent_id?: string | null;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "service_categories";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          avatar_path: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["user_role"];
          status: Database["public"]["Enums"]["user_status"];
          updated_at: string;
        };
        Insert: {
          avatar_path?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["user_status"];
          updated_at?: string;
        };
        Update: {
          avatar_path?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["user_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      verification_requests: {
        Row: {
          business_id: string;
          created_at: string;
          document_type: Database["public"]["Enums"]["verification_document_type"] | null;
          id: string;
          message: string;
          requested_by: string;
          resolved_at: string | null;
          status: Database["public"]["Enums"]["verification_request_status"];
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          document_type?: Database["public"]["Enums"]["verification_document_type"] | null;
          id?: string;
          message: string;
          requested_by: string;
          resolved_at?: string | null;
          status?: Database["public"]["Enums"]["verification_request_status"];
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          document_type?: Database["public"]["Enums"]["verification_document_type"] | null;
          id?: string;
          message?: string;
          requested_by?: string;
          resolved_at?: string | null;
          status?: Database["public"]["Enums"]["verification_request_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "verification_requests_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "verification_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_dashboard_stats: { Args: { top_n?: number }; Returns: Json };
      create_booking: {
        Args: { p_booking: Json; p_items: Json };
        Returns: {
          id: string;
          reference: string;
        }[];
      };
      current_user_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["user_role"];
      };
      get_booking_counterparts: {
        Args: { user_ids: string[] };
        Returns: {
          avatar_path: string;
          full_name: string;
          id: string;
        }[];
      };
      get_business_stats: {
        Args: { p_business_id: string };
        Returns: {
          completed_bookings: number;
          has_quote_only: boolean;
          max_price_minor: number;
          min_price_minor: number;
          rating_breakdown: number[];
        }[];
      };
      get_public_reviews: {
        Args: { p_business_id: string; p_limit?: number; p_offset?: number };
        Returns: {
          business_replied_at: string;
          business_reply: string;
          comment: string;
          created_at: string;
          id: string;
          rating: number;
          reviewer_name: string;
        }[];
      };
      is_active_user: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_booking_participant: { Args: { target_booking_id: string }; Returns: boolean };
      is_business_public: { Args: { target_business_id: string }; Returns: boolean };
      is_conversation_participant: { Args: { target_conversation_id: string }; Returns: boolean };
      is_valid_booking_transition: {
        Args: {
          from_status: Database["public"]["Enums"]["booking_status"];
          to_status: Database["public"]["Enums"]["booking_status"];
        };
        Returns: boolean;
      };
      match_businesses: {
        Args: {
          p_area?: string;
          p_budget_minor?: number;
          p_category?: string;
          p_city?: string;
          p_date?: string;
          p_guests?: number;
          p_ids?: string[];
          p_limit?: number;
          p_max_price_minor?: number;
          p_offset?: number;
          p_query?: string;
          p_sort?: string;
          p_state?: string;
          p_time?: string;
        };
        Returns: {
          availability: string;
          availability_note: string;
          category_name: string;
          city: string;
          completed_bookings: number;
          cover_path: string;
          description: string;
          fits_guests: boolean;
          guest_capacity: number;
          has_quote_only: boolean;
          id: string;
          is_verified: boolean;
          location_match: string;
          logo_path: string;
          matched_services: string[];
          max_price_minor: number;
          min_price_minor: number;
          name: string;
          rating_avg: number;
          rating_count: number;
          score: number;
          score_parts: Json;
          served_areas: string[];
          slug: string;
          state: string;
          within_budget: boolean;
        }[];
      };
      owns_business: { Args: { target_business_id: string }; Returns: boolean };
      storage_owner_id: { Args: { object_name: string }; Returns: string };
    };
    Enums: {
      ai_message_role: "user" | "assistant" | "tool";
      booking_status:
        | "quote_requested"
        | "quoted"
        | "requested"
        | "pending_provider"
        | "accepted"
        | "payment_pending"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "reviewed"
        | "cancelled"
        | "declined"
        | "expired"
        | "disputed"
        | "refunded";
      business_status: "draft" | "pending" | "under_review" | "approved" | "rejected" | "suspended";
      conversation_status: "open" | "closed" | "locked";
      dispute_status: "open" | "under_review" | "resolved" | "rejected";
      payment_provider: "paystack" | "flutterwave" | "mock";
      payment_status: "pending" | "success" | "failed" | "abandoned" | "refunded" | "partially_refunded";
      payout_status: "pending" | "processing" | "paid" | "failed" | "on_hold";
      portfolio_media_type: "image" | "video";
      pricing_type: "fixed" | "hourly" | "starting_from" | "quote_only";
      review_status: "published" | "hidden";
      user_role: "customer" | "business" | "admin";
      user_status: "active" | "suspended" | "deactivated";
      verification_document_type:
        | "cac_certificate"
        | "national_id"
        | "drivers_license"
        | "international_passport"
        | "voters_card"
        | "utility_bill"
        | "professional_license"
        | "other";
      verification_request_status: "open" | "submitted" | "closed";
      verification_status: "pending" | "approved" | "rejected" | "needs_more_info";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_message_role: ["user", "assistant", "tool"],
      booking_status: [
        "quote_requested",
        "quoted",
        "requested",
        "pending_provider",
        "accepted",
        "payment_pending",
        "confirmed",
        "in_progress",
        "completed",
        "reviewed",
        "cancelled",
        "declined",
        "expired",
        "disputed",
        "refunded",
      ],
      business_status: ["draft", "pending", "under_review", "approved", "rejected", "suspended"],
      conversation_status: ["open", "closed", "locked"],
      dispute_status: ["open", "under_review", "resolved", "rejected"],
      payment_provider: ["paystack", "flutterwave", "mock"],
      payment_status: ["pending", "success", "failed", "abandoned", "refunded", "partially_refunded"],
      payout_status: ["pending", "processing", "paid", "failed", "on_hold"],
      portfolio_media_type: ["image", "video"],
      pricing_type: ["fixed", "hourly", "starting_from", "quote_only"],
      review_status: ["published", "hidden"],
      user_role: ["customer", "business", "admin"],
      user_status: ["active", "suspended", "deactivated"],
      verification_document_type: [
        "cac_certificate",
        "national_id",
        "drivers_license",
        "international_passport",
        "voters_card",
        "utility_bill",
        "professional_license",
        "other",
      ],
      verification_request_status: ["open", "submitted", "closed"],
      verification_status: ["pending", "approved", "rejected", "needs_more_info"],
    },
  },
} as const;
