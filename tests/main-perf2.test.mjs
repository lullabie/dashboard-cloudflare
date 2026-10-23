import { performance } from 'perf_hooks';

// Setup dataset of 50,000 items
const NUM_ITEMS = 50000;
const statuses = ['active', 'archived', 'other', 'unknown'];
const allGoals = [];

for (let i = 0; i < NUM_ITEMS; i++) {
    allGoals.push({
        id: i,
        status: statuses[i % statuses.length],
        title: `Goal ${i}`
    });
}

// Old implementation
function runOldApproach(data) {
    const activeGoals = data.filter(g => g.status === 'active');
    const archivedGoals = data.filter(g => g.status === 'archived');
    return { activeGoals, archivedGoals };
}

// New implementation
function runNewApproach(data) {
    const activeGoals = [];
    const archivedGoals = [];

    for (const g of data) {
        if (g.status === 'active') {
            activeGoals.push(g);
        } else if (g.status === 'archived') {
            archivedGoals.push(g);
        }
    }

    return { activeGoals, archivedGoals };
}

// Verify output equivalence
const oldResult = runOldApproach(allGoals);
const newResult = runNewApproach(allGoals);

if (oldResult.activeGoals.length !== newResult.activeGoals.length) {
    console.error(`Assertion failed: activeGoals length mismatch. Old: ${oldResult.activeGoals.length}, New: ${newResult.activeGoals.length}`);
    process.exit(1);
}

if (oldResult.archivedGoals.length !== newResult.archivedGoals.length) {
    console.error(`Assertion failed: archivedGoals length mismatch. Old: ${oldResult.archivedGoals.length}, New: ${newResult.archivedGoals.length}`);
    process.exit(1);
}

for (let i = 0; i < oldResult.activeGoals.length; i++) {
    if (oldResult.activeGoals[i] !== newResult.activeGoals[i]) {
        console.error(`Assertion failed: activeGoals element mismatch at index ${i}`);
        process.exit(1);
    }
}

for (let i = 0; i < oldResult.archivedGoals.length; i++) {
    if (oldResult.archivedGoals[i] !== newResult.archivedGoals[i]) {
        console.error(`Assertion failed: archivedGoals element mismatch at index ${i}`);
        process.exit(1);
    }
}

console.log('✅ Correctness verified: Output is exactly equivalent.\n');

// Benchmark
const ITERATIONS = 100;

// Warmup
for (let i = 0; i < 10; i++) {
    runOldApproach(allGoals);
    runNewApproach(allGoals);
}

let oldTime = 0;
for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    runOldApproach(allGoals);
    const end = performance.now();
    oldTime += (end - start);
}

let newTime = 0;
for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    runNewApproach(allGoals);
    const end = performance.now();
    newTime += (end - start);
}

console.log(`--- Performance Benchmark (${ITERATIONS} iterations, ${NUM_ITEMS} items each) ---`);
console.log(`Old Approach (2x filter): ${oldTime.toFixed(2)} ms`);
console.log(`New Approach (for...of): ${newTime.toFixed(2)} ms`);
console.log(`Improvement: ${((oldTime - newTime) / oldTime * 100).toFixed(2)}% faster`);

if (newTime >= oldTime) {
    console.warn('⚠️ Warning: New approach was not faster in this run.');
} else {
    console.log('✅ Performance improvement verified.');
}
