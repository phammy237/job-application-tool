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
 * email_connections / email_signals (Phase 5).
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
          location: string | null;
          source_url: string | null;
          canonical_url: string | null;
          ats_provider: string | null;
          external_id: string | null;
          autofill_summary: Json | null;
          unresolved_fields: Json | null;
          job_snapshot_id: string | null;
          submission_packet_id: string | null;
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
      generated_answers: {
        Row: {
          id: string;
          user_id: string;
          application_id: string | null;
          job_id: string | null;
          field_label: string;
          field_classification: string;
          answer: string;
          confidence: number;
          source_fact_ids: string[];
          reasoning_summary: string | null;
          unsupported_claims: string[];
          requires_user_review: boolean;
          user_decision: string | null;
          final_text: string | null;
          insufficient_data: boolean | null;
          rejection_reason: string | null;
          available_fact_ids: string[] | null;
          generation_run_id: string | null;
          attempt_number: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['generated_answers']['Row']> & {
          user_id: string;
          field_label: string;
          field_classification: string;
          answer: string;
          confidence: number;
        };
        Update: Partial<Database['public']['Tables']['generated_answers']['Row']>;
        Relationships: [];
      };
      ai_usage_events: {
        Row: {
          id: string;
          user_id: string;
          application_id: string | null;
          generation_run_id: string;
          attempt_number: number;
          ladder: string;
          field_classification: string | null;
          provider: string | null;
          model: string | null;
          task_type: string;
          provider_succeeded: boolean | null;
          outcome: string;
          rejection_reason: string | null;
          escalation_reason: string | null;
          input_tokens: number;
          cached_input_tokens: number;
          output_tokens: number;
          estimated_cost: number | null;
          latency_ms: number | null;
          prompt_version: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['ai_usage_events']['Row']> & {
          user_id: string;
          generation_run_id: string;
          attempt_number: number;
          ladder: string;
          task_type: string;
          outcome: string;
        };
        Update: Partial<Database['public']['Tables']['ai_usage_events']['Row']>;
        Relationships: [];
      };
      job_snapshots: {
        Row: {
          id: string;
          user_id: string;
          source_job_id: string;
          company: string;
          title: string;
          location: string | null;
          employment_type: string | null;
          source_url: string | null;
          external_id: string | null;
          description: string | null;
          required_qualifications: string[];
          preferred_qualifications: string[];
          responsibilities: string[];
          skills: string[];
          salary_min: number | null;
          salary_max: number | null;
          salary_currency: string | null;
          locations: string[];
          work_mode: string | null;
          remote_location_restrictions: string | null;
          work_authorization_language: string | null;
          source_type: string | null;
          content_fingerprint: string;
          content_truncated: boolean;
          truncated_fields: string[];
          captured_at: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['job_snapshots']['Row']> & {
          user_id: string;
          source_job_id: string;
          company: string;
          title: string;
          content_fingerprint: string;
        };
        Update: Partial<Database['public']['Tables']['job_snapshots']['Row']>;
        Relationships: [];
      };
      requirement_mapping_runs: {
        Row: {
          id: string;
          user_id: string;
          job_snapshot_id: string;
          status: string;
          provider: string;
          model: string;
          prompt_version: string;
          retrieval_fact_count: number;
          failure_category: string | null;
          created_at: string;
          completed_at: string | null;
          failed_at: string | null;
        };
        Insert: Partial<
          Database['public']['Tables']['requirement_mapping_runs']['Row']
        > & {
          user_id: string;
          job_snapshot_id: string;
          status: string;
          provider: string;
          model: string;
          prompt_version: string;
        };
        Update: Partial<Database['public']['Tables']['requirement_mapping_runs']['Row']>;
        Relationships: [];
      };
      requirement_evidence_mappings: {
        Row: {
          id: string;
          user_id: string;
          run_id: string;
          requirement_text: string;
          requirement_fingerprint: string;
          requirement_category: string | null;
          required_or_preferred: string;
          relationship: string;
          matched_facts: Json;
          explanation: string;
          confidence: number;
          requires_user_confirmation: boolean;
          created_at: string;
        };
        Insert: Partial<
          Database['public']['Tables']['requirement_evidence_mappings']['Row']
        > & {
          user_id: string;
          run_id: string;
          requirement_text: string;
          requirement_fingerprint: string;
          required_or_preferred: string;
          relationship: string;
          explanation: string;
          confidence: number;
        };
        Update: Partial<
          Database['public']['Tables']['requirement_evidence_mappings']['Row']
        >;
        Relationships: [];
      };
      email_connections: {
        Row: {
          id: string;
          user_id: string;
          provider: string;
          email_address: string;
          encrypted_refresh_token: string;
          scopes: string[];
          status: string;
          last_synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['email_connections']['Row']> & {
          user_id: string;
          email_address: string;
          encrypted_refresh_token: string;
        };
        Update: Partial<Database['public']['Tables']['email_connections']['Row']>;
        Relationships: [];
      };
      email_signals: {
        Row: {
          id: string;
          user_id: string;
          email_connection_id: string;
          provider_message_id: string;
          sender: string | null;
          sender_domain: string | null;
          subject: string | null;
          received_at: string | null;
          matched_application_id: string | null;
          classification: string | null;
          confidence: number | null;
          evidence: string | null;
          confirmation_status: string;
          processed_at: string;
        };
        Insert: Partial<Database['public']['Tables']['email_signals']['Row']> & {
          user_id: string;
          email_connection_id: string;
          provider_message_id: string;
        };
        Update: Partial<Database['public']['Tables']['email_signals']['Row']>;
        Relationships: [];
      };
      submission_packets: {
        Row: {
          id: string;
          user_id: string;
          application_id: string;
          job_snapshot_id: string | null;
          resume_id: string | null;
          requirement_mapping_run_id: string | null;
          answers_snapshot: Json;
          autofill_summary: Json | null;
          unresolved_fields: Json | null;
          consistency_findings: Json;
          consistency_acknowledgements: Json;
          content_fingerprint: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['submission_packets']['Row']> & {
          user_id: string;
          application_id: string;
          content_fingerprint: string;
        };
        Update: Partial<Database['public']['Tables']['submission_packets']['Row']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_ai_request_usage: {
        Args: {
          p_user_id: string;
          p_period_length?: string;
        };
        Returns: {
          allowed: boolean;
          ai_requests_this_period: number;
          ai_request_limit: number;
          ai_request_period_started_at: string;
        }[];
      };
      upsert_application_from_extension: {
        Args: {
          p_user_id: string;
          p_job_id: string | null;
          p_company: string;
          p_title: string;
          p_location: string | null;
          p_status: string;
          p_source_url: string | null;
          p_canonical_url: string | null;
          p_ats_provider: string | null;
          p_external_id: string | null;
          p_autofill_summary: Json;
          p_unresolved_fields: Json;
        };
        Returns: {
          application_id: string;
          created: boolean;
          final_status: string;
          previous_status: string | null;
        }[];
      };
      upsert_application_with_snapshot: {
        Args: {
          p_user_id: string;
          p_job_id: string;
          p_status: string;
          p_snapshot_company: string;
          p_snapshot_title: string;
          p_snapshot_location: string | null;
          p_snapshot_employment_type: string | null;
          p_snapshot_source_url: string | null;
          p_snapshot_external_id: string | null;
          p_snapshot_description: string | null;
          p_snapshot_required_qualifications: string[];
          p_snapshot_preferred_qualifications: string[];
          p_snapshot_responsibilities: string[];
          p_snapshot_skills: string[];
          p_snapshot_salary_min: number | null;
          p_snapshot_salary_max: number | null;
          p_snapshot_salary_currency: string | null;
          p_snapshot_locations: string[];
          p_snapshot_work_mode: string | null;
          p_snapshot_remote_location_restrictions: string | null;
          p_snapshot_work_authorization_language: string | null;
          p_snapshot_source_type: string | null;
          p_snapshot_content_fingerprint: string;
          p_snapshot_content_truncated: boolean;
          p_snapshot_truncated_fields: string[];
          p_location: string | null;
          p_source_url: string | null;
          p_canonical_url: string | null;
          p_ats_provider: string | null;
          p_external_id: string | null;
          p_autofill_summary: Json;
          p_unresolved_fields: Json;
        };
        Returns: {
          application_id: string;
          created: boolean;
          final_status: string;
          previous_status: string | null;
          job_snapshot_id: string | null;
          snapshot_frozen: boolean;
        }[];
      };
      create_pending_requirement_mapping_run: {
        Args: {
          p_user_id: string;
          p_job_snapshot_id: string;
          p_provider: string;
          p_model: string;
          p_prompt_version: string;
          p_retrieval_fact_count: number;
        };
        Returns: string;
      };
      mark_requirement_mapping_run_failed: {
        Args: {
          p_user_id: string;
          p_run_id: string;
          p_failure_category: string;
        };
        Returns: boolean;
      };
      promote_requirement_mapping_run: {
        Args: {
          p_user_id: string;
          p_run_id: string;
          p_mappings: Json;
        };
        Returns: {
          run_id: string;
          mapping_count: number;
        }[];
      };
      mark_application_applied: {
        Args: {
          p_user_id: string;
          p_application_id: string;
          p_answers_snapshot: Json;
          p_autofill_summary: Json | null;
          p_unresolved_fields: Json | null;
          p_consistency_findings: Json;
          p_consistency_acknowledgements: Json;
          p_job_snapshot_id: string | null;
          p_resume_id: string | null;
          p_requirement_mapping_run_id: string | null;
          p_content_fingerprint: string;
        };
        Returns: {
          application_id: string;
          status: string;
          applied_at: string;
          previous_status: string;
          submission_packet_id: string;
          packet_created: boolean;
        }[];
      };
    };
    Enums: Record<string, never>;
  };
}
