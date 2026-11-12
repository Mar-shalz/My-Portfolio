What this repo does: It serves a public portfolio and a password-protected content editor. Content is saved either to local JSON files or to GitHub, with a static export option. I assumed modest public traffic and one owner editing the CMS, sometimes with two tabs open.

The original audit was read-only. On 6 November 2026, the owner authorized fixes for findings 1 and 2. Both are now fixed and regression-tested; findings 3 and 4 remain open.

## Resolved save issues

1. **Fixed: two local publishes could overwrite each other** ([lib/store.js](/Users/marshalz/Desktop/My%20Porfolio/lib/store.js:116))
   - **What this is:** Local publishing checks the document version before saving it and keeping a backup.
   - **Problem:** The save pauses to list backups after its version check. Two simultaneous saves with version 0 both succeeded as version 1 in a temporary-folder reproduction; the second replaced the first without a conflict warning.
   - **Fix:** Keep the version check and local write in one uninterrupted synchronous operation, including backup listing. Add a regression check that the second same-version save is rejected. Multiple Node processes would additionally need a shared lock or one designated writer.
   - **Verification:** Same-revision saves now accept one and reject the other with 409. A separate stale store instance also rejects the overwrite. Tests verify content, revisions, backups, restores, invalid input, and a failed disk replacement. Both conflict tests fail against the previous implementation. Local mode continues to support one writer process.

2. **Fixed: typing during publication could leave edits marked as saved** ([admin/admin.js](/Users/marshalz/Desktop/My%20Porfolio/admin/admin.js:85))
   - **What this is:** The CMS sends a snapshot of the draft and updates its saved status when the server responds.
   - **Problem:** The fields remain editable while the request is running. A controlled delayed-response check sent “Before”, kept “Typed during save” in the editor, then set `dirty` to false even though the new words were never sent.
   - **Fix:** Record an edit counter when publishing starts. Clear the unsaved flag only if that counter is unchanged when the request completes. Test typing before the response arrives.
   - **Verification:** Delayed-response tests exercise the actual editor/API functions. Later edits, slugs, added/deleted projects and the unpublished flag survive completion. A second publish sends those edits with the new revision. Network failures, conflicts, expired sessions, retries, duplicate clicks and replaced drafts are covered.

## Should fix

3. **A malformed cookie makes CMS authentication throw** ([lib/auth.js](/Users/marshalz/Desktop/My%20Porfolio/lib/auth.js:30))
   - **What this is:** Each CMS session check reads and decodes cookies sent by the browser.
   - **Problem:** An unrelated cookie with the value `%` throws `URIError` before the session cookie is checked. The API responds with a server error instead of a normal signed-in or signed-out result.
   - **Fix:** Decode each cookie inside a small `try/catch` and ignore malformed entries. Keep a test containing a bad unrelated cookie and a valid session cookie.
   - **If we skip it:** A bad cookie can prevent a visitor from using the CMS until they clear their cookies. This reproduction did not bypass authentication.

4. **Unused animation packages still get installed and exported** ([server.js](/Users/marshalz/Desktop/My%20Porfolio/server.js:79), [scripts/export.js](/Users/marshalz/Desktop/My%20Porfolio/scripts/export.js:36))
   - **What this is:** GSAP and Lenis were used by an earlier design. The current renderer loads only the native interaction script.
   - **Problem:** A repository-wide reference search found their remaining uses in dependency declarations, vendor-serving/export plumbing, deployment inclusion and three obsolete Lenis styles. No current page loads the libraries.
   - **Fix:** Remove the two dependencies, the unused vendor route and export loop, the deployment inclusion entries, and obsolete Lenis rules. Keep native smooth scrolling.
   - **If we skip it:** Installation and deployment retain packages and exported files that the portfolio never uses.

Verdict: The two demonstrated save races are fixed. Run `npm test` to repeat the regression checks without changing real portfolio content.

Lean: -24 lines, -2 dependencies possible, excluding generated lockfile changes.

Not checked in the original audit: Live GitHub writes/deployments, a multi-process production host, sustained load, real assistive technology, historical files under `legacy`, and third-party package internals. Live publishing was subsequently checked as recorded below. I read the active server, auth, store, GitHub client, text/image helpers, rendering, interaction script, CMS save/media/history paths, README and deployment/export configuration. The original reproductions used temporary data, not the portfolio's content.

---

What this change does: It makes the project images the main case-study links, adds the requested title emphasis and UI/UX wording, introduces a testimonial carousel, a rounded arrow cursor and a résumé overlay, and updates the CMS fields and help text. It uses native browser features without new dependencies.

The change review checked the renderer's consumers, content normalization, image fields, résumé URL conversion, modal focus restoration and the shipped carousel handlers. `node scripts/check-ui.js` covers automatic rotation, wrapping, manual controls, hover/focus pausing, hidden tabs, reduced motion, one-quote behavior, unpublished samples and image replacement. The browser check also confirmed automatic rotation using clearly labelled temporary test slides; those slides were never published.

No additional blocking defect was found in the new interaction logic. The two connected CMS publication issues above were subsequently fixed and regression-tested.

Verdict: The local UI preview and both CMS save fixes are ready. Image labels are editable in the CMS; résumé placement and navigation styles match the latest requested layout.

Not checked: A populated Drive folder or an actual résumé document: the owner confirmed that the linked folder is intentionally empty and will add CVs later. The sample quotes were unpublished at this review; the subsequent GitHub merge preserved the owner's published quote from Adefope Oluwatosin. No claim of a complete accessibility certification is made.

## Live publishing verification — 6 November 2026

- Pushed the portfolio and CMS update as `51baf8d`, preserving the remote CMS commits through version 19 and the owner's approved testimonial. The merged content became version 20.
- Published through the signed-in production CMS to create version 21 (`259dbe9`). The test corrected a stray space before a full stop in the testimonial invitation, initially with a trailing space.
- Removed that trailing space while the first request still showed “Publishing…”. After the response, the editor retained this newer text, showed “Unpublished changes” and enabled publishing again.
- Published the preserved newer draft as version 22 (`69b75cb`). Compared the complete normalized document against version 20: only the intended invitation text and revision/timestamp metadata changed. Projects, images, résumé settings and testimonials were preserved.
- Attempted a publish from a second tab still holding version 20. The CMS rejected it with “The content was changed somewhere else since you opened it. Reload to get the latest version.” The rejected draft remained editable and unpublished; GitHub retained version 22.
- Vercel reported successful production deployments for the code update and version 22. A fresh public-page visit showed the corrected invitation text, the preserved approved testimonial and the updated portfolio. Reloading the CMS showed the saved text, “Live” status and a disabled Publish button.
- `npm test` passes 11 local/GitHub storage cases plus the editor and UI assertion suites. These cover restoration, failed writes, SHA conflicts, rejected credentials, retries and edits during publication without touching production data.

Limits: This is a verified publish/refresh cycle, not a sustained-load or host-outage test. Local disk storage still requires one writer process. Original findings 3 and 4 remain open.


## Draft recovery, horizontal motion and live content: 7 November 2026

- Browser-local autosave runs on every edit and retains its original published revision. Refresh and closing/reopening the CMS restored a temporary intro-label edit without publishing it. The public page retained its original title; the test draft was discarded through the CMS and Saved drafts was then empty.
- Separate/duplicated tabs, recovery, stale draft selection, blocked storage, failed publishes and edits during publication are covered by the draft-store/editor tests. Successful publication removes only the relevant draft.
- The CMS now previews the current draft in an embedded portfolio view using the same renderer as the public pages. Browser verification showed the current cover and all three “Read case study” image labels. Cover and case-study hero fields are labelled separately.
- Public routes read published GitHub content with a 30-second per-instance cache and shared in-flight request. Reads time out and fall back to the last available version; a late old read cannot roll back a newer save. Content changes no longer depend on deployment completion.
- Testimonials use a horizontal scroll-snap track with swipe/keyboard navigation and automatic rotation, paused by interaction, hidden tabs or reduced motion. A temporary, unpublished second quote produced equal vertical positions, horizontal overflow and correct next-slide scrolling in the browser. Only the owner’s genuine quote remains published.
- Count-ups were observed starting at 0K+, 0+, 0+ and ending exactly at 41K+, 250+, 6+. Unit checks cover formatting, ranges, visibility and reduced motion. Clickable controls use the native hand pointer; bridge links have transparent resting backgrounds.
- Lead wording and explicit current team leadership appear in the hero/About. Render checks cover absence of em dashes across all published pages. Added bounded hero, section, button and disclosure motion.
- Validation: 21 draft/local/GitHub test cases, editor assertions, UI/count-up assertions, and the nine-page export. No test testimonial or recovery marker was published.

Limits: Drafts remain local to the current browser/device; clearing site storage removes them. Only one real quote is currently published, so automatic carousel movement requires a second. These checks are not a full assistive-technology certification or load test.

Production follow-through: code commit `3395fd1` deployed successfully. In the live CMS, a temporary intro-label draft survived both reload and closing/reopening; it did not appear on the public site. The embedded preview showed the current uploaded Mobile Banking cover (`mobile-0750e2.jpg`) and all three “Read case study” labels. The temporary draft was discarded. A real Publish then updated the contact copy to include “Product Design and UI/UX”, creating version 25 (`e8b64f8`). The refreshed public page displayed that exact text. A full-document comparison against version 24 found only this intended text edit and revision/timestamp changes. Vercel reported success for both commits. No sample testimonial or test marker was published.

## Accessibility and presentation: 12 November 2026

Scope: public home, About and all six published case studies; CMS dashboard, Home, About, Method, Testimonials, Site settings, Media, History, Projects and the case-study editor. Checked light and dark themes with rendered text contrast measurements, mobile reflow and keyboard interaction. This is an engineering audit, not a WCAG certification.

Fixed:
- CMS disclosure headers and media choices were mouse-only. They are now native buttons; disclosures expose their expanded state and retain focus after toggling.
- Project ordering previously required dragging. Named up/down buttons now use the same bounded reorder operation, preserving project objects and restoring focus. Covered by editor assertions.
- CMS dialogs now use native modal dialogs, making the underlying page inert and supporting Escape and focus restoration.
- The off-screen CMS mobile sidebar remained keyboard reachable. Closed navigation is now hidden; menu state is announced and Escape returns focus.
- CMS dark-theme monogram, inline formatting hints and tag removal buttons failed contrast. Corrected their colors. Project initials now use a dependable contrasting background rather than arbitrary project accent colors.
- List action controls overflowed at 320px. Actions wrap onto a second row, grid tracks can shrink and labels can wrap. Increased small action targets, improved input boundaries and toggle contrast.
- Portfolio defaults to light and uses a split-panel appearance icon. Explicit visitor theme choices persist. CMS has matching light/dark appearance support.

Verification:
- No measured text contrast failures remained across the eight public pages in both themes. Checked normal text against 4.5:1 and large text against 3:1, with ancestor background composition. Image content and complex composited backgrounds also require human judgment.
- No document-width overflow on those public pages at 320px. CMS sections were checked in both themes; identified narrow list overflows were fixed and rechecked. Desktop, 390px and 320px views were inspected during the audit.
- Keyboard checks covered mobile navigation open/close and focus restoration, CMS disclosure activation with Enter, media selection controls, native modal state, Escape dismissal and return to the invoking control.
- Existing automated checks cover carousel keyboard/swipe/autoplay/pause, reduced-motion changes, count-up formatting, CMS draft recovery, publish failures and concurrent writes. All pass. No audit fixtures were published.

Presentation:
- Chopbaze is the fourth featured case study, with the owner's clarified design leadership and sole AI-assisted development contribution. Captures from the current live site show both the home and gatherings sections.
- Five new AI-assisted presentation mockups use supplied UI: E-Token, Internet Banking, Chopbaze, Evamor and a supplementary Fast Credit Mobile showcase. Original UI evidence remains in the case studies and original uploaded files remain available.
- All new covers, hero images and content images use existing CMS media fields. Optimized JPEG assets keep each new showcase below 600KB. Original generated PNGs remain in the local generation folder.
- Horizontal testimonial cards use smaller quotes and larger attribution. More than one published quote enables rotation; only one approved quote is currently published.
- Subtle pointer-responsive depth reuses the existing bounded motion helper. It is disabled for touch/coarse pointers and reduced-motion preferences.

Limits: No physical-device or screen-reader certification. Drafts remain browser/device-local. AI mockups are presentation imagery; original screenshots remain the authoritative interface evidence. The résumé folder and portrait still require the owner's files.
