import { describe, expect, it, vi } from 'vitest';

import { ScheduleOverlapPolicy, type Client } from '@temporalio/client';
import type { JobSchedule } from '@ragenai/jobs';

import { TASK_QUEUE_NAME, TemporalJobRuntime } from '../index';

/**
 * The adapter's wiring, which is the only place this wiring exists.
 *
 * This repository is made almost entirely of the case the core's `AGENTS.md`
 * calls the one most often left untested: a thin binding that fails silently.
 * Nothing else would notice if `start` stopped passing the task queue, if
 * `requestCancel` began cancelling runs that had already begun, or if the
 * create half of `upsertSchedule` lost its overlap policy — the parity job
 * covers behaviour against a real server, and it is nightly, slow, and cannot
 * distinguish "the adapter is wrong" from "the engine changed".
 *
 * The `Client` is injected rather than mocked at the module boundary, because
 * `TemporalJobRuntimeOptions.client` exists for exactly this and a module mock
 * would also stub the constructor whose laziness is a property worth keeping.
 */

type Handle = {
  describe: ReturnType<typeof vi.fn>;
  result: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
};

type ScheduleHandleStub = {
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

/** An error Temporal's SDK signals by `name`, which is what the adapter reads. */
function named(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

function workflowHandle(overrides: Partial<Handle> = {}): Handle {
  return {
    describe: vi.fn(),
    result: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function client(parts: {
  workflowHandle?: Handle;
  scheduleHandle?: ScheduleHandleStub;
}): {
  client: Client;
  start: ReturnType<typeof vi.fn>;
  createSchedule: ReturnType<typeof vi.fn>;
  getScheduleHandle: ReturnType<typeof vi.fn>;
} {
  const start = vi.fn().mockResolvedValue(undefined);
  const createSchedule = vi.fn().mockResolvedValue(undefined);
  const getScheduleHandle = vi.fn().mockReturnValue(parts.scheduleHandle);

  const stub = {
    workflow: {
      start,
      getHandle: vi.fn().mockReturnValue(parts.workflowHandle),
    },
    schedule: {
      create: createSchedule,
      getHandle: getScheduleHandle,
    },
  };

  return {
    client: stub as unknown as Client,
    start,
    createSchedule,
    getScheduleHandle,
  };
}

describe('TemporalJobRuntime.start', () => {
  it('starts the workflow by name, on the task queue, with the run id', async () => {
    const { client: temporal, start } = client({});
    const jobs = new TemporalJobRuntime({ client: temporal });

    const payload = { fileId: 'file-7', orgId: 'org-1' };
    await jobs.start('runFileEmbeddings', 'run-1', payload);

    expect(start).toHaveBeenCalledWith('runFileEmbeddings', {
      taskQueue: TASK_QUEUE_NAME,
      workflowId: 'run-1',
      args: [payload],
    });
  });

  it('passes an empty argument list for a job with no payload', async () => {
    // A scheduled job started by hand. `[undefined]` would reach a workflow
    // that declares no parameters as one argument, which Temporal records in
    // history and a replay then disagrees about.
    const { client: temporal, start } = client({});
    const jobs = new TemporalJobRuntime({ client: temporal });

    await jobs.start('cleanupDemoThreads', 'run-2', undefined);

    expect(start.mock.calls[0]?.[1]).toMatchObject({ args: [] });
  });

  it('uses the task queue it was constructed with', async () => {
    // The parity harness gives every run its own queue, because a Temporal
    // namespace outlives the harness that wrote to it.
    const { client: temporal, start } = client({});
    const jobs = new TemporalJobRuntime({
      client: temporal,
      taskQueue: 'jobs-integration-abc',
    });

    await jobs.start('scrapeWebsite', 'run-3', {
      url: 'https://example.com',
      mode: 'scrape',
      orgId: 'org-1',
      projectId: null,
    });

    expect(start.mock.calls[0]?.[1]).toMatchObject({
      taskQueue: 'jobs-integration-abc',
    });
  });
});

describe('TemporalJobRuntime.getRun', () => {
  it.each([
    ['RUNNING', 'running'],
    ['FAILED', 'failed'],
    ['CANCELLED', 'cancelled'],
    ['CANCELED', 'cancelled'],
    ['TERMINATED', 'failed'],
    ['TIMED_OUT', 'failed'],
    ['CONTINUED_AS_NEW', 'running'],
  ])('reads %s as %s', async (temporalStatus, expected) => {
    const handle = workflowHandle({
      describe: vi.fn().mockResolvedValue({
        status: { name: temporalStatus },
      }),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await expect(
      new TemporalJobRuntime({ client: temporal }).getRun('run-1'),
    ).resolves.toEqual({ status: expected });
  });

  it('reads a status it does not know as unknown rather than throwing', async () => {
    const handle = workflowHandle({
      describe: vi.fn().mockResolvedValue({ status: { name: 'PAUSED' } }),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await expect(
      new TemporalJobRuntime({ client: temporal }).getRun('run-1'),
    ).resolves.toEqual({ status: 'unknown' });
  });

  it('reads the result only once the run completed', async () => {
    // `result()` on a failed run throws the workflow's own failure, and the
    // caller asked for a status. The document-generation route is the one
    // reader, and it polls while the run is still going.
    const handle = workflowHandle({
      describe: vi.fn().mockResolvedValue({ status: { name: 'FAILED' } }),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await new TemporalJobRuntime({ client: temporal }).getRun('run-1');

    expect(handle.result).not.toHaveBeenCalled();
  });

  it('returns the result of a completed run', async () => {
    const handle = workflowHandle({
      describe: vi.fn().mockResolvedValue({ status: { name: 'COMPLETED' } }),
      result: vi.fn().mockResolvedValue({ documentId: 12 }),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await expect(
      new TemporalJobRuntime({ client: temporal }).getRun('run-1'),
    ).resolves.toEqual({
      status: 'completed',
      result: { documentId: 12 },
    });
  });

  it('reads a run the engine has forgotten as unknown', async () => {
    // Temporal ages executions out of visibility. The seam's callers treat a
    // status they cannot establish as unknown rather than as an error, because
    // the database row is the record either way.
    const handle = workflowHandle({
      describe: vi.fn().mockRejectedValue(named('WorkflowNotFoundError')),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await expect(
      new TemporalJobRuntime({ client: temporal }).getRun('run-1'),
    ).resolves.toEqual({ status: 'unknown' });
  });

  it('rethrows a failure that is not a missing run', async () => {
    // The narrow catch matters: a connection error read as "unknown" would
    // report every job as untraceable while Temporal was merely unreachable.
    const handle = workflowHandle({
      describe: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await expect(
      new TemporalJobRuntime({ client: temporal }).getRun('run-1'),
    ).rejects.toThrow('connection refused');
  });
});

describe('TemporalJobRuntime.requestCancel', () => {
  it('cancels a run no worker has picked up', async () => {
    // Two events is what Temporal writes at creation: WorkflowExecutionStarted
    // and the first WorkflowTaskScheduled.
    const handle = workflowHandle({
      describe: vi.fn().mockResolvedValue({
        status: { name: 'RUNNING' },
        historyLength: 2,
      }),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await new TemporalJobRuntime({ client: temporal }).requestCancel('run-1');

    expect(handle.cancel).toHaveBeenCalled();
  });

  it('leaves a run that has already begun alone', async () => {
    // The load-bearing one. `handle.cancel()` would end the run where it
    // stands and the file row it was updating would sit in PROCESSING forever
    // — cancelling a *running* ingest is a database fact the pipeline reads at
    // its own checkpoints, which is what lets it record CANCELLED itself.
    const handle = workflowHandle({
      describe: vi.fn().mockResolvedValue({
        status: { name: 'RUNNING' },
        historyLength: 3,
      }),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await new TemporalJobRuntime({ client: temporal }).requestCancel('run-1');

    expect(handle.cancel).not.toHaveBeenCalled();
  });

  it('leaves a run that is no longer running alone', async () => {
    const handle = workflowHandle({
      describe: vi.fn().mockResolvedValue({
        status: { name: 'COMPLETED' },
        historyLength: 2,
      }),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await new TemporalJobRuntime({ client: temporal }).requestCancel('run-1');

    expect(handle.cancel).not.toHaveBeenCalled();
  });

  it('treats a run the engine has forgotten as nothing to cancel', async () => {
    const handle = workflowHandle({
      describe: vi.fn().mockRejectedValue(named('WorkflowNotFoundError')),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await expect(
      new TemporalJobRuntime({ client: temporal }).requestCancel('run-1'),
    ).resolves.toBeUndefined();
  });

  it('rethrows a failure that is not a missing run', async () => {
    const handle = workflowHandle({
      describe: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    const { client: temporal } = client({ workflowHandle: handle });

    await expect(
      new TemporalJobRuntime({ client: temporal }).requestCancel('run-1'),
    ).rejects.toThrow('connection refused');
  });
});

const SCHEDULE: JobSchedule = {
  id: 'prune-analytics-retrievals',
  job: 'pruneAnalyticsRetrievals',
  cron: '0 3 * * *',
  timezone: 'Europe/Warsaw',
};

describe('TemporalJobRuntime.upsertSchedule', () => {
  it('updates the action as well as the spec on an existing schedule', async () => {
    // An update carrying only the spec would leave the schedule pointing at
    // whatever workflow type and queue it was created with — a renamed job
    // would keep firing the old name, and "upsert" would be true of the cron
    // and false of the thing it runs.
    const existing = {
      spec: { cronExpressions: ['0 1 * * *'] },
      action: {
        type: 'startWorkflow',
        workflowType: 'oldName',
        taskQueue: 'old-queue',
        args: [],
      },
    };
    let updated: typeof existing | undefined;

    const scheduleHandle: ScheduleHandleStub = {
      update: vi.fn(
        async (mutate: (current: typeof existing) => typeof existing) => {
          updated = mutate(existing);
        },
      ),
      delete: vi.fn(),
    };
    const { client: temporal, createSchedule } = client({ scheduleHandle });

    await new TemporalJobRuntime({
      client: temporal,
      taskQueue: 'queue-a',
    }).upsertSchedule(SCHEDULE);

    expect(createSchedule).not.toHaveBeenCalled();
    expect(updated?.spec).toEqual({
      cronExpressions: [SCHEDULE.cron],
      timezone: SCHEDULE.timezone,
    });
    expect(updated?.action).toMatchObject({
      type: 'startWorkflow',
      workflowType: SCHEDULE.job,
      taskQueue: 'queue-a',
      args: [],
    });
  });

  it('creates the schedule when there is none, skipping overlapping fires', async () => {
    // SKIP, not the default. A nightly job still running when the next fire
    // arrives should skip it rather than queue a second copy behind it.
    const scheduleHandle: ScheduleHandleStub = {
      update: vi.fn().mockRejectedValue(named('ScheduleNotFoundError')),
      delete: vi.fn(),
    };
    const { client: temporal, createSchedule } = client({ scheduleHandle });

    await new TemporalJobRuntime({ client: temporal }).upsertSchedule(SCHEDULE);

    expect(createSchedule).toHaveBeenCalledWith({
      scheduleId: SCHEDULE.id,
      spec: {
        cronExpressions: [SCHEDULE.cron],
        timezone: SCHEDULE.timezone,
      },
      action: {
        type: 'startWorkflow',
        workflowType: SCHEDULE.job,
        taskQueue: TASK_QUEUE_NAME,
        args: [],
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
    });
  });

  it('does not create a duplicate when the update fails for another reason', async () => {
    const scheduleHandle: ScheduleHandleStub = {
      update: vi.fn().mockRejectedValue(new Error('connection refused')),
      delete: vi.fn(),
    };
    const { client: temporal, createSchedule } = client({ scheduleHandle });

    await expect(
      new TemporalJobRuntime({ client: temporal }).upsertSchedule(SCHEDULE),
    ).rejects.toThrow('connection refused');
    expect(createSchedule).not.toHaveBeenCalled();
  });
});

describe('TemporalJobRuntime.deleteSchedule', () => {
  it('deletes the schedule', async () => {
    const scheduleHandle: ScheduleHandleStub = {
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const { client: temporal, getScheduleHandle } = client({ scheduleHandle });

    await new TemporalJobRuntime({ client: temporal }).deleteSchedule(
      SCHEDULE.id,
    );

    expect(getScheduleHandle).toHaveBeenCalledWith(SCHEDULE.id);
    expect(scheduleHandle.delete).toHaveBeenCalled();
  });

  it('is a no-op when the schedule is already gone', async () => {
    // The drain procedure deletes both schedules before a runtime switch, and
    // it has to be re-runnable.
    const scheduleHandle: ScheduleHandleStub = {
      update: vi.fn(),
      delete: vi.fn().mockRejectedValue(named('ScheduleNotFoundError')),
    };
    const { client: temporal } = client({ scheduleHandle });

    await expect(
      new TemporalJobRuntime({ client: temporal }).deleteSchedule(SCHEDULE.id),
    ).resolves.toBeUndefined();
  });

  it('rethrows a failure that is not a missing schedule', async () => {
    const scheduleHandle: ScheduleHandleStub = {
      update: vi.fn(),
      delete: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    const { client: temporal } = client({ scheduleHandle });

    await expect(
      new TemporalJobRuntime({ client: temporal }).deleteSchedule(SCHEDULE.id),
    ).rejects.toThrow('connection refused');
  });
});

describe('the client it builds when none is injected', () => {
  it('does not open a connection while constructing the runtime', () => {
    // A producer builds one per request path, and a Temporal that is briefly
    // unreachable should fail the start call rather than the module load.
    // `Connection.lazy()` is what makes that true; constructing without a
    // server running is the assertion.
    expect(
      () => new TemporalJobRuntime({ address: '127.0.0.1:1' }),
    ).not.toThrow();
  });
});
