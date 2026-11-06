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

Not checked: Live GitHub writes/deployments, a multi-process production host, sustained load, real assistive technology, historical files under `legacy`, and third-party package internals. I read the active server, auth, store, GitHub client, text/image helpers, rendering, interaction script, CMS save/media/history paths, README and deployment/export configuration. The reproductions used temporary data, not the portfolio's content.

---

What this change does: It makes the project images the main case-study links, adds the requested title emphasis and UI/UX wording, introduces a testimonial carousel, a rounded arrow cursor and a résumé overlay, and updates the CMS fields and help text. It uses native browser features without new dependencies.

The change review checked the renderer's consumers, content normalization, image fields, résumé URL conversion, modal focus restoration and the shipped carousel handlers. `node scripts/check-ui.js` covers automatic rotation, wrapping, manual controls, hover/focus pausing, hidden tabs, reduced motion, one-quote behavior, unpublished samples and image replacement. The browser check also confirmed automatic rotation using clearly labelled temporary test slides; those slides were never published.

No additional blocking defect was found in the new interaction logic. The two connected CMS publication issues above were subsequently fixed and regression-tested.

Verdict: The local UI preview and both CMS save fixes are ready. Image labels are editable in the CMS; résumé placement and navigation styles match the latest requested layout.

Not checked: A populated Drive folder or an actual résumé document: the owner confirmed that the linked folder is intentionally empty and will add CVs later. The owner will also add real quotes in the CMS; the two saved sample quotes remain unpublished. No claim of a complete accessibility certification is made.
