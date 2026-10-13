import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AppError } from "../../errors";
import type { ContentPlanner, PlanInput, PlanOutput } from "../types";
import { anthropicClient, FALLBACK_OPTIONS, mapAnthropicError } from "./anthropic-client";

/** Uses Claude to write the concept, storyboard, prompts, caption and hashtags. */

const PlanSchema = z.object({
  concept: z.string().describe("One or two sentence content concept"),
  scenes: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().describe("What happens in the scene"),
        imagePrompt: z
          .string()
          .describe("Still-image prompt for the FIRST FRAME: pose, outfit, location, lighting, framing. Do NOT describe the face/identity."),
        videoPrompt: z.string().describe("Motion prompt: how the model moves and how fabric/hair move. Do NOT describe the face."),
        cameraMovement: z.string(),
        durationSeconds: z.number().int(),
        transition: z.string().describe("Transition into the next scene"),
        onScreenText: z.string().describe("Short on-screen text, or empty string"),
      }),
    )
    .describe("1 to 4 scenes"),
  transitions: z.array(z.string()),
  caption: z.string(),
  hashtags: z.array(z.string()).describe("5-10 relevant hashtags starting with #"),
});

const SYSTEM = `You are a creative director planning short vertical fashion videos (Instagram Reels) for a FICTIONAL AI fashion model.
Each scene becomes: one still image generated from the character's reference photos, then animated by an image-to-video model.
Write prompts that are concrete and visual. Keep motion simple and realistic for a 3-15 second AI clip (walks, turns, poses, fabric movement, camera moves).
Never describe facial identity in prompts; identity is supplied separately from the approved reference images.
Keep everything tasteful and non-explicit.`;

export class ClaudePlanner implements ContentPlanner {
  readonly id = "claude" as const;
  constructor(
    private readonly getKey: () => string | undefined,
    private readonly getModel: () => string,
  ) {}

  get model() {
    return this.getModel();
  }

  isConfigured() {
    return !!this.getKey();
  }

  async plan(input: PlanInput): Promise<PlanOutput> {
    const client = anthropicClient(this.getKey);
    const b = input.brief;
    const request = [
      `Character: ${input.characterName}. ${input.characterSummary}`,
      `Character's usual style: ${JSON.stringify(input.style)}`,
      `Brief: ${JSON.stringify(b)}`,
      `Total target duration: about ${b.durationSeconds} seconds. Aspect ratio ${b.aspectRatio}.`,
      `Each scene's durationSeconds MUST be one of: ${input.allowedSceneDurations.join(", ")}.`,
    ].join("\n");

    let response;
    try {
      response = await client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        ...FALLBACK_OPTIONS,
        system: SYSTEM,
        output_config: { effort: "medium", format: betaZodOutputFormat(PlanSchema) },
        messages: [{ role: "user", content: request }],
      });
    } catch (err) {
      throw mapAnthropicError(err, "planning content");
    }

    if (response.stop_reason === "refusal")
      throw new AppError("CONTENT_REFUSED", "Claude declined to plan this brief.", {
        action: "Rephrase the brief so it is clearly fashion-focused, or use the template planner.",
        detail: JSON.stringify(response.stop_details ?? null),
      });
    const plan = response.parsed_output;
    if (!plan || plan.scenes.length === 0)
      throw new AppError("PROVIDER_INVALID_RESPONSE", "Claude's storyboard came back incomplete.", {
        action: "Try generating the plan again.",
        detail: `stop_reason=${response.stop_reason}`,
      });

    // Snap durations to what the video model supports, cap scene count.
    const allowed = input.allowedSceneDurations;
    const snap = (d: number) => allowed.reduce((best, a) => (Math.abs(a - d) < Math.abs(best - d) ? a : best), allowed[0]);
    return {
      ...plan,
      scenes: plan.scenes.slice(0, 4).map((s) => ({ ...s, durationSeconds: snap(s.durationSeconds) })),
      hashtags: plan.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 15),
    };
  }
}
