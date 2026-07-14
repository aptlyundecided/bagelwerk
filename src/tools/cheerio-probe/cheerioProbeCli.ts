import { readFile } from "node:fs/promises";

import { PROBE_OPS, runProbe, type ProbeArgs, type ProbeOp } from "./cheerioProbe";

// CLI front-end for the bounded cheerio probe. This is the SANCTIONED tool an agent invokes to
// interrogate a downloaded HTML artifact — it is given this command but NOT raw file-read of the
// .html, so it can only ever pull small, bounded pieces (never the whole document).

function takeOption(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, value === undefined ? 1 : 2);
  return value;
}

function printUsage(): void {
  console.error(`cheerio-probe — bounded cheerio ops over a downloaded HTML artifact (an agent's only door to a page).

Usage: npm run cheerio-probe -- <op> --artifact <path.html> [--selector <css>] [--name <attr>] [--keyword <kw>] [--prefer-type <t>]

Ops:
  outline                                   heading skeleton (orient without reading the page)
  jsonld   [--prefer-type <t>]              application/ld+json blocks (preferred @type first)
  microdata                                 itemscope/itemprop blocks
  query    --selector <css>                 match count + a few text samples
  list     --selector <css>                 item texts (e.g. ingredients / steps)
  text     --selector <css>                 concatenated text under a selector (capped)
  attr     --selector <css> --name <attr>   attribute values
  find     --keyword <kw>                   section landmarks (h*/th/strong/…) mentioning kw

Every op returns a SMALL, bounded JSON result — the whole document cannot be retrieved through this tool.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const artifact = takeOption(args, "--artifact");
  const selector = takeOption(args, "--selector");
  const name = takeOption(args, "--name");
  const keyword = takeOption(args, "--keyword");
  const preferType = takeOption(args, "--prefer-type");
  const op = args.shift();

  if (!op || op === "-h" || op === "--help") {
    printUsage();
    process.exitCode = op ? 0 : 2;
    return;
  }
  if (!PROBE_OPS.includes(op as ProbeOp)) {
    console.error(`Unknown op '${op}'. Valid ops: ${PROBE_OPS.join(", ")}.`);
    process.exitCode = 2;
    return;
  }
  if (!artifact) {
    console.error("--artifact <path> is required.");
    process.exitCode = 2;
    return;
  }

  let html: string;
  try {
    html = await readFile(artifact, "utf8");
  } catch (error) {
    console.error(`Could not read artifact '${artifact}': ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
    return;
  }

  try {
    const result = runProbe(html, op as ProbeOp, { selector, name, keyword, preferType } as ProbeArgs);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

void main();
