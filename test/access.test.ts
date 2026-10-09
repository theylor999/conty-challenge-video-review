import { describe, expect, it } from "vitest";
import { BRAND, CREATOR, OTHER_BRAND, OTHER_CREATOR, setup } from "./helpers.ts";

describe("actors and ownership", () => {
  it("requires the actor headers", async () => {
    const t = setup();
    const res = await t.call("POST", "/campaigns", undefined, { name: "X", required_pieces: ["video"] });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("actor_required");
  });

  it("creators cannot approve versions or deliveries, nor create campaigns", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["cover"]);
    const v = await t.upload(deliveryId, "cover");

    expect((await t.call("POST", `/versions/${v}/approve`, CREATOR)).status).toBe(403);
    expect((await t.call("POST", `/versions/${v}/request-changes`, CREATOR, {})).status).toBe(403);
    expect((await t.call("POST", `/deliveries/${deliveryId}/approve`, CREATOR)).status).toBe(403);
    expect((await t.call("POST", "/campaigns", CREATOR, { name: "X", required_pieces: ["video"] })).status).toBe(403);
    expect((await t.get(`/versions/${v}`)).body.status).toBe("pending_review");
  });

  it("another brand cannot review a campaign it does not own", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["cover"]);
    const v = await t.upload(deliveryId, "cover");

    expect((await t.call("POST", `/versions/${v}/approve`, OTHER_BRAND)).body.error.code).toBe("not_campaign_brand");
    expect((await t.approveDelivery(deliveryId, OTHER_BRAND)).status).toBe(403);
  });

  it("only the delivery creator uploads versions", async () => {
    const t = setup();
    const { deliveryId } = await t.start(["cover"]);
    const url = `/deliveries/${deliveryId}/pieces/cover/versions`;
    const body = { url: "https://cdn.example.com/c.png" };

    expect((await t.call("POST", url, BRAND, body)).status).toBe(403);
    expect((await t.call("POST", url, OTHER_CREATOR, body)).status).toBe(403);
    expect((await t.call("POST", url, CREATOR, body)).status).toBe(201);
  });

  it("one delivery per creator per campaign", async () => {
    const t = setup();
    const { campaignId, deliveryId } = await t.start(["cover"]);
    const dup = await t.call("POST", "/deliveries", CREATOR, { campaign_id: campaignId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.delivery_id).toBe(deliveryId);
    expect((await t.call("POST", "/deliveries", OTHER_CREATOR, { campaign_id: campaignId })).status).toBe(201);
  });

  it("returns 404 for unknown resources", async () => {
    const t = setup();
    expect((await t.get("/deliveries/nope")).body.error.code).toBe("delivery_not_found");
    expect((await t.get("/versions/nope")).body.error.code).toBe("version_not_found");
    expect((await t.call("POST", "/deliveries", CREATOR, { campaign_id: "nope" })).body.error.code).toBe("campaign_not_found");
    expect((await t.get("/nowhere")).status).toBe(404);
  });
});
