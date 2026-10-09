import type {
  Campaign,
  DeliveryApproval,
  PieceKind,
  PieceVersion,
} from "./types.ts";
import { PIECE_KINDS } from "./types.ts";

export type DeliveryStatus = "in_production" | "ready_for_approval" | "approved";
export type PaymentStatus = "not_due" | "released" | "on_hold";
export type BlockerCode = "missing" | "pending_review" | "changes_requested";

export interface PieceBlocker {
  piece: PieceKind;
  code: BlockerCode;
  reason: string;
}

export interface PieceState {
  kind: PieceKind;
  required: boolean;
  current: PieceVersion | null;
}

export interface DeliveryEvaluation {
  status: DeliveryStatus;
  pieces: PieceState[];
  blockers: PieceBlocker[];
  approvalValid: boolean;
  payment: PaymentStatus;
}

export type CurrentVersions = Partial<Record<PieceKind, PieceVersion>>;

export function currentVersions(versions: readonly PieceVersion[]): CurrentVersions {
  const current: CurrentVersions = {};
  for (const v of versions) {
    const best = current[v.kind];
    if (!best || v.version > best.version) current[v.kind] = v;
  }
  return current;
}

function blockerFor(piece: PieceState): PieceBlocker | null {
  const { kind, current } = piece;
  if (!current) return { piece: kind, code: "missing", reason: "sem versão enviada" };
  switch (current.status) {
    case "approved":
      return null;
    case "pending_review":
      return { piece: kind, code: "pending_review", reason: `versão ${current.version} aguardando revisão` };
    case "changes_requested":
      return {
        piece: kind,
        code: "changes_requested",
        reason: `versão ${current.version} com alterações solicitadas`,
      };
  }
}

/**
 * Single source of truth for delivery status. Nothing here is stored: the
 * result is recomputed from the campaign's required list, the current version
 * of each piece and the last approval snapshot.
 */
export function evaluateDelivery(
  campaign: Pick<Campaign, "requiredPieces">,
  current: CurrentVersions,
  approval: DeliveryApproval | null,
): DeliveryEvaluation {
  const pieces: PieceState[] = PIECE_KINDS.map((kind) => ({
    kind,
    required: campaign.requiredPieces.includes(kind),
    current: current[kind] ?? null,
  }));

  const blockers = pieces
    .filter((p) => p.required)
    .map(blockerFor)
    .filter((b): b is PieceBlocker => b !== null);

  const approvalValid =
    approval !== null &&
    blockers.length === 0 &&
    campaign.requiredPieces.every((kind) => approval.snapshot[kind] === current[kind]?.id);

  const status: DeliveryStatus =
    blockers.length > 0 ? "in_production" : approvalValid ? "approved" : "ready_for_approval";

  const payment: PaymentStatus = approvalValid ? "released" : approval ? "on_hold" : "not_due";

  return { status, pieces, blockers, approvalValid, payment };
}
