import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AppError } from "../../errors";
import type { ImageInput, ReferenceAnalysisResult, ReferenceAnalyzer } from "../types";
import { anthropicClient, FALLBACK_OPTIONS, mapAnthropicError } from "./anthropic-client";

/**
 * Looks at the uploaded reference image and describes the VISIBLE appearance
 * so the user has a starting description to review and edit.
 */

const AnalysisSchema = z.object({
  summary: z.string().describe("2-3 sentence overall visual description of the person's look"),
  apparentAgeRange: z.string().describe('Apparent adult age range, e.g. "mid-20s". Never guess identity.'),
  genderPresentation: z.string(),
  face: z.string().describe("Face shape, jawline, cheekbones, nose, lips, brows"),
  eyes: z.string().describe("Eye shape and colour"),
  hair: z.string().describe("Hair length, texture, style and colour"),
  skin: z.string().describe("Visible skin tone/undertone and texture (no ethnicity or nationality)"),
  body: z.string().describe("Visible build and proportions, neutral wording"),
  distinctiveFeatures: z.string().describe("Freckles, moles, beauty marks, etc. Empty string if none"),
  clothing: z.string(),
  accessories: z.string(),
  makeup: z.string(),
  mood: z.string().describe("Visual mood and expression"),
  lighting: z.string(),
  camera: z.string().describe("Framing, lens feel, angle"),
  background: z.string(),
  notes: z.string().describe("Anything that limits the analysis (blur, partial face, filters). Empty if none"),
});

const SYSTEM = `You help a fashion content creator turn a reference photo into a written character profile for a FICTIONAL AI fashion model.

Rules:
- Describe only what is visibly present: appearance, styling, lighting, framing.
- Never identify who the person is, never guess a name, and never say they resemble a celebrity.
- Do not infer ethnicity, nationality, religion, health, or other sensitive traits. Describe skin as a visible tone/undertone only.
- Use neutral, respectful, non-sexualized wording for body description.
- Be specific and concrete (colours, lengths, shapes) so an image model can reproduce the look consistently.
- If something isn't visible, say "not visible".`;

export class ClaudeReferenceAnalyzer implements ReferenceAnalyzer {
  readonly id = "anthropic";
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

  async analyze(image: ImageInput): Promise<ReferenceAnalysisResult> {
    const client = anthropicClient(this.getKey);
    const mediaType = image.mimeType as "image/jpeg" | "image/png" | "image/webp";
    let response;
    try {
      response = await client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        ...FALLBACK_OPTIONS,
        system: SYSTEM,
        output_config: { effort: "low", format: betaZodOutputFormat(AnalysisSchema) },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: image.data.toString("base64") } },
              { type: "text", text: "Describe this reference image for the character profile." },
            ],
          },
        ],
      });
    } catch (err) {
      throw mapAnthropicError(err, "analyzing reference image");
    }

    if (response.stop_reason === "refusal")
      throw new AppError("CONTENT_REFUSED", "Claude declined to analyze this image.", {
        action: "Try a different reference image, or skip analysis and write the description yourself.",
        detail: JSON.stringify(response.stop_details ?? null),
      });
    const a = response.parsed_output;
    if (!a)
      throw new AppError("PROVIDER_INVALID_RESPONSE", "Claude's analysis came back incomplete.", {
        action: "Try analyzing again.",
        detail: `stop_reason=${response.stop_reason}`,
      });

    return {
      summary: a.summary,
      notes: [a.apparentAgeRange ? `Apparent age: ${a.apparentAgeRange}.` : "", a.notes].filter(Boolean).join(" "),
      identity: {
        genderPresentation: a.genderPresentation,
        face: a.face,
        eyes: a.eyes,
        hair: a.hair,
        skin: a.skin,
        body: a.body,
        distinctiveFeatures: a.distinctiveFeatures,
      },
      style: {
        clothing: a.clothing,
        accessories: a.accessories,
        makeup: a.makeup,
        mood: a.mood,
        lighting: a.lighting,
        camera: a.camera,
        locations: a.background,
      },
    };
  }
}
