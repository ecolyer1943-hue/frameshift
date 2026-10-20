import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestionFor, suggestionList } from "./suggest.ts";

describe("suggestionFor", () => {
  it("offers a full line when the prompt is empty", () => {
    assert.match(suggestionFor("recast", ""), /coat/i);
  });

  it("uses the selected performance when the field is empty", () => {
    assert.match(suggestionFor("recast", "  ", 0, "night"), /black coat/i);
  });

  it("continues a line the person has started", () => {
    const full = suggestionFor("animate", "");
    const rest = suggestionFor("animate", full.slice(0, 12));
    assert.equal(`${full.slice(0, 12)}${rest}`, full);
  });

  it("adds a beat for the selected performance", () => {
    const sample = "She walks two steps toward the camera, stops, and looks back over her shoulder. Wet night street, one blue neon sign, long black coat.";
    assert.match(suggestionFor("recast", sample, 0, "night"), /Rain stays on the coat/);
  });

  it("cycles to another ending", () => {
    const first = suggestionFor("prompt", "A quiet room.");
    const second = suggestionFor("prompt", "A quiet room.", 1);
    assert.notEqual(first, second);
    assert.ok(first.startsWith(" ") || first.length > 0);
  });

  it("puts the uploaded person first when the character changed", () => {
    const sample = "She walks two steps toward the camera, stops, and looks back over her shoulder. Wet night street, one blue neon sign, long black coat.";
    const line = suggestionFor("recast", sample, 0, "night", true);
    assert.match(line, /uploaded person/);
    assert.equal(line.includes("Rain stays"), false);
  });

  it("offers a different line for a performance that is not a preset", () => {
    const line = suggestionFor("recast", "A person waits in a subway car.", 0, null, true, true);
    assert.match(line, /uploaded person|new person|this performance/i);
    assert.equal(/black coat|red coat|ivory suit|linen/i.test(line), false);
  });

  it("lists every suggestion, not only the first", () => {
    const list = suggestionList("recast", "A quiet room.", null, true, true);
    assert.ok(list.length >= 8);
    assert.equal(new Set(list).size, list.length);
  });

  it("does not repeat an ending already on the line", () => {
    const first = suggestionFor("recast", "Hello.");
    const next = suggestionFor("recast", `Hello.${first}`);
    assert.notEqual(next, first);
    assert.equal(next.includes(first.trim()), false);
  });
});
