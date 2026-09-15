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

**Scaffold, and deliberately waiting.** Nothing is published here and nothing
will be published to npm — decided 2026-09-15. The adapter is being built in
the core as `packages/jobs-temporal`, where it stays until `ragen-worker` is
published as a container image; that is the core spec's Phase G, and it has no
date. Until then durable execution is available to anyone who builds the worker
from source, and this repository holds the contract the adapter will have to
honour ([`AGENTS.md`](AGENTS.md)) plus the deployment notes that belong beside
it ([`docs/`](docs)).

Deferring the move costs nothing and buys something: while the adapter is in
the core, the core's own CI can run it against a real Temporal, so drift
between the two is zero because nothing has left yet.

## What this repository is not

- **Not a fork of the worker.** It holds no pipeline handler and no activity.
  Both come from the core: the handlers from `@ragenai/jobs`, the activities
  from the worker image that this repository's Dockerfile extends — an image
  the core does not publish yet, which is a prerequisite rather than an
  assumption.
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
packages/        one workspace per component (empty — see packages/README.md)
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
