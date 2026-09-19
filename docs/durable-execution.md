# Durable execution: running Ragen's worker on Temporal

**State: this is the only copy of the adapter.** The core's Phase G is complete
— its G3 dropped `packages/jobs-temporal` from
[`webamigos/RagenAI`](https://github.com/webamigos/RagenAI), so
`@ragenai/jobs-temporal` exists here and nowhere else.
`packages/jobs-temporal/Dockerfile` builds the layered worker image, and
[`.github/workflows/temporal-parity.yml`](../.github/workflows/temporal-parity.yml)
runs the core's own worker integration suite against it on a real Temporal
server. Nothing is published to npm in either repository; the delivery
mechanism is the image. The shape below is a commitment made in the core's
[worker-runtime spec](https://github.com/webamigos/RagenAI/blob/main/docs/specs/2026-09-15-bullmq-is-the-worker-runtime.md),
§8.

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

## How it is deployed

1. **The worker image.**
   [`packages/jobs-temporal/Dockerfile`](../packages/jobs-temporal/Dockerfile)
   is `FROM ghcr.io/webamigos/ragen-worker` plus the compiled adapter. The
   handlers and the 69 activity modules come from the core; nothing is rebuilt
   here. Build it from the repository root and run it instead of the OSS worker
   image:

   ```bash
   docker build -f packages/jobs-temporal/Dockerfile -t ragen-worker-temporal .
   ```

   Pin the base tag — `BASE_TAG` defaults to a release, and `latest` and the
   minor series both move.

   **The layer adds two things, not one.** The OSS worker image ships the
   Temporal _bootstrap_ — `dist/temporal-runtime.js`, `dist/workflows/`,
   `dist/temporal-failure.js` — with none of the packages those files import,
   because `@temporalio/*` are `apps/worker`'s devDependencies and the image
   installs with `--omit=dev`. Set `WORKER_RUNTIME=temporal` on an unextended
   image and it starts, logs `runtime: "temporal"`, and exits with
   `Cannot find package '@temporalio/worker'`. Restoring the SDK alongside the
   adapter is this layer's job, and it is why the layer exists rather than
   being a single environment variable.

   The bootstrap itself stays in the core on purpose: it imports the core's
   handlers and its activity modules, so moving it here would mean compiling the
   pipeline here, which invariants 1 and 2 forbid. See the core spec's G2.

   The Dockerfile's last stage runs
   [`verify-layer.mjs`](../packages/jobs-temporal/verify-layer.mjs) inside the
   image it just built: it reads every `@temporalio/*` the base image's compiled
   output imports, resolves each from where the worker runs, and then loads the
   adapter. That is not belt and braces — it is what caught `@temporalio/common`,
   which `dist/temporal-failure.js` imports and which resolved by accident until
   the core's G3 stopped shipping the adapter workspace that had been dragging
   it in.

2. **The producers, which you build.** `apps/web` and `apps/api` enqueue, so
   they have to speak the same engine as the worker — and the images the core
   publishes are BullMQ producers. That is the core's G3 decision. The reason is
   that `apps/web` is a Next standalone build: it traces its imports at build
   time, so a package that is not in the tree cannot be reached, and an image of
   it cannot be layered the way the worker's can. `apps/api` could have been,
   and deliberately is not — half a deployment enqueueing to the other engine
   reads as a worker that is merely slow, which is the failure the seam exists
   to prevent.

   So for each of the two, in a checkout of the core:

   1. add `@ragenai/jobs-temporal` to `apps/web/package.json` and
      `apps/api/package.json`, however you vendor this repository;
   2. add two lines beside the existing registration — in
      `apps/web/src/libs/jobs/index.ts` and `apps/api/src/jobs/jobs.service.ts`,
      both of which say so in a comment at the call site:

      ```ts
      import { TemporalJobRuntime } from '@ragenai/jobs-temporal';
      registerJobRuntime('temporal', () => new TemporalJobRuntime());
      ```

   3. build the two images as the core does.

   Written down rather than made to look automatic. Without it a producer throws
   `no adapter registered for WORKER_RUNTIME="temporal"` on its first enqueue —
   loud and immediate, which is better than a queue nobody reads.

3. **The switch.** `WORKER_RUNTIME=temporal`, on the worker _and_ on every
   producer. They must agree, or the jobs go to an engine nobody is reading.

4. **The schedules.** The two nightly jobs are registered by explicit scripts in
   the core (`ensure-demo-cleanup-schedule.ts`,
   `ensure-analytics-retention-schedule.ts`), and a schedule is state in
   whichever engine is running jobs. On Temporal those scripts need the adapter,
   so **run them from this image**, not the OSS one:

   ```bash
   docker run --rm -e WORKER_RUNTIME=temporal … ragen-worker-temporal \
     node dist/scripts/ensure-analytics-retention-schedule.js
   ```

   Both take `--delete`, which is what a switch back needs.

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
  Temporal server, against the core's current handlers, nightly and on every
  push. It checks out `webamigos/RagenAI`, builds this adapter against _that
  checkout's_ `@ragenai/jobs` rather than the shipped image's, splices the build
  into the core's `node_modules` and runs `npm run worker:test:jobs` with
  `WORKER_RUNTIME=temporal` — so the question it answers is whether the _next_
  core release will still be able to run Temporal, not whether the last one
  could;
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
