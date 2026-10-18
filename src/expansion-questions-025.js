import { QUESTION_GROUPS_025_A } from './expansion-questions-025-a.js';
import { QUESTION_GROUPS_025_B } from './expansion-questions-025-b.js';
import { QUESTION_GROUPS_025_C } from './expansion-questions-025-c.js';
import { QUESTION_GROUPS_025_D } from './expansion-questions-025-d.js';
import { QUESTION_GROUPS_025_E, CATEGORY_SOURCES_025 } from './expansion-questions-025-e.js';

const questionGroups = [
  QUESTION_GROUPS_025_A,
  QUESTION_GROUPS_025_B,
  QUESTION_GROUPS_025_C,
  QUESTION_GROUPS_025_D,
  QUESTION_GROUPS_025_E,
];

export const EXPANSION_025_ROWS = questionGroups.flatMap(groups =>
  Object.entries(groups).flatMap(([category, questions]) =>
    questions.map(question => [category, ...question]),
  ),
);

export { CATEGORY_SOURCES_025 };
