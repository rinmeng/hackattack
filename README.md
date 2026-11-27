# hackattack

A hackathon-ready Next.js starter with shadcn/ui, Supabase auth, and Tailwind CSS v4. Clone it, run two commands, and start building your idea.

**Stack:** Next.js 16 · React 19 · TypeScript 7 · shadcn/ui (base-lyra, on Base UI) · Supabase · Tailwind v4 · pnpm

> Using AI coding agents? They read [AGENTS.md](AGENTS.md) (Claude Code reads it through `CLAUDE.md`). It holds the project's conventions, so your agent writes code that matches everyone else's.

## Get started in 5 minutes

### 1. Install the prerequisites

| Tool                                              | Why                                  | Check            |
| ------------------------------------------------- | ------------------------------------ | ---------------- |
| [Node.js 20+](https://nodejs.org)                 | Runs Next.js                         | `node -v`        |
| [pnpm](https://pnpm.io/installation)              | Package manager (don't use npm/yarn) | `pnpm -v`        |
| [Docker Desktop](https://docs.docker.com/desktop) | Only needed for local Supabase       | `docker info`    |
| [GitHub CLI](https://cli.github.com) (optional)   | Opening PRs and issues from terminal | `gh auth status` |

No pnpm yet? Run `corepack enable` (ships with Node) or `npm install -g pnpm`.

### 2. Clone and run

```bash
git clone https://github.com/rinmeng/hackattack.git
cd hackattack
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The UI runs without Supabase, so frontend work can start right away.

### 3. (Optional) Turn on the database and auth

Only needed once you want login or stored data. With Docker running:

```bash
pnpm db:start   # starts Supabase, applies migrations, seeds a test user
```

Write the local keys into `.env.local` (this replaces the file, which is fine since these three values are all it needs):

```bash
pnpm exec supabase status -o env --override-name api.url=NEXT_PUBLIC_SUPABASE_URL --override-name auth.publishable_key=NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY --override-name auth.secret_key=SUPABASE_SECRET_KEY | grep -E "^(NEXT_PUBLIC_SUPABASE|SUPABASE_SECRET)" > .env.local
```

Then set `AUTH_ENABLED = true` in `config/auth.ts`, restart `pnpm dev`, and log in with the seeded user:

| Email               | Password      |
| ------------------- | ------------- |
| `admin@example.com` | `password123` |

| Service                                | URL                                              |
| -------------------------------------- | ------------------------------------------------ |
| App                                    | [http://localhost:3000](http://localhost:3000)   |
| Supabase Studio (browse tables)        | [http://127.0.0.1:54723](http://127.0.0.1:54723) |
| Email inbox (auth emails sent locally) | [http://127.0.0.1:54724](http://127.0.0.1:54724) |

That's it, you're set up. The rest of this README is reference.

## Team workflow

With several people pushing to one repo over a weekend, a few habits keep merges painless:

1. **Pull first:** `git pull origin main`
2. **Branch per feature:** `git checkout -b feature/leaderboard` (prefixes: `feature/`, `fix/`, `chore/`)
3. **Check before pushing:** `pnpm format && pnpm check`
4. **Commit with Conventional Commits:** `feat: add leaderboard page`, `fix(auth): redirect after logout`
5. **Open a PR** into `main` and link the issue with `Closes #12`

Tips:

- Claim work in a GitHub issue (use the Task template) so two people don't build the same thing.
- Keep edits to shared files (`components/Navbar.tsx`, `app/layout.tsx`, `lib/types/`) small. Those are where conflicts happen.
- Pull right before creating a migration so its timestamp comes after everyone else's.
- Check `package.json` before adding a dependency. zod, react-hook-form, date-fns, recharts, lucide-react, and sonner are already installed.

## Folder structure

```text
hackattack/
├── app/                      # Pages and layouts (Next.js App Router)
│   ├── layout.tsx            #   Root layout: providers, Navbar, metadata
│   ├── page.tsx              #   Home page (/)
│   ├── globals.css           #   Tailwind v4 theme (colors, dark mode, animations)
│   ├── login/                #   /login
│   ├── admin/                #   /admin (protected when auth is on)
│   ├── features/             #   Demo page, delete when you start
│   └── tech-stack/           #   Demo page, delete when you start
├── components/               # Reusable app components
│   ├── ui/                   #   shadcn/ui components (don't edit by hand)
│   ├── Navbar.tsx            #   Top nav and navLinks
│   ├── Text.tsx              #   Typography: <Text variant='hd-lg'>
│   ├── EmptyState.tsx        #   Empty-state wrapper
│   ├── UserButton.tsx        #   Signed-in user name + logout
│   ├── Logo.tsx
│   ├── ModeToggle.tsx        #   Light/dark toggle
│   └── theme-provider.tsx
├── config/
│   └── auth.ts               # AUTH_ENABLED flag
├── contexts/                 # React context providers (Auth, Toast)
├── hooks/                    # useAuth, useToast, useMobile, ...
├── lib/
│   ├── types/                # Shared TypeScript types (import from '@/lib/types')
│   │   └── database.ts       #   Generated from the DB schema, don't edit
│   ├── durations.ts          # Toast durations
│   └── utils.ts              # cn() helper
├── utils/
│   ├── supabase/             # Supabase clients: client, server, admin, proxy, env
│   ├── animations.ts         # getDelayClass() for staggered animations
│   └── user.ts               # getDisplayName()
├── supabase/
│   ├── config.toml           # Local Supabase config (ports 547xx)
│   ├── migrations/           # SQL schema changes, one timestamped file each
│   └── seed.sql              # Local-only test data (seeded admin user)
├── public/                   # Static files (images, icons)
├── docs/
│   ├── examples/             # Copy-paste examples (table + RLS policies)
│   └── planning/             # Plans for big features
├── scripts/                  # Repo scripts (db-types.mjs)
├── .claude/skills/           # Agent workflows (orchestrator, create-pr)
├── .github/                  # CI workflows, PR template, issue template
├── proxy.ts                  # Session refresh + route protection
├── AGENTS.md                 # Conventions for AI coding agents
└── .env.example              # Env vars template
```

**Where do I put…**

| Thing                    | Location                                                     |
| ------------------------ | ------------------------------------------------------------ |
| A new page               | `app/<route>/page.tsx`                                       |
| A reusable component     | `components/MyThing.tsx`                                     |
| A shadcn component       | `pnpm dlx shadcn@latest add <name>` → `components/ui/`       |
| A custom hook            | `hooks/use-my-thing.ts`                                      |
| A TypeScript type        | `lib/types/<feature>.ts`, re-exported from `lib/types/index` |
| A database table         | `pnpm exec supabase migration new <name>`                    |
| Images and static assets | `public/`                                                    |
| Theme colors / dark mode | `app/globals.css` (there is no `tailwind.config.js`)         |
| A new env var            | `.env.local`, and document it in `.env.example`              |

## Scripts

| Command               | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `pnpm dev`            | Start the dev server                                 |
| `pnpm build`          | Production build                                     |
| `pnpm start`          | Run the production server                            |
| `pnpm check`          | Format check + lint + typecheck (what CI runs)       |
| `pnpm lint`           | oxlint                                               |
| `pnpm format`         | Prettier (write)                                     |
| `pnpm format:check`   | Prettier (check only)                                |
| `pnpm typecheck`      | `tsc --noEmit` (TypeScript 7)                        |
| `pnpm db:start`       | Start local Supabase (Docker)                        |
| `pnpm db:stop`        | Stop local Supabase                                  |
| `pnpm db:status`      | Show local URLs and keys                             |
| `pnpm db:reset`       | Rebuild local DB from migrations + seed (wipes data) |
| `pnpm db:types`       | Regenerate `lib/types/database.ts` from local DB     |
| `pnpm db:types:check` | Fail if `database.ts` doesn't match the local DB     |

CI runs format check, lint, typecheck, and build on every push and PR (`.github/workflows/ci.yml`). When migrations change, `.github/workflows/db-types.yml` also checks the generated types.

## Database

Schema changes are SQL migrations in `supabase/migrations/`:

```bash
pnpm exec supabase migration new create_todos   # creates a timestamped .sql file
# write the SQL, including RLS policies
pnpm exec supabase migration up                  # applies it locally, keeps your data
pnpm db:types                                    # regenerates lib/types/database.ts
```

Every table needs `enable row level security` plus policies, or nobody (or everybody) can read it. [docs/examples/profiles-table.md](docs/examples/profiles-table.md) has a complete example to copy from. Commit the regenerated `lib/types/database.ts` with your migration.

### Which Supabase client to use

| Where                                            | Import                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| Client Components                                | `createClient()` from `@/utils/supabase/client`       |
| Server Components, Server Actions, Route Handler | `await createClient()` from `@/utils/supabase/server` |
| Signed-in user on the server                     | `await getUser()` from `@/utils/supabase/server`      |
| Privileged server work that bypasses RLS         | `createAdminClient()` from `@/utils/supabase/admin`   |
| Current user in Client Components                | `useAuth()` from `@/hooks/use-auth`                   |

The publishable key runs in the browser and acts as the signed-in user, so RLS applies. The secret key is server-only and bypasses RLS. Use it only through `createAdminClient()`.

### Hosted Supabase

To share one database across the team or deploy:

```bash
cp .env.example .env.local
```

Fill in the three values from [Project Settings → API Keys](https://supabase.com/dashboard/project/_/settings/api-keys), then push your migrations:

```bash
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase db push
```

The seed is local-only, so create users in the dashboard under Authentication → Users. The app expects `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, not `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## shadcn/ui (Base UI, not Radix)

Components live in `components/ui/`, and most of the usual set is installed. Add more with `pnpm dlx shadcn@latest add <component>`.

This project uses the **base-lyra** style, built on [Base UI](https://base-ui.com). Most shadcn examples online use Radix, so watch for two differences:

- **No `asChild`.** Pass the element through `render` instead.
- **Add `nativeButton={false}`** when `render` turns a `Button` into a link or other non-button.

```tsx
// Do
<Button nativeButton={false} render={<Link href='/about' />}>About</Button>
<DialogTrigger render={<Button variant='outline' />}>Open</DialogTrigger>

// Don't (Radix API, doesn't work here)
<Button asChild><Link href='/about'>About</Link></Button>
```

## Troubleshooting

- **"port is already allocated"** when running `pnpm db:start`: another local Supabase is probably running. Find it with `docker ps` and stop it with `pnpm exec supabase stop --project-id <other-project>`, or change the ports in `supabase/config.toml`.
- **Auth doesn't work:** check that `.env.local` has all three values, `AUTH_ENABLED` is `true`, and you restarted `pnpm dev`.
- **Typecheck fails after pulling:** someone added a migration. Run `pnpm exec supabase migration up`, then `pnpm db:types`.
- **`supabase migration up` reports out-of-order migrations:** ask the team before running `pnpm db:reset`, since it wipes your local data.

## Make it yours

Before demo day:

- [ ] Replace `app/page.tsx` with your landing page
- [ ] Delete `app/features/` and `app/tech-stack/`, and remove them from `navLinks` in `components/Navbar.tsx`
- [ ] Swap the name and logos in `components/Logo.tsx`, and remove unused files in `public/`
- [ ] Replace `app/favicon.ico`
- [ ] Update `title` and `description` in `app/layout.tsx`
- [ ] Update or delete `app/admin/page.tsx` (and `/admin` in `proxy.ts`)

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/rinmeng/hackattack)

Set the same three Supabase env vars in your host's dashboard. In Supabase, under Authentication → URL Configuration, set the Site URL to your deployed URL.

## License

MIT — see [LICENSE](LICENSE).
