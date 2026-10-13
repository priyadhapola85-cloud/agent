import { Client, handle_file } from "@gradio/client";
import { AppError } from "../../errors";
import { log, redact } from "../../logger";
import { detectMime } from "../../media/media-type";
import { findImageModel, findVideoModel } from "../models";
import type {
  AsyncMediaProvider,
  ImageGenerationRequest,
  ProviderHandle,
  ProviderJobState,
  ProviderOutputFile,
  VideoGenerationRequest,
} from "../types";

/**
 * FREE GENERATION via Hugging Face Spaces (ZeroGPU)
 *
 * Calls public Gradio apps hosted on Hugging Face with the official
 * @gradio/client library. Free, but limited by a daily GPU allowance:
 *   - without a token: a small anonymous allowance (shared per IP)
 *   - with a free HF_TOKEN: more minutes per day (see huggingface.co/pricing)
 *
 * Gradio jobs can't be "looked up later" like fal's queue, so each job runs
 * inside this server process and its result is kept in memory until the
 * worker saves it. If the app restarts mid-job, the job is reported as
 * interrupted and you can press Retry.
 *
 * Space inputs below come from each Space's /gradio_api/info (Oct 2026).
 */

type Run = {
  state: ProviderJobState;
  outputs: { data: Buffer; mimeType: string }[];
  startedAt: number;
};

type Connect = (space: string, opts: { token?: `hf_${string}` }) => Promise<Pick<Client, "predict">>;

// Kept on globalThis so hot reloads in development don't lose running jobs.
const runs: Map<string, Run> = ((globalThis as Record<string, unknown>).__hfRuns ??= new Map()) as Map<string, Run>;

const spaceOf = (modelId: string) => modelId.replace(/^hf:/, "");

/** Turns Gradio/ZeroGPU errors into friendly messages. */
export function mapHfError(err: unknown, during: string): AppError {
  if (err instanceof AppError) return err;
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
  const detail = `${during}: ${redact(raw)}`;
  if (/quota|exceeded your|gpu limit|daily limit|run out of/i.test(raw))
    return new AppError("PROVIDER_RATE_LIMIT", "The free daily GPU allowance on Hugging Face is used up for now.", {
      action:
        "It refills automatically (within about 24 hours). For more free minutes per day, create a free Hugging Face account and add HF_TOKEN to .env.local (see Settings).",
      detail,
      retryable: false,
    });
  if (/sleeping|building|paused|not running|runtime error|space.*(error|unavailable)/i.test(raw))
    return new AppError("PROVIDER_UNAVAILABLE", "The free model's Hugging Face Space is waking up or temporarily down.", {
      action: "Wait a minute and press Retry. If it keeps failing, choose the other free model.",
      detail,
    });
  if (/queue.*full|too many/i.test(raw))
    return new AppError("PROVIDER_UNAVAILABLE", "The free model is busy right now.", {
      action: "Wait a minute and press Retry.",
      detail,
    });
  if (/nsfw|safety|inappropriate|content/i.test(raw))
    return new AppError("CONTENT_REFUSED", "The free model's safety filter declined this request.", {
      action: "Rephrase the prompt (keep it clearly fashion-focused and non-explicit).",
      detail,
      retryable: false,
    });
  if (/fetch failed|ENOTFOUND|ECONN|network|timed? ?out/i.test(raw))
    return new AppError("PROVIDER_UNAVAILABLE", "Could not reach Hugging Face.", {
      action: "Check your internet connection and press Retry.",
      detail,
    });
  return new AppError("PROVIDER_REJECTED", "The free model could not complete this request.", {
    action: "Press Retry, try a simpler prompt, or switch to the other free model.",
    detail,
  });
}

abstract class HfSpaceProvider<Req extends { model: string }> implements AsyncMediaProvider<Req> {
  readonly id = "huggingface";

  constructor(
    private readonly getToken: () => string | undefined,
    private readonly connect: Connect = (space, opts) => Client.connect(space, opts),
  ) {}

  /** No key is required for the free tier. */
  isConfigured() {
    return true;
  }

  protected async client(space: string) {
    const token = this.getToken();
    return this.connect(space, token ? { token: token as `hf_${string}` } : {});
  }

  /** Downloads one Gradio output file (sending the token if the Space needs it). */
  protected async fetchOutput(file: unknown, expect: "image" | "video") {
    const url = (file as { url?: string } | null)?.url;
    if (!url || !/^https:\/\//.test(url))
      throw new AppError("PROVIDER_INVALID_RESPONSE", "The free model returned no file.", { action: "Press Retry." });
    const token = this.getToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new AppError("PROVIDER_INVALID_RESPONSE", "Could not download the result from Hugging Face.", { detail: `HTTP ${res.status}`, retryable: true });
    const data = Buffer.from(await res.arrayBuffer());
    const mimeType = detectMime(data);
    if (!mimeType || !mimeType.startsWith(expect))
      throw new AppError("PROVIDER_INVALID_RESPONSE", "The free model returned an unexpected file type.", { detail: String(mimeType) });
    return { data, mimeType };
  }

  /** Starts the work in the background and returns immediately (like a queue). */
  protected start(work: () => Promise<{ data: Buffer; mimeType: string }[]>): ProviderHandle {
    const requestId = `hf_${crypto.randomUUID()}`;
    const run: Run = { state: { state: "running" }, outputs: [], startedAt: Date.now() };
    runs.set(requestId, run);
    work()
      .then((outputs) => {
        run.outputs = outputs;
        run.state = { state: "completed" };
      })
      .catch((err) => {
        const e = mapHfError(err, "running free model");
        log.warn(`Hugging Face job ${requestId} failed: ${e.message}`, e.detail);
        run.state = { state: "failed", message: e.action ? `${e.message} ${e.action}` : e.message, detail: e.detail };
      });
    this.cleanup();
    return { requestId };
  }

  abstract submit(request: Req): Promise<ProviderHandle>;

  async status(_model: string, handle: ProviderHandle): Promise<ProviderJobState> {
    const run = runs.get(handle.requestId);
    if (!run)
      return {
        state: "failed",
        message: "This free generation was interrupted because the app restarted. Press Retry to run it again.",
      };
    return run.state;
  }

  async result(_model: string, handle: ProviderHandle): Promise<ProviderOutputFile[]> {
    const run = runs.get(handle.requestId);
    if (!run || run.state.state !== "completed" || run.outputs.length === 0)
      throw new AppError("PROVIDER_INVALID_RESPONSE", "The free model's result is no longer available.", { action: "Press Retry." });
    return run.outputs.map((o, i) => ({ url: `memory://${handle.requestId}/${i}`, contentType: o.mimeType }));
  }

  async download(file: ProviderOutputFile, maxBytes: number) {
    const m = /^memory:\/\/([^/]+)\/(\d+)$/.exec(file.url);
    const out = m ? runs.get(m[1])?.outputs[Number(m[2])] : undefined;
    if (!out) throw new AppError("PROVIDER_INVALID_RESPONSE", "The free model's result is no longer available.", { action: "Press Retry." });
    if (out.data.length > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "The generated file is larger than allowed.");
    return out;
  }

  /** Forget finished runs after 2 hours so memory doesn't grow. */
  private cleanup() {
    const cutoff = Date.now() - 2 * 60 * 60_000;
    for (const [id, r] of runs) if (r.startedAt < cutoff && r.state.state !== "running") runs.delete(id);
  }
}

export class HfImageProvider extends HfSpaceProvider<ImageGenerationRequest> {
  async submit(req: ImageGenerationRequest): Promise<ProviderHandle> {
    const model = findImageModel(req.model);
    if (!model || model.provider !== "huggingface")
      throw new AppError("NOT_CONFIGURED", `Image model "${req.model}" is not a free Hugging Face model.`);
    if (req.references.length === 0) throw new AppError("VALIDATION", "A reference image is required.");
    const space = spaceOf(model.id);
    const ref = req.references[0]; // these models take exactly one input image
    const count = Math.min(req.numImages, model.maxImagesPerRequest);
    // Prompt models of this size work best with a focused instruction.
    const prompt = req.prompt.length > 1800 ? `${req.prompt.slice(0, 1800)}…` : req.prompt;

    return this.start(async () => {
      const client = await this.client(space);
      const outputs: { data: Buffer; mimeType: string }[] = [];
      for (let i = 0; i < count; i++) {
        const image = handle_file(new Blob([new Uint8Array(ref.data)], { type: ref.mimeType }));
        const res =
          space === "black-forest-labs/FLUX.1-Kontext-Dev"
            ? await client.predict("/infer", { input_image: image, prompt, seed: 0, randomize_seed: true, guidance_scale: 2.5, steps: 28 })
            : await client.predict("/infer", {
                image,
                prompt,
                seed: 0,
                randomize_seed: true,
                true_guidance_scale: 4,
                num_inference_steps: 30,
                rewrite_prompt: false,
              });
        outputs.push(await this.fetchOutput((res.data as unknown[])[0], "image"));
      }
      return outputs;
    });
  }
}

export class HfVideoProvider extends HfSpaceProvider<VideoGenerationRequest> {
  async submit(req: VideoGenerationRequest): Promise<ProviderHandle> {
    const model = findVideoModel(req.model);
    if (!model || model.provider !== "huggingface")
      throw new AppError("NOT_CONFIGURED", `Video model "${req.model}" is not a free Hugging Face model.`);
    if (!model.durations.includes(req.durationSeconds))
      throw new AppError("VALIDATION", `${model.label} supports durations of ${model.durations.join(", ")} seconds.`);
    const space = spaceOf(model.id);
    const start = req.startImage;

    return this.start(async () => {
      const client = await this.client(space);
      const res = await client.predict("/generate_video", {
        input_image: handle_file(new Blob([new Uint8Array(start.data)], { type: start.mimeType })),
        prompt: req.prompt,
        steps: 6,
        negative_prompt: req.negativePrompt ?? "blur, low quality, distorted",
        duration_seconds: req.durationSeconds,
        guidance_scale: 1,
        guidance_scale_2: 1,
        seed: 42,
        randomize_seed: true,
      });
      return [await this.fetchOutput((res.data as unknown[])[0], "video")];
    });
  }
}
