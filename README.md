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

The core's G3 has landed, so `packages/jobs-temporal` exists here and nowhere
else: this is not a fork of a package the core also has, it is the package.
What the core keeps is the _bootstrap_ the worker image ships compiled —
`temporal-runtime.js`, `workflows/`, `temporal-failure.js` — because those
import its handlers and its activity modules, and moving them here would mean
compiling the pipeline here.

One consequence to know before deploying: the core's published `web` and `api`
images are BullMQ producers, so a Temporal deployment builds those two itself.
[`docs/durable-execution.md`](docs/durable-execution.md) has the procedure; it
is a dependency and two lines per application.

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
- **Not where a closed MCP connector goes.** That is
  [`ragen-connectors-enterprise`](https://github.com/webamigos/ragen-connectors-enterprise)
  — see below.

## The other closed repository

There are two, and the split is by _kind_ rather than by licence:

|                                                                                           |                                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **this repository**                                                                       | deployment-side **libraries** a Ragen install loads — Apache 2.0, delivered as a container image rather than npm, currently the Temporal adapter |
| [`ragen-connectors-enterprise`](https://github.com/webamigos/ragen-connectors-enterprise) | closed-source **MCP connectors** — standalone services Ragen calls out to over MCP, proprietary, deployed rather than distributed                |

A connector belongs there when it cannot be open: a paid upstream under a
commercial agreement, a credential that cannot be handed out, or logic that is
the commercial product rather than plumbing. The first is `rejestrio`, for the
first reason — it calls a paid Polish registry API and carries a per-org budget
guard and a cost audit.

The open connectors — Google, ClickUp, HubSpot — stay in
[`ragen-connectors`](https://github.com/webamigos/ragen-connectors), and the two
connector repositories have the same shape on purpose, so
`npx create-ragen-connector` and everything else applies to both.

Nothing links the two closed repositories at build time. A connector is a
service Ragen dials over MCP, added to an installation by a platform admin
without a deploy. What is here runs _inside_ the worker: the image build
compiles the adapter from this repository and lays it into the worker's
`node_modules` — so it takes the shape of an installed package without ever
being published to or installed from npm. The two are closed for related
reasons and share no code.

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
