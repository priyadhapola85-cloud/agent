"use client";

import { Field } from "./ui";

export type ModelOption = { id: string; label: string; free: boolean; ready: boolean; note?: string; priceNote?: string };

/** Model picker: free models first; paid ones are disabled until their key is set. */
export function ModelSelect({
  label,
  models,
  value,
  onChange,
}: {
  label: string;
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const sorted = [...models].sort((a, b) => Number(b.free) - Number(a.free));
  const current = models.find((m) => m.id === value);
  return (
    <Field label={label} hint={current?.note ?? current?.priceNote}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {sorted.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.ready}>
            {m.label}
            {!m.ready ? " — needs fal.ai key + credit" : ""}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** The default model if it can run, otherwise the first free one. */
export function pickDefaultModel(models: ModelOption[], preferred: string | null | undefined) {
  const p = models.find((m) => m.id === preferred && m.ready);
  return (p ?? models.find((m) => m.free && m.ready) ?? models.find((m) => m.ready) ?? models[0])?.id ?? "";
}
