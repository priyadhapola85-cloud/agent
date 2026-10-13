import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * PRIVATE MEDIA STORAGE
 *
 * Files live in a folder that is NOT inside /public, so nobody can open them
 * directly by URL. The app streams them only to logged-in users through
 * /api/assets/[id].
 *
 * Swap this class for an S3/R2/GCS implementation later by implementing the
 * same `MediaStorage` interface — nothing else in the app needs to change.
 */
export interface MediaStorage {
  put(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  /** Streams a file, optionally only bytes start..end (inclusive) for video seeking. */
  stream(key: string, range?: { start: number; end: number }): Promise<{ stream: ReadableStream<Uint8Array>; size: number }>;
  size(key: string): Promise<number>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9_\-/.]*$/i;

export class LocalFileStorage implements MediaStorage {
  constructor(private readonly rootDir: string) {}

  /** Turns a storage key into a file path, refusing anything that escapes the root folder. */
  private resolve(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    const full = path.resolve(this.rootDir, key);
    const root = path.resolve(this.rootDir) + path.sep;
    if (!full.startsWith(root)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Buffer) {
    const file = this.resolve(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file); // atomic: never leaves a half-written file
  }

  async read(key: string) {
    return fsp.readFile(this.resolve(key));
  }

  async stream(key: string, range?: { start: number; end: number }) {
    const file = this.resolve(key);
    const stat = await fsp.stat(file);
    const nodeStream = fs.createReadStream(file, range ? { start: range.start, end: range.end } : undefined);
    return { stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>, size: stat.size };
  }

  async size(key: string) {
    return (await fsp.stat(this.resolve(key))).size;
  }

  async exists(key: string) {
    try {
      await fsp.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string) {
    await fsp.rm(this.resolve(key), { force: true });
  }
}
