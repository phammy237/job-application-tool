import {
  COMPANY_RESEARCH_MAX_OUTPUT_TOKENS,
  EMAIL_CLASSIFICATION_MAX_OUTPUT_TOKENS,
  FOLLOW_UP_DRAFT_MAX_OUTPUT_TOKENS,
  INTERVIEW_PREP_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
  REQUIREMENT_MAPPING_MAX_OUTPUT_TOKENS,
  RESUME_TAILORING_MAX_OUTPUT_TOKENS,
  UNSUPPORTED_CLAIM_CHECK_MAX_OUTPUT_TOKENS,
} from '../config';
import { getAnthropicClient } from './client';

/**
 * Hand-written JSON Schema mirroring generatedAnswerContractSchema (packages/shared), rather
 * than the SDK's `zodOutputFormat` helper — that helper requires Zod v4's internals, and this
 * monorepo is pinned to Zod v3 everywhere (packages/shared, packages/database). This schema
 * only needs to match closely enough to constrain the model's output shape; the authoritative
 * check is still the independent Zod v3 parse in contract/validate-contract.ts.
 */
const GENERATED_ANSWER_JSON_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number' },
    sourceFactIds: { type: 'array', items: { type: 'string' } },
    reasoningSummary: { type: 'string' },
    unsupportedClaims: { type: 'array', items: { type: 'string' } },
    requiresUserReview: { type: 'boolean' },
  },
  required: [
    'answer',
    'confidence',
    'sourceFactIds',
    'reasoningSummary',
    'unsupportedClaims',
    'requiresUserReview',
  ],
  additionalProperties: false,
} as const;

export type CallClaudeResult =
  | { status: 'ok'; rawText: string }
  | { status: 'refusal'; category: string | null }
  | { status: 'provider_error'; message: string };

/**
 * Wraps a single structured-JSON generation call. Deliberately has no `tools` array — the
 * single biggest blast-radius reducer against prompt injection in the job/fact content (see
 * docs/AI_GROUNDING.md §2/§6 and the Phase 3 plan): there is nothing for injected text to
 * invoke. `output_config.format` constrains the response shape at the API level as a second,
 * independent layer beneath the Zod validation in contract/validate-contract.ts. Thinking is
 * disabled — this is a short, single-turn structured-output call, not a task that benefits
 * from adaptive reasoning.
 */
export async function callClaudeForSuggestion(
  systemPrompt: string,
  userText: string,
): Promise<CallClaudeResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL_ID,
      max_tokens: MAX_OUTPUT_TOKENS,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
      output_config: {
        format: { type: 'json_schema', schema: GENERATED_ANSWER_JSON_SCHEMA },
      },
    });

    if (response.stop_reason === 'refusal') {
      return { status: 'refusal', category: response.stop_details?.category ?? null };
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { status: 'provider_error', message: 'No text content in Claude response' };
    }
    return { status: 'ok', rawText: textBlock.text };
  } catch (error) {
    return {
      status: 'provider_error',
      message: error instanceof Error ? error.message : 'Unknown Anthropic API error',
    };
  }
}

/**
 * Mirrors generatedAnswerContractSchema's JSON Schema mirror above, but for
 * requirementMappingRunContractSchema (packages/shared) — a JSON array of requirement objects
 * rather than one answer object.
 */
const REQUIREMENT_MAPPING_JSON_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      requirementText: { type: 'string' },
      requirementCategory: {
        type: ['string', 'null'],
        enum: [
          'SKILL',
          'EXPERIENCE',
          'EDUCATION',
          'CERTIFICATION',
          'WORK_AUTHORIZATION',
          'LOCATION',
          'LANGUAGE',
          'OTHER',
          null,
        ],
      },
      requiredOrPreferred: { type: 'string', enum: ['REQUIRED', 'PREFERRED'] },
      relationship: {
        type: 'string',
        enum: ['DIRECT', 'EQUIVALENT', 'INFERRED', 'MISSING'],
      },
      matchedFactIds: { type: 'array', items: { type: 'string' } },
      explanation: { type: 'string' },
      confidence: { type: 'number' },
      requiresUserConfirmation: { type: 'boolean' },
    },
    required: [
      'requirementText',
      'requirementCategory',
      'requiredOrPreferred',
      'relationship',
      'matchedFactIds',
      'explanation',
      'confidence',
      'requiresUserConfirmation',
    ],
    additionalProperties: false,
  },
} as const;

/**
 * Same no-tools/thinking-disabled/schema-constrained posture as callClaudeForSuggestion — the
 * single biggest blast-radius reducer against prompt injection in the snapshot content
 * (docs/AI_GROUNDING.md §2/§6, extended by docs/IMPLEMENTATION_PLAN.md's Phase 5A round-4
 * addendum §7). A separate function rather than a generalized/parameterized one: the two
 * contracts have different shapes and different output-token budgets, and keeping them
 * independent means a change to one call shape can never accidentally affect the other's
 * already-verified behavior.
 */
export async function callClaudeForRequirementMapping(
  systemPrompt: string,
  userText: string,
): Promise<CallClaudeResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL_ID,
      max_tokens: REQUIREMENT_MAPPING_MAX_OUTPUT_TOKENS,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
      output_config: {
        format: { type: 'json_schema', schema: REQUIREMENT_MAPPING_JSON_SCHEMA },
      },
    });

    if (response.stop_reason === 'refusal') {
      return { status: 'refusal', category: response.stop_details?.category ?? null };
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { status: 'provider_error', message: 'No text content in Claude response' };
    }
    return { status: 'ok', rawText: textBlock.text };
  } catch (error) {
    return {
      status: 'provider_error',
      message: error instanceof Error ? error.message : 'Unknown Anthropic API error',
    };
  }
}

/**
 * Mirrors emailClassificationContractSchema (packages/shared) — a single small object, unlike
 * the array-shaped requirement-mapping contract.
 */
const EMAIL_CLASSIFICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    classification: {
      type: 'string',
      enum: [
        'APPLICATION_RECEIVED',
        'ASSESSMENT',
        'INTERVIEW',
        'ACTION_REQUIRED',
        'OFFER',
        'REJECTED',
        'OTHER',
      ],
    },
    confidence: { type: 'number' },
    evidence: { type: 'string' },
  },
  required: ['classification', 'confidence', 'evidence'],
  additionalProperties: false,
} as const;

/**
 * Same no-tools/thinking-disabled/schema-constrained posture as the other two call* functions —
 * the single biggest blast-radius reducer against prompt injection, which matters even more here
 * since the untrusted content is a real third-party-authored email rather than a job posting (see
 * build-email-classification-system-prompt.ts). A separate function rather than a
 * generalized/parameterized one, same rationale as callClaudeForRequirementMapping's doc comment:
 * each contract has its own shape and output-token budget, kept independent so a change to one
 * call can never accidentally affect the others' already-verified behavior.
 */
/**
 * Mirrors unsupportedClaimCheckContractSchema (packages/shared) — an array with the same length
 * as the number of answers sent, one entry per answer, in order.
 */
const UNSUPPORTED_CLAIM_CHECK_JSON_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      supportStatus: { type: 'string', enum: ['SUPPORTED', 'UNSUPPORTED', 'UNCERTAIN'] },
      citedFactIds: { type: 'array', items: { type: 'string' } },
      explanation: { type: 'string' },
    },
    required: ['supportStatus', 'citedFactIds', 'explanation'],
    additionalProperties: false,
  },
} as const;

/**
 * Same no-tools/thinking-disabled/schema-constrained posture as the other call* functions — the
 * content being assessed here is the user's own already-approved/edited answer text, not
 * third-party content, but the posture is kept identical for consistency and because an answer's
 * text could itself echo untrusted job-posting language the user pasted in.
 */
export async function callClaudeForUnsupportedClaimCheck(
  systemPrompt: string,
  userText: string,
): Promise<CallClaudeResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL_ID,
      max_tokens: UNSUPPORTED_CLAIM_CHECK_MAX_OUTPUT_TOKENS,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
      output_config: {
        format: { type: 'json_schema', schema: UNSUPPORTED_CLAIM_CHECK_JSON_SCHEMA },
      },
    });

    if (response.stop_reason === 'refusal') {
      return { status: 'refusal', category: response.stop_details?.category ?? null };
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { status: 'provider_error', message: 'No text content in Claude response' };
    }
    return { status: 'ok', rawText: textBlock.text };
  } catch (error) {
    return {
      status: 'provider_error',
      message: error instanceof Error ? error.message : 'Unknown Anthropic API error',
    };
  }
}

/**
 * Mirrors `followUpDraftModelContractSchema` (packages/shared) — deliberately just
 * `subject`/`body`, no `groundingNotes`/`usedContext` field for the model to fill in (see that
 * schema's own doc comment for why: provenance here is always server-derived, never a model
 * claim).
 */
const FOLLOW_UP_DRAFT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: ['string', 'null'] },
    body: { type: 'string' },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
} as const;

/**
 * Same no-tools/thinking-disabled/schema-constrained posture as the other call* functions — the
 * job snapshot and any confirmed-email context placed in the prompt are untrusted third-party
 * content (docs/AI_GROUNDING.md §2/§6), same as the requirement-mapping pipeline's job posting.
 */
export async function callClaudeForFollowUpDraft(
  systemPrompt: string,
  userText: string,
): Promise<CallClaudeResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL_ID,
      max_tokens: FOLLOW_UP_DRAFT_MAX_OUTPUT_TOKENS,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
      output_config: {
        format: { type: 'json_schema', schema: FOLLOW_UP_DRAFT_JSON_SCHEMA },
      },
    });

    if (response.stop_reason === 'refusal') {
      return { status: 'refusal', category: response.stop_details?.category ?? null };
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { status: 'provider_error', message: 'No text content in Claude response' };
    }
    return { status: 'ok', rawText: textBlock.text };
  } catch (error) {
    return {
      status: 'provider_error',
      message: error instanceof Error ? error.message : 'Unknown Anthropic API error',
    };
  }
}

/** Mirrors `interviewPrepModelContractSchema` (packages/shared) — six bounded arrays of small
 * objects; every `sourceFactIds`/`sourceRequirementId(s)` field is a bare id list/nullable id,
 * never a nested object, so the model cannot smuggle extra unvalidated fields through it. */
const INTERVIEW_PREP_JSON_SCHEMA = {
  type: 'object',
  properties: {
    rolePriorities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string' },
          importance: { type: 'string', enum: ['REQUIRED', 'PREFERRED'] },
          sourceRequirementId: { type: ['string', 'null'] },
          researchFindingIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['requirement', 'importance', 'sourceRequirementId'],
        additionalProperties: false,
      },
    },
    evidenceToEmphasize: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          theme: { type: 'string' },
          sourceFactIds: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
          researchFindingIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['theme', 'sourceFactIds', 'summary'],
        additionalProperties: false,
      },
    },
    starStoryPrompts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          competency: { type: 'string' },
          sourceFactIds: { type: 'array', items: { type: 'string' } },
          prompt: { type: 'string' },
          researchFindingIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['competency', 'sourceFactIds', 'prompt'],
        additionalProperties: false,
      },
    },
    possibleQuestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          rationale: { type: 'string' },
          sourceRequirementIds: { type: 'array', items: { type: 'string' } },
          researchFindingIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['question', 'rationale', 'sourceRequirementIds'],
        additionalProperties: false,
      },
    },
    questionsToAsk: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          rationale: { type: 'string' },
          researchFindingIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['question', 'rationale'],
        additionalProperties: false,
      },
    },
    gapsToPrepare: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          requirement: { type: 'string' },
          sourceRequirementId: { type: ['string', 'null'] },
          note: { type: 'string' },
          researchFindingIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['requirement', 'sourceRequirementId', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'rolePriorities',
    'evidenceToEmphasize',
    'starStoryPrompts',
    'possibleQuestions',
    'questionsToAsk',
    'gapsToPrepare',
  ],
  additionalProperties: false,
} as const;

/**
 * Same no-tools/thinking-disabled/schema-constrained posture as `callClaudeForRequirementMapping`
 * — the job snapshot (and, when present, requirement-mapping text) is untrusted third-party
 * content, same prompt-injection posture as that pipeline.
 */
export async function callClaudeForInterviewPrep(
  systemPrompt: string,
  userText: string,
): Promise<CallClaudeResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL_ID,
      max_tokens: INTERVIEW_PREP_MAX_OUTPUT_TOKENS,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
      output_config: {
        format: { type: 'json_schema', schema: INTERVIEW_PREP_JSON_SCHEMA },
      },
    });

    if (response.stop_reason === 'refusal') {
      return { status: 'refusal', category: response.stop_details?.category ?? null };
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { status: 'provider_error', message: 'No text content in Claude response' };
    }
    return { status: 'ok', rawText: textBlock.text };
  } catch (error) {
    return {
      status: 'provider_error',
      message: error instanceof Error ? error.message : 'Unknown Anthropic API error',
    };
  }
}

/**
 * Mirrors `resumeTailoringPlanSchema` (packages/shared) — a single object with one array field,
 * `operations`, each a discriminated union by `type`. JSON Schema itself cannot express Zod's
 * discriminated-union/refine semantics (e.g. "ADD_BULLET requires min 1 sourceFactIds"), so this
 * schema is intentionally the union of every operation type's fields as one loosely-typed object
 * shape (every field optional except `type`/`reason`) — it only needs to keep the model roughly
 * on-shape at the API level; the real, authoritative check is the independent Zod v3 parse in
 * contract/validate-resume-tailoring-contract.ts followed by the shared, deep semantic validator
 * (`validateResumeTailoringPlan`). No `latexSource`/`template`/free-form résumé field exists
 * anywhere in this schema, by construction (docs/IMPLEMENTATION_PLAN.md "Phase 7E" §23/§44).
 */
const RESUME_TAILORING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'REWRITE_BULLET',
              'ADD_BULLET',
              'OMIT_BULLET',
              'OMIT_ENTRY',
              'MOVE_BULLET',
              'MOVE_ENTRY',
              'REORDER_SKILLS',
            ],
          },
          bulletId: { type: 'string' },
          entryId: { type: 'string' },
          proposedText: { type: 'string' },
          sourceFactIds: { type: 'array', items: { type: 'string' } },
          requirementIds: { type: 'array', items: { type: 'string' } },
          /** Phase 7H — OPTIONAL company-relevance citations (docs/IMPLEMENTATION_PLAN.md
           * "Phase 7H" §12); present on every operation type, exactly like requirementIds, and
           * never treated as a substitute for sourceFactIds by the deep validator. */
          researchFindingIds: { type: 'array', items: { type: 'string' } },
          targetIndex: { type: 'integer' },
          orderedSkillGroupIds: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['type', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['operations'],
  additionalProperties: false,
} as const;

/**
 * Same no-tools/thinking-disabled/schema-constrained posture as the other call* functions — the
 * job snapshot, any requirement-mapping analysis, and the base résumé's own bullet text are all
 * untrusted-ish content placed in the prompt (the résumé bullets are the user's own words, but
 * are still treated with the same discipline as every other pipeline's prompt content).
 */
export async function callClaudeForResumeTailoring(
  systemPrompt: string,
  userText: string,
): Promise<CallClaudeResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL_ID,
      max_tokens: RESUME_TAILORING_MAX_OUTPUT_TOKENS,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
      output_config: {
        format: { type: 'json_schema', schema: RESUME_TAILORING_JSON_SCHEMA },
      },
    });

    if (response.stop_reason === 'refusal') {
      return { status: 'refusal', category: response.stop_details?.category ?? null };
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { status: 'provider_error', message: 'No text content in Claude response' };
    }
    return { status: 'ok', rawText: textBlock.text };
  } catch (error) {
    return {
      status: 'provider_error',
      message: error instanceof Error ? error.message : 'Unknown Anthropic API error',
    };
  }
}

/**
 * Mirrors `companyResearchPlanContractSchema` (packages/shared) — a single object with one array
 * field, `findings`, each a small object citing already-discovered source/requirement ids. No
 * `url`/`title`/`publisher`/`publishedAt` field exists anywhere in this schema, by construction
 * (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §16/§25: "The model should not invent URLs").
 */
const COMPANY_RESEARCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: [
              'PRODUCT',
              'STRATEGY',
              'TECHNOLOGY',
              'BUSINESS',
              'CULTURE',
              'HIRING',
              'RECENT_DEVELOPMENT',
              'OTHER',
            ],
          },
          claim: { type: 'string' },
          roleRelevance: { type: ['string', 'null'] },
          sourceIds: { type: 'array', items: { type: 'string' } },
          requirementIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'claim', 'roleRelevance', 'sourceIds', 'requirementIds'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
} as const;

/**
 * Same no-tools/thinking-disabled/schema-constrained posture as every other call* function — the
 * extracted source text placed in the prompt is third-party web content, the single strongest
 * prompt-injection vector in this entire codebase (docs/IMPLEMENTATION_PLAN.md "Phase 7G" §24),
 * which is exactly why there are no tools on this call at all.
 */
export async function callClaudeForCompanyResearch(
  systemPrompt: string,
  userText: string,
): Promise<CallClaudeResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL_ID,
      max_tokens: COMPANY_RESEARCH_MAX_OUTPUT_TOKENS,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
      output_config: {
        format: { type: 'json_schema', schema: COMPANY_RESEARCH_JSON_SCHEMA },
      },
    });

    if (response.stop_reason === 'refusal') {
      return { status: 'refusal', category: response.stop_details?.category ?? null };
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { status: 'provider_error', message: 'No text content in Claude response' };
    }
    return { status: 'ok', rawText: textBlock.text };
  } catch (error) {
    return {
      status: 'provider_error',
      message: error instanceof Error ? error.message : 'Unknown Anthropic API error',
    };
  }
}

export async function callClaudeForEmailClassification(
  systemPrompt: string,
  userText: string,
): Promise<CallClaudeResult> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: MODEL_ID,
      max_tokens: EMAIL_CLASSIFICATION_MAX_OUTPUT_TOKENS,
      thinking: { type: 'disabled' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
      output_config: {
        format: { type: 'json_schema', schema: EMAIL_CLASSIFICATION_JSON_SCHEMA },
      },
    });

    if (response.stop_reason === 'refusal') {
      return { status: 'refusal', category: response.stop_details?.category ?? null };
    }

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { status: 'provider_error', message: 'No text content in Claude response' };
    }
    return { status: 'ok', rawText: textBlock.text };
  } catch (error) {
    return {
      status: 'provider_error',
      message: error instanceof Error ? error.message : 'Unknown Anthropic API error',
    };
  }
}
