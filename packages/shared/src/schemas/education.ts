import { z } from 'zod';
import {
  approvalFieldsSchema,
  isoDateSchema,
  isoDateTimeSchema,
  uuidSchema,
} from './common';

export const educationSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    sourceFactId: uuidSchema.nullable(),
    school: z.string().min(1),
    degree: z.string().nullable(),
    fieldOfStudy: z.string().nullable(),
    startDate: isoDateSchema.nullable(),
    graduationDate: isoDateSchema.nullable(),
    gpa: z.string().nullable(),
    honors: z.array(z.string()).default([]),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .merge(approvalFieldsSchema);
export type Education = z.infer<typeof educationSchema>;

export const educationInputSchema = educationSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type EducationInput = z.infer<typeof educationInputSchema>;

export const educationUpdateSchema = educationInputSchema.partial();
export type EducationUpdate = z.infer<typeof educationUpdateSchema>;
