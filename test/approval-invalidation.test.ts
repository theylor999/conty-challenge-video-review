import { describe, expect, it } from "vitest";
import { PIECE_KINDS, type PieceKind } from "../src/domain/types.ts";
import { setup } from "./helpers.ts";

const types = (history: { type: string }[]) => history.map((e) => e.type);

describe("new version on an approved delivery", () => {
  async function approvedDelivery(required: PieceKind[]) {
    const t = setup();
    const { deliveryId } = await t.start(required);
    const versions: Record<string, string> = {};
    for (const kind of required) versions[kind] = await t.uploadApproved(deliveryId, kind);
    const approved = await t.approveDelivery(deliveryId);
    expect(approved.body.status).toBe("approved");
    return { t, deliveryId, versions };
  }

  it("stops being approved, holds payment, and records why", async () => {
    const { t, deliveryId, versions } = await approvedDelivery(["video", "cover"]);
    const v2 = await t.upload(deliveryId, "cover");

    const d = (await t.get(`/deliveries/${deliveryId}`)).body;
    expect(d.status).toBe("in_production");
    expect(d.can_approve).toBe(false);
    expect(d.blockers).toEqual([{ piece: "cover", code: "pending_review", reason: "versão 2 aguardando revisão" }]);
    expect(d.approval).toMatchObject({ valid: false, snapshot: { cover: versions.cover, video: versions.video } });
    expect(d.payment.status).toBe("on_hold");

    const invalidated = d.history.find((e: { type: string }) => e.type === "approval_invalidated");
    expect(invalidated).toMatchObject({ piece: "cover", caused_by_version_id: v2 });
    expect(types(d.history).slice(-3)).toEqual(["version_submitted", "approval_invalidated", "payment_hold"]);
    // history is kept
    expect(types(d.history)).toContain("delivery_approved");
    expect(types(d.history).filter((x: string) => x === "payment_released")).toHaveLength(1);
  });

  it("approving the new version alone does not bring approval back; re-approving does", async () => {
    const { t, deliveryId } = await approvedDelivery(["video", "cover"]);
    const v2 = await t.upload(deliveryId, "cover");
    await t.approveVersion(v2);

    const mid = (await t.get(`/deliveries/${deliveryId}`)).body;
    expect(mid.status).toBe("ready_for_approval");
    expect(mid.payment.status).toBe("on_hold");

    const again = await t.approveDelivery(deliveryId);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("approved");
    expect(again.body.payment.status).toBe("released");
    expect(again.body.approval.snapshot.cover).toBe(v2);
    expect(types(again.body.history)).toEqual([
      "version_submitted", "version_approved",
      "version_submitted", "version_approved",
      "delivery_approved", "payment_released",
      "version_submitted", "approval_invalidated", "payment_hold",
      "version_approved",
      "delivery_approved", "payment_released",
    ]);
    const releases = again.body.history.filter((e: { type: string }) => e.type === "payment_released");
    expect(releases.map((e: { payout_key: string }) => e.payout_key)).toEqual(["delivery:dlv_1", "delivery:dlv_1"]);
  });

  it("no payment_released is emitted while the new version is unapproved", async () => {
    const { t, deliveryId } = await approvedDelivery(["cover"]);
    await t.upload(deliveryId, "cover");
    const v3 = await t.upload(deliveryId, "cover");

    const delivery = (await t.get(`/deliveries/${deliveryId}`)).body;
    const history = delivery.history;
    expect(delivery.pieces.find((p: { piece: string }) => p.piece === "cover").current_version).toMatchObject({ id: v3, version: 3 });
    expect(types(history).filter((x: string) => x === "version_submitted")).toHaveLength(3);
    expect(types(history).filter((x: string) => x === "payment_released")).toHaveLength(1);
    // a second upload on an already invalidated approval records no second invalidation
    expect(types(history).filter((x: string) => x === "approval_invalidated")).toHaveLength(1);
    expect(types(history).filter((x: string) => x === "payment_hold")).toHaveLength(1);
  });

  it.each(PIECE_KINDS)("a new %s version needs its own approval and a new delivery approval", async (kind) => {
    const { t, deliveryId, versions } = await approvedDelivery([...PIECE_KINDS]);
    const next = await t.upload(deliveryId, kind);

    const invalid = (await t.get(`/deliveries/${deliveryId}`)).body;
    expect(invalid.status).toBe("in_production");
    expect(invalid.approval).toMatchObject({ valid: false, snapshot: versions });

    await t.approveVersion(next);
    const mid = (await t.get(`/deliveries/${deliveryId}`)).body;
    expect(mid.status).toBe("ready_for_approval");
    expect(mid.approval.valid).toBe(false);

    const again = await t.approveDelivery(deliveryId);
    expect(again.body.status).toBe("approved");
    expect(again.body.approval.snapshot).toEqual({ ...versions, [kind]: next });
  });

  it("a version of a piece the campaign does not require leaves the approval intact", async () => {
    const { t, deliveryId } = await approvedDelivery(["video"]);
    await t.upload(deliveryId, "script");
    await t.upload(deliveryId, "cover");

    const d = (await t.get(`/deliveries/${deliveryId}`)).body;
    expect(d.pieces.filter((p: { versions_count: number }) => p.versions_count === 1).map((p: { piece: string }) => p.piece)).toEqual(["script", "video", "cover"]);
    expect(d.status).toBe("approved");
    expect(d.payment.status).toBe("released");
    expect(types(d.history)).not.toContain("approval_invalidated");
  });

  it("a delivery that was never approved gets no invalidation event", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["cover"]);
    await t.upload(deliveryId, "cover");
    await t.upload(deliveryId, "cover");

    const d = (await t.get(`/deliveries/${deliveryId}`)).body;
    expect(d.payment.status).toBe("not_due");
    expect(types(d.history)).toEqual(["version_submitted", "version_submitted"]);
  });
});
