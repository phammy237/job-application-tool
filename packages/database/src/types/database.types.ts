/**
 * Hand-authored Supabase database types for the Phase 1 schema
 * (supabase/migrations/0001_init.sql). Regenerate/extend with
 * `supabase gen types typescript` once a live project exists — until then this file is the
 * source of truth for `packages/database`'s query layer and must be kept in sync with the
 * migration by hand.
 *
 * Every table includes `Relationships: []` even where FKs exist (e.g. experiences ->
 * candidate_facts) because postgrest-js's `GenericTable` constraint requires the field to be
 * present for the query builder's generics to resolve at all — an empty array just means no
 * embedded-resource (`.select('*, other_table(*)')`) queries are typed yet. Add real
 * relationship descriptors here if/when a query needs to embed a related table.
 *
 * Tables intentionally NOT included yet (added in their respective phases):
 * generated_answers (Phase 3), email_connections / email_signals (Phase 5).
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          user_id: string;
          full_name: string | null;
          headline: string | null;
          email: string | null;
          phone: string | null;
          location: string | null;
          work_authorization: string | null;
          relocation_preference: string | null;
          links: Json;
          public_slug: string | null;
          visible_on_public_profile: boolean;
          onboarding_completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<
          Omit<Database['public']['Tables']['profiles']['Row'], 'user_id'>
        > & {
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      candidate_facts: {
        Row: {
          id: string;
          user_id: string;
          category: string;
          title: string;
          normalized_value: string;
          source_text: string | null;
          source_resume_id: string | null;
          user_approved: boolean;
          approved_for_applications: boolean;
          visible_on_public_profile: boolean;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['candidate_facts']['Row']> & {
          user_id: string;
          category: string;
          title: string;
          normalized_value: string;
        };
        Update: Partial<Database['public']['Tables']['candidate_facts']['Row']>;
        Relationships: [];
      };
      experiences: {
        Row: {
          id: string;
          user_id: string;
          source_fact_id: string | null;
          company: string;
          title: string;
          location: string | null;
          employment_type: string | null;
          start_date: string | null;
          end_date: string | null;
          description: string | null;
          tags: string[];
          user_approved: boolean;
          approved_for_applications: boolean;
          visible_on_public_profile: boolean;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['experiences']['Row']> & {
          user_id: string;
          company: string;
          title: string;
        };
        Update: Partial<Database['public']['Tables']['experiences']['Row']>;
        Relationships: [];
      };
      education: {
        Row: {
          id: string;
          user_id: string;
          source_fact_id: string | null;
          school: string;
          degree: string | null;
          field_of_study: string | null;
          start_date: string | null;
          graduation_date: string | null;
          gpa: string | null;
          honors: string[];
          user_approved: boolean;
          approved_for_applications: boolean;
          visible_on_public_profile: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['education']['Row']> & {
          user_id: string;
          school: string;
        };
        Update: Partial<Database['public']['Tables']['education']['Row']>;
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          user_id: string;
          source_fact_id: string | null;
          name: string;
          description: string | null;
          role: string | null;
          start_date: string | null;
          end_date: string | null;
          url: string | null;
          tags: string[];
          user_approved: boolean;
          approved_for_applications: boolean;
          visible_on_public_profile: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['projects']['Row']> & {
          user_id: string;
          name: string;
        };
        Update: Partial<Database['public']['Tables']['projects']['Row']>;
        Relationships: [];
      };
      skills: {
        Row: {
          id: string;
          user_id: string;
          source_fact_id: string | null;
          name: string;
          category: string | null;
          proficiency: string | null;
          user_approved: boolean;
          approved_for_applications: boolean;
          visible_on_public_profile: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['skills']['Row']> & {
          user_id: string;
          name: string;
        };
        Update: Partial<Database['public']['Tables']['skills']['Row']>;
        Relationships: [];
      };
      resumes: {
        Row: {
          id: string;
          user_id: string;
          file_path: string;
          file_name: string;
          label: string | null;
          is_primary: boolean;
          extraction_status: string;
          extracted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['resumes']['Row']> & {
          user_id: string;
          file_path: string;
          file_name: string;
        };
        Update: Partial<Database['public']['Tables']['resumes']['Row']>;
        Relationships: [];
      };
      jobs: {
        Row: {
          id: string;
          user_id: string;
          company: string | null;
          title: string | null;
          location: string | null;
          employment_type: string | null;
          description: string | null;
          responsibilities: string[];
          qualifications: string[];
          preferred_qualifications: string[];
          skills: string[];
          source_url: string | null;
          platform_type: string | null;
          raw_extraction: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['jobs']['Row']> & {
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['jobs']['Row']>;
        Relationships: [];
      };
      extension_sessions: {
        Row: {
          id: string;
          user_id: string;
          token_hash: string;
          device_label: string | null;
          last_used_at: string | null;
          expires_at: string;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['extension_sessions']['Row']> & {
          user_id: string;
          token_hash: string;
          expires_at: string;
        };
        Update: Partial<Database['public']['Tables']['extension_sessions']['Row']>;
        Relationships: [];
      };
      applications: {
        Row: {
          id: string;
          user_id: string;
          job_id: string | null;
          resume_id: string | null;
          company: string;
          title: string;
          status: string;
          notes: string | null;
          applied_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['applications']['Row']> & {
          user_id: string;
          company: string;
          title: string;
        };
        Update: Partial<Database['public']['Tables']['applications']['Row']>;
        Relationships: [];
      };
      application_events: {
        Row: {
          id: string;
          user_id: string;
          application_id: string;
          event_type: string;
          from_status: string | null;
          to_status: string | null;
          source: string;
          email_signal_id: string | null;
          reverted_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['application_events']['Row']> & {
          user_id: string;
          application_id: string;
          event_type: string;
          source: string;
        };
        Update: Partial<Database['public']['Tables']['application_events']['Row']>;
        Relationships: [];
      };
      user_settings: {
        Row: {
          user_id: string;
          gmail_integration_enabled: boolean;
          ai_requests_this_period: number;
          ai_request_period_started_at: string;
          ai_request_limit: number;
          theme: string;
        };
        Insert: Partial<Database['public']['Tables']['user_settings']['Row']> & {
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['user_settings']['Row']>;
        Relationships: [];
      };
      feature_flags: {
        Row: {
          key: string;
          enabled: boolean;
          description: string | null;
          updated_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['feature_flags']['Row']> & {
          key: string;
        };
        Update: Partial<Database['public']['Tables']['feature_flags']['Row']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
