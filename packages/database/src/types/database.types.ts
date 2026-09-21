/**
 * Hand-maintained Supabase database types — this is NOT a generated file, and it is not meant
 * to become one on some future trigger. A live Supabase project has existed since the Phase 1
 * commit, and every phase since (through Phase 6A) has continued to hand-add each migration's
 * new tables/columns/functions here rather than switching to `supabase gen types typescript`.
 * That is the established, intentional practice for this repo (see `packages/database/README.md`
 * and docs/IMPLEMENTATION_PLAN.md's Phase 5B.1 file list, which already called this out
 * explicitly) — not a stopgap. Whoever adds a migration keeps this file in sync by hand, in the
 * same PR, matching each new/changed column's actual nullability and required-on-insert status.
 *
 * The live Supabase schema — not this file — is the authoritative source of truth. Verify this
 * file against it periodically with `supabase gen types typescript --linked` (compare, don't
 * blindly overwrite: the real output's shape differs structurally — `type` vs `interface`,
 * per-column `Insert`/`Update` instead of this file's `Partial<Row> & {...}` pattern, real
 * `Relationships` entries, an `__InternalSupabase` block, and a boilerplate `graphql_public`
 * schema — so a wholesale replacement is a real design decision, not a routine sync).
 *
 * Every table here includes `Relationships: []` even where FKs exist (e.g. experiences ->
 * candidate_facts) because postgrest-js's `GenericTable` constraint requires the field to be
 * present for the query builder's generics to resolve at all — an empty array just means no
 * embedded-resource (`.select('*, other_table(*)')`) queries are typed yet. Add real
 * relationship descriptors here if/when a query needs to embed a related table.
 *
 * CHECK-constrained text columns (e.g. `contacts.source`, `applications.status`) are typed as
 * plain `string` here, matching what real generation would also produce — Postgres CHECK
 * constraints don't reflect into TypeScript literal unions either way. The real enum narrowing
 * for those columns lives in `@career-os/shared`'s Zod schemas, applied when a query module maps
 * a raw row into its domain type.
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
      resume_uploads: {
        Row: {
          id: string;
          user_id: string;
          file_path: string;
          file_name: string;
          label: string | null;
          is_primary: boolean;
          extraction_status: string;
          extracted_at: string | null;
          // Added in migration 0034 (Phase B, Resume Import) — nullable; absent on any row that
          // predates this migration (none in any real environment — see that migration's comment).
          content_hash: string | null;
          content_type: string | null;
          file_size_bytes: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['resume_uploads']['Row']> & {
          user_id: string;
          file_path: string;
          file_name: string;
        };
        Update: Partial<Database['public']['Tables']['resume_uploads']['Row']>;
        Relationships: [];
      };
      /** Migration 0020 (Phase 7A) — logical résumé identity. Distinct from `resume_uploads`
       * above (the unrelated, still-unwired uploaded-file/extraction concept this table's `resumes`
       * name was renamed away from in the same migration). */
      resumes: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          kind: string;
          parent_resume_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['resumes']['Row']> & {
          user_id: string;
          name: string;
          kind: string;
        };
        Update: Partial<Database['public']['Tables']['resumes']['Row']>;
        Relationships: [];
      };
      /** Migration 0020 (Phase 7A) — immutable résumé version snapshots. Written only through the
       * `create_resume_version` RPC (see Functions below); no ordinary insert/update from
       * `authenticated`. */
      resume_versions: {
        Row: {
          id: string;
          user_id: string;
          resume_id: string;
          version_number: number;
          display_name: string;
          snapshot_format: string;
          snapshot_payload: Json | null;
          created_at: string;
          // Added in migration 0028 (Phase 7H) — nullable; the exact immutable company-research
          // snapshot that informed this version, if any. `on delete restrict` from
          // company_research_snapshots: an owner cannot delete a snapshot once a résumé version
          // references it (see that migration's own doc comment for why RESTRICT was chosen over
          // SET NULL here).
          company_research_snapshot_id: string | null;
        };
        Insert: Partial<Database['public']['Tables']['resume_versions']['Row']> & {
          user_id: string;
          resume_id: string;
          version_number: number;
          display_name: string;
        };
        Update: Partial<Database['public']['Tables']['resume_versions']['Row']>;
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
          working_resume_version_id: string | null;
          /** Added in migration 0032 (D6) — durable provenance back to the global job_catalog
           * row this application was started from, if any. Nullable; null for every non-discovery
           * application. */
          job_catalog_id: string | null;
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
          /** Added in migration 0032 (D6) — only ever populated on DISCOVERY_HANDOFF events. */
          metadata: Json | null;
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
          resume_version_id: string | null;
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
      contacts: {
        Row: {
          id: string;
          user_id: string;
          display_name: string;
          first_name: string | null;
          last_name: string | null;
          email: string | null;
          phone: string | null;
          linkedin_url: string | null;
          current_company: string | null;
          current_title: string | null;
          location: string | null;
          notes: string | null;
          source: string;
          follow_up_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['contacts']['Row']> & {
          user_id: string;
          display_name: string;
          source: string;
        };
        Update: Partial<Database['public']['Tables']['contacts']['Row']>;
        Relationships: [];
      };
      contact_tags: {
        Row: {
          user_id: string;
          contact_id: string;
          tag: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['contact_tags']['Row']> & {
          user_id: string;
          contact_id: string;
          tag: string;
        };
        Update: Partial<Database['public']['Tables']['contact_tags']['Row']>;
        Relationships: [];
      };
      application_contacts: {
        Row: {
          user_id: string;
          application_id: string;
          contact_id: string;
          role: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['application_contacts']['Row']> & {
          user_id: string;
          application_id: string;
          contact_id: string;
          role: string;
        };
        Update: Partial<Database['public']['Tables']['application_contacts']['Row']>;
        Relationships: [];
      };
      contact_interactions: {
        Row: {
          id: string;
          user_id: string;
          contact_id: string;
          interaction_type: string;
          direction: string | null;
          occurred_at: string;
          subject: string | null;
          notes: string | null;
          application_id: string | null;
          source: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['contact_interactions']['Row']> & {
          user_id: string;
          contact_id: string;
          interaction_type: string;
          occurred_at: string;
        };
        Update: Partial<Database['public']['Tables']['contact_interactions']['Row']>;
        Relationships: [];
      };
      // Added in migration 0025 (Phase 7G) — company research. All four tables are immutable
      // once written (block-update triggers) and have no INSERT policy for `authenticated`;
      // every row is created exclusively through the create_company_research_snapshot RPC below.
      company_research_snapshots: {
        Row: {
          id: string;
          user_id: string;
          application_id: string | null;
          company_name: string;
          role_title: string;
          job_snapshot_id: string | null;
          researched_at: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['company_research_snapshots']['Row']> & {
          user_id: string;
          company_name: string;
          role_title: string;
        };
        Update: Partial<Database['public']['Tables']['company_research_snapshots']['Row']>;
        Relationships: [];
      };
      company_research_sources: {
        Row: {
          id: string;
          user_id: string;
          snapshot_id: string;
          url: string;
          canonical_url: string | null;
          title: string;
          publisher: string | null;
          source_type: string;
          published_at: string | null;
          retrieved_at: string;
          evidence_excerpt: string | null;
          content_hash: string | null;
        };
        Insert: Partial<Database['public']['Tables']['company_research_sources']['Row']> & {
          user_id: string;
          snapshot_id: string;
          url: string;
          title: string;
          source_type: string;
        };
        Update: Partial<Database['public']['Tables']['company_research_sources']['Row']>;
        Relationships: [];
      };
      company_research_findings: {
        Row: {
          id: string;
          user_id: string;
          snapshot_id: string;
          category: string;
          claim: string;
          role_relevance: string | null;
          requirement_ids: string[];
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['company_research_findings']['Row']> & {
          user_id: string;
          snapshot_id: string;
          category: string;
          claim: string;
        };
        Update: Partial<Database['public']['Tables']['company_research_findings']['Row']>;
        Relationships: [];
      };
      company_research_finding_sources: {
        Row: {
          user_id: string;
          snapshot_id: string;
          finding_id: string;
          source_id: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['company_research_finding_sources']['Row']> & {
          user_id: string;
          snapshot_id: string;
          finding_id: string;
          source_id: string;
        };
        Update: Partial<Database['public']['Tables']['company_research_finding_sources']['Row']>;
        Relationships: [];
      };
      job_sources: {
        Row: {
          id: string;
          company_name: string;
          source_type: string;
          source_identifier: string;
          careers_url: string | null;
          enabled: boolean;
          crawl_interval_hours: number;
          last_crawled_at: string | null;
          last_success_at: string | null;
          last_error_at: string | null;
          last_error: string | null;
          consecutive_failures: number;
          etag: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['job_sources']['Row']> & {
          company_name: string;
          source_type: string;
          source_identifier: string;
        };
        Update: Partial<Database['public']['Tables']['job_sources']['Row']>;
        Relationships: [];
      };
      job_catalog: {
        Row: {
          id: string;
          source_id: string;
          source_job_id: string;
          company_name: string;
          title: string;
          normalized_title: string;
          location_text: string | null;
          normalized_location: string | null;
          city: string | null;
          state_region: string | null;
          country: string | null;
          workplace_type: string | null;
          employment_type: string | null;
          description: string | null;
          responsibilities: string | null;
          qualifications: string | null;
          salary_min: number | null;
          salary_max: number | null;
          salary_currency: string | null;
          apply_url: string;
          source_url: string | null;
          canonical_apply_url: string | null;
          dedupe_fingerprint: string | null;
          cross_source_observations: Json;
          posted_at: string | null;
          source_updated_at: string | null;
          first_seen_at: string;
          last_seen_at: string;
          content_updated_at: string;
          consecutive_misses: number;
          status: string;
          closed_at: string | null;
          /** D7.1 — official-posting-resolution bookkeeping. Never read by ranking/features/UI. */
          resolution_status: string;
          resolution_strategy: string | null;
          resolution_confidence: number | null;
          resolution_candidate_url: string | null;
          resolution_attempt_count: number;
          resolution_last_attempt_at: string | null;
          resolution_link_check_failures: number;
          content_hash: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['job_catalog']['Row']> & {
          source_id: string;
          source_job_id: string;
          company_name: string;
          title: string;
          normalized_title: string;
          apply_url: string;
          content_hash: string;
        };
        Update: Partial<Database['public']['Tables']['job_catalog']['Row']>;
        Relationships: [];
      };
      job_catalog_features: {
        Row: {
          id: string;
          job_catalog_id: string;
          content_hash_at_extraction: string;
          plain_text_description: string;
          role_family: string;
          seniority: string;
          is_internship: boolean;
          is_new_grad: boolean;
          normalized_employment_type: string;
          normalized_workplace_type: string;
          location_tokens: string[];
          extracted_competency_codes: string[];
          required_years_min: number | null;
          required_years_max: number | null;
          graduation_year_min: number | null;
          graduation_year_max: number | null;
          sponsorship_signal: string;
          citizenship_requirement: string;
          clearance_requirement: string;
          work_authorization_requirement: string;
          evidence: Json;
          feature_version: string;
          computed_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['job_catalog_features']['Row']> & {
          job_catalog_id: string;
          content_hash_at_extraction: string;
          feature_version: string;
        };
        Update: Partial<Database['public']['Tables']['job_catalog_features']['Row']>;
        Relationships: [];
      };
      discovery_scoring_profiles: {
        Row: {
          id: string;
          user_id: string;
          profile_version: string;
          preset: string;
          criteria_weights: Json;
          role_preferences: Json;
          seniority_preferences: Json;
          location_preferences: Json;
          work_mode_preferences: Json;
          employment_type_preferences: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['discovery_scoring_profiles']['Row']> & {
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['discovery_scoring_profiles']['Row']>;
        Relationships: [];
      };
      discovery_eligibility_profiles: {
        Row: {
          id: string;
          user_id: string;
          currently_authorized_to_work: boolean | null;
          requires_sponsorship_now: boolean | null;
          requires_sponsorship_future: boolean | null;
          is_us_citizen: boolean | null;
          has_active_security_clearance: boolean | null;
          eligible_to_obtain_security_clearance: boolean | null;
          graduation_year: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['discovery_eligibility_profiles']['Row']> & {
          user_id: string;
        };
        Update: Partial<Database['public']['Tables']['discovery_eligibility_profiles']['Row']>;
        Relationships: [];
      };
      user_job_match_scores: {
        Row: {
          id: string;
          user_id: string;
          job_catalog_id: string;
          match_score: number;
          coverage: number;
          eligibility_status: string;
          score_components: Json;
          eligibility_checks: Json;
          ranking_version: string;
          feature_version: string;
          eligibility_version: string;
          computed_at: string;
          created_at: string;
          /** Generated column (migration 0031) — 0=HIGH/1=MODERATE/2=LOW coverage tier, mirroring
           * packages/shared's getCoverageBucket. Read-only; never set on insert/update. */
          coverage_bucket: number;
        };
        Insert: Partial<Database['public']['Tables']['user_job_match_scores']['Row']> & {
          user_id: string;
          job_catalog_id: string;
          match_score: number;
          coverage: number;
          eligibility_status: string;
          ranking_version: string;
          feature_version: string;
          eligibility_version: string;
        };
        Update: Partial<Database['public']['Tables']['user_job_match_scores']['Row']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      list_own_discovery_feed: {
        Args: {
          p_search?: string | null;
          p_role_families?: string[] | null;
          p_location_token?: string | null;
          p_workplace_types?: string[] | null;
          p_employment_types?: string[] | null;
          p_eligibility_statuses?: string[] | null;
          p_min_match?: number | null;
          p_min_coverage?: number | null;
          p_freshness_days?: number | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          job_catalog_id: string;
          title: string;
          company_name: string;
          location_text: string | null;
          normalized_workplace_type: string;
          normalized_employment_type: string;
          /** Added in migration 0037 — the canonical internship classification (broader than
           * normalized_employment_type === 'INTERNSHIP' alone). */
          is_internship: boolean;
          role_family: string;
          first_seen_at: string;
          match_score: number;
          coverage: number;
          eligibility_status: string;
          /** Added in migration 0032 (D6) — both null when the caller has no application linked
           * to this catalog job. */
          tracked_application_id: string | null;
          tracked_application_status: string | null;
          /** Added in migration 0040 (D7.1) — lets the job-card decide its own primary apply
           * action without a separate per-card fetch. */
          canonical_apply_url: string | null;
          source_url: string | null;
          apply_url: string;
        }[];
      };
      start_application_from_catalog_job: {
        Args: {
          p_user_id: string;
          p_job_catalog_id: string;
          p_snapshot_company: string;
          p_snapshot_title: string;
          p_snapshot_location: string | null;
          p_snapshot_employment_type: string | null;
          p_snapshot_source_url: string | null;
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
          p_snapshot_source_type: string | null;
          p_snapshot_content_fingerprint: string;
          p_snapshot_content_truncated: boolean;
          p_snapshot_truncated_fields: string[];
          p_canonical_url: string | null;
          p_event_metadata: Json | null;
        };
        Returns: {
          application_id: string;
          created: boolean;
          application_status: string;
          job_snapshot_id: string | null;
        }[];
      };
      list_discovery_location_tokens: {
        Args: Record<string, never>;
        Returns: { location_token: string }[];
      };
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
      decrement_ai_request_usage: {
        Args: {
          p_user_id: string;
        };
        Returns: undefined;
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
          // Appended in migration 0021 (Phase 7B) with a SQL-side default of null.
          p_resume_version_id?: string | null;
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
      create_resume_version: {
        Args: {
          p_user_id: string;
          p_resume_id: string;
          p_display_name: string;
          p_snapshot_format?: string;
          p_snapshot_payload?: Json | null;
        };
        // `returns public.resume_versions` (a full rowtype) — migration 0028 (Phase 7H) added
        // company_research_snapshot_id to that table, so it comes back here too (always null:
        // this RPC's own signature was never extended with a param for it — see that migration's
        // doc comment for why only save_reviewed_tailored_resume needed the new parameter).
        Returns: {
          id: string;
          user_id: string;
          resume_id: string;
          version_number: number;
          display_name: string;
          snapshot_format: string;
          snapshot_payload: Json | null;
          created_at: string;
          company_research_snapshot_id: string | null;
        };
      };
      // Added in migration 0024 (Phase 7F) — the one atomic save path for a reviewed AI
      // résumé-tailoring draft. p_target_resume_id XOR (p_new_resume_name/p_new_resume_parent_id)
      // is exactly one of "append a version to this existing logical résumé" or "create a new
      // TAILORED résumé first" — see the migration's own doc comment.
      // Migration 0028 (Phase 7H) added an optional p_company_research_snapshot_id param — the
      // old 9-arg signature was dropped and recreated (PostgreSQL treats an added parameter, even
      // with a default, as a distinct overload; see that migration's own doc comment, following
      // migration 0021's precedent for mark_application_applied).
      save_reviewed_tailored_resume: {
        Args: {
          p_user_id: string;
          p_application_id: string;
          p_expected_working_resume_version_id: string | null;
          p_expected_job_snapshot_id: string | null;
          p_target_resume_id: string | null;
          p_new_resume_name: string | null;
          p_new_resume_parent_id: string | null;
          p_version_display_name: string;
          p_snapshot_payload: Json;
          p_company_research_snapshot_id?: string | null;
        };
        Returns: {
          resume_id: string;
          resume_created: boolean;
          version_id: string;
          version_number: number;
          display_name: string;
        }[];
      };
      // Added in migration 0025 (Phase 7G) — the one atomic path for persisting a completed
      // company-research pipeline run. p_sources/p_findings are JSON arrays whose shape is
      // validated structurally inside the function itself (see the migration's own doc comment).
      create_company_research_snapshot: {
        Args: {
          p_user_id: string;
          p_application_id: string | null;
          p_company_name: string;
          p_role_title: string;
          p_job_snapshot_id: string | null;
          p_sources: Json;
          p_findings: Json;
        };
        Returns: {
          snapshot_id: string;
          source_count: number;
          finding_count: number;
        }[];
      };
    };
    Enums: Record<string, never>;
  };
}
