import { AppError, validationFailed, type FieldError } from "./errors.ts";
import { PIECE_KINDS, type PieceContent, type PieceKind, type PieceVersion } from "./types.ts";

const MAX_TEXT = 20_000;
const MAX_URL = 2_048;
const MAX_NAME = 120;
const MAX_COMMENT = 2_000;
const MAX_DURATION_SECONDS = 86_400;

type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

function requireRecord(raw: unknown): Raw {
  if (!isRecord(raw)) throw validationFailed([{ field: "body", message: "o corpo deve ser um objeto JSON" }]);
  return raw;
}

function text(raw: Raw, field: string, max: number, errors: FieldError[]): string {
  const value = raw[field];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({ field, message: "texto obrigatório e não vazio" });
    return "";
  }
  if (value.length > max) errors.push({ field, message: `máximo de ${max} caracteres` });
  return value.trim();
}

function url(raw: Raw, errors: FieldError[]): string {
  const value = raw.url;
  if (typeof value !== "string" || value.length > MAX_URL) {
    errors.push({ field: "url", message: "url http(s) obrigatória (até 2048 caracteres)" });
    return "";
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return value;
  } catch {
    // falls through to the error below
  }
  errors.push({ field: "url", message: "url inválida, use http ou https" });
  return "";
}

function rejectUnknown(raw: Raw, allowed: readonly string[], errors: FieldError[]): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) errors.push({ field: key, message: "campo não aceito aqui" });
  }
}

export function parseCampaign(raw: unknown): { name: string; requiredPieces: PieceKind[] } {
  const body = requireRecord(raw);
  const errors: FieldError[] = [];
  rejectUnknown(body, ["name", "required_pieces"], errors);
  const name = text(body, "name", MAX_NAME, errors);

  const pieces = body.required_pieces;
  const requiredPieces: PieceKind[] = [];
  if (!Array.isArray(pieces) || pieces.length === 0) {
    errors.push({ field: "required_pieces", message: `lista não vazia com: ${PIECE_KINDS.join(", ")}` });
  } else {
    for (const p of pieces) {
      if (!PIECE_KINDS.includes(p as PieceKind)) {
        errors.push({ field: "required_pieces", message: `peça desconhecida: ${JSON.stringify(p)}` });
      } else if (requiredPieces.includes(p as PieceKind)) {
        errors.push({ field: "required_pieces", message: `peça repetida: ${String(p)}` });
      } else {
        requiredPieces.push(p as PieceKind);
      }
    }
  }
  if (errors.length > 0) throw validationFailed(errors);
  return { name, requiredPieces };
}

export function parseDeliveryInput(raw: unknown): { campaignId: string } {
  const body = requireRecord(raw);
  const id = body.campaign_id;
  if (typeof id !== "string" || id === "") {
    throw validationFailed([{ field: "campaign_id", message: "obrigatório" }]);
  }
  return { campaignId: id };
}

export function parsePieceKind(raw: string): PieceKind {
  if (!PIECE_KINDS.includes(raw as PieceKind)) {
    throw new AppError("not_found", "unknown_piece_kind", `Peça desconhecida: "${raw}". Use: ${PIECE_KINDS.join(", ")}.`);
  }
  return raw as PieceKind;
}

export function parseContent(kind: PieceKind, raw: unknown): PieceContent {
  const body = requireRecord(raw);
  const errors: FieldError[] = [];
  let content: PieceContent;

  switch (kind) {
    case "script":
    case "caption":
      rejectUnknown(body, ["text"], errors);
      content = { text: text(body, "text", MAX_TEXT, errors) };
      break;
    case "cover":
      rejectUnknown(body, ["url"], errors);
      content = { url: url(body, errors) };
      break;
    case "video": {
      rejectUnknown(body, ["url", "duration_seconds"], errors);
      const duration = body.duration_seconds;
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) {
        errors.push({ field: "duration_seconds", message: `número maior que 0 e até ${MAX_DURATION_SECONDS}` });
      }
      content = { url: url(body, errors), durationSeconds: typeof duration === "number" ? duration : 0 };
      break;
    }
  }
  if (errors.length > 0) throw validationFailed(errors);
  return content;
}

export function videoDuration(version: Pick<PieceVersion, "kind" | "content">): number | null {
  return version.kind === "video" && "durationSeconds" in version.content ? version.content.durationSeconds : null;
}

/**
 * Video comments must be pinned to a second inside the video (decimals
 * allowed, 0 and the exact duration included). Other pieces have no timeline,
 * so a position there is an error instead of being silently dropped.
 */
export function parseComment(
  version: Pick<PieceVersion, "kind" | "content">,
  raw: unknown,
): { atSecond: number | null; body: string } {
  const input = requireRecord(raw);
  const errors: FieldError[] = [];
  rejectUnknown(input, ["at_second", "body"], errors);
  const body = text(input, "body", MAX_COMMENT, errors);

  const duration = videoDuration(version);
  const at = input.at_second;
  let atSecond: number | null = null;
  if (duration !== null) {
    if (typeof at !== "number" || !Number.isFinite(at) || at < 0 || at > duration) {
      errors.push({ field: "at_second", message: `obrigatório, entre 0 e ${duration} (duração do vídeo)` });
    } else {
      atSecond = at;
    }
  } else if (at !== undefined) {
    errors.push({ field: "at_second", message: `só comentários de vídeo têm segundo; esta peça é ${version.kind}` });
  }
  if (errors.length > 0) throw validationFailed(errors);
  return { atSecond, body };
}

export function parseReviewNote(raw: unknown): string | null {
  if (raw === undefined) return null;
  const input = requireRecord(raw);
  const errors: FieldError[] = [];
  rejectUnknown(input, ["note"], errors);
  const note = input.note;
  if (note !== undefined && (typeof note !== "string" || note.length > MAX_COMMENT)) {
    errors.push({ field: "note", message: `texto de até ${MAX_COMMENT} caracteres` });
  }
  if (errors.length > 0) throw validationFailed(errors);
  return typeof note === "string" && note.trim() !== "" ? note.trim() : null;
}
