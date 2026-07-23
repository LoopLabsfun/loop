// Post an X thread from a JSON spec — text, optional image, optional quote-
// tweet per entry. The CONTENT lives outside the repo (loop-private-notes):
// this script is deliberately generic so no launch/marketing copy is ever
// committed to the public repo (founder rule).
//
// Spec file: [{ "text": "...", "imagePath": "/abs/path.png"?, "quoteTweetId": "123"? }, ...]
// Entry 1 posts standalone; every following entry replies to the previous one.
//
// DRY-RUN BY DEFAULT — prints each tweet with char counts and flags problems
// (over 280, >1 cashtag), posts nothing. Nothing posts without the founder's go.
//
//   set -a; source .env.local; set +a
//   npx tsx scripts/post-thread.ts <thread.json>              # dry-run
//   npx tsx scripts/post-thread.ts <thread.json> --test-media # uploads image(s) only,
//                                                             # no tweet — validates the
//                                                             # media leg safely (unattached
//                                                             # uploads just expire)
//   npx tsx scripts/post-thread.ts <thread.json> --post       # posts for real
import fs from "fs";
import { sendTweet, uploadTweetMedia, isXConfigured } from "../lib/x-send";

interface ThreadEntry {
  text: string;
  imagePath?: string;
  quoteTweetId?: string;
}

const POST = process.argv.includes("--post");
const TEST_MEDIA = process.argv.includes("--test-media");
const specPath = process.argv[2];

function mimeFor(path: string): string {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.gif$/i.test(path)) return "image/gif";
  if (/\.webp$/i.test(path)) return "image/webp";
  throw new Error(`unsupported image type: ${path}`);
}

(async () => {
  if (!specPath || specPath.startsWith("--")) {
    throw new Error("usage: post-thread.ts <thread.json> [--test-media|--post]");
  }
  const entries = JSON.parse(fs.readFileSync(specPath, "utf8")) as ThreadEntry[];
  if (!Array.isArray(entries) || !entries.length) throw new Error("spec must be a non-empty array");

  console.log(`\n=== THREAD (${entries.length} tweets · ${POST ? "POST" : TEST_MEDIA ? "TEST-MEDIA" : "dry-run"}) ===\n`);
  let issues = 0;
  entries.forEach((e, i) => {
    const cashtags = (e.text.match(/\$[A-Za-z]+/g) ?? []).length;
    const over = e.text.length > 280;
    if (over || cashtags > 1) issues++;
    console.log(`--- ${i + 1}/${entries.length} · ${e.text.length} chars${over ? " ⚠️ OVER 280" : ""}${cashtags > 1 ? ` ⚠️ ${cashtags} cashtags` : ""}`);
    if (e.quoteTweetId) console.log(`    quote: https://x.com/i/web/status/${e.quoteTweetId}`);
    if (e.imagePath) {
      const exists = fs.existsSync(e.imagePath);
      console.log(`    image: ${e.imagePath}${exists ? "" : " ⚠️ FILE MISSING"}`);
      if (!exists) issues++;
    }
    console.log(e.text.split("\n").map((l) => "    | " + l).join("\n"));
    console.log();
  });
  if (issues) console.log(`⚠️  ${issues} issue(s) above — fix before posting.\n`);

  if (!POST && !TEST_MEDIA) {
    console.log("(dry-run) nothing sent. --test-media validates the image upload; --post fires the thread.\n");
    return;
  }
  if (!isXConfigured()) throw new Error("X credentials not configured in this environment.");

  if (TEST_MEDIA) {
    for (const e of entries) {
      if (!e.imagePath) continue;
      const up = await uploadTweetMedia(new Uint8Array(fs.readFileSync(e.imagePath)), mimeFor(e.imagePath));
      console.log(up.ok ? `✅ media upload OK — id ${up.mediaId} (expires unattached, nothing posted)` : `❌ media upload failed: ${up.error}`);
    }
    return;
  }

  if (issues) throw new Error("refusing to post with issues flagged above.");
  let prevId: string | undefined;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let mediaIds: string[] | undefined;
    if (e.imagePath) {
      const up = await uploadTweetMedia(new Uint8Array(fs.readFileSync(e.imagePath)), mimeFor(e.imagePath));
      if (!up.ok) throw new Error(`tweet ${i + 1}: media upload failed: ${up.error}`);
      mediaIds = [up.mediaId!];
    }
    const r = await sendTweet(e.text, prevId, { quoteTweetId: e.quoteTweetId, mediaIds });
    if (!r.ok) throw new Error(`tweet ${i + 1} failed: ${r.error} — thread stopped (${i} posted).`);
    console.log(`✅ ${i + 1}/${entries.length} → https://x.com/i/web/status/${r.id}`);
    prevId = r.id;
  }
  console.log("\n🎉 thread posted.\n");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
