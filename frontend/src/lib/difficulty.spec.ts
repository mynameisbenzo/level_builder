import { describe, expect, it } from 'vitest';
import { ENDLESS_DIFFICULTY_LABELS } from './endlessApi';
import { DIFFICULTY_TEXT, DIFFICULTY_VALUES, NO_DIFFICULTY_TEXT, difficultyDisplay } from './difficulty';

describe('difficultyDisplay', () => {
	it('shows every label by name', () => {
		expect(difficultyDisplay('easy')).toEqual({ text: 'Easy', label: 'easy' });
		expect(difficultyDisplay('very_hard')).toEqual({ text: 'Very Hard', label: 'very_hard' });
		expect(difficultyDisplay('tas')).toEqual({ text: 'TAS!?!?', label: 'tas' });
	});

	it('says there are not enough plays when there is no label', () => {
		expect(difficultyDisplay(null)).toEqual({ text: NO_DIFFICULTY_TEXT, label: null });
		expect(difficultyDisplay(undefined).label).toBeNull();
	});

	it('treats an unknown value like no label', () => {
		expect(difficultyDisplay('impossible').label).toBeNull();
		expect(difficultyDisplay(3).label).toBeNull();
	});

	it('uses the same names as the endless difficulty picker', () => {
		for (const value of DIFFICULTY_VALUES) {
			expect(DIFFICULTY_TEXT[value]).toBe(ENDLESS_DIFFICULTY_LABELS[value]);
		}
	});
});