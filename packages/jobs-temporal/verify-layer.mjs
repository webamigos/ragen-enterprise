/**
 * Does the layer actually resolve, from where the worker runs?
 *
 * Run as the last step of `packages/jobs-temporal/Dockerfile`, inside the image
 * it just built. A `COPY` that lands in the wrong `node_modules`, a base image
 * whose layout moved, or a package the SDK install did not name at the top of
 * its tree all produce a build that succeeds and a container that exits at
 * boot — in somebody else's deployment, on the one runtime nothing else here
 * exercises.
 *
 * **The list is derived from the artifact, not written here.** The base image's
 * compiled output decides which `@temporalio/*` packages have to be resolvable;
 * this reads them out of it. That is the difference between a check that would
 * have caught `@temporalio/common` and one that would have been updated at the
 * same time the mistake was made — `dist/temporal-failure.js` imports it, and
 * it resolved by accident until the core's G3 stopped shipping the adapter
 * workspace that dragged it in.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const DIST = '/app/apps/worker/dist';

/**
 * Compiled test files, which the base image ships and a start never loads.
 *
 * They import `@temporalio/testing` and `@temporalio/nyc-test-coverage`, which
 * are the core's devDependencies and belong in no runtime image. Requiring the
 * layer to install them would mean shipping a test framework to production to
 * satisfy a check.
 */
const NOT_A_START_PATH = /(^|\/)__tests__\//;

function compiledModules(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...compiledModules(path));
    } else if (path.endsWith('.js') && !NOT_A_START_PATH.test(path)) {
      found.push(path);
    }
  }
  return found;
}

const modules = compiledModules(DIST);
if (modules.length === 0) {
  throw new Error(
    `No compiled worker output under ${DIST}. Either the base image is not a ` +
      'Ragen worker, or its layout changed — which is exactly the breakage ' +
      'this file exists to notice.',
  );
}

const needed = new Set(['@ragenai/jobs', '@ragenai/jobs-temporal']);
for (const path of modules) {
  for (const match of readFileSync(path, 'utf8').matchAll(
    /['"](@temporalio\/[a-z-]+)['"]/g,
  )) {
    needed.add(match[1]);
  }
}

// Guard on the guard: the scan returning almost nothing would make every
// resolve below pass over an empty list and report a layer that works.
if (needed.size < 4) {
  throw new Error(
    `Found only ${needed.size} packages to check across ${modules.length} ` +
      'modules. The scan is not reading the output it thinks it is.',
  );
}

const require = createRequire(join(DIST, 'worker.js'));
for (const name of [...needed].sort()) {
  console.log(`${name} -> ${require.resolve(name)}`);
}

/**
 * Loading it, not just resolving it — which is how `@temporalio/client` is
 * covered without being named.
 *
 * The scan above sees only what the *worker's* output imports, and nothing
 * there names the client: it is the adapter's own dependency, and the adapter
 * is not part of the base image for the scan to read. Requiring the module runs
 * its imports, so a client that did not resolve fails here. Do not reduce this
 * to a `require.resolve`.
 */
const { TemporalJobRuntime } = require('@ragenai/jobs-temporal');
if (typeof TemporalJobRuntime !== 'function') {
  throw new Error(
    '@ragenai/jobs-temporal resolved but exports no TemporalJobRuntime ' +
      'constructor — the adapter build in this image is not the adapter.',
  );
}

console.log(`layer verified against ${modules.length} compiled modules`);
