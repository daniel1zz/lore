/**
 * Language of the questions `lore pending --ask` writes (BR-1374).
 *
 * Purpose: one table of lore's own sentences per question language; ids, hashes, class names and stored text stay as they are.
 * Public surface: ASK_LANGUAGES, AskLanguage, parseAskLanguage, ASK_TEXT, AskText.
 * Invariants:
 *   - Every language carries the same keys (the table is typed `Record<AskLanguage, AskText>`).
 *   - The recommendation marker (leading space included where the language uses one) is the last part of an option label; harness-ask.ts strips it when reading the answer.
 * Side-effect class: pure.
 */
import type { LoreError, Result } from "@lore/core";
import { err, ok, validationError } from "@lore/core";

export const ASK_LANGUAGES = ["en", "zh"] as const;
export type AskLanguage = (typeof ASK_LANGUAGES)[number];

/** Parses `--lang`; absent means English. */
export function parseAskLanguage(raw: unknown): Result<AskLanguage, LoreError> {
  if (raw === undefined) return ok("en");
  const found = ASK_LANGUAGES.find((l) => l === raw);
  return found === undefined ? err(validationError("lang", `expected one of ${ASK_LANGUAGES.join("|")}, got ${JSON.stringify(raw)}`)) : ok(found);
}

export interface AskText {
  readonly acceptLabel: string;
  readonly rejectLabel: string;
  readonly recommendedMarker: string;
  readonly acceptDescription: string;
  readonly rejectDescription: string;
  /** Third option of a review-round-cap question (BR-1531): its direction is typed as the Other answer. */
  readonly directLabel: string;
  readonly directDescription: string;
  readonly question: string;
  readonly what: string;
  readonly before: string;
  readonly after: string;
  readonly ifAccept: string;
  readonly ifReject: string;
  readonly facts: (f: { class: string; subject: string; version: string; score: number; factors: string }) => string;
  readonly measured: (answer: string, reason: string) => string;
}

export const ASK_TEXT: Record<AskLanguage, AskText> = {
  en: {
    acceptLabel: "Accept",
    rejectLabel: "Reject",
    recommendedMarker: " (Recommended)",
    acceptDescription: "Accept: the operation may proceed when it is re-run.",
    rejectDescription: "Reject: the operation stays refused.",
    directLabel: "Direct",
    directDescription: "Direct: type your direction as the Other answer; it is recorded and one more review round is allowed.",
    question: "do you accept it?",
    what: "What: ",
    before: "Before: ",
    after: "After: ",
    ifAccept: "If you accept: ",
    ifReject: "If you reject: ",
    facts: (f) => `Facts: class ${f.class}; subject ${f.subject} (${f.version}); score ${f.score}${f.factors === "" ? "" : `; factors ${f.factors}`}.`,
    measured: (answer, reason) => `Lore's measured recommendation: ${answer} (${reason}).`,
  },
  zh: {
    acceptLabel: "接受",
    rejectLabel: "拒绝",
    recommendedMarker: "（推荐）",
    acceptDescription: "接受：重新运行该操作时可以继续。",
    rejectDescription: "拒绝：该操作继续被拒绝。",
    directLabel: "指示",
    directDescription: "指示：在“其他”答案中输入你的指示；它会被记录，并多允许一轮评审。",
    question: "你接受吗？",
    what: "内容：",
    before: "之前：",
    after: "之后：",
    ifAccept: "如果接受：",
    ifReject: "如果拒绝：",
    facts: (f) => `事实：类别 ${f.class}；对象 ${f.subject}（${f.version}）；分数 ${f.score}${f.factors === "" ? "" : `；因素 ${f.factors}`}。`,
    measured: (answer, reason) => `Lore 的测算建议：${answer === "accept" ? "接受" : "拒绝"}（${reason}）。`,
  },
};
