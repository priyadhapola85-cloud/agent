import { AppError } from "../errors";
import { findImageModel, findVideoModel, type ProviderName } from "./models";
import type { AsyncMediaProvider, ProviderHandle, ProviderOutputFile } from "./types";

/**
 * Sends each request to the right provider based on the chosen model:
 * free models → Hugging Face, paid models → fal.ai.
 * The rest of the app only ever sees one provider.
 */
export class ModelRouter<Req extends { model: string }> implements AsyncMediaProvider<Req> {
  readonly id = "router";

  constructor(
    private readonly kind: "image" | "video",
    private readonly providers: Record<ProviderName, AsyncMediaProvider<Req>>,
  ) {}

  /** Which provider serves a model id (used when recording jobs). */
  providerName(model: string): ProviderName {
    const info = this.kind === "image" ? findImageModel(model) : findVideoModel(model);
    if (!info) throw new AppError("NOT_CONFIGURED", `Model "${model}" is not supported by this app.`);
    return info.provider;
  }

  private pick(model: string) {
    return this.providers[this.providerName(model)];
  }

  isConfigured(model?: string) {
    if (!model) return Object.values(this.providers).some((p) => p.isConfigured());
    try {
      return this.pick(model).isConfigured(model);
    } catch {
      return false;
    }
  }

  submit(req: Req): Promise<ProviderHandle> {
    return this.pick(req.model).submit(req);
  }

  status(model: string, handle: ProviderHandle) {
    return this.pick(model).status(model, handle);
  }

  result(model: string, handle: ProviderHandle) {
    return this.pick(model).result(model, handle);
  }

  download(file: ProviderOutputFile, maxBytes: number) {
    // Free (Hugging Face) results are held in memory; everything else is a fal URL.
    return (file.url.startsWith("memory://") ? this.providers.huggingface : this.providers.fal).download(file, maxBytes);
  }
}
