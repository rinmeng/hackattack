## Summary

<!-- What does this PR change? -->

Closes #

## Why

<!-- Why is this change needed? -->

## Screenshots

<!-- Before/after for UI changes. Delete if not applicable. -->

## Agent review

When `ENABLE_AGENTS=true`, Claude reviews this PR once it is ready (not a draft) and **approves** it
or **requests changes**. To run it again after fixing:

- Comment `/review`, or `/rereview` to check the full diff against the earlier findings
- Or add the label `review:request` / `review:rerequest`

## Checklist

- [ ] Branch is `feature/*`, `fix/*` or `chore/*`; title is a Conventional Commit
- [ ] `pnpm format` and `pnpm check` pass (and `pnpm build` for routing, rendering or config changes)
- [ ] Migrations come with a regenerated `lib/types/database.ts`
- [ ] New env vars are in `.env.example`
