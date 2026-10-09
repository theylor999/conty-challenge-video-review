import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

describe("piece versions", () => {
  it("a new version replaces the previous as current, and the old one stays retrievable", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["cover"]);
    const v1 = await t.upload(deliveryId, "cover", { url: "https://cdn.example.com/a.png" });
    const v2 = await t.upload(deliveryId, "cover", { url: "https://cdn.example.com/b.png" });

    const delivery = (await t.get(`/deliveries/${deliveryId}`)).body;
    const cover = delivery.pieces.find((p: { piece: string }) => p.piece === "cover");
    expect(cover.current_version).toMatchObject({ id: v2, version: 2, status: "pending_review" });
    expect(cover.versions_count).toBe(2);

    const old = (await t.get(`/versions/${v1}`)).body;
    expect(old).toMatchObject({ id: v1, version: 1, is_current: false, content: { url: "https://cdn.example.com/a.png" } });
    expect((await t.get(`/versions/${v2}`)).body.is_current).toBe(true);
  });

  it("an approved version does not carry over: the new version starts pending", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["cover"]);
    const v1 = await t.uploadApproved(deliveryId, "cover");
    const v2 = await t.upload(deliveryId, "cover");

    expect((await t.get(`/versions/${v1}`)).body.status).toBe("approved");
    expect((await t.get(`/versions/${v2}`)).body.status).toBe("pending_review");
    const res = await t.approveDelivery(deliveryId);
    expect(res.status).toBe(422);
    expect(res.body.error.missing).toEqual([
      { piece: "cover", code: "pending_review", reason: "versão 2 aguardando revisão" },
    ]);
  });

  it("numbers versions per piece, not per delivery", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["cover", "video"]);
    await t.upload(deliveryId, "cover");
    await t.upload(deliveryId, "cover");
    const video = await t.upload(deliveryId, "video");

    expect((await t.get(`/versions/${video}`)).body.version).toBe(1);
  });

  it("reviewing an old version returns 409 and changes nothing", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["cover"]);
    const v1 = await t.upload(deliveryId, "cover");
    const v2 = await t.upload(deliveryId, "cover");

    const res = await t.approveVersion(v1);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "version_not_current", current_version_id: v2, current_version: 2 });
    const stale = await t.call("POST", `/versions/${v1}/request-changes`, { role: "brand", id: "brand_1" }, {});
    expect(stale.status).toBe(409);
    expect((await t.get(`/versions/${v1}`)).body.status).toBe("pending_review");
  });

  it("a version can be reviewed only once", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["cover"]);
    const v1 = await t.uploadApproved(deliveryId, "cover");

    const res = await t.approveVersion(v1);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("version_already_reviewed");
  });

  it("request-changes stores the note, with or without a body", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["script"]);
    const v1 = await t.upload(deliveryId, "script");
    const r1 = await t.call("POST", `/versions/${v1}/request-changes`, { role: "brand", id: "brand_1" }, { note: "Falta o CTA" });
    expect(r1.body).toMatchObject({ status: "changes_requested", review_note: "Falta o CTA", reviewed_by: "brand_1" });

    const v2 = await t.upload(deliveryId, "script");
    const r2 = await t.call("POST", `/versions/${v2}/request-changes`, { role: "brand", id: "brand_1" });
    expect(r2.body).toMatchObject({ status: "changes_requested", review_note: null });
  });

  it("validates content per piece kind", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["video"]);
    const post = (kind: string, body: unknown) =>
      t.call("POST", `/deliveries/${deliveryId}/pieces/${kind}/versions`, { role: "creator", id: "creator_1" }, body);

    expect((await post("video", { url: "https://x.example/v.mp4" })).status).toBe(422); // no duration
    expect((await post("video", { url: "https://x.example/v.mp4", duration_seconds: 0 })).status).toBe(422);
    expect((await post("video", { url: "ftp://x.example/v.mp4", duration_seconds: 10 })).status).toBe(422);
    expect((await post("cover", { url: "https://x.example/c.png", duration_seconds: 5 })).status).toBe(422);
    expect((await post("script", { text: "   " })).status).toBe(422);
    expect((await post("caption", { url: "https://x.example" })).status).toBe(422);
    expect((await post("thumbnail", { url: "https://x.example" })).status).toBe(404);
    expect((await post("script", "not json")).status).toBe(400);
    expect((await t.get(`/deliveries/${deliveryId}`)).body.pieces.every((p: { versions_count: number }) => p.versions_count === 0)).toBe(true);
  });
});
