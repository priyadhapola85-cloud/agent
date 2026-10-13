"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, Button, ErrorNote, Notice, PageHeader, Steps } from "@/components/ui";
import { CharacterProfileForm, cleanProfile, type ProfileDraft } from "@/components/character-profile-form";
import { api } from "@/lib/client/api";
import { useAction } from "@/lib/client/hooks";

export default function NewCharacterPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<ProfileDraft>({ name: "", description: "", identity: {}, style: {} });
  const create = useAction();

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Create AI character"
        subtitle="Start with a profile. Nothing is generated yet — you'll upload a reference image in the Design Studio next."
      />
      <div className="mb-6">
        <Steps steps={["Create profile", "Upload reference", "Review description", "Generate candidates", "Approve master"]} current={0} />
      </div>
      <Notice>
        Only a <strong>name</strong> is required now. You can leave the rest empty and let the reference-image analysis fill it in
        later. Characters are <strong>fictional adults</strong>; don&apos;t recreate a real person without their consent.
      </Notice>
      <Card className="mt-6">
        <CharacterProfileForm value={draft} onChange={setDraft} fieldErrors={create.error?.fields} />
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            busy={create.busy}
            disabled={!draft.name.trim()}
            onClick={() =>
              create.run(async () => {
                const res = await api<{ character: { id: string } }>("/api/characters", { method: "POST", body: cleanProfile(draft) });
                router.push(`/characters/${res.character.id}`);
              })
            }
          >
            Create & open Design Studio
          </Button>
        </div>
        <div className="mt-4">
          <ErrorNote error={create.error} />
        </div>
      </Card>
    </div>
  );
}
