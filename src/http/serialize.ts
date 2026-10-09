import type { PieceBlocker } from "../domain/delivery-status.ts";
import type { Campaign, Comment, DeliveryEvent, PieceContent, PieceVersion } from "../domain/types.ts";
import type { DeliveryView, VersionView } from "../service/review-service.ts";

function content(c: PieceContent) {
  return "durationSeconds" in c ? { url: c.url, duration_seconds: c.durationSeconds } : c;
}

export const campaignJson = (c: Campaign) => ({
  id: c.id,
  brand_id: c.brandId,
  name: c.name,
  required_pieces: c.requiredPieces,
  created_at: c.createdAt,
});

export const versionSummary = (v: PieceVersion) => ({
  id: v.id,
  piece: v.kind,
  version: v.version,
  status: v.status,
  content: content(v.content),
  created_by: v.createdBy,
  created_at: v.createdAt,
  reviewed_by: v.reviewedBy,
  reviewed_at: v.reviewedAt,
  review_note: v.reviewNote,
});

export const commentJson = (c: Comment) => ({
  id: c.id,
  version_id: c.versionId,
  at_second: c.atSecond,
  body: c.body,
  author: c.author,
  created_at: c.createdAt,
});

export const blockerJson = (b: PieceBlocker) => ({ piece: b.piece, code: b.code, reason: b.reason });

const eventJson = (e: DeliveryEvent) => ({ id: e.id, type: e.type, at: e.at, ...e.data });

export function versionJson(view: VersionView) {
  return {
    ...versionSummary(view.version),
    delivery_id: view.version.deliveryId,
    is_current: view.isCurrent,
    required: view.required,
    comments: view.comments.map(commentJson),
    previous_versions_comments_count: view.previousVersionsCommentsCount,
  };
}

export function deliveryJson(view: DeliveryView) {
  const { delivery, campaign, evaluation, approval } = view;
  return {
    id: delivery.id,
    creator_id: delivery.creatorId,
    campaign: { id: campaign.id, name: campaign.name, required_pieces: campaign.requiredPieces },
    status: evaluation.status,
    can_approve: evaluation.status === "ready_for_approval",
    blockers: evaluation.blockers.map(blockerJson),
    pieces: evaluation.pieces.map((p) => ({
      piece: p.kind,
      requirement: p.required ? "required" : "not_required",
      required: p.required,
      versions_count: view.versionCounts[p.kind],
      current_version: p.current ? versionSummary(p.current) : null,
    })),
    approval: approval
      ? {
          id: approval.id,
          approved_by: approval.approvedBy,
          approved_at: approval.approvedAt,
          snapshot: approval.snapshot,
          valid: evaluation.approvalValid,
        }
      : null,
    payment: { status: evaluation.payment, payout_key: view.payoutKey },
    history: view.events.map(eventJson),
  };
}
