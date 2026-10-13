import { apiRoute } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { MAX_UPLOAD_BYTES } from "@/lib/media/media-type";
import { getCharacterDetail, uploadSourceReference } from "@/lib/services/characters";

export const dynamic = "force-dynamic";

/** POST /api/characters/:id/reference-upload — multipart form: file + rightsConfirmed */
export const POST = apiRoute<{ id: string }>(async (req, { app, params }) => {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024)
    throw new AppError("PAYLOAD_TOO_LARGE", "The image is larger than 5 MB.", {
      action: "Resize or compress it to under 5 MB and upload again.",
    });
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data"))
    throw new AppError("UNSUPPORTED_MEDIA", "Expected a file upload.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION", "The upload could not be read. Please try again.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION", "Choose an image file to upload.", { fields: { file: "Required" } });
  if (file.size > MAX_UPLOAD_BYTES)
    throw new AppError("PAYLOAD_TOO_LARGE", "The image is larger than 5 MB.", {
      action: "Resize or compress it to under 5 MB and upload again.",
    });

  await uploadSourceReference(
    app,
    params.id,
    { data: Buffer.from(await file.arrayBuffer()), filename: file.name || "reference" },
    form.get("rightsConfirmed") === "true",
  );
  return getCharacterDetail(app, params.id);
});
