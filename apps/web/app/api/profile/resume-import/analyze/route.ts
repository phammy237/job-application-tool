import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createOwnResumeUpload,
  getOwnResumeUploadByContentHash,
  updateOwnResumeUploadExtractionStatus,
} from '@career-os/database';
import { generateResumeExtraction } from '@career-os/ai';
import { parseResumeContactInfo, type ResumeExtractionResult } from '@career-os/shared';
import { getCurrentUser } from '../../../../../lib/auth';
import { extractPdfText } from '../../../../../lib/pdf-text-extraction';
import { createClient } from '../../../../../lib/supabase/server';

export const maxDuration = 60;

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB — matches the storage bucket's own limit
const BUCKET = 'resume-uploads';

/**
 * Resume Import step 1: "Upload resume" -> "Analyze" (Phase B of the onboarding-path hardening
 * pass). Deliberately synchronous, single request — the whole pipeline (store file, extract PDF
 * text, deterministically parse contact info, AI-structure the rest) completes before responding.
 * NEVER writes to profiles/experiences/education/projects/skills — the returned structured
 * result exists only for the client-side review step; nothing reaches Candidate Profile until
 * the user explicitly confirms (see ../confirm/route.ts). Candidate Profile stays the one
 * canonical source of truth throughout.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });
  }

  // Content-type validation — PDF only, per docs/DEPLOYMENT.md's Resume Import scope decision
  // (DOCX deferred; never silently accepted and mis-parsed).
  if (file.type !== 'application/pdf') {
    return NextResponse.json(
      { error: 'Only PDF résumés are supported right now. Please upload a .pdf file.' },
      { status: 415 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'The uploaded file is empty.' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: 'This file is larger than the 5 MB limit. Please upload a smaller PDF.' },
      { status: 413 },
    );
  }

  const supabase = await createClient();
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = createHash('sha256').update(buffer).digest('hex');

  // Dedup: a repeat upload of the identical file reuses the existing storage object/row rather
  // than writing a duplicate (docs' "no duplicate uploaded files unnecessarily").
  let upload = await getOwnResumeUploadByContentHash(supabase, user.id, contentHash);
  if (!upload) {
    const storagePath = `${user.id}/${contentHash}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true });
    if (uploadError) {
      console.error('[career-os] resume upload to storage failed', uploadError);
      return NextResponse.json(
        { error: 'Could not store your file — please try again.' },
        { status: 500 },
      );
    }
    upload = await createOwnResumeUpload(supabase, user.id, {
      filePath: storagePath,
      // Sanitized: only the base name, no path traversal — never trust the client-supplied name
      // as a filesystem path (it never touches one here, but keep it a plain label regardless).
      fileName: file.name.replace(/[/\\]/g, '_').slice(0, 200) || 'resume.pdf',
      contentType: 'application/pdf',
      fileSizeBytes: file.size,
      contentHash,
    });
  }

  const extraction = await extractPdfText(buffer);
  if (extraction.status === 'no_extractable_text') {
    await updateOwnResumeUploadExtractionStatus(supabase, user.id, upload.id, 'FAILED');
    return NextResponse.json(
      { error: 'This PDF appears to be scanned and contains no extractable text.' },
      { status: 422 },
    );
  }
  if (extraction.status === 'parse_failed') {
    console.error('[career-os] PDF parse failed', extraction.message);
    await updateOwnResumeUploadExtractionStatus(supabase, user.id, upload.id, 'FAILED');
    return NextResponse.json(
      { error: 'Could not read this PDF — it may be corrupted or password-protected.' },
      { status: 422 },
    );
  }

  const personal = parseResumeContactInfo(extraction.text);

  const aiResult = await generateResumeExtraction(supabase, user.id, extraction.text);
  if (aiResult.status === 'rate_limited') {
    await updateOwnResumeUploadExtractionStatus(supabase, user.id, upload.id, 'FAILED');
    return NextResponse.json(
      { error: "You've reached your AI request limit for this period." },
      { status: 429 },
    );
  }
  if (aiResult.status === 'provider_error') {
    await updateOwnResumeUploadExtractionStatus(supabase, user.id, upload.id, 'FAILED');
    return NextResponse.json(
      { error: 'The AI provider is temporarily unavailable — please try again shortly.' },
      { status: 502 },
    );
  }
  if (aiResult.status === 'invalid_output') {
    await updateOwnResumeUploadExtractionStatus(supabase, user.id, upload.id, 'FAILED');
    return NextResponse.json(
      { error: 'Could not structure this résumé — please try again.' },
      { status: 502 },
    );
  }

  await updateOwnResumeUploadExtractionStatus(supabase, user.id, upload.id, 'COMPLETE');

  const result: ResumeExtractionResult = {
    personal,
    experience: aiResult.result.experience,
    education: aiResult.result.education,
    projects: aiResult.result.projects,
    skills: aiResult.result.skills,
    droppedCount: aiResult.droppedCount,
  };
  return NextResponse.json(result);
}
