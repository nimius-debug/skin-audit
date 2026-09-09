import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [form, client, worker, schema, migration] = await Promise.all([
  readFile(new URL("../public/form.html", import.meta.url), "utf8"),
  readFile(new URL("../public/form.js", import.meta.url), "utf8"),
  readFile(new URL("../worker/index.js", import.meta.url), "utf8"),
  readFile(new URL("../schema.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0002_expanded_intake.sql", import.meta.url), "utf8")
]);

test("the intake is split into approachable steps", () => {
  assert.equal((form.match(/data-step data-step-name=/g) || []).length, 10);
  assert.match(form, /data-step-name="Your products"/);
  assert.match(form, /data-step-name="Medications & actives"/);
  assert.match(form, /data-step-name="Health & lifestyle"/);
  assert.match(form, /data-step-name="Hormonal considerations"/);
});

test("product, medication, health, and lifestyle answers are captured", () => {
  for (const name of [
    "product_cleanser", "product_bar_soap", "product_exfoliant", "product_toner",
    "product_serums", "product_moisturizers", "product_sunscreen", "product_eye",
    "product_lip", "allergies", "medications", "active_use", "active_details",
    "acne_medication_use", "acne_medication_details", "health_conditions",
    "health_details", "supplements", "smoking_status", "high_caffeine",
    "birth_control", "birth_control_type", "pregnancy_status"
  ]) {
    assert.match(form, new RegExp(`name="${name}"`), `missing ${name}`);
  }
  assert.match(client, /data-exclusive-choice/);
  assert.match(client, /data-required-when-visible/);
});

test("the consent is specific to a routine PDF and separates marketing photos", () => {
  assert.doesNotMatch(form, /Alchemy Skin|Chemical Peels|Hydrofacials|Microneedling/i);
  assert.match(form, /not medical care, does not diagnose or treat disease/i);
  assert.match(form, /results vary and no specific result is guaranteed/i);
  assert.match(form, /name="photo_marketing_consent"/);
  assert.doesNotMatch(form, /name="photo_marketing_consent" required/);
  assert.match(form, /name="signature_name"[^>]*required/);
});

test("the worker persists and exports the versioned intake", () => {
  assert.match(worker, /const CONSENT_VERSION = "2026-09-09"/);
  assert.match(worker, /JSON\.stringify\(intake\)/);
  assert.match(worker, /Optional marketing photo permission/);
  assert.match(worker, /Marketing photo permission/);
  for (const column of [
    "intake_details", "service_acknowledgment", "photo_marketing_consent",
    "signature_name", "consent_version", "consented_at"
  ]) {
    assert.match(schema, new RegExp(column));
    assert.match(migration, new RegExp(column));
  }
});

