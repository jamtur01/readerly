import { Queue, Worker, JobsOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "../env";

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

export const fetchQueueName = "fetch-queue";
export const fetchQueue = new Queue(fetchQueueName, { connection });

export type FetchJobData = {
  feedId: string;
};

export async function enqueueFetch(feedId: string, opts?: JobsOptions) {
  return fetchQueue.add("fetch", { feedId }, opts);
}

// Optional: create a worker here if you want single-file startup,
// but our dedicated worker process will live in src/queue/fetcher.ts
export function createWorker(processor: (data: FetchJobData) => Promise<void>) {
  return new Worker<FetchJobData>(
    fetchQueueName,
    async (job) => processor(job.data),
    { connection }
  );
}
