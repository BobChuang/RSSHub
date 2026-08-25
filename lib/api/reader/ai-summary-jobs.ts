import { randomUUID } from 'node:crypto';

import logger from '@/utils/logger';

import type { AiSummaryProgress } from './ai-summary';
import { buildAiSummaryResponse, estimateAiSummaryDurationMs } from './ai-summary';

const jobRetentionMs = 60 * 60 * 1000;
const defaultJobRetries = 2;
const jobRetryDelayMs = 1000;

type AiSummaryJobStatus = 'queued' | 'running' | 'completed' | 'failed';

type AiSummaryJobRecord = {
    createdAt: number;
    error?: string;
    estimatedTotalMs: number;
    finishedAt?: number;
    id: string;
    progress: AiSummaryProgress;
    result?: Record<string, unknown>;
    startedAt?: number;
    status: AiSummaryJobStatus;
};

export type AiSummaryJobResponse = {
    createdAt: number;
    elapsedMs: number;
    error?: string;
    estimatedRemainingMs: number;
    estimatedTotalMs: number;
    finishedAt?: number;
    id: string;
    progress: AiSummaryProgress;
    result?: Record<string, unknown>;
    startedAt?: number;
    status: AiSummaryJobStatus;
};

const jobs = new Map<string, AiSummaryJobRecord>();

function getJobRetryCount() {
    const configuredRetries = Number(process.env.READER_AI_JOB_RETRIES);
    return Number.isSafeInteger(configuredRetries) && configuredRetries >= 0 ? configuredRetries : defaultJobRetries;
}

function waitForJobRetry() {
    return new Promise((resolve) => setTimeout(resolve, jobRetryDelayMs));
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function createInitialProgress(): AiSummaryProgress {
    return {
        completedBatches: 0,
        estimatedTotalMs: estimateAiSummaryDurationMs(0),
        itemCount: 0,
        stage: 'collecting',
        totalBatches: 1,
    };
}

function updateProgress(job: AiSummaryJobRecord, progress: AiSummaryProgress) {
    job.progress = progress;
    job.estimatedTotalMs = progress.estimatedTotalMs;
}

function toJobResponse(job: AiSummaryJobRecord): AiSummaryJobResponse {
    const now = Date.now();
    const elapsedMs = Math.max(0, (job.finishedAt || now) - (job.startedAt || job.createdAt));
    const isFinished = job.status === 'completed' || job.status === 'failed';
    return {
        createdAt: job.createdAt,
        elapsedMs,
        ...(job.error && { error: job.error }),
        estimatedRemainingMs: isFinished ? 0 : Math.max(0, job.estimatedTotalMs - elapsedMs),
        estimatedTotalMs: job.estimatedTotalMs,
        ...(job.finishedAt && { finishedAt: job.finishedAt }),
        id: job.id,
        progress: job.progress,
        ...(job.result && { result: job.result }),
        ...(job.startedAt && { startedAt: job.startedAt }),
        status: job.status,
    };
}

async function runAiSummaryJob(job: AiSummaryJobRecord, feedIds: string[], days: number, prompt: unknown, savePrompt: boolean, forceRefresh: boolean) {
    job.status = 'running';
    job.startedAt = Date.now();
    const maxAttempts = getJobRetryCount() + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // A retry waits for the previous attempt to finish so the upstream is not overloaded.
            // oxlint-disable-next-line eslint/no-await-in-loop
            const result = await buildAiSummaryResponse(feedIds, days, prompt, savePrompt, {
                forceRefresh: forceRefresh && attempt === 1,
                onProgress: (progress) => updateProgress(job, progress),
            });
            job.result = result;
            job.status = 'completed';
            job.finishedAt = Date.now();
            return;
        } catch (error) {
            if (attempt >= maxAttempts) {
                job.error = errorMessage(error);
                job.status = 'failed';
                job.finishedAt = Date.now();
                logger.error(`Reader AI summary job ${job.id} failed: ${job.error}`);
                return;
            }
            job.progress = {
                ...job.progress,
                attempt: attempt + 1,
                stage: 'retrying',
            };
            logger.warn(`Reader AI summary job ${job.id} failed on attempt ${attempt}/${maxAttempts}: ${error}; retrying`);
            // oxlint-disable-next-line eslint/no-await-in-loop
            await waitForJobRetry();
        }
    }
}

export function createAiSummaryJob(feedIds: string[], days: number, prompt: unknown, savePrompt: boolean, options: { forceRefresh?: boolean } = {}) {
    const job: AiSummaryJobRecord = {
        createdAt: Date.now(),
        estimatedTotalMs: estimateAiSummaryDurationMs(0),
        id: randomUUID(),
        progress: createInitialProgress(),
        status: 'queued',
    };
    jobs.set(job.id, job);
    void runAiSummaryJob(job, feedIds, days, prompt, savePrompt, options.forceRefresh === true);
    const cleanup = setTimeout(() => jobs.delete(job.id), jobRetentionMs);
    cleanup.unref?.();
    return toJobResponse(job);
}

export function getAiSummaryJob(jobId: string) {
    const job = jobs.get(jobId);
    return job ? toJobResponse(job) : undefined;
}

export function clearAiSummaryJobs() {
    jobs.clear();
}
