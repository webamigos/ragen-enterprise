/**
 * Run an npm task across every workspace, tolerating there being none.
 *
 * `npm run --workspaces --if-present <task>` exits non-zero with "No workspaces
 * found!" when `packages/` holds no package yet, which would fail CI on an
 * empty scaffold — a red build that says nothing about the code. `--if-present`
 * covers a workspace without the script; nothing covers no workspace at all.
 *
 * A real failure still propagates: this only decides whether to invoke npm.
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const task = process.argv[2];
if (!task) {
  console.error('usage: node scripts/run-workspaces.mjs <task>');
  process.exit(1);
}

const packages = new URL('../packages/', import.meta.url);
const hasWorkspace =
  existsSync(packages) &&
  readdirSync(packages, { withFileTypes: true }).some(
    (entry) =>
      entry.isDirectory() &&
      existsSync(new URL(`${entry.name}/package.json`, packages)),
  );

if (!hasWorkspace) {
  console.log(`No workspaces yet — skipping \`${task}\`.`);
  process.exit(0);
}

const result = spawnSync('npm', ['run', '--workspaces', '--if-present', task], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
