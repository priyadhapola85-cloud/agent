import { z } from "zod";

/**
 * INPUT VALIDATION
 *
 * Every request body is checked against one of these schemas before anything
 * else happens. Text is trimmed, control characters are removed and lengths
 * are limited so nothing unexpected reaches the database or a provider.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const text = (max: number) =>
  z
    .string()
    .max(max, `Must be ${max} characters or fewer.`)
    .transform((s) => s.replace(CONTROL_CHARS, "").trim());

const requiredText = (max: number, label: string) =>
  text(max).refine((s) => s.length > 0, `${label} is required.`);

export const idempotencyKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, "Invalid request key. Refresh the page and try again.");

export const FASHION_NICHES = ["luxury", "streetwear", "casual", "ethnic", "editorial", "other"] as const;

export const identitySchema = z
  .object({
    fictionalAge: z.coerce
      .number()
      .int("Age must be a whole number.")
      .min(18, "Characters must be adults (18+).")
      .max(80, "Age must be 80 or below.")
      .optional(),
    genderPresentation: text(120).optional(),
    face: text(600).optional(),
    eyes: text(300).optional(),
    hair: text(400).optional(),
    skin: text(300).optional(),
    body: text(400).optional(),
    distinctiveFeatures: text(400).optional(),
  })
  .strict();

export const styleSchema = z
  .object({
    niche: text(60).optional(),
    clothing: text(600).optional(),
    accessories: text(400).optional(),
    makeup: text(300).optional(),
    personality: text(400).optional(),
    mood: text(300).optional(),
    presentationStyle: text(300).optional(),
    locations: text(400).optional(),
    lighting: text(300).optional(),
    camera: text(300).optional(),
  })
  .strict();

export const createCharacterSchema = z
  .object({
    name: requiredText(80, "Name"),
    description: text(2000).optional().default(""),
    identity: identitySchema.optional().default({}),
    style: styleSchema.optional().default({}),
  })
  .strict();

export const updateCharacterSchema = z
  .object({
    name: requiredText(80, "Name").optional(),
    description: text(2000).optional(),
    identity: identitySchema.optional(),
    style: styleSchema.optional(),
    archived: z.boolean().optional(),
    /** Marks the edited description as reviewed (enables generation). */
    markReviewed: z.boolean().optional(),
  })
  .strict();

export const IMAGE_ASPECT_RATIOS = ["9:16", "4:5", "3:4", "1:1", "16:9"] as const;
export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;

const modelId = z.string().min(1).max(120);

export const generateCandidatesSchema = z
  .object({
    /** Defaults to the image model from settings (free unless changed). */
    model: modelId.optional(),
    numImages: z.coerce.number().int().min(1).max(4).default(4),
    aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).default("3:4"),
    resolution: z.enum(IMAGE_RESOLUTIONS).default("1K"),
    revisionNotes: text(1000).optional(),
    idempotencyKey,
  })
  .strict();

export const approveReferenceSchema = z
  .object({
    assetId: z.string().min(1).max(60),
    role: z.enum(["master", "approved"]),
    label: text(80).optional(),
  })
  .strict();

export const updateReferenceSchema = z
  .object({
    useForGeneration: z.boolean().optional(),
    makeMaster: z.literal(true).optional(),
    label: text(80).optional(),
  })
  .strict();

export const assetReviewSchema = z
  .object({
    decision: z.enum(["rejected", "pending"]),
    note: text(500).optional().default(""),
  })
  .strict();

export const briefSchema = z
  .object({
    theme: requiredText(200, "Theme"),
    outfit: text(500).optional(),
    accessories: text(300).optional(),
    scene: text(500).optional(),
    mood: text(200).optional(),
    visualStyle: text(300).optional(),
    durationSeconds: z.coerce.number().int().min(3, "Minimum 3 seconds.").max(60, "Maximum 60 seconds."),
    aspectRatio: z.enum(["9:16", "4:5", "1:1", "16:9"]),
    cameraMovement: text(200).optional(),
    movementType: text(200).optional(),
    caption: text(2200).optional(),
    onScreenText: text(200).optional(),
  })
  .strict();

export const createProjectSchema = z
  .object({
    characterId: z.string().min(1).max(60),
    title: requiredText(120, "Title"),
    brief: briefSchema,
  })
  .strict();

export const updateProjectSchema = z
  .object({
    title: requiredText(120, "Title").optional(),
    brief: briefSchema.optional(),
    concept: text(2000).optional(),
    caption: text(2200).optional(),
    hashtags: z.array(text(60)).max(30).optional(),
    transitions: z.array(text(200)).max(20).optional(),
    notes: text(4000).optional(),
  })
  .strict();

export const planProjectSchema = z
  .object({
    planner: z.enum(["auto", "claude", "template"]).default("auto"),
    /** Planning replaces existing scenes; the UI asks the user first. */
    replaceExisting: z.boolean().default(false),
  })
  .strict();

export const sceneFieldsSchema = z
  .object({
    title: requiredText(120, "Scene title"),
    description: text(1500).optional(),
    imagePrompt: text(2000).optional(),
    videoPrompt: text(2000).optional(),
    cameraMovement: text(200).optional(),
    durationSeconds: z.coerce.number().int().min(3).max(15).optional(),
    transition: text(200).optional(),
    onScreenText: text(200).optional(),
    notes: text(2000).optional(),
  })
  .strict();

export const updateSceneSchema = sceneFieldsSchema.partial().extend({
  position: z.coerce.number().int().min(0).max(100).optional(),
});

export const generateSceneImageSchema = z
  .object({
    model: modelId.optional(),
    numImages: z.coerce.number().int().min(1).max(4).default(2),
    resolution: z.enum(IMAGE_RESOLUTIONS).default("1K"),
    revisionNotes: text(1000).optional(),
    idempotencyKey,
  })
  .strict();

export const selectSceneImageSchema = z.object({ assetId: z.string().min(1).max(60) }).strict();

export const generateVideoSchema = z
  .object({
    /** Defaults to the scene's selected image. */
    startAssetId: z.string().min(1).max(60).optional(),
    model: z.string().min(1).max(120).optional(),
    durationSeconds: z.coerce.number().int().min(3).max(15).optional(),
    generateAudio: z.boolean().default(false),
    negativePrompt: text(500).optional(),
    revisionNotes: text(1000).optional(),
    idempotencyKey,
  })
  .strict();

export const reviewDecisionSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    note: text(1000).optional().default(""),
  })
  .strict();

export const retryJobSchema = z.object({ idempotencyKey }).strict();

export const loginSchema = z.object({ password: z.string().min(1).max(200) }).strict();
