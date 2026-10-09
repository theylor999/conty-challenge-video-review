import type {
  Campaign,
  Comment,
  Delivery,
  DeliveryApproval,
  DeliveryEvent,
  PieceKind,
  PieceVersion,
} from "../domain/types.ts";
import type { Store } from "./store.ts";

export class MemoryStore implements Store {
  private campaigns = new Map<string, Campaign>();
  private deliveries = new Map<string, Delivery>();
  private versions = new Map<string, PieceVersion>();
  private comments: Comment[] = [];
  private approvals: DeliveryApproval[] = [];
  private events: DeliveryEvent[] = [];

  saveCampaign(campaign: Campaign): void {
    this.campaigns.set(campaign.id, campaign);
  }
  getCampaign(id: string): Campaign | undefined {
    return this.campaigns.get(id);
  }

  saveDelivery(delivery: Delivery): void {
    this.deliveries.set(delivery.id, delivery);
  }
  getDelivery(id: string): Delivery | undefined {
    return this.deliveries.get(id);
  }
  findDelivery(campaignId: string, creatorId: string): Delivery | undefined {
    return [...this.deliveries.values()].find((d) => d.campaignId === campaignId && d.creatorId === creatorId);
  }

  saveVersion(version: PieceVersion): void {
    this.versions.set(version.id, version);
  }
  getVersion(id: string): PieceVersion | undefined {
    return this.versions.get(id);
  }
  listVersions(deliveryId: string, kind?: PieceKind): PieceVersion[] {
    return [...this.versions.values()]
      .filter((v) => v.deliveryId === deliveryId && (kind === undefined || v.kind === kind))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.version - b.version);
  }

  addComment(comment: Comment): void {
    this.comments.push(comment);
  }
  listComments(versionId: string): Comment[] {
    return this.comments
      .filter((c) => c.versionId === versionId)
      .sort((a, b) => (a.atSecond ?? 0) - (b.atSecond ?? 0));
  }
  countComments(versionIds: readonly string[]): number {
    return this.comments.filter((c) => versionIds.includes(c.versionId)).length;
  }

  addApproval(approval: DeliveryApproval): void {
    this.approvals.push(approval);
  }
  latestApproval(deliveryId: string): DeliveryApproval | undefined {
    return this.approvals.filter((a) => a.deliveryId === deliveryId).at(-1);
  }

  addEvent(event: DeliveryEvent): void {
    this.events.push(event);
  }
  listEvents(deliveryId: string): DeliveryEvent[] {
    return this.events.filter((e) => e.deliveryId === deliveryId);
  }
}
