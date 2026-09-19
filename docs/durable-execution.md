# Durable execution: running Ragen's worker on Temporal

**State: the gate is open, the move is in progress.** The adapter was built in
the core as `packages/jobs-temporal`, and the one thing it waited on — a
published `ragen-worker` image to layer onto — now exists at
`ghcr.io/webamigos/ragen-worker`. Until the core's Phase G3 lands, its copy is
still the one an install uses. Nothing is published to npm in either
repository. This page describes the shape the component has, because that shape
is a commitment made in the core's
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

1. **The image.** This repository's Dockerfile is `FROM` the Ragen worker
   image plus the compiled adapter. The handlers and the 69 activity modules
   come from the core; nothing is rebuilt here. Run that image instead of the
   OSS worker image.

   The base image is `ghcr.io/webamigos/ragen-worker`, published on every core
   release. Pin a tag — `sha-…` for production, since `latest` and the minor
   series both move.

   The layer adds two things, not one: the compiled adapter, and the Temporal
   SDK itself. The OSS worker image ships the Temporal _bootstrap_ code but not
   the packages it imports — `@temporalio/*` are `apps/worker`'s
   devDependencies and the image installs with `--omit=dev` — so an unextended
   image set to `WORKER_RUNTIME=temporal` exits at boot saying exactly that.
   Restoring those packages is this layer's job, and it is why the layer exists
   rather than being a single environment variable.

2. **The switch.** `WORKER_RUNTIME=temporal`, read by the worker _and_ by every
   producer — `apps/web` and `apps/api` enqueue, so they must agree with the
   worker or the jobs go to an engine nobody is reading.

Plus Temporal itself, which you run. The core's `docker-compose.yml` and Helm
chart no longer contain a Temporal server at all — `TEMPORAL_SERVER_ADDRESS`
points at one you operate, and it is required rather than defaulted, because a
`localhost:7233` fallback is right on a laptop and silent everywhere else.

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
  Temporal server, against the current published handlers, nightly and on every
  push;
- a breaking change to `JobContext` in `@ragenai/jobs` breaks an
  out-of-repository consumer, and is expected to be noticed here rather than
  absorbed silently.

There is no version number doing that second job, deliberately. Nothing is
published to npm: the adapter declares `@ragenai/jobs` as a peer dependency it
never installs and compiles against the copy inside the base image, where
`/app/node_modules/@ragenai/*` are symlinks into `/app/packages/`. So it is
type-checked against the contract the image actually ships rather than against
a version range that can skew from it — and the parity job is what turns a
compile-time agreement into a behavioural one.

If either bullet stops being true, the honest move is to say Temporal is
unsupported — not to leave the package here and hope.
