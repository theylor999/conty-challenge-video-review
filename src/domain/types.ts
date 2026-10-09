export const PIECE_KINDS = ["script", "video", "cover", "caption"] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

export type ReviewStatus = "pending_review" | "changes_requested" | "approved";

export type PieceContent =
  | { text: string }
  | { url: string }
  | { url: string; durationSeconds: number };

export interface Actor {
  role: "brand" | "creator";
  id: string;
}

export interface Campaign {
  id: string;
  brandId: string;
  name: string;
  // Data, not code: the approval rule reads this list and nothing else.
  requiredPieces: readonly PieceKind[];
  createdAt: string;
}

export interface Delivery {
  id: string;
  campaignId: string;
  creatorId: string;
  createdAt: string;
}

export interface PieceVersion {
  id: string;
  deliveryId: string;
  kind: PieceKind;
  version: number;
  content: PieceContent;
  status: ReviewStatus;
  createdBy: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export interface Comment {
  id: string;
  versionId: string;
  atSecond: number | null;
  body: string;
  author: string;
  createdAt: string;
}

export type ApprovalSnapshot = Readonly<Partial<Record<PieceKind, string>>>;

export interface DeliveryApproval {
  id: string;
  deliveryId: string;
  approvedBy: string;
  approvedAt: string;
  // version id per required piece at the moment of approval
  snapshot: ApprovalSnapshot;
}

export type DeliveryEventType =
  | "version_submitted"
  | "version_approved"
  | "version_changes_requested"
  | "delivery_approved"
  | "approval_invalidated"
  | "payment_released"
  | "payment_hold";

export interface DeliveryEvent {
  id: string;
  deliveryId: string;
  type: DeliveryEventType;
  at: string;
  data: Record<string, unknown>;
}
