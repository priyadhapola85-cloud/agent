import { createFalClient, type FalClient } from "@fal-ai/client";
import { z } from "zod";
import { AppError } from "../../errors";
import { detectMime } from "../../media/media-type";
import type {
  AsyncMediaProvider,
  ImageGenerationRequest,
  ImageInput,
  ProviderHandle,
  ProviderJobState,
  ProviderOutputFile,
  VideoGenerationRequest,
} from "../types";
import { mapFalError } from "./fal-errors";
import { findImageModel, findVideoModel } from "../models";

/**
 * fal.ai integration using its documented queue workflow:
 *   1. submit  → returns a request_id immediately
 *   2. status  → IN_QUEUE / IN_PROGRESS / COMPLETED
 *   3. result  → output file URLs (which we download into private storage)
 * Docs: https://fal.ai/docs/model-apis/model-endpoints/queue
 */

const imageResultSchema = z.object({
  images: z
    .array(
      z.object({
        url: z.string().url(),
        content_type: z.string().optional().nullable(),
        width: z.number().optional().nullable(),
        height: z.number().optional().nullable(),
      }),
    )
    .min(1),
});

const videoResultSchema = z.object({
  video: z.object({
    url: z.string().url(),
    content_type: z.string().optional().nullable(),
  }),
});

abstract class FalQueueProvider<Req> implements AsyncMediaProvider<Req> {
  readonly id = "fal";
  private client: FalClient | null = null;

  constructor(private readonly getKey: () => string | undefined) {}

  isConfigured() {
    return !!this.getKey();
  }

  protected fal(): FalClient {
    const key = this.getKey();
    if (!key)
      throw new AppError("NOT_CONFIGURED", "fal.ai is not configured, so generation is unavailable.", {
        action: "Add FAL_KEY to .env.local and restart the app. See Settings for step-by-step instructions.",
      });
    if (!this.client) this.client = createFalClient({ credentials: key });
    return this.client;
  }

  /**
   * Reference images live in our private storage, so fal can't download them.
   * We upload a temporary copy to fal's own file storage and pass that URL.
   */
  protected async uploadInput(image: ImageInput): Promise<string> {
    try {
      const blob = new Blob([new Uint8Array(image.data)], { type: image.mimeType });
      return await this.fal().storage.upload(blob);
    } catch (err) {
      throw mapFalError(err, "uploading reference image");
    }
  }

  abstract submit(request: Req): Promise<ProviderHandle>;
  protected abstract parseResult(data: unknown): ProviderOutputFile[];

  protected async enqueue(model: string, input: Record<string, unknown>): Promise<ProviderHandle> {
    try {
      const queued = await this.fal().queue.submit(model, { input });
      if (!queued?.request_id) throw new Error("fal.ai returned no request_id");
      return { requestId: queued.request_id };
    } catch (err) {
      throw mapFalError(err, `submitting to ${model}`);
    }
  }

  async status(model: string, handle: ProviderHandle): Promise<ProviderJobState> {
    try {
      const s = await this.fal().queue.status(model, { requestId: handle.requestId, logs: false });
      // Failed requests are reported with an `error` field (see fal queue docs).
      const failure = (s as unknown as { error?: unknown; error_type?: unknown }).error;
      if (failure)
        return {
          state: "failed",
          message: "fal.ai reported that the generation failed.",
          detail: String(failure),
        };
      if (s.status === "IN_QUEUE") return { state: "queued", position: s.queue_position };
      if (s.status === "IN_PROGRESS") return { state: "running" };
      if (s.status === "COMPLETED") return { state: "completed" };
      throw new Error(`Unknown fal status: ${JSON.stringify(s).slice(0, 200)}`);
    } catch (err) {
      throw mapFalError(err, `checking status of ${model}`);
    }
  }

  async result(model: string, handle: ProviderHandle): Promise<ProviderOutputFile[]> {
    let data: unknown;
    try {
      const res = await this.fal().queue.result(model, { requestId: handle.requestId });
      data = res.data;
    } catch (err) {
      throw mapFalError(err, `fetching result of ${model}`);
    }
    return this.parseResult(data);
  }

  async download(file: ProviderOutputFile, maxBytes: number) {
    const url = new URL(file.url);
    if (url.protocol !== "https:") throw new AppError("PROVIDER_INVALID_RESPONSE", "Provider returned an insecure file link.");
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    } catch (err) {
      throw mapFalError(err, "downloading output");
    }
    if (!res.ok || !res.body)
      throw new AppError("PROVIDER_INVALID_RESPONSE", "Could not download the generated file from fal.ai.", {
        action: "Retry the job.",
        detail: `download HTTP ${res.status}`,
        retryable: true,
      });
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "The generated file is larger than allowed.");

    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new AppError("PAYLOAD_TOO_LARGE", "The generated file is larger than allowed.");
      }
      chunks.push(value);
    }
    const data = Buffer.concat(chunks);
    const mimeType = detectMime(data);
    if (!mimeType)
      throw new AppError("PROVIDER_INVALID_RESPONSE", "fal.ai returned a file in an unexpected format.", {
        detail: `content-type ${res.headers.get("content-type")}`,
      });
    return { data, mimeType };
  }
}

export class FalImageProvider extends FalQueueProvider<ImageGenerationRequest> {
  async submit(req: ImageGenerationRequest): Promise<ProviderHandle> {
    const model = findImageModel(req.model);
    if (!model)
      throw new AppError("NOT_CONFIGURED", `Image model "${req.model}" is not supported by this app.`, {
        action: "Remove FAL_IMAGE_MODEL from .env.local or add the model to src/lib/providers/fal/models.ts.",
      });
    if (req.references.length === 0)
      throw new AppError("VALIDATION", "At least one reference image is required for this model.");
    if (!model.aspectRatios.includes(req.aspectRatio))
      throw new AppError("VALIDATION", `Aspect ratio ${req.aspectRatio} is not supported by ${model.label}.`);

    const imageUrls: string[] = [];
    for (const ref of req.references.slice(0, model.maxReferences)) imageUrls.push(await this.uploadInput(ref));

    // Parameters from https://fal.ai/models/fal-ai/nano-banana-pro/edit/api
    return this.enqueue(model.id, {
      prompt: req.prompt,
      image_urls: imageUrls,
      num_images: Math.min(req.numImages, model.maxImagesPerRequest),
      aspect_ratio: req.aspectRatio,
      resolution: req.resolution,
      output_format: "png",
      ...(req.seed !== undefined ? { seed: req.seed } : {}),
    });
  }

  protected parseResult(data: unknown): ProviderOutputFile[] {
    const parsed = imageResultSchema.safeParse(data);
    if (!parsed.success)
      throw new AppError("PROVIDER_INVALID_RESPONSE", "fal.ai returned a response without images.", {
        action: "Retry the job. The provider may have filtered the output.",
        detail: JSON.stringify(data)?.slice(0, 500),
      });
    return parsed.data.images.map((i) => ({
      url: i.url,
      contentType: i.content_type ?? undefined,
      width: i.width ?? undefined,
      height: i.height ?? undefined,
    }));
  }
}

export class FalVideoProvider extends FalQueueProvider<VideoGenerationRequest> {
  async submit(req: VideoGenerationRequest): Promise<ProviderHandle> {
    const model = findVideoModel(req.model);
    if (!model)
      throw new AppError("NOT_CONFIGURED", `Video model "${req.model}" is not supported by this app.`, {
        action: "Remove FAL_VIDEO_MODEL from .env.local or add the model to src/lib/providers/fal/models.ts.",
      });
    if (!model.durations.includes(req.durationSeconds))
      throw new AppError("VALIDATION", `${model.label} supports durations of ${model.durations.join(", ")} seconds.`);

    const startImageUrl = await this.uploadInput(req.startImage);
    // Parameters from the model's fal.ai API page (duration is sent as a string enum).
    return this.enqueue(model.id, {
      prompt: req.prompt,
      start_image_url: startImageUrl,
      duration: String(req.durationSeconds),
      ...(model.supportsAudio ? { generate_audio: req.generateAudio } : {}),
      ...(model.supportsNegativePrompt && req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
    });
  }

  protected parseResult(data: unknown): ProviderOutputFile[] {
    const parsed = videoResultSchema.safeParse(data);
    if (!parsed.success)
      throw new AppError("PROVIDER_INVALID_RESPONSE", "fal.ai returned a response without a video.", {
        action: "Retry the job.",
        detail: JSON.stringify(data)?.slice(0, 500),
      });
    return [{ url: parsed.data.video.url, contentType: parsed.data.video.content_type ?? undefined }];
  }
}
