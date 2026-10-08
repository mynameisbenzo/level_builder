/**
 * How a level's difficulty label is shown. The backend derives the label
 * from the level's clear rate (backend/app/services/difficulty.py) and
 * sends it as one of these values, or null when the level hasn't had
 * enough registered attempts yet.
 */

export const DIFFICULTY_VALUES = ['easy', 'normal', 'hard', 'very_hard', 'tas'] as const;
export type Difficulty = (typeof DIFFICULTY_VALUES)[number];

export const DIFFICULTY_TEXT: Record<Difficulty, string> = {
	easy: 'Easy',
	normal: 'Normal',
	hard: 'Hard',
	very_hard: 'Very Hard',
	tas: 'TAS!?!?'
};

/** What an unlabeled (published) level shows instead. */
export const NO_DIFFICULTY_TEXT = 'Not enough plays yet';

export interface DifficultyDisplay {
	/** Text for the badge. */
	text: string;
	/** The label, or null when the level has none yet. */
	label: Difficulty | null;
}

function isDifficulty(value: unknown): value is Difficulty {
	return typeof value === 'string' && (DIFFICULTY_VALUES as readonly string[]).includes(value);
}

/** Maps what the API sent (a label, null, or anything unexpected) to display text. */
export function difficultyDisplay(value: unknown): DifficultyDisplay {
	if (isDifficulty(value)) {
		return { text: DIFFICULTY_TEXT[value], label: value };
	}
	return { text: NO_DIFFICULTY_TEXT, label: null };
}