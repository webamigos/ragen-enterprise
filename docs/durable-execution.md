# Durable execution: running Ragen's worker on Temporal

**State: not yet implemented.** This page describes the shape the component will
have, because that shape is a commitment made in the core's
[worker-runtime spec](https://github.com/webamigos/RagenAI/blob/main/docs/specs/2026-09-15-bullmq-is-the-worker-runtime.md)
and is easier to hold to when it is written down before the code exists.

## Why there is a choice at all

Ragen's eight background jobs are linear chains of activities, and its default
runtime is BullMQ. BullMQ guarantees the _message_; Temporal guarantees the
_program_. In practice the difference is one sentence:

> On BullMQ, a worker that dies at activity 15 of 20 re-runs the job from
> activity 1. On Temporal, it resumes at 15.

Everything else follows from that. Ragen's activities are idempotent so the
default is safe, but re-running is not free — the summary and RAG-score model
calls are re-issued, and under a hosted document parser so is the OCR call, at
per-page cost. A deployment ingesting large documents on unreliable workers has
a real reason to want replay. A deployment ingesting a few hundred documents a
week does not, and should not pay two containers for it.

## What you get, and what you give up

|                                     | BullMQ (core default)                                    | Temporal (this component)                                  |
| ----------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| Crash mid-job                       | re-runs from the top                                     | resumes at the failed step                                 |
| Retry state across a worker restart | lost; the job is retried whole                           | durable                                                    |
| Per-activity history                | job state, attempts and the failure stack, in bull-board | full event history, in Temporal UI                         |
| Extra infrastructure                | Redis (required by the core anyway)                      | a Temporal server, its UI, a schema in Postgres, gRPC      |
| Cost of the SDK                     | —                                                        | six `@temporalio/*` packages that must move as one version |

Cancellation, schedules and the document-generation status route behave
identically on both. That is not an accident: the core moved cancellation from a
Temporal signal to a conditional database write precisely so the two runtimes
could not drift into two behaviours, one of which nobody tests.

## How it will be deployed

Two things, no more:

1. **The image.** This repository's Dockerfile is `FROM` the published Ragen
   worker image plus `npm i @ragenai/jobs-temporal`. The handlers and the 69
   activity modules come from the core; nothing is rebuilt here. Run that image
   instead of the OSS worker image.
2. **The switch.** `WORKER_RUNTIME=temporal`, read by the worker _and_ by every
   producer — `apps/web` and `apps/api` enqueue, so they must agree with the
   worker or the jobs go to an engine nobody is reading.

Plus Temporal itself, which the core ships behind a compose profile and a Helm
value rather than in the default install.

## Switching an existing install

The core's spec has the full procedure; the part that bites is the same in both
directions:

1. **Drain.** Stop producers, let in-flight runs finish, confirm no file is left
   in `PROCESSING`. A run in flight when the runtime changes is orphaned — the
   new engine has never heard of it.
2. **Delete the schedules on the engine you are leaving.** Both schedule scripts
   take `--delete`. A schedule left behind keeps firing against a worker that no
   longer listens.
3. Switch `WORKER_RUNTIME`, restart the worker, and confirm both schedules exist
   on the new engine.

There is no migration either way. `UserFile.workflowId` holds a
caller-supplied run id that both engines accept, which is what makes this a
restart rather than a data change.

## What "supported" means here

A runtime nothing runs is abandoned with a package name. So:

- this repository's CI runs the core's worker integration suite against a real
  Temporal container, against the current published handlers, nightly and on
  every push;
- a breaking change to `JobContext` in `@ragenai/jobs` is a major version,
  because this component is an out-of-repository consumer of that interface.

If either stops being true, the honest move is to say Temporal is unsupported —
not to leave the package published and hope.
