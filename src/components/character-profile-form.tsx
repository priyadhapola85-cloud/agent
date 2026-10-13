"use client";

import type { CharacterIdentity, CharacterStyle } from "@/lib/db/schema";
import { Field } from "./ui";

export type ProfileDraft = {
  name: string;
  description: string;
  identity: CharacterIdentity;
  style: CharacterStyle;
};

const NICHES = ["luxury", "streetwear", "casual", "ethnic", "editorial", "other"];

const IDENTITY_FIELDS: { key: keyof CharacterIdentity; label: string; placeholder: string; long?: boolean }[] = [
  { key: "genderPresentation", label: "Gender presentation", placeholder: "e.g. feminine" },
  { key: "face", label: "Face & facial features", placeholder: "Oval face, high cheekbones, straight nose, full lips…", long: true },
  { key: "eyes", label: "Eyes", placeholder: "Almond-shaped hazel eyes, thick brows" },
  { key: "hair", label: "Hairstyle & colour", placeholder: "Long wavy auburn hair, middle part" },
  { key: "skin", label: "Skin appearance", placeholder: "Light-medium skin, warm undertone, light freckles" },
  { key: "body", label: "Body proportions", placeholder: "Tall, slim athletic build" },
  { key: "distinctiveFeatures", label: "Distinctive features", placeholder: "Small mole above left lip" },
];

const STYLE_FIELDS: { key: keyof CharacterStyle; label: string; placeholder: string; long?: boolean }[] = [
  { key: "clothing", label: "Typical clothing", placeholder: "Tailored neutrals, cashmere, silk", long: true },
  { key: "accessories", label: "Accessories", placeholder: "Gold hoops, structured leather bag" },
  { key: "makeup", label: "Makeup", placeholder: "Soft glam, nude lip" },
  { key: "personality", label: "Personality", placeholder: "Calm, confident, quietly witty" },
  { key: "mood", label: "Visual mood", placeholder: "Warm, elegant, cinematic" },
  { key: "presentationStyle", label: "Presentation style", placeholder: "Slow, poised movement; direct gaze" },
  { key: "locations", label: "Preferred locations / backgrounds", placeholder: "Parisian streets, minimalist studios" },
  { key: "lighting", label: "Lighting", placeholder: "Golden hour, soft window light" },
  { key: "camera", label: "Camera style", placeholder: "35mm, shallow depth of field, eye level" },
];

export function CharacterProfileForm({
  value,
  onChange,
  fieldErrors,
  disabled,
}: {
  value: ProfileDraft;
  onChange: (next: ProfileDraft) => void;
  fieldErrors?: Record<string, string>;
  disabled?: boolean;
}) {
  const setIdentity = (k: keyof CharacterIdentity, v: string) =>
    onChange({
      ...value,
      identity: { ...value.identity, [k]: k === "fictionalAge" ? (v === "" ? undefined : Number(v)) : v },
    });
  const setStyle = (k: keyof CharacterStyle, v: string) => onChange({ ...value, style: { ...value.style, [k]: v } });
  const nicheIsCustom = !!value.style.niche && !NICHES.includes(value.style.niche);

  return (
    <fieldset disabled={disabled} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="Character name" error={fieldErrors?.name}>
            <input className="input" value={value.name} maxLength={80} onChange={(e) => onChange({ ...value, name: e.target.value })} />
          </Field>
        </div>
        <Field label="Fictional age (18+)" error={fieldErrors?.["identity.fictionalAge"]}>
          <input
            className="input"
            type="number"
            min={18}
            max={80}
            value={value.identity.fictionalAge ?? ""}
            onChange={(e) => setIdentity("fictionalAge", e.target.value)}
          />
        </Field>
      </div>
      <Field label="General description" hint="Overall look and character concept. Analysis can pre-fill this." error={fieldErrors?.description}>
        <textarea
          className="input min-h-20"
          maxLength={2000}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
      </Field>

      <div>
        <h3 className="mb-1 text-sm font-semibold">Stable identity</h3>
        <p className="mb-3 text-xs text-muted">These stay the same in every image and video. Be specific.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {IDENTITY_FIELDS.map((f) => (
            <div key={f.key} className={f.long ? "sm:col-span-2" : ""}>
              <Field label={f.label} error={fieldErrors?.[`identity.${f.key}`]}>
                {f.long ? (
                  <textarea
                    className="input min-h-16"
                    placeholder={f.placeholder}
                    value={(value.identity[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setIdentity(f.key, e.target.value)}
                  />
                ) : (
                  <input
                    className="input"
                    placeholder={f.placeholder}
                    value={(value.identity[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setIdentity(f.key, e.target.value)}
                  />
                )}
              </Field>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold">Default style (changeable per content)</h3>
        <p className="mb-3 text-xs text-muted">Starting points for outfits, locations and camera. Each content brief can override them.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fashion niche">
            <select
              className="input"
              value={nicheIsCustom ? "other" : (value.style.niche ?? "")}
              onChange={(e) => setStyle("niche", e.target.value)}
            >
              <option value="">Choose…</option>
              {NICHES.map((n) => (
                <option key={n} value={n}>
                  {n[0].toUpperCase() + n.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          {(value.style.niche === "other" || nicheIsCustom) && (
            <Field label="Describe the niche">
              <input
                className="input"
                placeholder="e.g. athleisure"
                value={nicheIsCustom ? value.style.niche : ""}
                onChange={(e) => setStyle("niche", e.target.value || "other")}
              />
            </Field>
          )}
          {STYLE_FIELDS.map((f) => (
            <div key={f.key} className={f.long ? "sm:col-span-2" : ""}>
              <Field label={f.label} error={fieldErrors?.[`style.${f.key}`]}>
                <input
                  className="input"
                  placeholder={f.placeholder}
                  value={value.style[f.key] ?? ""}
                  onChange={(e) => setStyle(f.key, e.target.value)}
                />
              </Field>
            </div>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

/** Removes empty strings so the API receives only filled-in fields. */
export function cleanProfile(p: ProfileDraft) {
  const strip = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])) as T;
  return { name: p.name.trim(), description: p.description.trim(), identity: strip(p.identity), style: strip(p.style) };
}
