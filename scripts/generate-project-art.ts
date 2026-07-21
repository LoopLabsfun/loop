/**
 * generate-project-art.ts — batch-generate an icon + banner for every project idea.
 *
 * Reads the Loop_Project_Ideas workbook (the "Icon Prompt" / "Banner Prompt"
 * columns) and renders one PNG icon (1024x1024) and one banner (1536x512, 3:1)
 * per ticker into ./project-art/<TICKER>/.
 *
 * Providers (auto-detected from env, in this order):
 *   - OPENAI_API_KEY  -> OpenAI gpt-image-1
 *   - FAL_KEY         -> fal.ai Flux (flux/dev)
 *
 * Usage:
 *   npx tsx scripts/generate-project-art.ts [path/to/Loop_Project_Ideas.xlsx] [--only TICKER,TICKER]
 *
 * Notes:
 *   - Prompts already carry the shared brand style (violet->indigo, no text),
 *     so the whole set looks like one family. Keep "no text" — add the ticker
 *     lettering later in Figma/Canva for crisp glyphs.
 *   - Skips a target if the PNG already exists, so it's safe to re-run.
 */
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
// xlsx is not a repo dependency — this local-only script loads it lazily so the
// app build/typecheck never depends on it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XLSX: any = require("xlsx");

type Row = { Ticker: string; Title: string; "Icon Prompt": string; "Banner Prompt": string };

const ICON_SIZE = "1024x1024";
const BANNER_SIZE = "1536x512"; // 3:1

async function exists(p: string) {
  try { await access(p); return true; } catch { return false; }
}

/** Returns a PNG buffer for a prompt at the given size. */
async function renderImage(prompt: string, size: string): Promise<Buffer> {
  const openai = process.env.OPENAI_API_KEY;
  const fal = process.env.FAL_KEY;

  if (openai) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openai}` },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size, n: 1 }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
    const d = json.data[0];
    if (d.b64_json) return Buffer.from(d.b64_json, "base64");
    if (d.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer());
    throw new Error("OpenAI: no image payload");
  }

  if (fal) {
    // fal wants width/height, not a size string
    const [w, h] = size.split("x").map(Number);
    const res = await fetch("https://fal.run/fal-ai/flux/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${fal}` },
      body: JSON.stringify({ prompt, image_size: { width: w, height: h }, num_images: 1 }),
    });
    if (!res.ok) throw new Error(`fal ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { images: { url: string }[] };
    const url = json.images?.[0]?.url;
    if (!url) throw new Error("fal: no image url");
    return Buffer.from(await (await fetch(url)).arrayBuffer());
  }

  throw new Error("No image provider configured. Set OPENAI_API_KEY or FAL_KEY.");
}

async function main() {
  const args = process.argv.slice(2);
  const only = (() => {
    const i = args.indexOf("--only");
    return i >= 0 ? new Set(args[i + 1].split(",").map((s) => s.trim().toUpperCase())) : null;
  })();
  const file = args.find((a) => a.endsWith(".xlsx")) ?? "Loop_Project_Ideas.xlsx";

  const wb = XLSX.read(await readFile(file));
  const sheet = wb.Sheets["Project Ideas"] ?? wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as Row[];

  const outRoot = "project-art";
  let made = 0, skipped = 0;

  for (const r of rows) {
    const ticker = String(r.Ticker || "").trim().toUpperCase();
    if (!ticker) continue;
    if (only && !only.has(ticker)) continue;

    const dir = join(outRoot, ticker);
    await mkdir(dir, { recursive: true });

    const targets: [string, string, string][] = [
      [join(dir, "icon.png"), r["Icon Prompt"], ICON_SIZE],
      [join(dir, "banner.png"), r["Banner Prompt"], BANNER_SIZE],
    ];

    for (const [path, prompt, size] of targets) {
      if (!prompt) continue;
      if (await exists(path)) { skipped++; continue; }
      process.stdout.write(`  ${ticker} ${path.endsWith("icon.png") ? "icon" : "banner"} … `);
      try {
        const buf = await renderImage(prompt, size);
        await writeFile(path, buf);
        made++;
        console.log("ok");
      } catch (e) {
        console.log(`FAILED — ${(e as Error).message}`);
      }
    }
  }

  console.log(`\nDone. ${made} generated, ${skipped} already existed. Output: ./${outRoot}/<TICKER>/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
