import { calculateStreak } from '../js/goals.js';

let exitCode = 0;

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        console.error(`❌ FAIL: ${message}`);
        console.error(`   Expected: ${expected}, Actual: ${actual}`);
        exitCode = 1;
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

const TODAY_STR = '2023-10-15';

// Scenario 1: A goal with N consecutive completed days returns N
function testConsecutiveDays() {
    const occurrences = {
        '2023-10-15': 'done',
        '2023-10-14': 'done',
        '2023-10-13': 'done',
        '2023-10-12': 'none',
    };
    assertEqual(calculateStreak(occurrences, TODAY_STR), 3, 'N consecutive completed days returns N');
}

// Scenario 2: A streak broken by a missed day returns the current segment
function testBrokenStreakReturnsCurrentSegment() {
    // If today is 'missed', it breaks immediately (returns 0)
    // If today is done, yesterday is done, but 2 days ago is missed, streak is 2.
    const occurrences = {
        '2023-10-15': 'done',
        '2023-10-14': 'done',
        '2023-10-13': 'missed',
        '2023-10-12': 'done',
    };
    assertEqual(calculateStreak(occurrences, TODAY_STR), 2, 'A streak broken by a missed day returns the current segment');

    const occurrencesTodayMissed = {
        '2023-10-15': 'missed',
        '2023-10-14': 'done',
        '2023-10-13': 'done',
    };
    assertEqual(calculateStreak(occurrencesTodayMissed, TODAY_STR), 0, 'A streak broken by today missed returns 0');
}

// Scenario 3: An empty occurrences map returns 0
function testEmptyOccurrencesReturnsZero() {
    assertEqual(calculateStreak({}, TODAY_STR), 0, 'Empty occurrences map returns 0');
    assertEqual(calculateStreak(undefined, TODAY_STR), 0, 'Undefined occurrences returns 0');
    assertEqual(calculateStreak(null, TODAY_STR), 0, 'Null occurrences returns 0');
}

// Scenario 4: A future-dated occurrence is not counted
function testFutureDatedNotCounted() {
    const occurrences = {
        '2023-10-16': 'done',
        '2023-10-15': 'none',
        '2023-10-14': 'done',
    };
    // If today is missing ('none') but yesterday is 'done' and tomorrow is 'done'
    // It should count yesterday's streak (1), but not tomorrow's 'done'
    assertEqual(calculateStreak(occurrences, TODAY_STR), 1, 'Future-dated occurrence is not counted, but past streak is maintained if today is none');

    // Testing a future-only case
    const futureOnly = {
        '2023-10-16': 'done',
        '2023-10-17': 'done'
    };
    assertEqual(calculateStreak(futureOnly, TODAY_STR), 0, 'Only future-dated occurrences return 0');
}

function runTests() {
    console.log('Running calculateStreak tests...\n');
    testConsecutiveDays();
    testBrokenStreakReturnsCurrentSegment();
    testEmptyOccurrencesReturnsZero();
    testFutureDatedNotCounted();

    if (exitCode !== 0) {
        console.error('\nSome tests failed.');
        process.exit(exitCode);
    } else {
        console.log('\nAll tests passed successfully.');
    }
}

runTests();
