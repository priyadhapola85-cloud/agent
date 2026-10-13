/**
 * MODELS THE APP KNOWS HOW TO CALL
 *
 * Every parameter used for these models was checked against the provider's
 * own API description (fal.ai model API pages, or the Hugging Face Space's
 * /gradio_api/info) in October 2026. We never send a parameter that isn't listed.
 *
 * provider:
 *   - "huggingface" → FREE. Runs on community GPU Spaces (ZeroGPU) with a small
 *                     daily allowance. Optional free HF_TOKEN gives more.
 *   - "fal"         → PAID. Needs FAL_KEY and account credit. Higher quality,
 *                     multiple reference images, longer videos.
 */

export type ProviderName = "huggingface" | "fal";

export type ImageModelInfo = {
  id: string;
  provider: ProviderName;
  label: string;
  free: boolean;
  /** How many reference images are sent per request (our cap). */
  maxReferences: number;
  maxImagesPerRequest: number;
  /** Empty = the output follows the reference image's shape (no aspect-ratio option). */
  aspectRatios: string[];
  resolutions: ("1K" | "2K" | "4K")[];
  note: string;
  docsUrl: string;
};

export type VideoModelInfo = {
  id: string;
  provider: ProviderName;
  label: string;
  free: boolean;
  durations: number[];
  supportsAudio: boolean;
  supportsNegativePrompt: boolean;
  priceNote: string;
  docsUrl: string;
};

export const IMAGE_MODELS: ImageModelInfo[] = [
  {
    id: "hf:black-forest-labs/FLUX.1-Kontext-Dev",
    provider: "huggingface",
    label: "FLUX.1 Kontext (free)",
    free: true,
    maxReferences: 1,
    maxImagesPerRequest: 4,
    aspectRatios: [],
    resolutions: ["1K"],
    note: "Free. Edits from ONE reference image (the master, or your upload). Output keeps the reference's shape.",
    docsUrl: "https://huggingface.co/spaces/black-forest-labs/FLUX.1-Kontext-Dev",
  },
  {
    id: "hf:Qwen/Qwen-Image-Edit",
    provider: "huggingface",
    label: "Qwen Image Edit (free)",
    free: true,
    maxReferences: 1,
    maxImagesPerRequest: 4,
    aspectRatios: [],
    resolutions: ["1K"],
    note: "Free alternative. Edits from ONE reference image. Slower than Kontext.",
    docsUrl: "https://huggingface.co/spaces/Qwen/Qwen-Image-Edit",
  },
  {
    // Google Nano Banana Pro (edit) via fal.ai — multiple reference images.
    id: "fal-ai/nano-banana-pro/edit",
    provider: "fal",
    label: "Nano Banana Pro (paid, fal.ai)",
    free: false,
    maxReferences: 4,
    maxImagesPerRequest: 4,
    aspectRatios: ["9:16", "4:5", "3:4", "2:3", "1:1", "4:3", "3:2", "16:9", "21:9", "5:4"],
    resolutions: ["1K", "2K", "4K"],
    note: "Paid. Uses up to 4 reference images for stronger consistency.",
    docsUrl: "https://fal.ai/models/fal-ai/nano-banana-pro/edit/api",
  },
];

export const VIDEO_MODELS: VideoModelInfo[] = [
  {
    id: "hf:zerogpu-aoti/wan2-2-fp8da-aoti-faster",
    provider: "huggingface",
    label: "Wan 2.2 image-to-video (free)",
    free: true,
    durations: [3, 4, 5],
    supportsAudio: false,
    supportsNegativePrompt: true,
    priceNote: "free (daily GPU allowance on Hugging Face)",
    docsUrl: "https://huggingface.co/spaces/zerogpu-aoti/wan2-2-fp8da-aoti-faster",
  },
  {
    id: "fal-ai/kling-video/v2.6/pro/image-to-video",
    provider: "fal",
    label: "Kling 2.6 Pro (paid, fal.ai)",
    free: false,
    durations: [5, 10],
    supportsAudio: true,
    supportsNegativePrompt: true,
    priceNote: "about $0.07 per second of video (check fal.ai for current pricing)",
    docsUrl: "https://fal.ai/models/fal-ai/kling-video/v2.6/pro/image-to-video/api",
  },
  {
    id: "fal-ai/kling-video/v3/pro/image-to-video",
    provider: "fal",
    label: "Kling 3 Pro (paid, fal.ai, higher quality)",
    free: false,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsAudio: true,
    supportsNegativePrompt: true,
    priceNote: "about $0.22 per second without audio (check fal.ai for current pricing)",
    docsUrl: "https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api",
  },
];

export function findImageModel(id: string) {
  return IMAGE_MODELS.find((m) => m.id === id) ?? null;
}

export function findVideoModel(id: string) {
  return VIDEO_MODELS.find((m) => m.id === id) ?? null;
}
