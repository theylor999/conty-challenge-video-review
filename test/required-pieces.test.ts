import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

describe("required pieces rule", () => {
  it("rejects approval with 422 listing a piece that was never sent and one awaiting review", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["video", "cover"]);
    await t.upload(deliveryId, "video");
    await t.upload(deliveryId, "video"); // video is now at version 2, pending

    const res = await t.approveDelivery(deliveryId);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("required_pieces_pending");
    expect(res.body.error.missing).toEqual([
      { piece: "video", code: "pending_review", reason: "versão 2 aguardando revisão" },
      { piece: "cover", code: "missing", reason: "sem versão enviada" },
    ]);
    expect((await t.get(`/deliveries/${deliveryId}`)).body.status).toBe("in_production");
  });

  it("reports changes_requested as a blocker", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["caption"]);
    const v = await t.upload(deliveryId, "caption");
    await t.call("POST", `/versions/${v}/request-changes`, { role: "brand", id: "brand_1" }, { note: "Sem hashtag" });

    const res = await t.approveDelivery(deliveryId);

    expect(res.status).toBe(422);
    expect(res.body.error.missing).toEqual([
      { piece: "caption", code: "changes_requested", reason: "versão 1 com alterações solicitadas" },
    ]);
  });

  it("does not let an approved video stand in for a missing required piece", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["video", "script"]);
    await t.uploadApproved(deliveryId, "video");

    const res = await t.approveDelivery(deliveryId);

    expect(res.status).toBe(422);
    expect(res.body.error.missing.map((m: { piece: string }) => m.piece)).toEqual(["script"]);
  });

  it("a pending piece the campaign did not ask for never blocks, and is marked not_required", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["video"]);
    await t.uploadApproved(deliveryId, "video");
    await t.upload(deliveryId, "cover"); // not required, left pending

    const status = (await t.get(`/deliveries/${deliveryId}`)).body;
    expect(status.status).toBe("ready_for_approval");
    expect(status.can_approve).toBe(true);
    expect(status.blockers).toEqual([]);
    const cover = status.pieces.find((p: { piece: string }) => p.piece === "cover");
    expect(cover).toMatchObject({ requirement: "not_required", required: false });
    expect(cover.current_version.status).toBe("pending_review");

    expect((await t.approveDelivery(deliveryId)).status).toBe(200);
  });

  it("video-only campaign approves without a script", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["video"]);
    await t.uploadApproved(deliveryId, "video");

    const res = await t.approveDelivery(deliveryId);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.pieces.find((p: { piece: string }) => p.piece === "script").current_version).toBeNull();
  });

  it("reads the requirement from campaign data: same code path, different campaigns", async () => {
    const t = setup();
    const a = await t.start(["video"]);
    const b = await t.campaign(["video", "script", "cover", "caption"]);
    const bDelivery = await t.delivery(b);
    await t.uploadApproved(a.deliveryId, "video");
    await t.uploadApproved(bDelivery, "video");

    expect((await t.approveDelivery(a.deliveryId)).status).toBe(200);
    const res = await t.approveDelivery(bDelivery);
    expect(res.status).toBe(422);
    expect(res.body.error.missing.map((m: { piece: string }) => m.piece)).toEqual(["script", "cover", "caption"]);
  });

  it("exposes blockers and can_approve before the approval attempt", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["video", "cover"]);
    await t.uploadApproved(deliveryId, "video");

    const status = (await t.get(`/deliveries/${deliveryId}`)).body;
    expect(status.can_approve).toBe(false);
    expect(status.blockers).toEqual([{ piece: "cover", code: "missing", reason: "sem versão enviada" }]);
  });

  it("is ready_for_approval once every required piece is approved, and approves", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["video", "cover"]);
    await t.uploadApproved(deliveryId, "video");
    await t.uploadApproved(deliveryId, "cover");

    expect((await t.get(`/deliveries/${deliveryId}`)).body.status).toBe("ready_for_approval");
    const res = await t.approveDelivery(deliveryId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.payment.status).toBe("released");
  });

  it("refuses to approve twice", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["cover"]);
    await t.uploadApproved(deliveryId, "cover");
    await t.approveDelivery(deliveryId);

    const res = await t.approveDelivery(deliveryId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("delivery_already_approved");
    const history = (await t.get(`/deliveries/${deliveryId}`)).body.history;
    expect(history.filter((e: { type: string }) => e.type === "payment_released")).toHaveLength(1);
  });

  it("rejects campaigns with no, unknown or repeated required pieces", async () => {
    const t = setup();
    for (const required_pieces of [[], ["thumbnail"], ["video", "video"], "video"]) {
      const res = await t.call("POST", "/campaigns", { role: "brand", id: "brand_1" }, { name: "X", required_pieces });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("validation_failed");
    }
  });
});
