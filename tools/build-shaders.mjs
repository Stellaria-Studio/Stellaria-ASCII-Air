import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'shaders/ascii_post.stsl');
const output = resolve(root, 'public/shaders/ascii_post.wgsl');
const candidates = [
  process.env.STSL_SLANGC,
  resolve(root, '../Stellaria Shading Language/upstream/slang/build-stsl/slang-2026.5.2-macos-aarch64/bin/slangc'),
  resolve(root, '../Stellaria Shading Language/upstream/slang/build-stsl/Release/bin/slangc'),
].filter(Boolean);
const compiler = candidates.find((candidate) => existsSync(candidate));

mkdirSync(dirname(output), { recursive: true });
if (!compiler) {
  if (!existsSync(output)) throw new Error('No StSL/Slang compiler and no generated WGSL artifact found. Set STSL_SLANGC.');
  console.log('StSL compiler unavailable; using checked generated WGSL artifact.');
  process.exit(0);
}

const result = spawnSync(compiler, ['-lang', 'slang', source, '-target', 'wgsl', '-profile', 'sm_6_0', '-entry', 'vertexMain', '-entry', 'fragmentMain', '-o', output], { encoding: 'utf8' });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(output, `${readFileSync(output, 'utf8').trimEnd()}\n`);
console.log('Generated public/shaders/ascii_post.wgsl from shaders/ascii_post.stsl');
