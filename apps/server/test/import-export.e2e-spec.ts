import request from "supertest";
import { createTestApp, registerUser, teardownApp, type TestCtx } from "./utils.js";

const ORDO_JSON = JSON.stringify({
  format: "ordo-export",
  version: 1,
  exportedAt: "2026-08-30T00:00:00.000Z",
  folders: [],
  bookmarks: [{ url: "https://example.com/imported", title: "Imported" }],
});

describe("Import upload (e2e)", () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    if (ctx) await teardownApp(ctx);
  });

  it("accepts a JSON body from mobile instead of multipart", async () => {
    const auth = await registerUser(ctx.app, "json-import@ordo.app");
    const agent = request.agent(ctx.app.getHttpServer()).auth(auth.tokens.accessToken, {
      type: "bearer",
    });

    const uploaded = await agent
      .post("/api/import-export/import")
      .set("x-client-type", "mobile")
      .send({ filename: "ordo-export.json", text: ORDO_JSON })
      .expect(201);

    expect(uploaded.body.jobId).toEqual(expect.any(String));

    const job = await agent
      .get(`/api/import-export/import/${uploaded.body.jobId}`)
      .set("x-client-type", "mobile")
      .expect(200);
    expect(["parsing", "ready"]).toContain(job.body.status);
  });

  it("still accepts a multipart file", async () => {
    const auth = await registerUser(ctx.app, "multipart-import@ordo.app");
    const agent = request.agent(ctx.app.getHttpServer()).auth(auth.tokens.accessToken, {
      type: "bearer",
    });

    const uploaded = await agent
      .post("/api/import-export/import")
      .set("x-client-type", "mobile")
      .attach("file", Buffer.from(ORDO_JSON), {
        filename: "ordo-export.json",
        contentType: "application/json",
      })
      .expect(201);

    expect(uploaded.body.jobId).toEqual(expect.any(String));
  });
});
