import { describe, expect, it } from "vitest";
import { BRAND, CREATOR, OTHER_BRAND, OTHER_CREATOR, setup } from "./helpers.ts";

async function videoDelivery() {
  const t = setup();
  const { deliveryId } = await t.start(["video", "script"]);
  const v1 = await t.upload(deliveryId, "video"); // 30s
  return { t, deliveryId, v1 };
}

describe("comments pinned to a second", () => {
  it("is visible in the version where it was made", async () => {
    const { t, v1 } = await videoDelivery();
    const res = await t.call("POST", `/versions/${v1}/comments`, BRAND, { at_second: 12.5, body: "Corta aqui" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ at_second: 12.5, body: "Corta aqui", author: "brand_1", version_id: v1 });

    const version = (await t.get(`/versions/${v1}`)).body;
    expect(version.comments).toHaveLength(1);
    expect(version.comments[0]).toMatchObject({ at_second: 12.5, body: "Corta aqui" });
  });

  it("does not migrate to the new version", async () => {
    const { t, deliveryId, v1 } = await videoDelivery();
    await t.call("POST", `/versions/${v1}/comments`, BRAND, { at_second: 3, body: "Logo muito pequeno" });
    await t.call("POST", `/versions/${v1}/comments`, BRAND, { at_second: 20, body: "Áudio baixo" });
    const v2 = await t.upload(deliveryId, "video");

    const second = (await t.get(`/versions/${v2}`)).body;
    expect(second.comments).toEqual([]);
    expect(second.previous_versions_comments_count).toBe(2);
    // the old version keeps its comments
    const first = (await t.get(`/versions/${v1}`)).body;
    expect(first.comments.map((c: { body: string }) => c.body)).toEqual(["Logo muito pequeno", "Áudio baixo"]);
    expect(first.previous_versions_comments_count).toBe(0);
  });

  it("lists comments in timeline order, ties by creation", async () => {
    const { t, v1 } = await videoDelivery();
    for (const [at, body] of [[20, "c"], [5, "a"], [5, "b"], [0, "start"]] as const) {
      await t.call("POST", `/versions/${v1}/comments`, BRAND, { at_second: at, body });
    }
    const bodies = (await t.get(`/versions/${v1}`)).body.comments.map((c: { body: string }) => c.body);
    expect(bodies).toEqual(["start", "a", "b", "c"]);
  });

  it("accepts the boundaries 0 and the exact duration", async () => {
    const { t, v1 } = await videoDelivery();
    expect((await t.call("POST", `/versions/${v1}/comments`, BRAND, { at_second: 0, body: "início" })).status).toBe(201);
    expect((await t.call("POST", `/versions/${v1}/comments`, BRAND, { at_second: 30, body: "fim" })).status).toBe(201);
  });

  it("rejects a second beyond the duration, negative, missing or not a number", async () => {
    const { t, v1 } = await videoDelivery();
    for (const at_second of [30.001, 31, -1, undefined, null, "10", Number.MAX_SAFE_INTEGER]) {
      const res = await t.call("POST", `/versions/${v1}/comments`, BRAND, { at_second, body: "x" });
      expect(res.status).toBe(422);
      expect(res.body.error.fields[0].field).toBe("at_second");
    }
    expect((await t.get(`/versions/${v1}`)).body.comments).toEqual([]);
  });

  it("the duration limit is the one of the version being commented", async () => {
    const { t, deliveryId, v1 } = await videoDelivery();
    const v2 = await t.upload(deliveryId, "video", { url: "https://cdn.example.com/long.mp4", duration_seconds: 90 });
    expect((await t.call("POST", `/versions/${v2}/comments`, BRAND, { at_second: 60, body: "ok" })).status).toBe(201);
    expect((await t.call("POST", `/versions/${v1}/comments`, BRAND, { at_second: 60, body: "x" })).status).toBe(409);
  });

  it("allows a plain comment on text pieces and rejects a second there", async () => {
    const { t, deliveryId } = await videoDelivery();
    const script = await t.upload(deliveryId, "script");

    const ok = await t.call("POST", `/versions/${script}/comments`, BRAND, { body: "Trocar o gancho" });
    expect(ok.status).toBe(201);
    expect(ok.body.at_second).toBeNull();
    const bad = await t.call("POST", `/versions/${script}/comments`, BRAND, { at_second: 3, body: "x" });
    expect(bad.status).toBe(422);
  });

  it("does not accept comments on a replaced version", async () => {
    const { t, deliveryId, v1 } = await videoDelivery();
    await t.upload(deliveryId, "video");
    const res = await t.call("POST", `/versions/${v1}/comments`, BRAND, { at_second: 1, body: "tarde demais" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("version_not_current");
  });

  it("only the campaign brand and the delivery creator can comment", async () => {
    const { t, v1 } = await videoDelivery();
    expect((await t.call("POST", `/versions/${v1}/comments`, CREATOR, { at_second: 1, body: "ajustado" })).status).toBe(201);
    expect((await t.call("POST", `/versions/${v1}/comments`, OTHER_BRAND, { at_second: 1, body: "x" })).status).toBe(403);
    expect((await t.call("POST", `/versions/${v1}/comments`, OTHER_CREATOR, { at_second: 1, body: "x" })).status).toBe(403);
    expect((await t.call("POST", `/versions/${v1}/comments`, undefined, { at_second: 1, body: "x" })).status).toBe(401);
  });

  it("rejects empty bodies", async () => {
    const { t, v1 } = await videoDelivery();
    expect((await t.call("POST", `/versions/${v1}/comments`, BRAND, { at_second: 1, body: "  " })).status).toBe(422);
  });
});
