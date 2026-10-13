import type { Character, CharacterIdentity, CharacterStyle, ContentBrief, StoryboardScene } from "../db/schema";

/**
 * PROMPT TEMPLATES
 *
 * Every generation prompt is built from two separate parts:
 *   1. IDENTITY  — stable traits from the approved character profile
 *                  (face, hair, skin, body…). Same text every time.
 *   2. SCENE     — what changes: outfit, location, pose, lighting, camera.
 *
 * Keeping them separate (and always sending the approved reference images)
 * is what gives the best practical character consistency.
 */

type CharacterLike = Pick<Character, "name" | "description" | "identity" | "style">;

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();

function line(label: string, value: string | number | undefined | null) {
  const v = clean(value === undefined || value === null ? "" : String(value));
  return v && v.toLowerCase() !== "not visible" ? `${label}: ${v}.` : "";
}

export function identityBlock(c: CharacterLike): string {
  const i: CharacterIdentity = c.identity ?? {};
  const parts = [
    `${clean(c.name)} is a fictional adult fashion model${i.fictionalAge ? ` (age ${i.fictionalAge})` : ""}.`,
    line("Gender presentation", i.genderPresentation),
    line("Face", i.face),
    line("Eyes", i.eyes),
    line("Hair", i.hair),
    line("Skin", i.skin),
    line("Body", i.body),
    line("Distinctive features", i.distinctiveFeatures),
  ];
  return parts.filter(Boolean).join(" ");
}

export function styleBlock(s: CharacterStyle): string {
  return [
    line("Fashion niche", s.niche),
    line("Clothing", s.clothing),
    line("Accessories", s.accessories),
    line("Makeup", s.makeup),
    line("Mood", s.mood),
    line("Presentation", s.presentationStyle),
    line("Location", s.locations),
    line("Lighting", s.lighting),
    line("Camera", s.camera),
  ]
    .filter(Boolean)
    .join(" ");
}

const CONSISTENCY_RULES =
  "Use the reference image(s) as the identity source: keep the exact same face, facial proportions, eye shape, skin tone and hair as the person in the references. Do not change their identity, age or ethnicity-related features.";

const QUALITY =
  "Photorealistic editorial fashion photograph, natural skin texture, accurate anatomy and hands, sharp focus, professional color grading. No text, no watermark, no logos.";

/** Prompt for the first candidate images generated from the uploaded reference. */
export function characterCandidatePrompt(c: CharacterLike, revisionNotes?: string): string {
  return [
    CONSISTENCY_RULES,
    "Create a clean, well-lit fashion model reference portrait (head and upper body, facing the camera, neutral background) of this person.",
    `IDENTITY: ${identityBlock(c)}`,
    c.description ? `CHARACTER NOTES: ${clean(c.description)}` : "",
    styleBlock(c.style) ? `STYLING: ${styleBlock(c.style)}` : "",
    revisionNotes ? `REVISION REQUEST (apply these changes, keep the identity): ${clean(revisionNotes)}` : "",
    QUALITY,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Prompt for a storyboard scene's still image (the video's first frame). */
export function sceneImagePrompt(
  c: CharacterLike,
  scene: Pick<StoryboardScene, "imagePrompt" | "description">,
  brief: ContentBrief,
  revisionNotes?: string,
): string {
  const changeable = [
    line("Outfit", brief.outfit),
    line("Accessories", brief.accessories),
    line("Location", brief.scene),
    line("Mood", brief.mood),
    line("Visual style", brief.visualStyle),
  ]
    .filter(Boolean)
    .join(" ");
  return [
    CONSISTENCY_RULES,
    `IDENTITY: ${identityBlock(c)}`,
    `SCENE: ${clean(scene.imagePrompt) || clean(scene.description)}`,
    changeable ? `CAMPAIGN DETAILS: ${changeable}` : "",
    `Composition suitable for a vertical social video first frame with the full outfit visible.`,
    revisionNotes ? `REVISION REQUEST: ${clean(revisionNotes)}` : "",
    QUALITY,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Prompt for image-to-video. Identity comes from the start frame itself. */
export function sceneVideoPrompt(scene: Pick<StoryboardScene, "videoPrompt" | "cameraMovement" | "description">): string {
  return [
    clean(scene.videoPrompt) || clean(scene.description),
    scene.cameraMovement ? `Camera: ${clean(scene.cameraMovement)}.` : "",
    "Keep the model's face, hair and outfit exactly as in the first frame. Smooth, natural, realistic fashion movement. Stable identity, no morphing.",
  ]
    .filter(Boolean)
    .join(" ");
}

export const DEFAULT_VIDEO_NEGATIVE_PROMPT =
  "blur, distort, low quality, face morphing, identity change, extra limbs, warped hands, flicker, text, watermark";
