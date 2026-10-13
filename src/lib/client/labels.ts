/** Human-friendly names and colours for statuses. */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export const CHARACTER_STATUS: Record<string, { label: string; tone: Tone; hint: string }> = {
  draft: { label: "Draft", tone: "neutral", hint: "Upload a reference image to start." },
  reference_uploaded: { label: "Reference uploaded", tone: "info", hint: "Review the description, then mark it reviewed." },
  ready_to_generate: { label: "Ready to generate", tone: "accent", hint: "Generate candidates and approve a master." },
  active: { label: "Active", tone: "success", hint: "Master reference approved — ready for content." },
  archived: { label: "Archived", tone: "neutral", hint: "Hidden from the library." },
};

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "info" },
  generating: { label: "Generating", tone: "accent" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  canceled: { label: "Canceled", tone: "neutral" },
};

export const VIDEO_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  generating: { label: "Generating", tone: "accent" },
  ready_for_review: { label: "Ready for review", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
};

export const PURPOSE_LABEL: Record<string, string> = {
  character_candidate: "Character candidates",
  scene_image: "Scene images",
  scene_video: "Scene video",
};

export function timeAgo(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
