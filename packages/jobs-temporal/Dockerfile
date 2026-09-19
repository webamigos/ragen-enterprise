# The deployment artifact: the OSS worker image, plus durable execution.
#
#   docker build -f packages/jobs-temporal/Dockerfile -t ragen-worker-temporal .
#
# Build context is the REPOSITORY ROOT, not this directory — the same
# convention the core's Dockerfiles follow, and here it is what lets the adapter
# be compiled from source in the same build that layers it.
#
# **It extends, it does not rebuild** (AGENTS.md, invariant 2). Nothing below
# installs a pipeline, copies an activity or compiles a handler: those are in
# the base image already, compiled, and this adds the two things that image
# deliberately leaves out.
#
# **Two things, and the first draft of the plan named only one.** The published
# worker ships the Temporal *bootstrap* — `dist/temporal-runtime.ts`,
# `dist/workflows/`, `dist/temporal-failure.js` — with none of the packages
# those files import, because the core's E6 moved `@temporalio/*` into
# `apps/worker`'s devDependencies and the image installs with `--omit=dev`.
# Verified against `ghcr.io/webamigos/ragen-worker:2.0.0`: with
# `WORKER_RUNTIME=temporal` it reaches `runTemporal()` and exits with
# `Cannot find package '@temporalio/worker' imported from
# /app/apps/worker/dist/temporal-runtime.js`. So the layer restores the SDK as
# well as the adapter.
ARG BASE_IMAGE=ghcr.io/webamigos/ragen-worker
# Pin a tag. `latest` and the minor series both move, and an image whose base
# moved underneath it is the failure this repository's parity job cannot see.
ARG BASE_TAG=2.0.0

FROM ${BASE_IMAGE}:${BASE_TAG} AS base

# The adapter, compiled against the contract the base image actually ships.
#
# `@ragenai/jobs` is a peer dependency this package never installs (AGENTS.md,
# invariant 3): it is copied out of the base image below, where
# `/app/node_modules/@ragenai/*` are symlinks into `/app/packages/`. There is no
# registry version to skew from, because nothing is published to npm.
FROM node:24-slim AS adapter
WORKDIR /adapter
COPY packages/jobs-temporal/package.json ./
# `--omit=peer`, or npm 7+ would try to satisfy `@ragenai/jobs` from the
# registry — where it does not exist, and is not meant to.
RUN npm install --no-package-lock --no-audit --no-fund --omit=peer
# The contract, from the artifact rather than from a checkout. `packages/jobs`
# is what the symlink points at, so this is the same directory the running
# worker resolves.
COPY --from=base /app/packages/jobs ./node_modules/@ragenai/jobs
COPY packages/jobs-temporal/tsconfig.json ./
COPY packages/jobs-temporal/src ./src
RUN npx tsc -p tsconfig.json

# The Temporal SDK, installed so that it shadows nothing.
#
# `--install-strategy=nested` is the whole point of this stage. A hoisted
# install puts 50 packages the base image already has — `uuid`, `ms`, `long`,
# `protobufjs`, `rxjs`, `tslib`, `commander` among them — at the top of the
# tree, and copying that into the worker's `node_modules` would shadow the
# versions the worker's own code resolves today. Nested keeps every transitive
# dependency underneath `@temporalio/`, so the copy below adds one directory and
# changes the resolution of nothing else. It costs about 50 MB of duplication
# (331 MB nested against 279 MB hoisted, measured), which is the right side of
# that trade for a layer nobody can test in CI against every worker dependency.
FROM node:24-slim AS sdk
WORKDIR /sdk
RUN npm init -y > /dev/null \
    && npm install --install-strategy=nested --no-package-lock --no-audit --no-fund --omit=dev \
    @temporalio/worker@1.23.0 \
    @temporalio/workflow@1.23.0 \
    @temporalio/client@1.23.0

FROM ${BASE_IMAGE}:${BASE_TAG}
USER root

# Everything lands in `/app/apps/worker/node_modules`, and nothing touches
# `/app/node_modules`.
#
# That directory is the nearest resolution root for both importers — Node walks
# up from `/app/apps/worker/dist/`, so `jobs.js`'s
# `await import('@ragenai/jobs-temporal')` and `temporal-runtime.js`'s
# `import '@temporalio/worker'` both find it before the shared root. Writing
# into the root instead would mean editing a directory the base image's other
# packages resolve through, which is a patch rather than a layer.
#
# The base image already creates this directory (it holds `@langfuse`), and
# `COPY` merges into it rather than replacing it.
COPY --from=sdk /sdk/node_modules/@temporalio /app/apps/worker/node_modules/@temporalio

# `rm -rf` first, because in a base image built before the core's G3 this path
# is a *symlink* into `/app/packages/jobs-temporal` — the core's own copy, which
# npm links for every workspace whether or not the scoped install installed it.
# `COPY` would follow that symlink and write the adapter into the core's package
# directory instead, leaving the layer looking applied and resolving to the
# wrong dist. After G3 the path does not exist and this is a no-op.
RUN rm -rf /app/node_modules/@ragenai/jobs-temporal
COPY --from=adapter /adapter/package.json /app/apps/worker/node_modules/@ragenai/jobs-temporal/package.json
COPY --from=adapter /adapter/dist /app/apps/worker/node_modules/@ragenai/jobs-temporal/dist
RUN chown -R worker:nodejs /app/apps/worker/node_modules

USER worker

# `WORKER_RUNTIME` is deliberately *not* set here. It is read by the worker and
# by every producer, and they have to agree — baking it into one of the three
# images is how a deployment ends up with jobs on a queue nobody reads. It stays
# a deployment-wide setting; see docs/durable-execution.md.
