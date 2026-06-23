# Contributing to Loop

Loop is an **autonomous software factory**: most commits here are authored by the
project's own AI agent, and the repository is public so anyone can verify it ships
real, test-passing work. Humans — and $LOOP holders — are welcome to contribute
too.

## Three ways to contribute

1. **Steer the agent (no code).** On the project page at
   [looplabs.fun](https://looplabs.fun) you can submit directives and vote on the
   backlog; token-weighted steering shapes what the agent builds next. Steering
   input is a *suggestion*, never a command — see [SECURITY.md](SECURITY.md).
2. **Open an issue.** Bugs, rough edges, or proposals. A clear repro or rationale
   helps the agent (and us) act on it.
3. **Open a pull request.** Outside PRs are reviewed by a human and/or the agent
   and must pass the same objective gate the agent itself passes (below). Good
   first PRs: tests, type-safety, accessibility, dead-code removal, doc fixes.

## The gate (must be green)

Nothing merges — human or agent — without an independent green check. Before you
push, run what the gate runs:

```bash
npm install
npx tsc --noEmit     # types
npm test             # vitest unit tests
npm run build        # production build (catches route/type errors)
```

Keep these green. A change that can't pass the gate isn't ready.

## Conventions

- **Server Components by default**; add `"use client"` only where you need hooks or
  interactivity.
- **Keep secrets server-side.** Anything touching a private key or API secret stays
  behind `import "server-only"`; never give a secret a `NEXT_PUBLIC_` prefix.
- **Style with design tokens**, not hardcoded colors — `text-muted`, `bg-surface`,
  `border-line-2`, `font-display`, `font-mono` (see `tailwind.config.ts`).
- **Respect the data seam.** Extend `lib/queries.ts` / `lib/api.ts` and keep the
  static fallback path working — a component must render without a configured
  backend.
- **Small, real increments.** One minimal, test-passing change beats a sweeping
  one. Match the surrounding code's style.

## Local setup

```bash
cp .env.example .env.local   # fill in your own keys; .env.local is gitignored
npm install
npm run dev                  # http://localhost:3000
```

Never commit secrets or a populated `.env.local`. If you find a leaked secret
anywhere, treat it as a security report ([SECURITY.md](SECURITY.md)), not an issue.

## Authorship & deploys

`main` auto-deploys. The agent commits under the `looplabs-fun` org identity; human
contributors should use their own GitHub identity on pull requests. By opening a
PR you agree it may be merged and deployed as part of this project.
