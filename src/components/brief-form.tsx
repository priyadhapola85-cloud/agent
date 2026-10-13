"use client";

import type { ContentBrief } from "@/lib/db/schema";
import { Field } from "./ui";

export const EMPTY_BRIEF: ContentBrief = { theme: "", durationSeconds: 10, aspectRatio: "9:16" };

const CAMERA = ["slow push-in", "slow orbit", "tracking shot following the walk", "static tripod", "handheld", "crane down", "whip pan"];
const MOVEMENT = ["runway walk toward camera", "slow turn to show the outfit", "posing sequence", "walking down the street", "sitting then standing", "hair flip and look to camera"];

export function BriefForm({ value, onChange, errors }: { value: ContentBrief; onChange: (b: ContentBrief) => void; errors?: Record<string, string> }) {
  const set = <K extends keyof ContentBrief>(k: K, v: ContentBrief[K]) => onChange({ ...value, [k]: v });
  const err = (k: string) => errors?.[`brief.${k}`] ?? errors?.[k];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Fashion theme or campaign idea *" error={err("theme")}>
          <input className="input" maxLength={200} placeholder="e.g. Autumn quiet-luxury knitwear drop" value={value.theme} onChange={(e) => set("theme", e.target.value)} />
        </Field>
      </div>
      <Field label="Outfit" error={err("outfit")}>
        <input className="input" placeholder="Camel wool coat, cream turtleneck, wide trousers" value={value.outfit ?? ""} onChange={(e) => set("outfit", e.target.value)} />
      </Field>
      <Field label="Accessories" error={err("accessories")}>
        <input className="input" placeholder="Gold hoops, leather tote" value={value.accessories ?? ""} onChange={(e) => set("accessories", e.target.value)} />
      </Field>
      <Field label="Scene / location" error={err("scene")}>
        <input className="input" placeholder="Cobblestone street in Paris at golden hour" value={value.scene ?? ""} onChange={(e) => set("scene", e.target.value)} />
      </Field>
      <Field label="Mood" error={err("mood")}>
        <input className="input" placeholder="Calm, confident, warm" value={value.mood ?? ""} onChange={(e) => set("mood", e.target.value)} />
      </Field>
      <Field label="Visual style" error={err("visualStyle")}>
        <input className="input" placeholder="Film grain, muted earth tones" value={value.visualStyle ?? ""} onChange={(e) => set("visualStyle", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Target duration (s)" error={err("durationSeconds")} hint="3–60">
          <input className="input" type="number" min={3} max={60} value={value.durationSeconds} onChange={(e) => set("durationSeconds", Number(e.target.value))} />
        </Field>
        <Field label="Aspect ratio" error={err("aspectRatio")}>
          <select className="input" value={value.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value as ContentBrief["aspectRatio"])}>
            <option value="9:16">9:16 (Reels)</option>
            <option value="4:5">4:5</option>
            <option value="1:1">1:1</option>
            <option value="16:9">16:9</option>
          </select>
        </Field>
      </div>
      <Field label="Camera movement" error={err("cameraMovement")}>
        <input className="input" list="camera-options" placeholder="slow push-in" value={value.cameraMovement ?? ""} onChange={(e) => set("cameraMovement", e.target.value)} />
        <datalist id="camera-options">{CAMERA.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="Movement / pose" error={err("movementType")}>
        <input className="input" list="movement-options" placeholder="runway walk toward camera" value={value.movementType ?? ""} onChange={(e) => set("movementType", e.target.value)} />
        <datalist id="movement-options">{MOVEMENT.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="Caption (optional)" error={err("caption")}>
        <input className="input" value={value.caption ?? ""} onChange={(e) => set("caption", e.target.value)} />
      </Field>
      <Field label="On-screen text (optional)" error={err("onScreenText")}>
        <input className="input" maxLength={200} value={value.onScreenText ?? ""} onChange={(e) => set("onScreenText", e.target.value)} />
      </Field>
    </div>
  );
}
