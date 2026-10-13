import type { ContentPlanner, PlanInput, PlanOutput, PlannedScene } from "./types";

/**
 * BASIC TEMPLATE PLANNER (no AI)
 *
 * Used when ANTHROPIC_API_KEY is not set. It fills a fixed 1–3 scene structure
 * from your brief so you can still continue. The UI labels these storyboards
 * as "Template (no AI)" so they are never mistaken for AI-written plans.
 */

const pick = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback);

function closestDuration(target: number, allowed: number[]) {
  return allowed.reduce((best, d) => (Math.abs(d - target) < Math.abs(best - target) ? d : best), allowed[0]);
}

export class TemplatePlanner implements ContentPlanner {
  readonly id = "template" as const;
  readonly model = null;

  isConfigured() {
    return true;
  }

  async plan(input: PlanInput): Promise<PlanOutput> {
    const b = input.brief;
    const outfit = pick(b.outfit, "the campaign outfit");
    const place = pick(b.scene, "a clean studio setting");
    const mood = pick(b.mood, "confident");
    const camera = pick(b.cameraMovement, "slow push-in");
    const motion = pick(b.movementType, "a slow confident walk toward the camera");
    const maxClip = Math.max(...input.allowedSceneDurations);

    // Split the target duration into clips the video model can produce.
    const sceneCount = Math.min(3, Math.max(1, Math.round(b.durationSeconds / maxClip)));
    const per = closestDuration(b.durationSeconds / sceneCount, input.allowedSceneDurations);

    const beats: Omit<PlannedScene, "durationSeconds">[] = [
      {
        title: "Hero reveal",
        description: `${input.characterName} is revealed in ${outfit} at ${place}.`,
        imagePrompt: `Full-body shot of the model wearing ${outfit} at ${place}, ${mood} expression, standing pose.`,
        videoPrompt: `The model performs ${motion}, ${mood} energy, fabric moving naturally.`,
        cameraMovement: camera,
        transition: "hard cut on the beat",
        onScreenText: pick(b.onScreenText, ""),
      },
      {
        title: "Outfit detail",
        description: `Close look at the details of ${outfit}${b.accessories ? ` and ${b.accessories}` : ""}.`,
        imagePrompt: `Medium shot of the model at ${place} touching the collar of ${outfit}${b.accessories ? `, showing ${b.accessories}` : ""}.`,
        videoPrompt: "The model turns slightly to show the outfit details, hands moving gracefully.",
        cameraMovement: "slow orbit around the model",
        transition: "whip pan",
        onScreenText: "",
      },
      {
        title: "Closing pose",
        description: `${input.characterName} ends with a signature pose.`,
        imagePrompt: `The model at ${place} in a confident final pose wearing ${outfit}, looking at the camera.`,
        videoPrompt: "The model strikes a final pose and looks directly into the camera with a subtle smile.",
        cameraMovement: "static, slight handheld feel",
        transition: "fade out",
        onScreenText: "",
      },
    ];

    const scenes = beats.slice(0, sceneCount).map((s) => ({ ...s, durationSeconds: per }));
    const tag = (s: string) => `#${s.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    return {
      concept: `${pick(b.theme, "Fashion")} — ${input.characterName} showcases ${outfit} at ${place} with a ${mood} mood.`,
      scenes,
      transitions: scenes.map((s) => s.transition),
      caption: pick(b.caption, `${pick(b.theme, "New look")} ✨`),
      hashtags: [tag(pick(input.style.niche, "fashion")), "#ootd", "#fashionreels", "#styleinspo"].filter(
        (h, i, a) => h.length > 1 && a.indexOf(h) === i,
      ),
    };
  }
}
