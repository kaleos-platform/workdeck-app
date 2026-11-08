# Handoff: Toss billing review (MID bill_workdst58) — continue in Paseo

Written: 2026-11-08 · Previous handoff: `docs/superpowers/handoffs/2026-10-30-toss-billing-review.md` (in the workdeck-app repo)
Detailed history and lessons learned: memory `~/.claude/projects/-Users-kaleos-projects-kaleos-workdeck-app-toss-billing/memory/project_pg_review_sellable_products.md`

## Current status (as of 11-08)

- The Toss review manager asked for a test account on 11-05 so they could check the checkout flow.
- On 11-06 at 00:49 KST, we replied from hello@ameaning.co.kr with the `hello+toss@workdeck.work` account and the steps to reach checkout.
- **Toss has not replied.** Last checked 11-06 23:58, including spam and trash.
- **No Toss login trace in prod DB.** Last login for `hello+toss@` was 11-05 23:35 (when we created the account). It has no sessions, no registered cards, and no charges.
- Prod is on **test keys**, which is correct for the review stage per Toss notice 20057.

## Next session's work

1. **Mon 11-09 and later:** check whether Toss replied and whether `hello+toss@` has logged in.
   - Mail: run `aside --effort low "읽기 전용. hello@ameaning.co.kr Gmail ... 토스 심사 담당자 스레드 '[토스페이먼츠] 주식회사의식주의 전자계약 관련 안내' 이후 메일 ... 답장·전송·변경 금지"`. Aside is read-only. Sending anything requires user approval.
   - DB login check: in the linked main repo (`/Users/kaleos/projects/kaleos/workdeck-app`), pull env to the scratchpad with `vercel env pull --environment=production --scope eddysangwon-gmailcoms-projects <file> --yes`. Then use node+pg to query read-only: `auth.users.last_sign_in_at`, `auth.sessions`, and `BillingMethod` / `BillingCharge` for the space. **The `workdeck-app-toss` worktree is not linked to Vercel (`not_linked`).** Delete the env file after use.
2. **Steps after the contract is done** (order matters; the memory file has details):
   1. Switch prod env to live keys and redeploy.
   2. Get every card re-registered, because billingKeys issued under test keys are invalid in live.
   3. Implement **per-deck free trials**. The current trial is per space, once per lifetime (`SpaceSubscription.trialEndsAt`, `ensureTrialStarted`).
   4. Remove `BILLING_CHECKOUT_PAUSED` and `BILLING_CHECKOUT_ALLOW_SPACES` together.

## Prod env (values not included)

- `BILLING_CHECKOUT_PAUSED=1` blocks card registration and new subscriptions, and puts entitlement into PAUSED state.
- `BILLING_CHECKOUT_ALLOW_SPACES` holds two spaces exempt from the pause:
  - 「토스 테스트」 (`hello+toss@`, for the review): `cmw3mnduf000e08l2s2vikrpk`
  - 「테스트」 (`hello+1@`, for internal tests): `cmw3ocbrl000308lbcb1n663j`
- Both spaces had their trials ended in the DB. Account passwords are known only to the user.

## Code changes this session (all merged to main and deployed to prod)

- #1306, #1309: checkout pause plus allowlist (`isCheckoutPausedFor`, `assertCheckoutOpen`)
- #1307: removed auto-activation of 쿠팡 광고 관리 for new spaces
- #1312: removed the "Trial 종료까지 0일" text
- #1313: removed 공급가 from displayed prices; shows VAT-inclusive only
- #1314: cardless checkout opens a payment-method popup, then card registration, then subscription; 구독 업무 관리 uses a 구독 button instead of checkboxes
- #1316, #1318: legal footer (business info, terms, privacy, refund policy), 2-line left/right layout, pinned to the bottom
- #1319: on mobile, the sidebar is replaced by a ☰ sheet menu for all decks. Prod deploy `1f1a8bc8` is Ready.

See `gh pr view <n> --repo kaleos-platform/workdeck-app` for details.

## Leftovers / caveats

- Worktree `/Users/kaleos/projects/kaleos/workdeck-app-toss` is checked out on the merged branch `fix/mobile-app-sidebar`. Start new work from a fresh branch off `origin/main`.
- Admin console has no deck stop/cancel feature. It was offered to the user but not built.
- The deck rename to 「쿠팡 채널 관리」 lives in another worktree on `feat/coupang-channel-sales-mix` and is not on main yet.
- Local visual QA: `npx next dev -p 3100`, then log in with the local test account through Playwright (see the transcript for the script).
- Constraints:
  - Never print keys or secrets.
  - No prod schema SQL. Data changes require user approval.
  - Mail, Toss chat, and any other outbound messages require user confirmation.
  - Respond to the user in Korean.

## Suggested skills

- `paseo` — continue the work and manage agents on Paseo
- `superpowers:brainstorming` → `superpowers:writing-plans` — when designing per-deck free trials
- `superpowers:test-driven-development` — when implementing billing logic changes
- `superpowers:verification-before-completion` — before calling the live-key switch or redeploy done
- `gstack-browse` / `iphone-safari` — real-device checks of the prod mobile menu and checkout flow
- `code-review` — before merging billing changes
