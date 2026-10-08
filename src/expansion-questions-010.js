import { QUESTION_GROUPS_010_A } from './expansion-questions-010-a.js';
import { QUESTION_GROUPS_010_B } from './expansion-questions-010-b.js';
import { QUESTION_GROUPS_010_C } from './expansion-questions-010-c.js';
import { QUESTION_GROUPS_010_D } from './expansion-questions-010-d.js';
import { QUESTION_GROUPS_010_E, CATEGORY_SOURCES_010 } from './expansion-questions-010-e.js';

const questionGroups = [
  QUESTION_GROUPS_010_A,
  QUESTION_GROUPS_010_B,
  QUESTION_GROUPS_010_C,
  QUESTION_GROUPS_010_D,
  QUESTION_GROUPS_010_E,
];

export const EXPANSION_010_ROWS = questionGroups.flatMap(groups =>
  Object.entries(groups).flatMap(([category, questions]) =>
    questions.map(question => [category, ...question]),
  ),
);

export { CATEGORY_SOURCES_010 };
