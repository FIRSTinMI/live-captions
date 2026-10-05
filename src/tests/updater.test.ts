import { describe, expect, test } from 'bun:test';
import { newerThan } from '../util/updater';

describe('newerThan', () => {
    test('compares versions as numbers', () => {
        expect(newerThan('1.10.0', '1.9.9')).toBe(true);
        expect(newerThan('1.10.10', '1.10.9')).toBe(true);
        expect(newerThan('1.9.9', '1.10.0')).toBe(false);
        expect(newerThan('1.10.8', '1.10.8')).toBe(false);
    });
});
