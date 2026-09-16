import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOUD_SERVER_URL,
  DEFAULT_SERVER_URL,
  SELF_HOST_CONFIRMATION,
  canAcknowledgeSelfHost,
  hostingDisplayName,
  hostingModeOf,
  isCloudServerUrl,
  isSelfHostDestination,
  resolvePersistedServerUrl,
} from "./hosting.ts";

test("new installs default to ordo Cloud", () => {
  assert.equal(DEFAULT_SERVER_URL, "https://api.ordo.axolet.com");
  assert.equal(CLOUD_SERVER_URL, DEFAULT_SERVER_URL);
});

test("cloud URL matching ignores trailing slashes and paths", () => {
  assert.equal(isCloudServerUrl(CLOUD_SERVER_URL), true);
  assert.equal(isCloudServerUrl("https://api.ordo.axolet.com/"), true);
  assert.equal(isCloudServerUrl("https://api.ordo.axolet.com/api"), true);
  assert.equal(isCloudServerUrl("http://api.ordo.axolet.com"), false);
  assert.equal(isCloudServerUrl("http://localhost:3000"), false);
  assert.equal(isCloudServerUrl(""), false);
  assert.equal(isCloudServerUrl(null), false);
});

test("hosting mode and display name follow the origin", () => {
  assert.equal(hostingModeOf(CLOUD_SERVER_URL), "cloud");
  assert.equal(hostingModeOf("http://localhost:3000"), "selfHosted");
  assert.equal(hostingDisplayName(CLOUD_SERVER_URL), "ordo Cloud");
  assert.equal(hostingDisplayName("https://ordo.example"), "Your server");
});

test("saved server URLs are left alone", () => {
  assert.equal(resolvePersistedServerUrl("http://localhost:3000"), "http://localhost:3000");
  assert.equal(
    resolvePersistedServerUrl(" https://ordo.example "),
    "https://ordo.example",
  );
  assert.equal(resolvePersistedServerUrl(""), CLOUD_SERVER_URL);
  assert.equal(resolvePersistedServerUrl("   "), CLOUD_SERVER_URL);
  assert.equal(resolvePersistedServerUrl(undefined), CLOUD_SERVER_URL);
  assert.equal(resolvePersistedServerUrl(null), CLOUD_SERVER_URL);
});

test("self-host acknowledgement needs both checks and the exact phrase", () => {
  const valid = {
    acceptedResponsibility: true,
    acceptedLimitations: true,
    confirmation: SELF_HOST_CONFIRMATION,
  };
  assert.equal(canAcknowledgeSelfHost(valid), true);
  assert.equal(canAcknowledgeSelfHost({ ...valid, confirmation: " I understand " }), true);
  assert.equal(canAcknowledgeSelfHost({ ...valid, confirmation: "i understand" }), false);
  assert.equal(canAcknowledgeSelfHost({ ...valid, acceptedResponsibility: false }), false);
  assert.equal(canAcknowledgeSelfHost({ ...valid, acceptedLimitations: false }), false);
  assert.equal(canAcknowledgeSelfHost({ ...valid, confirmation: "self-host" }), false);
});

test("cloud is not a self-host destination", () => {
  assert.equal(isSelfHostDestination(CLOUD_SERVER_URL), false);
  assert.equal(isSelfHostDestination("https://ordo.example"), true);
  assert.equal(isSelfHostDestination("not a url"), false);
});
