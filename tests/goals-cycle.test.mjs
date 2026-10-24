import assert from 'assert';

// Shim localStorage before importing modules
const storageMap = new Map();
globalThis.localStorage = {
    getItem(key) { return storageMap.has(key) ? storageMap.get(key) : null; },
    setItem(key, value) { storageMap.set(key, String(value)); },
    removeItem(key) { storageMap.delete(key); },
    clear() { storageMap.clear(); }
};

// Use dynamic imports to ensure the shim is active before the modules are evaluated
async function runTests() {
    console.log('Running tests for cycleOccurrence...');

    const { cycleOccurrence, saveGoal } = await import('../js/goals.js');
    const { getData } = await import('../js/store.js');

    function setup() {
        globalThis.localStorage.clear();
        const mockGoal = {
            title: 'Test Goal',
            target: 1,
            showNotes: false
        };
        saveGoal(mockGoal);
        const data = getData();
        const createdGoalId = data.goals[0].id;
        return createdGoalId;
    }

    // 1. none -> done
    let goalId = setup();
    const dateStr = '2023-10-15';
    cycleOccurrence(goalId, dateStr);
    let goal = getData().goals.find(g => g.id === goalId);
    assert.strictEqual(goal.occurrences[dateStr], 'done', "Transition none -> done failed");
    let lastHistory = goal.history[goal.history.length - 1];
    assert.strictEqual(lastHistory.type, 'OCCURRENCE_CHANGE');
    assert.strictEqual(lastHistory.status, 'done');

    // 2. done -> missed
    cycleOccurrence(goalId, dateStr);
    goal = getData().goals.find(g => g.id === goalId);
    assert.strictEqual(goal.occurrences[dateStr], 'missed', "Transition done -> missed failed");
    lastHistory = goal.history[goal.history.length - 1];
    assert.strictEqual(lastHistory.status, 'missed');

    // 3. missed -> late
    cycleOccurrence(goalId, dateStr);
    goal = getData().goals.find(g => g.id === goalId);
    assert.strictEqual(goal.occurrences[dateStr], 'late', "Transition missed -> late failed");
    lastHistory = goal.history[goal.history.length - 1];
    assert.strictEqual(lastHistory.status, 'late');

    // 4. late -> none (should delete key)
    cycleOccurrence(goalId, dateStr);
    goal = getData().goals.find(g => g.id === goalId);
    assert.strictEqual(goal.occurrences[dateStr], undefined, "Transition late -> none failed (key should be deleted)");
    lastHistory = goal.history[goal.history.length - 1];
    assert.strictEqual(lastHistory.status, 'none');

    // 5. unknown goal ID handles gracefully
    try {
        cycleOccurrence('non_existent_id', dateStr);
        // It returns undefined implicitly
    } catch (e) {
        assert.fail('cycleOccurrence crashed on non-existent goal ID');
    }

    console.log('All tests passed.');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
