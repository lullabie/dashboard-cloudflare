import { getTorontoMidnight } from '../js/countdowns.js';

const OriginalDate = Date;

function setMockTime(isoString) {
    global.Date = class extends OriginalDate {
        constructor(...args) {
            if (args.length === 0) {
                return new OriginalDate(isoString);
            }
            return new OriginalDate(...args);
        }
        static now() {
            return new OriginalDate(isoString).getTime();
        }
    };
}

function restoreTime() {
    global.Date = OriginalDate;
}

let failures = 0;
let testsRun = 0;

function runTest(name, mockTime, inputDateString, expectedDays) {
    testsRun++;
    setMockTime(mockTime);
    try {
        const result = getTorontoMidnight(inputDateString);
        if (result !== expectedDays) {
            console.error(`❌ FAIL: ${name}`);
            console.error(`   Expected: ${expectedDays}, Got: ${result}`);
            console.error(`   Mock Time: ${mockTime}, Input: ${inputDateString}`);
            failures++;
        } else {
            console.log(`✅ PASS: ${name}`);
        }
    } catch (e) {
        console.error(`❌ FAIL: ${name} (Exception thrown)`);
        console.error(e);
        failures++;
    } finally {
        restoreTime();
    }
}

console.log('Running countdowns tests...');

// 1. A date in the past
// Current time in Toronto is Nov 25, 12:00 PM EST. Target is Nov 20. Diff should be -5 days.
runTest('A date in the past', '2023-11-25T17:00:00Z', '2023-11-20', -5);

// 2. Today
// Current time in Toronto is Nov 25, 8:00 AM EST. Target is Nov 25. Diff should be 0.
runTest('Today', '2023-11-25T13:00:00Z', '2023-11-25', 0);

// 3. A cross-month boundary
// Current time in Toronto is Jan 31, 8:00 AM EST. Target is Feb 2. Diff should be 2.
runTest('Cross-month boundary', '2023-01-31T13:00:00Z', '2023-02-02', 2);

// 4. A cross-year boundary
// Current time in Toronto is Dec 31, 2023, 8:00 AM EST. Target is Jan 2, 2024. Diff should be 2.
runTest('Cross-year boundary', '2023-12-31T13:00:00Z', '2024-01-02', 2);

// 5. DST spring-forward transition (Toronto)
// In 2024, DST starts on March 10 at 2:00 AM.
// Current time: March 9, 2024, 12:00 PM EST (17:00 UTC). Target: March 11, 2024. Diff should be 2 days.
runTest('DST spring-forward transition', '2024-03-09T17:00:00Z', '2024-03-11', 2);

// 6. DST fall-back transition (Toronto)
// In 2024, DST ends on Nov 3 at 2:00 AM.
// Current time: Nov 2, 2024, 12:00 PM EDT (16:00 UTC). Target: Nov 4, 2024. Diff should be 2 days.
runTest('DST fall-back transition', '2024-11-02T16:00:00Z', '2024-11-04', 2);

console.log(`\nTests completed: ${testsRun}`);
if (failures > 0) {
    console.error(`❌ ${failures} test(s) failed.`);
    process.exit(1);
} else {
    console.log(`✅ All tests passed.`);
    process.exit(0);
}
