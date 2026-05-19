import { describe, it, expect } from "vitest";
import {
  validateQuestionnaireSchema,
  validateAnswers,
  pruneUnknownAnswerKeys,
  MAX_QUESTIONNAIRE_QUESTIONS,
  MAX_QUESTIONNAIRE_OPTIONS_PER_QUESTION,
  MAX_QUESTIONNAIRE_TEXT_ANSWER_LENGTH,
  type QuestionnaireSchema,
} from "../questionnaires.js";

const baseSchema = (): QuestionnaireSchema => ({
  version: 1,
  questions: [
    { id: "q_text", type: "text", title: "Tell us", required: true, multiline: false },
    {
      id: "q_single",
      type: "single_choice",
      title: "Pick one",
      required: true,
      options: [
        { id: "a", label: "Apple" },
        { id: "b", label: "Banana" },
      ],
    },
    {
      id: "q_multi",
      type: "multi_choice",
      title: "Pick any",
      required: false,
      options: [
        { id: "x", label: "X" },
        { id: "y", label: "Y" },
        { id: "z", label: "Z" },
      ],
    },
    { id: "q_rate", type: "rating", title: "Rate us", required: false, scale: 5 },
    { id: "q_nps", type: "nps", title: "Recommend?", required: false },
  ],
});

describe("validateQuestionnaireSchema", () => {
  it("accepts a well-formed schema with every question type", () => {
    const result = validateQuestionnaireSchema(baseSchema());
    expect(result.ok).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(validateQuestionnaireSchema(null).ok).toBe(false);
    expect(validateQuestionnaireSchema("nope").ok).toBe(false);
    expect(validateQuestionnaireSchema([]).ok).toBe(false);
  });

  it("rejects version != 1", () => {
    const r = validateQuestionnaireSchema({ version: 2, questions: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects empty questions array", () => {
    const r = validateQuestionnaireSchema({ version: 1, questions: [] });
    expect(r.ok).toBe(false);
  });

  it("enforces the question count cap", () => {
    const tooMany = {
      version: 1,
      questions: Array.from({ length: MAX_QUESTIONNAIRE_QUESTIONS + 1 }, (_, i) => ({
        id: `q${i}`,
        type: "text",
        title: "T",
        required: false,
      })),
    };
    const r = validateQuestionnaireSchema(tooMany);
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate question ids", () => {
    const r = validateQuestionnaireSchema({
      version: 1,
      questions: [
        { id: "q1", type: "text", title: "A", required: false },
        { id: "q1", type: "text", title: "B", required: false },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duplicate/);
  });

  it("rejects malformed ids (uppercase, hyphens)", () => {
    const r1 = validateQuestionnaireSchema({
      version: 1,
      questions: [{ id: "Q1", type: "text", title: "T", required: false }],
    });
    expect(r1.ok).toBe(false);
    const r2 = validateQuestionnaireSchema({
      version: 1,
      questions: [{ id: "q-1", type: "text", title: "T", required: false }],
    });
    expect(r2.ok).toBe(false);
  });

  it("rejects unknown question type", () => {
    const r = validateQuestionnaireSchema({
      version: 1,
      questions: [{ id: "q1", type: "ranking", title: "T", required: false }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects blank title", () => {
    const r = validateQuestionnaireSchema({
      version: 1,
      questions: [{ id: "q1", type: "text", title: "  ", required: false }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects rating with scale != 5", () => {
    const r = validateQuestionnaireSchema({
      version: 1,
      questions: [{ id: "q1", type: "rating", title: "Rate", required: false, scale: 10 }],
    });
    expect(r.ok).toBe(false);
  });

  it("requires options on single_choice with at least 2 entries", () => {
    const r = validateQuestionnaireSchema({
      version: 1,
      questions: [
        {
          id: "q1",
          type: "single_choice",
          title: "T",
          required: false,
          options: [{ id: "a", label: "A" }],
        },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("caps choice options", () => {
    const tooMany = Array.from({ length: MAX_QUESTIONNAIRE_OPTIONS_PER_QUESTION + 1 }, (_, i) => ({
      id: `o${i}`,
      label: `O${i}`,
    }));
    const r = validateQuestionnaireSchema({
      version: 1,
      questions: [
        { id: "q1", type: "single_choice", title: "T", required: false, options: tooMany },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate option ids", () => {
    const r = validateQuestionnaireSchema({
      version: 1,
      questions: [
        {
          id: "q1",
          type: "multi_choice",
          title: "T",
          required: false,
          options: [
            { id: "a", label: "A" },
            { id: "a", label: "A again" },
          ],
        },
      ],
    });
    expect(r.ok).toBe(false);
  });
});

describe("validateAnswers", () => {
  it("accepts a complete answer set", () => {
    const r = validateAnswers(baseSchema(), {
      q_text: "Hello",
      q_single: "a",
      q_multi: ["x", "z"],
      q_rate: 4,
      q_nps: 9,
    });
    expect(r.ok).toBe(true);
  });

  it("permits omitting optional questions", () => {
    const r = validateAnswers(baseSchema(), {
      q_text: "Hello",
      q_single: "a",
    });
    expect(r.ok).toBe(true);
  });

  it("rejects missing required questions", () => {
    const r = validateAnswers(baseSchema(), { q_text: "Hello" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/q_single/);
  });

  it("treats empty strings as missing for required questions", () => {
    const r = validateAnswers(baseSchema(), { q_text: "   ", q_single: "a" });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown question ids", () => {
    const r = validateAnswers(baseSchema(), {
      q_text: "Hi",
      q_single: "a",
      stray: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/stray/);
  });

  it("rejects out-of-range rating", () => {
    const r = validateAnswers(baseSchema(), {
      q_text: "Hi",
      q_single: "a",
      q_rate: 7,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects out-of-range NPS", () => {
    const r = validateAnswers(baseSchema(), {
      q_text: "Hi",
      q_single: "a",
      q_nps: 11,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects non-integer rating", () => {
    const r = validateAnswers(baseSchema(), {
      q_text: "Hi",
      q_single: "a",
      q_rate: 3.5,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid single_choice option", () => {
    const r = validateAnswers(baseSchema(), { q_text: "Hi", q_single: "missing" });
    expect(r.ok).toBe(false);
  });

  it("rejects invalid multi_choice entry", () => {
    const r = validateAnswers(baseSchema(), {
      q_text: "Hi",
      q_single: "a",
      q_multi: ["x", "missing"],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate multi_choice selections", () => {
    const r = validateAnswers(baseSchema(), {
      q_text: "Hi",
      q_single: "a",
      q_multi: ["x", "x"],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects oversize text answer", () => {
    const big = "a".repeat(MAX_QUESTIONNAIRE_TEXT_ANSWER_LENGTH + 1);
    const r = validateAnswers(baseSchema(), { q_text: big, q_single: "a" });
    expect(r.ok).toBe(false);
  });

  it("normalizes — empty arrays count as missing for optional", () => {
    const r = validateAnswers(baseSchema(), {
      q_text: "Hi",
      q_single: "a",
      q_multi: [],
    });
    expect(r.ok).toBe(true);
  });
});

describe("validateAnswers — partial mode", () => {
  it("accepts a subset of questions when allowPartial=true", () => {
    const r = validateAnswers(baseSchema(), { q_text: "Hello" }, { allowPartial: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ q_text: "Hello" });
  });

  it("accepts an empty answer set when allowPartial=true", () => {
    const r = validateAnswers(baseSchema(), {}, { allowPartial: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it("still type-checks present answers when allowPartial=true", () => {
    const r = validateAnswers(
      baseSchema(),
      { q_single: "not_an_option" },
      { allowPartial: true }
    );
    expect(r.ok).toBe(false);
  });

  it("still rejects out-of-range rating when allowPartial=true", () => {
    const r = validateAnswers(baseSchema(), { q_rate: 9 }, { allowPartial: true });
    expect(r.ok).toBe(false);
  });

  it("still rejects unknown question ids when allowPartial=true", () => {
    const r = validateAnswers(baseSchema(), { stray: "x" }, { allowPartial: true });
    expect(r.ok).toBe(false);
  });
});

describe("pruneUnknownAnswerKeys", () => {
  it("removes keys whose question id is no longer in the schema", () => {
    const schema: QuestionnaireSchema = {
      version: 1,
      questions: [{ id: "q_kept", type: "text", title: "T", required: false }],
    };
    const out = pruneUnknownAnswerKeys(schema, { q_kept: "yes", q_removed: "gone", other: 5 });
    expect(out).toEqual({ q_kept: "yes" });
  });

  it("returns an empty object when nothing matches the schema", () => {
    const schema: QuestionnaireSchema = {
      version: 1,
      questions: [{ id: "q_a", type: "text", title: "T", required: false }],
    };
    const out = pruneUnknownAnswerKeys(schema, { q_b: "x", q_c: 1 });
    expect(out).toEqual({});
  });

  it("does not mutate the input", () => {
    const schema: QuestionnaireSchema = {
      version: 1,
      questions: [{ id: "q_a", type: "text", title: "T", required: false }],
    };
    const input = { q_a: "keep", q_b: "drop" };
    pruneUnknownAnswerKeys(schema, input);
    expect(input).toEqual({ q_a: "keep", q_b: "drop" });
  });
});
