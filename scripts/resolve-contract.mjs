/**
 * Put `@ragenai/jobs` where tsc and vitest can find it, by taking it out of the
 * worker image.
 *
 * Nothing is published to npm — not the contract, not the adapter (the core
 * spec's §8.5) — so there is no `npm install` that can do this. What there is
 * instead is the artifact this repository layers onto: in
 * `ghcr.io/webamigos/ragen-worker`, `/app/node_modules/@ragenai/*` are symlinks
 * into `/app/packages/`, and `/app/packages/jobs` is the built contract, `dist`
 * and declarations included. Copying it here is what AGENTS.md's invariant 3
 * means concretely: the adapter compiles against the interface the image
 * actually ships rather than against a version number that can skew from it.
 *
 * The tag is read from the adapter's own Dockerfile rather than repeated here,
 * because a build that layers onto one image and a typecheck that ran against
 * another is a disagreement nothing else would report.
 *
 * **`RAGEN_CORE_PATH` is the escape hatch, not the default.** Pointed at a core
 * checkout, it uses that repository's `packages/jobs` instead — useful when you
 * are changing the contract and the adapter together, and honest about what it
 * costs: you are then testing against a contract no image ships yet.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOCKERFILE = join(ROOT, 'packages', 'jobs-temporal', 'Dockerfile');
const DESTINATION = join(ROOT, 'node_modules', '@ragenai', 'jobs');

/** The image the adapter is built to layer onto, from the one place it is written. */
function baseImage() {
  const dockerfile = readFileSync(DOCKERFILE, 'utf8');
  const name = /^ARG\s+BASE_IMAGE=(\S+)/m.exec(dockerfile);
  const tag = /^ARG\s+BASE_TAG=(\S+)/m.exec(dockerfile);

  if (!name || !tag) {
    throw new Error(
      `${DOCKERFILE} declares no BASE_IMAGE/BASE_TAG. They are the single ` +
        'source for which artifact this package is compiled against.',
    );
  }

  return `${name[1]}:${tag[1]}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status}):\n` +
        `${result.stderr ?? ''}${result.stdout ?? ''}`,
    );
  }
  return (result.stdout ?? '').trim();
}

function fromCheckout(corePath) {
  const source = join(corePath, 'packages', 'jobs');
  if (!existsSync(join(source, 'dist', 'index.d.ts'))) {
    throw new Error(
      `${source} has no dist/index.d.ts. RAGEN_CORE_PATH points at a checkout ` +
        'whose contract has not been built — run `npm run build --workspace=@ragenai/jobs` there.',
    );
  }
  rmSync(DESTINATION, { recursive: true, force: true });
  mkdirSync(dirname(DESTINATION), { recursive: true });
  cpSync(source, DESTINATION, { recursive: true });
  console.log(`@ragenai/jobs <- ${source} (RAGEN_CORE_PATH)`);
}

function fromImage(image) {
  run('docker', ['pull', '--platform', 'linux/amd64', image], {
    stdio: 'inherit',
  });

  // `docker create` rather than `docker run`: nothing has to execute, and the
  // image is amd64 while a developer's machine may not be.
  const container = run('docker', [
    'create',
    '--platform',
    'linux/amd64',
    image,
  ]);

  try {
    rmSync(DESTINATION, { recursive: true, force: true });
    mkdirSync(dirname(DESTINATION), { recursive: true });
    // The symlink target, not the link: `docker cp` of
    // /app/node_modules/@ragenai/jobs would copy a dangling relative link.
    run('docker', ['cp', `${container}:/app/packages/jobs`, DESTINATION]);
  } finally {
    run('docker', ['rm', '-f', container]);
  }

  if (!existsSync(join(DESTINATION, 'dist', 'index.d.ts'))) {
    throw new Error(
      `${image} has no /app/packages/jobs/dist/index.d.ts. Either the image ` +
        'predates the contract package, or its layout changed — which is ' +
        'exactly the breakage this repository exists to notice.',
    );
  }

  console.log(`@ragenai/jobs <- ${image}`);
}

const corePath = process.env.RAGEN_CORE_PATH;
if (corePath) {
  fromCheckout(corePath);
} else {
  fromImage(baseImage());
}
