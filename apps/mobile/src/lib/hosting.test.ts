import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOUD_PRIVACY_URL,
  CLOUD_SERVER_URL,
  CLOUD_TERMS_URL,
  CLOUD_WEBSITE_URL,
  DEFAULT_SERVER_URL,
  hostingDisplayName,
  hostingModeOf,
  isCloudServerUrl,
  isSelfHostDestination,
  resolvePersistedServerUrl,
  telemetryHosting,
} from "./hosting.ts";

test("new installs default to ordo Cloud", () => {
  assert.equal(DEFAULT_SERVER_URL, "https://api.ordo.axolet.com");
  assert.equal(CLOUD_SERVER_URL, DEFAULT_SERVER_URL);
});

test("cloud legal pages live on the public site", () => {
  assert.equal(CLOUD_WEBSITE_URL, "https://ordo.axolet.com");
  assert.equal(CLOUD_TERMS_URL, "https://ordo.axolet.com/terms");
  assert.equal(CLOUD_PRIVACY_URL, "https://ordo.axolet.com/privacy");
});

test("cloud URL matching ignores trailing slashes and paths", () => {
  assert.equal(isCloudServerUrl(CLOUD_SERVER_URL), true);
  assert.equal(isCloudServerUrl("https://api.ordo.axolet.com/"), true);
  assert.equal(isCloudServerUrl("https://api.ordo.axolet.com/api"), true);
  assert.equal(isCloudServerUrl("http://api.ordo.axolet.com"), true);
  assert.equal(isCloudServerUrl("http://localhost:3000"), false);
  assert.equal(isCloudServerUrl(""), false);
  assert.equal(isCloudServerUrl(null), false);
});

test("hosting mode and display name follow the origin", () => {
  assert.equal(hostingModeOf(CLOUD_SERVER_URL), "cloud");
  assert.equal(hostingModeOf("http://localhost:3000"), "selfHosted");
  assert.equal(hostingDisplayName(CLOUD_SERVER_URL), "ordo Cloud");
  assert.equal(hostingDisplayName("https://ordo.example"), "Your server");
  assert.equal(telemetryHosting(CLOUD_SERVER_URL), "cloud");
  assert.equal(telemetryHosting("http://localhost:3000"), "selfhosted");
});

test("saved self-host URLs are kept; Cloud HTTP is upgraded", () => {
  assert.equal(resolvePersistedServerUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(
    resolvePersistedServerUrl(" https://ordo.example "),
    "https://ordo.example",
  );
  assert.equal(resolvePersistedServerUrl("http://api.ordo.axolet.com"), CLOUD_SERVER_URL);
  assert.equal(resolvePersistedServerUrl(""), CLOUD_SERVER_URL);
  assert.equal(resolvePersistedServerUrl("   "), CLOUD_SERVER_URL);
  assert.equal(resolvePersistedServerUrl(undefined), CLOUD_SERVER_URL);
  assert.equal(resolvePersistedServerUrl(null), CLOUD_SERVER_URL);
});

test("cloud is not a self-host destination", () => {
  assert.equal(isSelfHostDestination(CLOUD_SERVER_URL), false);
  assert.equal(isSelfHostDestination("http://api.ordo.axolet.com"), false);
  assert.equal(isSelfHostDestination("https://ordo.example"), true);
  assert.equal(isSelfHostDestination("not a url"), false);
});
