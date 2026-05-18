// Questionnaires — structured multi-question surveys, complementary to feedback.
// Definitions live in `questionnaires`; responses in `questionnaire_responses`;
// comments in `questionnaire_response_comments` (mirrors feedback_comments).
//
// Schema is stored as JSONB and snapshotted into each response row so the
// dashboard can always render historical answers against the schema they were
// captured under, even after the definition has been edited.
//
// Validators here are pure (zero deps) and shared between server-side ingest
// validation and client-side SDK pre-flight checks.

// ---------- Question + schema ----------

export const QUESTIONNAIRE_QUESTION_TYPES = [
  "text",
  "single_choice",
  "multi_choice",
  "rating",
  "nps",
] as const;
export type QuestionnaireQuestionType = (typeof QUESTIONNAIRE_QUESTION_TYPES)[number];

export interface QuestionnaireChoiceOption {
  id: string;
  label: string;
}

export interface QuestionnaireQuestionBase {
  id: string;
  title: string;
  subtitle?: string;
  required: boolean;
}

export interface QuestionnaireTextQuestion extends QuestionnaireQuestionBase {
  type: "text";
  placeholder?: string;
  multiline?: boolean;
}

export interface QuestionnaireSingleChoiceQuestion extends QuestionnaireQuestionBase {
  type: "single_choice";
  options: QuestionnaireChoiceOption[];
}

export interface QuestionnaireMultiChoiceQuestion extends QuestionnaireQuestionBase {
  type: "multi_choice";
  options: QuestionnaireChoiceOption[];
}

export interface QuestionnaireRatingQuestion extends QuestionnaireQuestionBase {
  type: "rating";
  scale: 5;
}

export interface QuestionnaireNpsQuestion extends QuestionnaireQuestionBase {
  type: "nps";
}

export type QuestionnaireQuestion =
  | QuestionnaireTextQuestion
  | QuestionnaireSingleChoiceQuestion
  | QuestionnaireMultiChoiceQuestion
  | QuestionnaireRatingQuestion
  | QuestionnaireNpsQuestion;

export interface QuestionnaireSchema {
  version: 1;
  questions: QuestionnaireQuestion[];
}

// ---------- Response statuses ----------

export const QUESTIONNAIRE_RESPONSE_STATUSES = [
  "new",
  "in_review",
  "addressed",
  "dismissed",
] as const;
export type QuestionnaireResponseStatus = (typeof QUESTIONNAIRE_RESPONSE_STATUSES)[number];

// ---------- Length / count caps ----------

export const MAX_QUESTIONNAIRE_QUESTIONS = 30;
export const MAX_QUESTIONNAIRE_OPTIONS_PER_QUESTION = 20;
export const MAX_QUESTIONNAIRE_TEXT_ANSWER_LENGTH = 4000;
export const MAX_QUESTIONNAIRE_SLUG_LENGTH = 64;
export const MAX_QUESTIONNAIRE_NAME_LENGTH = 200;
export const MAX_QUESTIONNAIRE_DESCRIPTION_LENGTH = 2000;
export const MAX_QUESTION_TITLE_LENGTH = 200;
export const MAX_QUESTION_SUBTITLE_LENGTH = 500;
export const MAX_QUESTION_OPTION_LABEL_LENGTH = 100;
export const MAX_QUESTIONNAIRE_COMMENT_LENGTH = 4000;

export const QUESTIONNAIRE_SLUG_REGEX = /^[a-z0-9-]+$/;
export const QUESTION_ID_REGEX = /^[a-z0-9_]+$/;
export const QUESTION_OPTION_ID_REGEX = /^[a-z0-9_]+$/;

/**
 * Key written to `app_users.properties` when a user globally opts out of every
 * questionnaire. Stored as ISO timestamp. Eligibility checks treat any non-null
 * value as "globally dismissed" regardless of timestamp content.
 */
export const QUESTIONNAIRES_DISMISSED_PROPERTY = "_questionnaires_dismissed_at";

// ---------- Answers ----------

export type QuestionnaireAnswerValue = string | string[] | number;

export type QuestionnaireAnswers = Record<string, QuestionnaireAnswerValue>;

// ---------- Validators (pure, no deps) ----------

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates a raw questionnaire schema. Returns a normalized schema on success
 * (trimmed strings, `required` defaulted to false, optional fields preserved as-is).
 */
export function validateQuestionnaireSchema(
  input: unknown
): ValidationResult<QuestionnaireSchema> {
  if (!isPlainObject(input)) return { ok: false, error: "schema must be an object" };
  if (input.version !== 1) return { ok: false, error: "schema.version must be 1" };
  if (!Array.isArray(input.questions)) {
    return { ok: false, error: "schema.questions must be an array" };
  }
  if (input.questions.length === 0) {
    return { ok: false, error: "schema must have at least one question" };
  }
  if (input.questions.length > MAX_QUESTIONNAIRE_QUESTIONS) {
    return {
      ok: false,
      error: `schema may not have more than ${MAX_QUESTIONNAIRE_QUESTIONS} questions`,
    };
  }

  const seenIds = new Set<string>();
  const normalized: QuestionnaireQuestion[] = [];
  for (let i = 0; i < input.questions.length; i++) {
    const result = validateQuestion(input.questions[i], i);
    if (!result.ok) return result;
    if (seenIds.has(result.value.id)) {
      return { ok: false, error: `duplicate question id "${result.value.id}"` };
    }
    seenIds.add(result.value.id);
    normalized.push(result.value);
  }
  return { ok: true, value: { version: 1, questions: normalized } };
}

function validateQuestion(
  raw: unknown,
  index: number
): ValidationResult<QuestionnaireQuestion> {
  const where = `questions[${index}]`;
  if (!isPlainObject(raw)) return { ok: false, error: `${where} must be an object` };

  const type = raw.type;
  if (typeof type !== "string" || !QUESTIONNAIRE_QUESTION_TYPES.includes(type as QuestionnaireQuestionType)) {
    return { ok: false, error: `${where}.type must be one of ${QUESTIONNAIRE_QUESTION_TYPES.join(", ")}` };
  }

  const id = raw.id;
  if (typeof id !== "string" || !QUESTION_ID_REGEX.test(id) || id.length > 32) {
    return {
      ok: false,
      error: `${where}.id must be lowercase letters/digits/underscores (1-32 chars)`,
    };
  }

  const title = raw.title;
  if (typeof title !== "string" || title.trim().length === 0 || title.length > MAX_QUESTION_TITLE_LENGTH) {
    return { ok: false, error: `${where}.title must be 1-${MAX_QUESTION_TITLE_LENGTH} chars` };
  }

  const subtitle = raw.subtitle;
  if (subtitle !== undefined && subtitle !== null) {
    if (typeof subtitle !== "string" || subtitle.length > MAX_QUESTION_SUBTITLE_LENGTH) {
      return { ok: false, error: `${where}.subtitle must be a string up to ${MAX_QUESTION_SUBTITLE_LENGTH} chars` };
    }
  }

  const required = raw.required;
  if (typeof required !== "boolean") {
    return { ok: false, error: `${where}.required must be a boolean` };
  }

  const base: QuestionnaireQuestionBase = {
    id,
    title,
    required,
    ...(typeof subtitle === "string" ? { subtitle } : {}),
  };

  switch (type) {
    case "text": {
      const out: QuestionnaireTextQuestion = { ...base, type: "text" };
      if (raw.placeholder !== undefined && raw.placeholder !== null) {
        if (typeof raw.placeholder !== "string" || raw.placeholder.length > 200) {
          return { ok: false, error: `${where}.placeholder must be a string up to 200 chars` };
        }
        out.placeholder = raw.placeholder;
      }
      if (raw.multiline !== undefined && raw.multiline !== null) {
        if (typeof raw.multiline !== "boolean") {
          return { ok: false, error: `${where}.multiline must be a boolean` };
        }
        out.multiline = raw.multiline;
      }
      return { ok: true, value: out };
    }
    case "single_choice":
    case "multi_choice": {
      const optionsResult = validateOptions(raw.options, where);
      if (!optionsResult.ok) return optionsResult;
      return {
        ok: true,
        value: { ...base, type, options: optionsResult.value } as
          | QuestionnaireSingleChoiceQuestion
          | QuestionnaireMultiChoiceQuestion,
      };
    }
    case "rating": {
      if (raw.scale !== 5) {
        return { ok: false, error: `${where}.scale must be 5 (V1 only supports 5-point ratings)` };
      }
      return { ok: true, value: { ...base, type: "rating", scale: 5 } };
    }
    case "nps": {
      return { ok: true, value: { ...base, type: "nps" } };
    }
  }

  return { ok: false, error: `${where}.type unsupported` };
}

function validateOptions(
  raw: unknown,
  where: string
): ValidationResult<QuestionnaireChoiceOption[]> {
  if (!Array.isArray(raw)) return { ok: false, error: `${where}.options must be an array` };
  if (raw.length < 2) return { ok: false, error: `${where}.options must have at least 2 entries` };
  if (raw.length > MAX_QUESTIONNAIRE_OPTIONS_PER_QUESTION) {
    return {
      ok: false,
      error: `${where}.options may not have more than ${MAX_QUESTIONNAIRE_OPTIONS_PER_QUESTION} entries`,
    };
  }
  const seen = new Set<string>();
  const out: QuestionnaireChoiceOption[] = [];
  for (let i = 0; i < raw.length; i++) {
    const o = raw[i];
    if (!isPlainObject(o)) return { ok: false, error: `${where}.options[${i}] must be an object` };
    if (typeof o.id !== "string" || !QUESTION_OPTION_ID_REGEX.test(o.id) || o.id.length > 32) {
      return {
        ok: false,
        error: `${where}.options[${i}].id must be lowercase letters/digits/underscores (1-32 chars)`,
      };
    }
    if (seen.has(o.id)) return { ok: false, error: `${where}.options has duplicate id "${o.id}"` };
    seen.add(o.id);
    if (
      typeof o.label !== "string" ||
      o.label.trim().length === 0 ||
      o.label.length > MAX_QUESTION_OPTION_LABEL_LENGTH
    ) {
      return {
        ok: false,
        error: `${where}.options[${i}].label must be 1-${MAX_QUESTION_OPTION_LABEL_LENGTH} chars`,
      };
    }
    out.push({ id: o.id, label: o.label });
  }
  return { ok: true, value: out };
}

/**
 * Validates a set of answers against a schema. Returns the normalized answer
 * map on success — pruned of unknown keys and with string answers trimmed.
 */
export function validateAnswers(
  schema: QuestionnaireSchema,
  rawAnswers: unknown
): ValidationResult<QuestionnaireAnswers> {
  if (!isPlainObject(rawAnswers)) return { ok: false, error: "answers must be an object" };

  const questionIds = new Set(schema.questions.map((q) => q.id));
  for (const key of Object.keys(rawAnswers)) {
    if (!questionIds.has(key)) {
      return { ok: false, error: `unknown question id "${key}"` };
    }
  }

  const out: QuestionnaireAnswers = {};
  for (const question of schema.questions) {
    const raw = rawAnswers[question.id];
    const isEmpty =
      raw === undefined ||
      raw === null ||
      (typeof raw === "string" && raw.trim().length === 0) ||
      (Array.isArray(raw) && raw.length === 0);

    if (isEmpty) {
      if (question.required) {
        return { ok: false, error: `"${question.id}" is required` };
      }
      continue;
    }

    switch (question.type) {
      case "text": {
        if (typeof raw !== "string") return { ok: false, error: `"${question.id}" must be a string` };
        if (raw.length > MAX_QUESTIONNAIRE_TEXT_ANSWER_LENGTH) {
          return {
            ok: false,
            error: `"${question.id}" exceeds ${MAX_QUESTIONNAIRE_TEXT_ANSWER_LENGTH} chars`,
          };
        }
        out[question.id] = raw;
        break;
      }
      case "single_choice": {
        if (typeof raw !== "string") return { ok: false, error: `"${question.id}" must be a string option id` };
        const validIds = new Set(question.options.map((o) => o.id));
        if (!validIds.has(raw)) {
          return { ok: false, error: `"${raw}" is not a valid option for "${question.id}"` };
        }
        out[question.id] = raw;
        break;
      }
      case "multi_choice": {
        if (!Array.isArray(raw)) return { ok: false, error: `"${question.id}" must be an array` };
        const validIds = new Set(question.options.map((o) => o.id));
        const seen = new Set<string>();
        for (const x of raw) {
          if (typeof x !== "string") return { ok: false, error: `"${question.id}" entries must be strings` };
          if (!validIds.has(x)) {
            return { ok: false, error: `"${x}" is not a valid option for "${question.id}"` };
          }
          if (seen.has(x)) {
            return { ok: false, error: `"${question.id}" has duplicate selection "${x}"` };
          }
          seen.add(x);
        }
        out[question.id] = raw as string[];
        break;
      }
      case "rating": {
        if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > question.scale) {
          return { ok: false, error: `"${question.id}" must be an integer 1-${question.scale}` };
        }
        out[question.id] = raw;
        break;
      }
      case "nps": {
        if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 10) {
          return { ok: false, error: `"${question.id}" must be an integer 0-10` };
        }
        out[question.id] = raw;
        break;
      }
    }
  }

  return { ok: true, value: out };
}

// ---------- SDK ingest (synchronous) ----------

export type QuestionnaireIneligibleReason =
  | "already_responded"
  | "globally_dismissed"
  | "inactive";

export type IngestQuestionnaireFetchResponse =
  | { eligible: true; questionnaire: IngestQuestionnaireSpec }
  | { eligible: false; reason: QuestionnaireIneligibleReason };

export interface IngestQuestionnaireSpec {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  schema: QuestionnaireSchema;
}

export interface IngestQuestionnaireSubmitRequest {
  bundle_id: string;
  session_id?: string | null;
  user_id?: string | null;
  answers: QuestionnaireAnswers;
  app_version?: string;
  sdk_name?: string;
  sdk_version?: string;
  environment?: string;
  device_model?: string;
  os_version?: string;
  is_dev?: boolean;
}

export interface IngestQuestionnaireSubmitResponse {
  id: string;
  created_at: string;
}

export interface IngestQuestionnaireDismissRequest {
  bundle_id: string;
  user_id?: string | null;
}

export interface IngestQuestionnaireDismissResponse {
  dismissed_at: string;
}

// ---------- Dashboard / CLI / MCP ----------

export interface QuestionnaireSpec {
  id: string;
  project_id: string;
  app_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  schema: QuestionnaireSchema;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  response_count?: number;
  last_response_at?: string | null;
}

export interface QuestionnaireListResponse {
  questionnaires: QuestionnaireSpec[];
  cursor: string | null;
  has_more: boolean;
}

export interface QuestionnaireDetailResponse extends QuestionnaireSpec {
  response_count: number;
  last_response_at: string | null;
}

export interface CreateQuestionnaireRequest {
  slug: string;
  name: string;
  description?: string | null;
  schema: QuestionnaireSchema;
  app_id?: string | null;
  is_active?: boolean;
}

export interface UpdateQuestionnaireRequest {
  name?: string;
  description?: string | null;
  schema?: QuestionnaireSchema;
  is_active?: boolean;
  app_id?: string | null;
}

export interface QuestionnaireQueryParams {
  team_id?: string;
  project_id?: string;
  app_id?: string;
  is_active?: string;
  cursor?: string;
  limit?: string;
}

// ---------- Response records (the user-submitted answers) ----------

export type QuestionnaireResponseCommentAuthorType = "user" | "agent";

export interface QuestionnaireResponseComment {
  id: string;
  questionnaire_response_id: string;
  author_type: QuestionnaireResponseCommentAuthorType;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface QuestionnaireResponseRecord {
  id: string;
  questionnaire_id: string;
  slug: string;
  app_id: string;
  project_id: string;
  session_id: string | null;
  user_id: string | null;
  answers: QuestionnaireAnswers;
  schema_snapshot: QuestionnaireSchema;
  status: QuestionnaireResponseStatus;
  is_dev: boolean;
  environment: string | null;
  os_version: string | null;
  app_version: string | null;
  sdk_name: string | null;
  sdk_version: string | null;
  device_model: string | null;
  country_code: string | null;
  created_at: string;
  updated_at: string;
  questionnaire_name?: string;
  questionnaire_slug?: string;
  app_name?: string;
  project_name?: string;
  user_properties?: Record<string, string> | null;
}

export interface QuestionnaireResponseDetailResponse extends QuestionnaireResponseRecord {
  comments: QuestionnaireResponseComment[];
}

export interface QuestionnaireResponsesListResponse {
  responses: QuestionnaireResponseRecord[];
  cursor: string | null;
  has_more: boolean;
}

export interface QuestionnaireResponseQueryParams {
  status?: string;
  app_id?: string;
  is_dev?: string;
  data_mode?: string;
  cursor?: string;
  limit?: string;
}

export interface UpdateQuestionnaireResponseRequest {
  status?: QuestionnaireResponseStatus;
}

export interface CreateQuestionnaireResponseCommentRequest {
  body: string;
}

export interface UpdateQuestionnaireResponseCommentRequest {
  body: string;
}

// ---------- Analytics ----------

export interface QuestionnaireChoiceCount {
  id: string;
  label: string;
  count: number;
}

export interface QuestionnaireRatingBucket {
  value: number;
  count: number;
}

export type QuestionnaireQuestionAnalytics =
  | {
      id: string;
      type: "text";
      total_answered: number;
      recent_answers: Array<{ response_id: string; answer: string; created_at: string }>;
    }
  | {
      id: string;
      type: "single_choice" | "multi_choice";
      total_answered: number;
      choices: QuestionnaireChoiceCount[];
    }
  | {
      id: string;
      type: "rating";
      total_answered: number;
      average: number | null;
      buckets: QuestionnaireRatingBucket[];
    }
  | {
      id: string;
      type: "nps";
      total_answered: number;
      score: number | null;
      detractors: number;
      passives: number;
      promoters: number;
      buckets: QuestionnaireRatingBucket[];
    };

export interface QuestionnaireAnalyticsResponse {
  questionnaire_id: string;
  slug: string;
  total_responses: number;
  questions: QuestionnaireQuestionAnalytics[];
}
