# Ragen AI — Enterprise

Deployment-side extensions to [Ragen AI](https://github.com/webamigos/RagenAI).
Nothing here is required to run Ragen; everything here is for a deployment whose
requirements are heavier than the default install's.

**First and currently only component:** `@ragenai/jobs-temporal`, the Temporal
adapter for Ragen's job runtime. The core ships BullMQ as its worker runtime;
an install that needs durable execution — replay across a worker crash, a
per-activity event history, Temporal Cloud — adds this package and sets
`WORKER_RUNTIME=temporal`.

The decision that created this repository, with the phases, the trade-offs and
what "supported" is promised to mean, is
[`docs/specs/2026-09-15-bullmq-is-the-worker-runtime.md`](https://github.com/webamigos/RagenAI/blob/main/docs/specs/2026-09-15-bullmq-is-the-worker-runtime.md)
in the core repository.

## Status

**The adapter is here; the core has not dropped its copy yet.** Nothing is
published here and nothing will be published to npm — decided 2026-09-15. The
one prerequisite was a published worker image to layer onto, and the core now
publishes one: `ghcr.io/webamigos/ragen-worker` on every release (the core
spec's G1). `packages/jobs-temporal` holds the adapter, its Dockerfile builds
the layered worker image, and the parity job runs the core's own integration
suite against it on a real Temporal server.

What is left is the core's G3. Until it lands `packages/jobs-temporal` exists in
both repositories and **the core's is the one an install uses**; treat the two
as one move that is half done rather than as a supported fork.

## What this repository is not

- **Not a fork of the worker.** It holds no pipeline handler and no activity.
  Both come from the core: the handlers from `@ragenai/jobs`, the activities
  from the worker image that this repository's Dockerfile extends —
  `ghcr.io/webamigos/ragen-worker`, published on every core release.
  A copy of either here is the failure the core's ADR-26 and ADR-33 were
  written to undo.
- **Not a paywall.** See below.
- **Not a place for anything the core needs.** If a deployment cannot work
  without it, it belongs in the core. The core's
  [open-core boundary](https://github.com/webamigos/RagenAI/blob/main/docs/open-core-boundary.md)
  puts it plainly: an install without the commercial layer is a complete,
  working Ragen.

## Why Apache 2.0 and not a commercial licence

This repository carries the same licence as the core, deliberately. It exists
because the Temporal adapter costs every default install two containers, a gRPC
dependency and an SDK family under a version lock — so it moved out of the
install, not out of the licence. Nothing here is gated, and the components are
usable by anyone on the same terms as the rest of Ragen.

If a component is ever added under separate commercial terms it will carry its
own `LICENSE` file, which governs that directory and everything under it, and
it will be listed in the core's `docs/open-core-boundary.md`. That is the only
mechanism — no per-file headers, no allowlists.

## Repository layout

```
packages/        one workspace per component — see packages/README.md
docs/            deployment notes: durable execution, cloud model providers
AGENTS.md        the canonical guidance for humans and coding agents
```

## Getting started

```bash
nvm use            # Node 24.x
npm install
npm run verify     # typecheck + test + build across every workspace
```

## Licence

[Apache 2.0](LICENSE). See [NOTICE](NOTICE).
