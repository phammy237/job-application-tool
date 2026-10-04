import { z } from 'zod';

export const MIN_QUESTION_LENGTH = 3;
export const MAX_QUESTION_LENGTH = 500;

export const askQuestionSchema = z
  .string()
  .trim()
  .min(MIN_QUESTION_LENGTH, `Ask at least ${MIN_QUESTION_LENGTH} characters.`)
  .max(MAX_QUESTION_LENGTH, `Keep the question under ${MAX_QUESTION_LENGTH} characters.`);

export const EXAMPLE_QUESTIONS: readonly string[] = [
  'What product management projects have I done?',
  'Show cross-functional evidence',
  'Where have I used Python?',
  'Prepare me for a Microsoft PM interview',
  'What is my strongest leadership example?',
  'Which projects show AI experience?',
  'What evidence do I have of user research?',
  'What are my weak areas?',
];
