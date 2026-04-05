import { describe, expect, test } from "bun:test";
import { extractJson } from "./extract-json";

describe("extractJson", () => {
  test("clean JSON object", () => {
    expect(extractJson('{"score": 7}')).toEqual({ score: 7 });
  });

  test("markdown fenced JSON", () => {
    expect(extractJson('```json\n{"score": 7}\n```')).toEqual({ score: 7 });
  });

  test("thinking preamble before JSON", () => {
    expect(extractJson('<think>blah blah</think>\n{"score": 7}')).toEqual({
      score: 7,
    });
  });

  test("text before and after JSON", () => {
    const text =
      'Here is my evaluation:\n{"score": 7, "issues": []}\nHope this helps!';
    expect(extractJson(text)).toEqual({ score: 7, issues: [] });
  });

  test("nested braces", () => {
    expect(extractJson('{"data": {"inner": 1}}')).toEqual({
      data: { inner: 1 },
    });
  });

  test("no JSON at all returns null", () => {
    expect(extractJson("Just some text")).toBeNull();
  });

  test("partial/broken JSON returns null", () => {
    expect(extractJson('{"score": 7,')).toBeNull();
  });

  test("multiple JSON objects returns first valid one", () => {
    expect(extractJson('{"a": 1} and also {"b": 2}')).toEqual({ a: 1 });
  });

  test("JSON with newlines inside", () => {
    expect(extractJson('{\n  "score": 7\n}')).toEqual({ score: 7 });
  });

  test("markdown fence with language tag and surrounding whitespace", () => {
    const text = `
        \`\`\`json
        {
            "score": 7
        }
        \`\`\`
        `;
    expect(extractJson(text)).toEqual({ score: 7 });
  });

  test("markdown fence without language tag", () => {
    expect(extractJson('```\n{"score": 7}\n```')).toEqual({ score: 7 });
  });

  test("four-backtick fence variant", () => {
    expect(extractJson('````json\n{"score": 7}\n````')).toEqual({ score: 7 });
  });

  test("empty string returns null", () => {
    expect(extractJson("")).toBeNull();
  });

  test("JSON array", () => {
    expect(extractJson("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  test("JSON with special characters", () => {
    expect(extractJson('{"name": "John", "age": 30, "active": true}')).toEqual({
      name: "John",
      age: 30,
      active: true,
    });
  });

  test("JSON with unicode", () => {
    expect(extractJson('{"emoji": "😀", "text": "Hello 世界"}')).toEqual({
      emoji: "😀",
      text: "Hello 世界",
    });
  });

  test("JSON with mixed data types", () => {
    const text =
      '{"int": 42, "float": 3.14, "str": "hello", "bool": true, "null": null}';
    expect(extractJson(text)).toEqual({
      int: 42,
      float: 3.14,
      str: "hello",
      bool: true,
      null: null,
    });
  });

  test("markdown fence with extra content inside", () => {
    const text = '```json\nSome text\n{"score": 7}\nMore text\n```';
    expect(extractJson(text)).toEqual({ score: 7 });
  });

  test("nested JSON objects in array", () => {
    expect(extractJson('[{"a": 1}, {"b": 2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("JSON with escaped characters", () => {
    const text = '{"text": "Hello\\nWorld", "quote": "He said \\"Hi\\""}';
    expect(extractJson(text)).toEqual({
      text: "Hello\nWorld",
      quote: 'He said "Hi"',
    });
  });

  test("complex nested structure", () => {
    const text =
      '{"user": {"name": "John", "profile": {"age": 30, "city": "NYC"}}}';
    const result = extractJson(text);
    expect(result).toEqual({
      user: { name: "John", profile: { age: 30, city: "NYC" } },
    });
  });

  test("braces inside strings don't throw off depth counting", () => {
    // Braces inside the string should be ignored by the depth counter.
    const result = extractJson('{"text": "has } and ] inside", "ok": true}');
    expect(result).toEqual({
      text: "has } and ] inside",
      ok: true,
    });
  });
});
