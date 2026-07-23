/** Welcome chips: 2-col grid → up to 12 so full company default catalog can show. */
const MAX_ITEMS = 12;

const truncate = (text: string, max: number) => {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
};

export type SuggestQuestionSource = 'company' | 'opening';

export type OpeningSuggestItem = {
  description: string;
  id: string;
  prompt: string;
  source: SuggestQuestionSource;
  title: string;
};

/**
 * Map stored examples → HomeSuggest cards.
 * - First line = card title only (never sent as the user message)
 * - Remaining lines = prompt filled into the input on click
 * - Single-line entry: whole string is both title (truncated) and prompt
 */
export const questionsToSuggestItems = (
  questions: string[],
  source: SuggestQuestionSource,
  maxItems: number = MAX_ITEMS,
): OpeningSuggestItem[] =>
  questions
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((question, index) => {
      const lines = question
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const titleLine = lines[0] || question;
      const body = lines.slice(1).join('\n').trim();
      // Click fills what the user would actually type — not the card title.
      const prompt = body || titleLine;
      const title = truncate(titleLine, 36);
      const description = body ? truncate(body.replaceAll('\n', ' '), 80) : title;

      return {
        description,
        id: `${source}-${index}`,
        prompt,
        source,
        title,
      };
    });

/** @deprecated prefer questionsToSuggestItems(questions, 'opening') */
export const openingQuestionsToSuggestItems = (questions: string[]): OpeningSuggestItem[] =>
  questionsToSuggestItems(questions, 'opening');

/**
 * Company common first, then agent-personal; dedupe by prompt; cap at maxItems.
 */
export const mergeRecommendExamples = (
  companyQuestions: string[],
  agentQuestions: string[],
  maxItems: number = MAX_ITEMS,
): OpeningSuggestItem[] => {
  const seen = new Set<string>();
  const out: OpeningSuggestItem[] = [];

  for (const item of [
    ...questionsToSuggestItems(companyQuestions, 'company', maxItems),
    ...questionsToSuggestItems(agentQuestions, 'opening', maxItems),
  ]) {
    if (seen.has(item.prompt)) continue;
    seen.add(item.prompt);
    out.push(item);
    if (out.length >= maxItems) break;
  }

  return out;
};
