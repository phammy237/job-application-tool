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
const MIN_PASTE_TEXT_LENGTH = 100;
const MAX_PASTE_TEXT_LENGTH = 20_000;
const BUCKET = 'resume-uploads';

/**
 * Resume Import step 1: "Upload resume" / "Paste resume text" -> "Analyze" (Phase B of the
 * onboarding-path hardening pass, extended to support pasted text directly onto /profile).
 * Deliberately synchronous, single request — the whole pipeline (store file if uploaded, extract
 * PDF text if uploaded, deterministically parse contact info, AI-structure the rest) completes
 * before responding. NEVER writes to profiles/experiences/education/projects/skills — the
 * returned structured result exists only for the client-side review step; nothing reaches
 * Candidate Profile until the user explicitly confirms/autofills (see ../confirm/route.ts and
 * apps/web/app/(app)/profile). Candidate Profile stays the one canonical source of truth
 * throughout, and there is exactly one extraction pipeline (parseResumeContactInfo +
 * generateResumeExtraction) regardless of which entry point supplied the source text — a pasted
 * `text` field is used as that source text directly, never wrapped in a fake uploaded File and
 * never given its own resume_uploads row (there is no file to store or dedup by content hash).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  const pastedText = formData?.get('text');

  let sourceText: string;
  let uploadId: string | null = null;
  const supabase = await createClient();

  if (file instanceof File) {
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
        // Sanitized: only the base name, no path traversal — never trust the client-supplied
        // name as a filesystem path (it never touches one here, but keep it a plain label
        // regardless).
        fileName: file.name.replace(/[/\\]/g, '_').slice(0, 200) || 'resume.pdf',
        contentType: 'application/pdf',
        fileSizeBytes: file.size,
        contentHash,
      });
    }
    uploadId = upload.id;

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
    sourceText = extraction.text;
  } else if (typeof pastedText === 'string') {
    // The Fetch spec's multipart/form-data serializer normalizes every bare "\n" in a text field
    // to "\r\n" (real browsers do this, not just this route's test harness) — undone here so a
    // pasted résumé's line breaks match what an uploaded PDF's extracted text already looks like.
    const trimmed = pastedText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'Please paste your résumé text first.' }, { status: 400 });
    }
    if (trimmed.length < MIN_PASTE_TEXT_LENGTH) {
      return NextResponse.json(
        {
          error: `This doesn't look like enough résumé text yet (at least ${MIN_PASTE_TEXT_LENGTH} characters) — please paste more.`,
        },
        { status: 400 },
      );
    }
    if (trimmed.length > MAX_PASTE_TEXT_LENGTH) {
      return NextResponse.json(
        {
          error: `This text is too long (max ${MAX_PASTE_TEXT_LENGTH.toLocaleString()} characters) — please paste a shorter excerpt.`,
        },
        { status: 400 },
      );
    }
    sourceText = trimmed;
  } else {
    return NextResponse.json({ error: 'No file or résumé text was provided.' }, { status: 400 });
  }

  const personal = parseResumeContactInfo(sourceText);

  const aiResult = await generateResumeExtraction(supabase, user.id, sourceText);
  if (aiResult.status === 'rate_limited') {
    if (uploadId) await updateOwnResumeUploadExtractionStatus(supabase, user.id, uploadId, 'FAILED');
    return NextResponse.json(
      { error: "You've reached your AI request limit for this period." },
      { status: 429 },
    );
  }
  if (aiResult.status === 'provider_error') {
    if (uploadId) await updateOwnResumeUploadExtractionStatus(supabase, user.id, uploadId, 'FAILED');
    return NextResponse.json(
      { error: 'The AI provider is temporarily unavailable — please try again shortly.' },
      { status: 502 },
    );
  }
  if (aiResult.status === 'invalid_output') {
    if (uploadId) await updateOwnResumeUploadExtractionStatus(supabase, user.id, uploadId, 'FAILED');
    return NextResponse.json(
      { error: 'Could not structure this résumé — please try again.' },
      { status: 502 },
    );
  }

  if (uploadId) await updateOwnResumeUploadExtractionStatus(supabase, user.id, uploadId, 'COMPLETE');

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
