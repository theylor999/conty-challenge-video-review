import type {
  Campaign,
  Comment,
  Delivery,
  DeliveryApproval,
  DeliveryEvent,
  PieceKind,
  PieceVersion,
} from "../domain/types.ts";

/**
 * Persistence boundary. Versions, comments, approvals and events are
 * append-only; only saveVersion may replace a row (review status change).
 */
export interface Store {
  saveCampaign(campaign: Campaign): void;
  getCampaign(id: string): Campaign | undefined;

  saveDelivery(delivery: Delivery): void;
  getDelivery(id: string): Delivery | undefined;
  findDelivery(campaignId: string, creatorId: string): Delivery | undefined;

  saveVersion(version: PieceVersion): void;
  getVersion(id: string): PieceVersion | undefined;
  /** Versions of a delivery ordered by (kind, version); optionally one kind. */
  listVersions(deliveryId: string, kind?: PieceKind): PieceVersion[];

  addComment(comment: Comment): void;
  /** Ordered by position in the video, then by creation. */
  listComments(versionId: string): Comment[];
  countComments(versionIds: readonly string[]): number;

  addApproval(approval: DeliveryApproval): void;
  latestApproval(deliveryId: string): DeliveryApproval | undefined;

  addEvent(event: DeliveryEvent): void;
  listEvents(deliveryId: string): DeliveryEvent[];
}
