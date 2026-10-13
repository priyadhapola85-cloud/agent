import type { AppContext } from "../context";
import { AppError } from "../errors";
import { findImageModel, findVideoModel, IMAGE_MODELS, VIDEO_MODELS } from "../providers/models";

/**
 * Picks the model for a generation (the one the user chose, or the default
 * from settings) and checks it can actually run right now.
 */

function notReady(label: string, provider: string) {
  return provider === "fal"
    ? new AppError("NOT_CONFIGURED", `${label} is a paid fal.ai model and fal.ai is not set up.`, {
        action: "Choose a free model instead, or add FAL_KEY (with account credit) to .env.local and restart.",
      })
    : new AppError("NOT_CONFIGURED", `${label} is not available right now.`, { action: "Choose another model." });
}

export function resolveImageModel(ctx: AppContext, requested?: string) {
  const id = requested ?? ctx.settings.imageModel;
  const model = findImageModel(id);
  if (!model)
    throw new AppError("NOT_CONFIGURED", `Image model "${id}" is not supported.`, {
      action: `Choose one of: ${IMAGE_MODELS.map((m) => m.label).join(", ")}.`,
    });
  if (!ctx.providers.image.isConfigured(model.id)) throw notReady(model.label, model.provider);
  return model;
}

export function resolveVideoModel(ctx: AppContext, requested?: string) {
  const id = requested ?? ctx.settings.videoModel;
  const model = findVideoModel(id);
  if (!model)
    throw new AppError("VALIDATION", `Video model "${id}" is not supported.`, {
      action: `Choose one of: ${VIDEO_MODELS.map((m) => m.label).join(", ")}.`,
    });
  if (!ctx.providers.video.isConfigured(model.id)) throw notReady(model.label, model.provider);
  return model;
}
