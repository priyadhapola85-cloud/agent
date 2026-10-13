import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { setContextForTests } from "@/lib/context";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import * as charactersRoute from "@/app/api/characters/route";
import * as characterRoute from "@/app/api/characters/[id]/route";
import * as uploadRoute from "@/app/api/characters/[id]/reference-upload/route";
import * as candidatesRoute from "@/app/api/characters/[id]/candidates/route";
import * as exportRoute from "@/app/api/scenes/[id]/export/route";
import * as reviewRoute from "@/app/api/scenes/[id]/review/route";
import * as assetRoute from "@/app/api/assets/[id]/route";
import * as loginRoute from "@/app/api/auth/login/route";
import * as statusRoute from "@/app/api/status/route";
import { generateSceneVideo, getScene } from "@/lib/services/content";
import { createHarness, fakePng, key, type TestHarness } from "./support/fakes";
import { drainJobs, makePlannedProject } from "./support/workflow";

const SECRET = "test-session-secret-0123456789abcdef0123456789";
const PASSWORD = "correct horse battery staple";
let h: TestHarness;
let cookie: string;

beforeAll(async () => {
  process.env.APP_PASSWORD = PASSWORD;
  process.env.SESSION_SECRET = SECRET;
  cookie = `${SESSION_COOKIE}=${await createSessionToken(SECRET)}`;
});
afterAll(() => {
  delete process.env.APP_PASSWORD;
  delete process.env.SESSION_SECRET;
});
beforeEach(async () => {
  h = await createHarness();
  setContextForTests(h.ctx);
});
afterEach(async () => {
  setContextForTests(null);
  await h.close();
});

const BASE = "http://localhost:3000";
function req(path: string, init: { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string>; form?: FormData } = {}) {
  const headers: Record<string, string> = { host: "localhost:3000", ...(init.headers ?? {}) };
  if (init.auth !== false) headers.cookie = cookie;
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  }
  return new NextRequest(`${BASE}${path}`, { method: init.method ?? "GET", headers, body });
}
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const noParams = { params: Promise.resolve({}) };

describe("unauthorized requests", () => {
  it("rejects API calls without a valid session", async () => {
    const res = await charactersRoute.GET(req("/api/characters", { auth: false }), noParams);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");

    const forged = await charactersRoute.GET(
      req("/api/characters", { auth: false, headers: { cookie: `${SESSION_COOKIE}=9999999999.forged` } }),
      noParams,
    );
    expect(forged.status).toBe(401);
  });

  it("refuses everything if login is not configured", async () => {
    const saved = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "short";
    const res = await statusRoute.GET(req("/api/status"), noParams);
    expect(res.status).toBe(503);
    expect((await res.json()).error.action).toMatch(/SESSION_SECRET/);
    process.env.SESSION_SECRET = saved;
  });

  it("blocks cross-site POSTs (CSRF)", async () => {
    const res = await charactersRoute.POST(
      req("/api/characters", { method: "POST", body: { name: "X" }, headers: { origin: "https://evil.example" } }),
      noParams,
    );
    expect(res.status).toBe(403);
  });

  it("login: wrong password → 401, correct → httpOnly session cookie", async () => {
    const bad = await loginRoute.POST(req("/api/auth/login", { method: "POST", auth: false, body: { password: "nope" } }), noParams);
    expect(bad.status).toBe(401);
    const ok = await loginRoute.POST(req("/api/auth/login", { method: "POST", auth: false, body: { password: PASSWORD } }), noParams);
    expect(ok.status).toBe(200);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("status endpoint reports configuration as booleans, never key values", async () => {
    process.env.FAL_KEY = "secret-fal-key-value-123456";
    const res = await statusRoute.GET(req("/api/status"), noParams);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain("secret-fal-key-value-123456");
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(SECRET);
    delete process.env.FAL_KEY;
  });
});

describe("invalid inputs", () => {
  it("returns 400 with field messages", async () => {
    const res = await charactersRoute.POST(
      req("/api/characters", { method: "POST", body: { name: "", identity: { fictionalAge: 15 } } }),
      noParams,
    );
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe("VALIDATION");
    expect(error.fields["identity.fictionalAge"]).toMatch(/adults/);
    expect(error.fields.name).toMatch(/required/);
  });

  it("rejects unknown fields, bad JSON and wrong content types", async () => {
    const extra = await charactersRoute.POST(req("/api/characters", { method: "POST", body: { name: "A", isAdmin: true } }), noParams);
    expect(extra.status).toBe(400);
    const badJson = await charactersRoute.POST(req("/api/characters", { method: "POST", body: "{not json" }), noParams);
    expect(badJson.status).toBe(400);
    const textBody = new NextRequest(`${BASE}/api/characters`, {
      method: "POST",
      headers: { host: "localhost:3000", cookie, "content-type": "text/plain" },
      body: "name=A",
    });
    expect((await charactersRoute.POST(textBody, noParams)).status).toBe(415);
  });

  it("missing character → 404 with a friendly message", async () => {
    const res = await characterRoute.GET(req("/api/characters/chr_missing"), params({ id: "chr_missing" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Character was not found.");
  });

  it("generation requires an idempotency key", async () => {
    const created = await (await charactersRoute.POST(req("/api/characters", { method: "POST", body: { name: "K" } }), noParams)).json();
    const res = await candidatesRoute.POST(
      req(`/api/characters/${created.character.id}/candidates`, { method: "POST", body: { numImages: 2 } }),
      params({ id: created.character.id }),
    );
    expect(res.status).toBe(400);
  });
});

describe("reference upload over HTTP", () => {
  it("accepts a valid image and rejects disguised files", async () => {
    const created = await (await charactersRoute.POST(req("/api/characters", { method: "POST", body: { name: "Up" } }), noParams)).json();
    const id = created.character.id;

    const good = new FormData();
    good.set("file", new File([new Uint8Array(fakePng())], "me.png", { type: "image/png" }));
    good.set("rightsConfirmed", "true");
    const res = await uploadRoute.POST(req(`/api/characters/${id}/reference-upload`, { method: "POST", form: good }), params({ id }));
    expect(res.status).toBe(200);
    const detail = await res.json();
    expect(detail.character.status).toBe("reference_uploaded");
    expect(detail.references[0].asset.url).toMatch(/^\/api\/assets\//);
    expect(JSON.stringify(detail)).not.toContain(h.storageDir); // no internal paths leak

    const bad = new FormData();
    bad.set("file", new File([new TextEncoder().encode("<script>alert(1)</script> padding padding")], "evil.png", { type: "image/png" }));
    bad.set("rightsConfirmed", "true");
    const res2 = await uploadRoute.POST(req(`/api/characters/${id}/reference-upload`, { method: "POST", form: bad }), params({ id }));
    expect(res2.status).toBe(415);
  });
});

describe("asset export over HTTP", () => {
  it("export is 403 until approved, then downloads as an attachment; assets support range requests", async () => {
    const { scene, masterAssetId } = await makePlannedProject(h);
    await generateSceneVideo(h.ctx, scene.id, { startAssetId: masterAssetId, generateAudio: false, idempotencyKey: key() });
    await drainJobs(h);

    const denied = await exportRoute.GET(req(`/api/scenes/${scene.id}/export`), params({ id: scene.id }));
    expect(denied.status).toBe(403);

    const review = await reviewRoute.POST(
      req(`/api/scenes/${scene.id}/review`, { method: "POST", body: { decision: "approved", note: "ok" } }),
      params({ id: scene.id }),
    );
    expect(review.status).toBe(200);

    const ok = await exportRoute.GET(req(`/api/scenes/${scene.id}/export`), params({ id: scene.id }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("video/mp4");
    expect(ok.headers.get("content-disposition")).toContain('attachment; filename="ava-laurent_autumn-luxe_scene-1.mp4"');
    const bytes = Buffer.from(await ok.arrayBuffer());
    expect(bytes.toString("ascii", 4, 8)).toBe("ftyp");

    const videoId = (await getScene(h.ctx, scene.id)).currentVideoAssetId!;
    const partial = await assetRoute.GET(
      req(`/api/assets/${videoId}`, { headers: { range: "bytes=0-9" } }),
      params({ id: videoId }),
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toMatch(/^bytes 0-9\/64$/);
    expect((await partial.arrayBuffer()).byteLength).toBe(10);
  });
});
