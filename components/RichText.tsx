import Link from "next/link";

// Render plain text with @username mentions surfaced. When `linkify` is set,
// each @handle becomes a link to /u/<handle> (the profile route resolves a
// username to its wallet); otherwise it's just accent-styled (e.g. inside a
// button, where a nested <a> would be invalid). Handles match the profile rule:
// 3-20 chars of [a-z0-9_]. Everything else passes through untouched.
const MENTION = /(^|[^a-zA-Z0-9_@])@([a-zA-Z0-9_]{3,20})/g;

export function RichText({ text, linkify = false }: { text: string; linkify?: boolean }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MENTION.lastIndex = 0;
  let i = 0;
  while ((m = MENTION.exec(text)) !== null) {
    const lead = m[1];
    const handle = m[2];
    const start = m.index + lead.length; // position of the '@'
    if (start > last) out.push(text.slice(last, start));
    const label = `@${handle}`;
    out.push(
      linkify ? (
        <Link key={`m${i}`} href={`/u/${handle.toLowerCase()}`} className="text-accent-text hover:underline font-medium">
          {label}
        </Link>
      ) : (
        <span key={`m${i}`} className="text-accent-text font-medium">
          {label}
        </span>
      )
    );
    last = start + label.length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
