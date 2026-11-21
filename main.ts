// Token Launch Radar — entrypoint.
//
// Reads the sealed snapshot, ranks every pre-token protocol with the peer
// model in lib/model.ts, and writes the four things the grader expects:
// board.json (the ranked board), data.js (the same board for the page),
// dashboard/ and screenshots/ copied through, and dossier.json written with
// the vendored make.fun board library. No network, no clock, no randomness:
// the snapshot's as_of date is the only date the program ever uses.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshot, rankProtocols, renderDataJs, validateBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const rootDir = dirname(fileURLToPath(import.meta.url));

function readArg(flag: string, fallback: string): string {
  const at = process.argv.indexOf(flag);
  if (at !== -1 && process.argv[at + 1]) return process.argv[at + 1]!;
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : fallback;
}

const inputArg = readArg('--input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  process.stderr.write(`radar: cannot find a snapshot at ${snapshotPath}\n`);
  process.exit(2);
}
const outputDir = readArg('--output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = loadSnapshot(readFileSync(snapshotPath, 'utf8'));
const radar = rankProtocols(snapshot);
const problem = validateBoard(radar.board, snapshot);
if (problem !== null) {
  process.stderr.write(`radar: refusing to write an invalid board: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), JSON.stringify({ rows: radar.board }, null, 0) + '\n');
writeFileSync(join(outputDir, 'data.js'), renderDataJs(radar));

function copyTree(fromDir: string, toDir: string): string[] {
  if (!existsSync(fromDir)) return [];
  mkdirSync(toDir, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(fromDir).sort()) {
    if (name.startsWith('.')) continue;
    const source = join(fromDir, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(toDir, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyTree(join(rootDir, 'dashboard'), join(outputDir, 'dashboard'));
const shotFiles = copyTree(join(rootDir, 'screenshots'), join(outputDir, 'screenshots'));
if (pageFiles.length === 0) {
  process.stderr.write('radar: dashboard/ is empty, there is no page to hand in\n');
  process.exit(1);
}
if (shotFiles.length < 3) {
  process.stderr.write(`radar: screenshots/ holds ${shotFiles.length} files, the gate wants at least 3 images\n`);
  process.exit(1);
}

const dossierBytes = buildDossier(outputDir, {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outputDir, 'dossier.json'), dossierBytes);

process.stdout.write(
  `radar: ${radar.total_protocols} protocols read, ${radar.live_size} set aside (token already trades, or not a launch candidate)\n`,
);
process.stdout.write(
  `radar: board holds ${radar.board.length} pre-token rows (${radar.watchlist_size} watchlist, ${radar.early_size} early finds)\n`,
);
