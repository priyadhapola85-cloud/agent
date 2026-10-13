# Atelier — Fashion AI Studio

Create **fictional AI fashion models**, keep them **visually consistent**, and turn approved looks into **short fashion videos** for Instagram Reels — then review, approve and export the MP4 yourself.

> This version does **not** post to Instagram, schedule posts, take payments, or track costs. Approved videos are downloaded so you can post them manually.

---

## 1. Quick start (first time)

You need **Node.js 20+** (you have Node 24). Nothing else to install — the database is built in.

Open a terminal in this folder (`fashion-ai-studio`) and run:

```bash
npm install
```

```bash
npm run setup
```

`npm run setup` creates a private file called **`.env.local`** with a random login password (it prints the password in the terminal) and a random session secret. Then:

1. Nothing else is required — image and video generation is **free by default** (Hugging Face models, no account needed).
2. Optional: add a free `HF_TOKEN` (more free minutes per day), an `ANTHROPIC_API_KEY` (AI analysis/storyboards), or a paid `FAL_KEY` (see section 3).
3. Start the app:

```bash
npm run dev
```

4. Open **http://localhost:3000** and log in with the password from step 1 (also in `.env.local` as `APP_PASSWORD`).

Stop the app with **Ctrl + C**. Your characters, images, videos and history are saved and will still be there next time.

---

## 2. How to use it (the workflow)

| Step | Where | What happens |
|---|---|---|
| 1. Create a character | **Create AI Character** | Name + optional notes. No image needed, nothing is generated. |
| 2. Upload a reference | Character **Design Studio** | Upload your reference photo (JPG/PNG/WebP, ≤ 5 MB). Stored privately. You confirm you have the rights to use it. |
| 3. Analyze & edit | Design Studio | *Analyze reference* asks Claude to describe what's visible (face, hair, skin, styling, lighting). You review and edit every field, then press **Save & mark reviewed**. |
| 4. Generate candidates | Design Studio | Only when you press **Generate**. Your reference + description go to the chosen model — **FLUX.1 Kontext (free)** by default. |
| 5. Approve a master | Design Studio | Compare candidates with your reference, reject ones that drift, **Approve as master**. Optionally add more approved references (other angles). |
| 6. Content brief | **Create Fashion Content** | Theme, outfit, location, mood, duration, aspect ratio, camera, pose, caption. Saving generates nothing. |
| 7. Storyboard | Project page | *Plan with Claude* (AI) or *basic template* (no AI). Everything stays editable. |
| 8. First frames | Project page → each scene | Generate scene images (they reuse the character's master + approved references) **or** use the master directly. Pick one as the **start frame**. |
| 9. Video | Project page → each scene | Image-to-video — **Wan 2.2 (free)** by default, 3–5 s clips. Runs in the background. |
| 10. Review & export | **Review & Approval** | Watch, Approve or Reject, add notes, edit the caption, **Download MP4**. Regenerating an approved video clears the approval — the new version must be reviewed again. |

---

## 3. Getting API keys (and keeping them safe)

Keys live **only** in `.env.local` on your computer. The browser never sees them, and `.env.local` is excluded from Git. **Never paste keys into chat, screenshots or code.**

| Key | Needed for | Where to get it |
|---|---|---|
| *(none)* | **Free** image + video generation (Hugging Face) | Works out of the box — small shared daily GPU allowance. |
| `HF_TOKEN` | Optional: more **free** daily GPU minutes | huggingface.co → Settings → **Access Tokens** → *Create new token* (Read). No payment. |
| `FAL_KEY` | Optional **paid** models (Nano Banana Pro, Kling) | fal.ai → Dashboard → **Keys**. Needs account credit. |
| `ANTHROPIC_API_KEY` | Reference-image analysis + AI storyboards (optional) | platform.claude.com → Settings → **API keys** |

After editing `.env.local`, **restart** `npm run dev`. The **Settings** page shows whether each key is detected (it never shows the key itself).

**What works without any keys:** everything, including free image and video generation. Paid models appear in the model pickers but stay disabled until `FAL_KEY` is set. The app never shows fake results as real ones.

**Free tier limits:** Hugging Face gives a limited amount of free GPU time per day (more with a free `HF_TOKEN`). When it runs out, the app says so clearly; it refills automatically within about 24 hours. Free models use **one** reference image (the master) and make 3–5 second clips; paid models use up to 4 references and longer clips.

### If a key leaks — rotate it
1. Create a new key in the provider dashboard.
2. Replace it in `.env.local` and restart the app.
3. Delete/revoke the old key in the dashboard so it stops working.
4. Check the provider's usage page for unexpected charges.
5. To log out every browser session, change `SESSION_SECRET` (and `APP_PASSWORD` if needed) and restart.

### Costs (check the provider for current prices)
Free models cost nothing. With **paid** models, every **Generate**/**Regenerate**/**Retry** click is a paid request. Rough guide at the time of writing: Kling 2.6 Pro ≈ $0.07 per video second; Kling 3 Pro ≈ $0.22/s; Nano Banana Pro is billed per image (more for 2K/4K).

---

## 4. Character consistency — what to expect

The app uses the strongest practical **reference-based** workflow:

- **Stable identity** (face, eyes, hair, skin, body, distinctive features) is stored separately from **changeable style** (outfit, location, pose, lighting, camera).
- Every image request sends the character's **approved reference images** (master first, up to 4) plus the identity text, built from reusable prompt templates (`src/lib/prompts/templates.ts`).
- Videos are **image-to-video**: they start from an approved image of the character, so the first frame is on-model.
- Every generation is saved with character ID, full prompt, reference image IDs, provider, model, options, timestamp and outputs.

**Limitations (honest):** no current provider guarantees a perfect identity match. Faces can drift, especially in motion, at extreme angles, or with long clips. That's why you can compare outputs side-by-side with your references, **reject** inconsistent ones, and regenerate with revision notes.

---

## 5. Project structure

```
fashion-ai-studio/
├─ src/
│  ├─ app/
│  │  ├─ (studio)/          ← dashboard pages (with sidebar)
│  │  │  ├─ page.tsx               Dashboard
│  │  │  ├─ characters/            Library, Create, Design Studio ([id])
│  │  │  ├─ content/               Projects, New brief, Workspace ([id])
│  │  │  ├─ studio/images|videos   Image / Video studio hubs
│  │  │  ├─ review/  history/  settings/
│  │  ├─ login/                 Login page
│  │  └─ api/                   Server API endpoints (one folder per URL)
│  ├─ components/            UI building blocks (buttons, forms, job progress…)
│  ├─ lib/
│  │  ├─ services/           Business logic (characters, content, jobs, lifecycle…)
│  │  ├─ providers/          AI integrations behind interfaces
│  │  │  ├─ fal/                 fal.ai image + video (models.ts lists exact params)
│  │  │  ├─ anthropic/           Claude analyzer + planner
│  │  │  └─ template-planner.ts  Non-AI fallback planner
│  │  ├─ db/                 Database schema + connection
│  │  ├─ storage/            Private file storage (swap for S3 later)
│  │  ├─ jobs/worker.ts      Background job worker
│  │  ├─ validation/         Input validation (zod schemas)
│  │  ├─ auth/  api/  config/  prompts/  media/  client/
│  └─ proxy.ts               Login check before every page/API request
├─ drizzle/                  Database migrations (SQL)
├─ tests/                    Automated tests (fake providers — free)
│  └─ integration/           Real-API tests (opt-in, cost money)
├─ data/      (created on first run, git-ignored) embedded database
└─ storage/   (created on first run, git-ignored) your private images/videos
```

**Why it's built this way (simple version):**
- **Next.js + TypeScript** gives one app for both the screens and the server code.
- **Provider adapters**: the rest of the app talks to an `ImageProvider` / `VideoProvider` interface (`src/lib/providers/types.ts`). Switching provider = writing one new class and registering it in `src/lib/context.ts`.
- **Background jobs**: video takes minutes, so a job row is saved immediately and a worker submits/polls the provider (fal's official *queue* API: submit → status → result). If you close the app mid-job, it resumes on next start.
- **Database: PostgreSQL**. By default it's **PGlite** — real Postgres running inside Node, stored in `./data`. To use a normal Postgres server, set `DATABASE_URL` in `.env.local`; the same migrations run automatically.
- **Media is never stored in the database** — only its location and metadata. Files live in `./storage`, served only to a logged-in user through `/api/assets/[id]`.

### Data model (tables)
`characters` · `character_references` (source / master / approved; DB enforces one master) · `media_assets` · `content_projects` · `storyboard_scenes` (with the video approval status) · `generation_jobs` (prompt, provider, model, params, reference IDs, provider request ID, status, errors, idempotency key, retry link) · `approvals` (approved / rejected / invalidated per video file) · `status_events` (full status history).

After changing `src/lib/db/schema.ts`, run `npm run db:generate` to create a new migration.

---

## 6. Tests

```bash
npm test
```

Runs **71 automated tests** with an in-memory database and **fake (mock) providers** — free, offline. They cover: creating/saving characters, the reference-first rules, uploading and reusing references, single-master rule, prompt generation, image-provider success/failure, automatic re-submit on temporary errors, video status transitions, timeouts, retry, duplicate-click protection, approval/rejection, approval invalidation after regeneration, export, missing credentials, invalid inputs, unauthorized and cross-site requests, session tokens and secret redaction.

**Real API tests** (cost money, skipped by default):

```bash
RUN_PAID_TESTS=1 npm run test:integration
```

(PowerShell: `$env:RUN_PAID_TESTS="1"; npm run test:integration`. Add `RUN_PAID_VIDEO_TESTS=1` to include one 5-second video.)

Other checks: `npm run typecheck`, `npm run lint`, `npm run build`.

---

## 7. Security summary

- API keys only in server-side environment variables; `.env.local` git-ignored; `.env.example` has placeholders only.
- Logs scrub keys, passwords and large data URIs; raw provider errors and file paths are never sent to the browser.
- Password login with a signed, httpOnly session cookie; every API route re-checks it; cross-site POSTs are blocked; login attempts are rate-limited.
- All inputs validated (zod): lengths, types, adult-only ages, unknown fields rejected.
- Uploads: JPG/PNG/WebP only, checked by file **content** (not name), ≤ 5 MB, 256–12000 px.
- Media stored outside `public/`; only served to logged-in users.
- Approval is required before export; regenerating clears approval.
- Characters are fictional adults; uploading requires confirming you have rights/consent for the image.

---

## 8. Feature status

| Feature | Status |
|---|---|
| Character profiles, library, search, archive/delete | ✅ Complete |
| Reference upload + validation + rights confirmation | ✅ Complete |
| Reference analysis (Claude vision) | ✅ Implemented — needs `ANTHROPIC_API_KEY`; not yet run against the live API in this build |
| Candidate generation — FREE (Hugging Face FLUX.1 Kontext / Qwen Image Edit) | ✅ Complete — verified with a real free generation |
| Candidate generation — paid (fal.ai Nano Banana Pro) | ✅ Implemented — needs `FAL_KEY` + credit |
| Master/approved references, compare, reject, history | ✅ Complete |
| Content brief, editable storyboard, caption, hashtags | ✅ Complete |
| AI storyboard (Claude) | ✅ Implemented — needs `ANTHROPIC_API_KEY` |
| Template storyboard (no AI) | ✅ Complete (clearly labelled) |
| Scene images + start-frame selection | ✅ Implemented — needs `FAL_KEY` |
| Image-to-video — FREE (Hugging Face Wan 2.2, 3–5 s) | ✅ Implemented — the free model was verified with a real test clip; first in-app video not yet run |
| Image-to-video — paid (Kling 2.6 / 3 Pro via fal.ai), async jobs, retry, timeouts | ✅ Implemented — needs `FAL_KEY` + credit |
| Review queue, approve/reject, invalidation, MP4 export | ✅ Complete |
| Automated tests (mock providers) | ✅ 71 passing |
| Real-API integration tests | ⏸ Written, opt-in (`RUN_PAID_TESTS=1`) |
| Stitching multiple scene clips into one Reel, music | ⏳ Not built — export clips and edit in CapCut/Instagram |
| Instagram publishing, scheduling, payments, cost dashboard | ⏳ Out of scope for v1 |

**Mocked anywhere?** Only inside automated tests (`tests/support/fakes.ts`). The running app never fakes a generation.

---

## 9. Known limitations

- Single user, single password (no multiple accounts/roles yet).
- The background worker runs inside the app process: jobs progress only while `npm run dev`/`npm start` is running (they resume after restart). The embedded database allows one running app at a time — use `DATABASE_URL` + a real Postgres for multiple processes.
- fal.ai output links expire; the app downloads outputs into `./storage` immediately, so keep that folder backed up.
- Uploads are limited to 5 MB (Claude's image limit).
- Multi-scene Reels are exported as separate clips (no automatic stitching or music yet).
- Identity consistency is strong but not guaranteed (see section 4).

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| Login page says "Login isn't set up yet" | Run `npm run setup`, or set `APP_PASSWORD` and a 32+ character `SESSION_SECRET` in `.env.local`, then restart. |
| "Free daily GPU allowance is used up" | Wait (it refills within ~24 h) or add a free `HF_TOKEN` for more minutes. |
| "Out of credit" on a paid model | Top up fal.ai, or switch the model picker to a free model. |
| "fal.ai did not accept the API key" | Wrong key or no credit — check fal.ai dashboard. |
| Job stuck on "Generating" | Keep the app running; videos take minutes. After 30 min (10 for images) it is marked failed and you can Retry. |
| Want to start fresh | Stop the app, delete the `data/` and `storage/` folders (this deletes everything). |
