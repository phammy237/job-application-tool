import {
  EMAIL_CLASSIFICATION_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
  REQUIREMENT_MAPPING_MAX_OUTPUT_TOKENS,
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
      relationship: { type: 'string', enum: ['DIRECT', 'EQUIVALENT', 'INFERRED', 'MISSING'] },
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
