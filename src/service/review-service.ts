import type { Clock } from "../clock.ts";
import { AppError } from "../domain/errors.ts";
import {
  currentVersions,
  evaluateDelivery,
  type CurrentVersions,
  type DeliveryEvaluation,
} from "../domain/delivery-status.ts";
import {
  parseCampaign,
  parseComment,
  parseContent,
  parseDeliveryInput,
  parsePieceKind,
  parseReviewNote,
} from "../domain/input.ts";
import type {
  Actor,
  Campaign,
  Comment,
  Delivery,
  DeliveryApproval,
  DeliveryEvent,
  DeliveryEventType,
  PieceKind,
  PieceVersion,
} from "../domain/types.ts";
import type { IdGenerator } from "../ids.ts";
import type { Store } from "../storage/store.ts";

export interface DeliveryView {
  delivery: Delivery;
  campaign: Campaign;
  evaluation: DeliveryEvaluation;
  versionCounts: Record<PieceKind, number>;
  approval: DeliveryApproval | null;
  payoutKey: string;
  events: DeliveryEvent[];
}

export interface VersionView {
  version: PieceVersion;
  isCurrent: boolean;
  required: boolean;
  comments: Comment[];
  previousVersionsCommentsCount: number;
}

interface Snapshot {
  delivery: Delivery;
  campaign: Campaign;
  versions: PieceVersion[];
  current: CurrentVersions;
  approval: DeliveryApproval | null;
  evaluation: DeliveryEvaluation;
}

const payoutKeyOf = (deliveryId: string) => `delivery:${deliveryId}`;

export class ReviewService {
  constructor(
    private readonly store: Store,
    private readonly clock: Clock,
    private readonly newId: IdGenerator,
  ) {}

  createCampaign(actor: Actor, raw: unknown): Campaign {
    this.requireRole(actor, "brand", "criar campanhas");
    const { name, requiredPieces } = parseCampaign(raw);
    const campaign: Campaign = {
      id: this.newId("cmp"),
      brandId: actor.id,
      name,
      requiredPieces,
      createdAt: this.now(),
    };
    this.store.saveCampaign(campaign);
    return campaign;
  }

  getCampaign(id: string): Campaign {
    return this.loadCampaign(id);
  }

  createDelivery(actor: Actor, raw: unknown): DeliveryView {
    this.requireRole(actor, "creator", "abrir uma entrega");
    const { campaignId } = parseDeliveryInput(raw);
    const campaign = this.loadCampaign(campaignId);
    const existing = this.store.findDelivery(campaign.id, actor.id);
    if (existing) {
      throw new AppError("conflict", "delivery_already_exists", "Este criador já tem uma entrega nesta campanha.", {
        delivery_id: existing.id,
      });
    }
    const delivery: Delivery = {
      id: this.newId("dlv"),
      campaignId: campaign.id,
      creatorId: actor.id,
      createdAt: this.now(),
    };
    this.store.saveDelivery(delivery);
    return this.view(delivery, campaign);
  }

  getDelivery(id: string): DeliveryView {
    const { delivery, campaign } = this.loadDelivery(id);
    return this.view(delivery, campaign);
  }

  submitVersion(actor: Actor, deliveryId: string, rawKind: string, raw: unknown): PieceVersion {
    const kind = parsePieceKind(rawKind);
    const { delivery, campaign } = this.loadDelivery(deliveryId);
    this.requireRole(actor, "creator", "enviar versões");
    if (delivery.creatorId !== actor.id) {
      throw new AppError("forbidden", "not_delivery_creator", "Só o criador desta entrega pode enviar versões.");
    }
    const content = parseContent(kind, raw);

    const before = this.snapshot(delivery, campaign);
    const version: PieceVersion = {
      id: this.newId("ver"),
      deliveryId,
      kind,
      version: before.versions.filter((v) => v.kind === kind).length + 1,
      content,
      status: "pending_review",
      createdBy: actor.id,
      createdAt: this.now(),
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    };
    this.store.saveVersion(version);
    this.record(deliveryId, "version_submitted", {
      piece: kind,
      version: version.version,
      version_id: version.id,
      required: campaign.requiredPieces.includes(kind),
    });

    // Approval validity is derived; this only writes the history of the flip.
    const after = this.snapshot(delivery, campaign);
    if (before.evaluation.status === "approved" && after.evaluation.status !== "approved" && before.approval) {
      this.record(deliveryId, "approval_invalidated", {
        approval_id: before.approval.id,
        piece: kind,
        caused_by_version_id: version.id,
      });
      this.record(deliveryId, "payment_hold", {
        approval_id: before.approval.id,
        payout_key: payoutKeyOf(deliveryId),
        reason: "approval_invalidated",
      });
    }
    return version;
  }

  getVersion(id: string): VersionView {
    const version = this.loadVersion(id);
    const { campaign } = this.loadDelivery(version.deliveryId);
    const siblings = this.store.listVersions(version.deliveryId, version.kind);
    const older = siblings.filter((v) => v.version < version.version).map((v) => v.id);
    return {
      version,
      isCurrent: siblings.at(-1)?.id === version.id,
      required: campaign.requiredPieces.includes(version.kind),
      comments: this.store.listComments(id),
      previousVersionsCommentsCount: this.store.countComments(older),
    };
  }

  reviewVersion(actor: Actor, versionId: string, decision: "approve" | "request_changes", raw?: unknown): PieceVersion {
    const version = this.loadVersion(versionId);
    const { delivery, campaign } = this.loadDelivery(version.deliveryId);
    this.requireBrandOf(actor, campaign, "revisar versões");

    this.assertCurrent(version);
    const note = decision === "request_changes" ? parseReviewNote(raw) : null;
    if (version.status !== "pending_review") {
      throw new AppError(
        "conflict",
        "version_already_reviewed",
        `A versão ${version.version} de ${version.kind} já foi revisada (${version.status}). Peça uma nova versão ao criador.`,
      );
    }

    const reviewed: PieceVersion = {
      ...version,
      status: decision === "approve" ? "approved" : "changes_requested",
      reviewedBy: actor.id,
      reviewedAt: this.now(),
      reviewNote: note,
    };
    this.store.saveVersion(reviewed);
    this.record(delivery.id, decision === "approve" ? "version_approved" : "version_changes_requested", {
      piece: version.kind,
      version: version.version,
      version_id: version.id,
      by: actor.id,
      ...(note ? { note } : {}),
    });
    return reviewed;
  }

  approveDelivery(actor: Actor, deliveryId: string): DeliveryView {
    const { delivery, campaign } = this.loadDelivery(deliveryId);
    this.requireBrandOf(actor, campaign, "aprovar a entrega");

    const state = this.snapshot(delivery, campaign);
    if (state.evaluation.status === "approved") {
      throw new AppError("conflict", "delivery_already_approved", "Esta entrega já está aprovada.");
    }
    if (state.evaluation.blockers.length > 0) {
      throw new AppError(
        "unprocessable",
        "required_pieces_pending",
        "A entrega não pode ser aprovada: há peças obrigatórias pendentes.",
        { missing: state.evaluation.blockers },
      );
    }

    const snapshot: Record<string, string> = {};
    for (const kind of campaign.requiredPieces) {
      const current = state.current[kind];
      if (current) snapshot[kind] = current.id;
    }
    const approval: DeliveryApproval = {
      id: this.newId("apr"),
      deliveryId,
      approvedBy: actor.id,
      approvedAt: this.now(),
      snapshot,
    };
    this.store.addApproval(approval);
    this.record(deliveryId, "delivery_approved", { approval_id: approval.id, snapshot });
    this.record(deliveryId, "payment_released", {
      approval_id: approval.id,
      payout_key: payoutKeyOf(deliveryId),
    });
    return this.view(delivery, campaign);
  }

  addComment(actor: Actor, versionId: string, raw: unknown): Comment {
    const version = this.loadVersion(versionId);
    const { delivery, campaign } = this.loadDelivery(version.deliveryId);
    const isBrand = actor.role === "brand" && actor.id === campaign.brandId;
    const isCreator = actor.role === "creator" && actor.id === delivery.creatorId;
    if (!isBrand && !isCreator) {
      throw new AppError("forbidden", "not_participant", "Só a marca da campanha ou o criador da entrega podem comentar.");
    }
    this.assertCurrent(version);
    const { atSecond, body } = parseComment(version, raw);
    const comment: Comment = {
      id: this.newId("cmt"),
      versionId,
      atSecond,
      body,
      author: actor.id,
      createdAt: this.now(),
    };
    this.store.addComment(comment);
    return comment;
  }

  private now(): string {
    return this.clock.now().toISOString();
  }

  private record(deliveryId: string, type: DeliveryEventType, data: Record<string, unknown>): void {
    this.store.addEvent({ id: this.newId("evt"), deliveryId, type, at: this.now(), data });
  }

  private requireRole(actor: Actor, role: Actor["role"], action: string): void {
    if (actor.role !== role) {
      const who = role === "brand" ? "a marca" : "o criador";
      throw new AppError("forbidden", "wrong_role", `Só ${who} pode ${action}.`);
    }
  }

  private requireBrandOf(actor: Actor, campaign: Campaign, action: string): void {
    this.requireRole(actor, "brand", action);
    if (campaign.brandId !== actor.id) {
      throw new AppError("forbidden", "not_campaign_brand", "Esta campanha pertence a outra marca.");
    }
  }

  private assertCurrent(version: PieceVersion): void {
    const latest = this.store.listVersions(version.deliveryId, version.kind).at(-1);
    if (latest && latest.id !== version.id) {
      throw new AppError(
        "conflict",
        "version_not_current",
        `A versão ${version.version} de ${version.kind} foi substituída pela versão ${latest.version}. Só a versão atual aceita revisão e comentários.`,
        { current_version_id: latest.id, current_version: latest.version },
      );
    }
  }

  private loadCampaign(id: string): Campaign {
    const campaign = this.store.getCampaign(id);
    if (!campaign) throw new AppError("not_found", "campaign_not_found", "Campanha não encontrada.");
    return campaign;
  }

  private loadDelivery(id: string): { delivery: Delivery; campaign: Campaign } {
    const delivery = this.store.getDelivery(id);
    if (!delivery) throw new AppError("not_found", "delivery_not_found", "Entrega não encontrada.");
    return { delivery, campaign: this.loadCampaign(delivery.campaignId) };
  }

  private loadVersion(id: string): PieceVersion {
    const version = this.store.getVersion(id);
    if (!version) throw new AppError("not_found", "version_not_found", "Versão não encontrada.");
    return version;
  }

  private snapshot(delivery: Delivery, campaign: Campaign): Snapshot {
    const versions = this.store.listVersions(delivery.id);
    const current = currentVersions(versions);
    const approval = this.store.latestApproval(delivery.id) ?? null;
    return { delivery, campaign, versions, current, approval, evaluation: evaluateDelivery(campaign, current, approval) };
  }

  private view(delivery: Delivery, campaign: Campaign): DeliveryView {
    const { versions, approval, evaluation } = this.snapshot(delivery, campaign);
    const versionCounts: Record<PieceKind, number> = { script: 0, video: 0, cover: 0, caption: 0 };
    for (const v of versions) versionCounts[v.kind] += 1;
    return {
      delivery,
      campaign,
      evaluation,
      versionCounts,
      approval,
      payoutKey: payoutKeyOf(delivery.id),
      events: this.store.listEvents(delivery.id),
    };
  }
}
