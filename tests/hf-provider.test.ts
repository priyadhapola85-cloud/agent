import { afterEach, describe, expect, it, vi } from "vitest";
import { HfImageProvider, HfVideoProvider, mapHfError } from "@/lib/providers/huggingface/hf-provider";
import { ModelRouter } from "@/lib/providers/router";
import { FakeMediaProvider, fakeMp4, fakePng } from "./support/fakes";
import type { ImageGenerationRequest, VideoGenerationRequest } from "@/lib/providers/types";

/**
 * Tests for the FREE Hugging Face provider. The Gradio connection is faked
 * (no network, no GPU quota used).
 */

const KONTEXT = "hf:black-forest-labs/FLUX.1-Kontext-Dev";
const WAN = "hf:zerogpu-aoti/wan2-2-fp8da-aoti-faster";

function fakeConnect(result: () => Promise<unknown>) {
  const calls: { space: string; endpoint: string; data: Record<string, unknown>; token?: string }[] = [];
  const connect = async (space: string, opts: { token?: string }) => ({
    predict: (async (endpoint: string, data: Record<string, unknown>) => {
      calls.push({ space, endpoint, data, token: opts.token });
      return { data: [await result()] };
    }) as never,
  });
  return { connect, calls };
}

async function waitDone(p: { status: (m: string, h: { requestId: string }) => Promise<{ state: string }> }, model: string, h: { requestId: string }) {
  for (let i = 0; i < 50; i++) {
    const s = await p.status(model, h);
    if (s.state !== "running") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("never finished");
}

afterEach(() => vi.unstubAllGlobals());

const imageReq = (n = 2): ImageGenerationRequest => ({
  model: KONTEXT,
  prompt: "fashion portrait",
  references: [{ data: fakePng(), mimeType: "image/png" }, { data: fakePng(), mimeType: "image/png" }],
  numImages: n,
  aspectRatio: "3:4",
  resolution: "1K",
});

describe("free Hugging Face image provider (mocked Space)", () => {
  it("runs in the background, uses only the first reference, returns downloadable outputs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(fakePng()), { status: 200 })));
    const { connect, calls } = fakeConnect(async () => ({ url: "https://space.hf.space/gradio_api/file=/tmp/x.png" }));
    const p = new HfImageProvider(() => "hf_testtoken", connect);
    expect(p.isConfigured()).toBe(true); // free: no key needed

    const handle = await p.submit(imageReq(2));
    const s = await waitDone(p, KONTEXT, handle);
    expect(s.state).toBe("completed");
    expect(calls).toHaveLength(2); // one Space call per image
    expect(calls[0]).toMatchObject({ space: "black-forest-labs/FLUX.1-Kontext-Dev", endpoint: "/infer", token: "hf_testtoken" });
    expect(calls[0].data).toMatchObject({ prompt: "fashion portrait", randomize_seed: true, steps: 28 });

    const files = await p.result(KONTEXT, handle);
    expect(files).toHaveLength(2);
    const dl = await p.download(files[0], 10_000_000);
    expect(dl.mimeType).toBe("image/png");
  });

  it("works without a token (anonymous free tier)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(fakePng()), { status: 200 })));
    const { connect, calls } = fakeConnect(async () => ({ url: "https://space.hf.space/file.png" }));
    const p = new HfImageProvider(() => undefined, connect);
    const h = await p.submit(imageReq(1));
    expect((await waitDone(p, KONTEXT, h)).state).toBe("completed");
    expect(calls[0].token).toBeUndefined();
  });

  it("quota exhaustion becomes a clear, non-retryable 'free daily allowance' failure", async () => {
    const { connect } = fakeConnect(async () => {
      throw { message: "You have exceeded your free GPU quota (60s requested vs. 0s left). Try again in 23:59:00" };
    });
    const p = new HfImageProvider(() => undefined, connect);
    const h = await p.submit(imageReq(1));
    const s = (await waitDone(p, KONTEXT, h)) as { state: string; message?: string };
    expect(s.state).toBe("failed");
    expect(s.message).toMatch(/free daily GPU allowance/);
    expect(mapHfError({ message: "exceeded your GPU quota" }, "t").retryable).toBe(false);
  });

  it("a job lost by an app restart is reported as interrupted (so the user can Retry)", async () => {
    const p = new HfImageProvider(() => undefined, fakeConnect(async () => ({})).connect);
    const s = await p.status(KONTEXT, { requestId: "hf_unknown" });
    expect(s).toMatchObject({ state: "failed" });
    expect((s as { message: string }).message).toMatch(/interrupted/);
  });
});

describe("free Hugging Face video provider (mocked Space)", () => {
  it("sends the documented Wan 2.2 inputs and returns an MP4", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(fakeMp4()), { status: 200 })));
    const { connect, calls } = fakeConnect(async () => ({ url: "https://space.hf.space/file.mp4" }));
    const p = new HfVideoProvider(() => undefined, connect);
    const req: VideoGenerationRequest = {
      model: WAN,
      prompt: "slow turn",
      startImage: { data: fakePng(), mimeType: "image/png" },
      durationSeconds: 5,
      generateAudio: false,
    };
    const h = await p.submit(req);
    expect((await waitDone(p, WAN, h)).state).toBe("completed");
    expect(calls[0]).toMatchObject({ endpoint: "/generate_video" });
    expect(calls[0].data).toMatchObject({ duration_seconds: 5, steps: 6, prompt: "slow turn" });
    const [file] = await p.result(WAN, h);
    expect((await p.download(file, 10_000_000)).mimeType).toBe("video/mp4");
  });

  it("refuses durations the free model can't make", async () => {
    const p = new HfVideoProvider(() => undefined, fakeConnect(async () => ({})).connect);
    await expect(
      p.submit({ model: WAN, prompt: "x", startImage: { data: fakePng(), mimeType: "image/png" }, durationSeconds: 10, generateAudio: false }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("model router", () => {
  it("sends free models to Hugging Face and paid ones to fal.ai; paid needs a key", async () => {
    const hf = new FakeMediaProvider<ImageGenerationRequest>("image");
    const fal = new FakeMediaProvider<ImageGenerationRequest>("image");
    fal.configured = false;
    const router = new ModelRouter<ImageGenerationRequest>("image", { huggingface: hf, fal });
    expect(router.providerName(KONTEXT)).toBe("huggingface");
    expect(router.providerName("fal-ai/nano-banana-pro/edit")).toBe("fal");
    expect(router.isConfigured(KONTEXT)).toBe(true);
    expect(router.isConfigured("fal-ai/nano-banana-pro/edit")).toBe(false);
    expect(router.isConfigured("made-up/model")).toBe(false);
    await router.submit(imageReq(1));
    expect(hf.submitted).toHaveLength(1);
    expect(fal.submitted).toHaveLength(0);
  });
});
