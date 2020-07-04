import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import chalk from 'chalk';
import regpack from './RegPack/regPack.js';
const { packer } = regpack;

// Title of the demo.
const title = 'Traveler';

// Maximum size of packed source.
const sizeLimit = 1024;

// Create a directory, unless it already exists.
async function mkdirExistOk(path) {
  try {
    const st = await stat(path);
    if (st.isDirectory()) {
      return;
    }
  } catch (e) {
    if (e.code != 'ENOENT') {
      throw e;
    }
  }
  await mkdir(path);
}

// Project root directory.
const rootDir = dirname(fileURLToPath(import.meta.url));

// Convert a project-relative path to an absolute path.
function path(...name) {
  return join(rootDir, ...name);
}

// Escape text so it can appear in an HTML text node.
function escapeTextHTML(text) {
  return text.replace(/&<>/g, (t) => {
    switch (t) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        throw new Error(`Unexpected text ${JSON.stringify(t)}`);
    }
  });
}

// Evaluate a template containing "{{variable}}" substitutions.
function evalTemplate(template, variables) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    const value = variables.get(name);
    if (value == null) {
      throw new Error(
        `Template has undefined variable: ${JSON.stringify(name)}`,
      );
    }
    return value;
  });
}

function buildHTML(source, shim) {
  return evalTemplate(
    shim,
    new Map([
      ['title_html', escapeTextHTML(title)],
      ['title_js', JSON.stringify(title)],
      ['code', source],
    ]),
  );
}

function* runPacker(source, options) {
  for (const method of packer.runPacker(source, options)) {
    yield method.contents;
    const { result } = method;
    for (let i = result.length - 1; i >= 0; i--) {
      yield result[i][1];
    }
  }
}

function compressSource(source) {
  let text, buf;
  for (const output of runPacker(source, {})) {
    const obuf = Buffer.from(output, 'utf8');
    if (text == null || obuf.length < buf.length) {
      text = output;
      buf = obuf;
    }
  }
  return { text, buf };
}

const barBlocks = Array(...Array(7).keys()).map((i) =>
  String.fromCodePoint(0x2589 + 6 - i),
);

function makeBar(frac) {
  const columns = Math.max(10, process.stderr.columns || 80) - 2;
  const bwidth = Math.min(
    columns * 8,
    Math.max(0, Math.round(frac * columns * 8)),
  );
  const fullBlocks = bwidth >> 3;
  const fracBlock = bwidth & 7;
  let t = '';
  t += '\u250c';
  for (let j = 0; j < columns; j++) {
    t += '\u2500';
  }
  t += '\u2510\n\u2502';
  let i = 0;
  for (; i < fullBlocks; i++) {
    t += '\u2588';
  }
  if (fracBlock != 0) {
    t += barBlocks[fracBlock];
    i++;
  }
  for (; i < columns; i++) {
    t += ' ';
  }
  t += '\u2502\n\u2514';
  for (let j = 0; j < columns; j++) {
    t += '\u2500';
  }
  t += '\u2518\n';
  return t;
}

function printStats(size) {
  process.stderr.write(`Size: ${size} bytes\n`);
  if (size > sizeLimit) {
    const frac = (size - sizeLimit) / sizeLimit;
    process.stderr.write(chalk.red.bgWhiteBright(makeBar(frac)));
    process.stderr.write(
      chalk.redBright(`Over limit by: ${(100 * frac).toFixed(1)}%\n`),
    );
  } else {
    const frac = (sizeLimit - size) / sizeLimit;
    process.stderr.write(chalk.greenBright.bgBlue(makeBar(frac)));
    process.stderr.write(`Space remaining: ${(100 * frac).toFixed(1)}%\n`);
  }
}

async function build() {
  const [source, shim] = await Promise.all([
    readFile(path('src.js'), 'utf8'),
    readFile(path('shim.html'), 'utf8'),
  ]);
  const { text, buf } = compressSource(source);
  printStats(buf.length);
  const html = buildHTML(text, shim);
  await Promise.all([
    writeFile(path('build', 'demo.js'), buf),
    writeFile(path('build', 'demo.html'), html, 'utf8'),
  ]);
}

async function main() {
  try {
    const buildDir = path('build');
    await mkdirExistOk(buildDir);
    await build();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
