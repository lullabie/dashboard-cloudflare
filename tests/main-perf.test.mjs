import assert from 'assert';
import { performance } from 'perf_hooks';

// --- Mock Minimal DOM ---
class Node {
    constructor(nodeName) {
        this.nodeName = nodeName;
        this.childNodes = [];
        this._innerHTML = '';
    }

    appendChild(child) {
        if (child.nodeName === '#document-fragment') {
            this.childNodes.push(...child.childNodes);
            child.childNodes = [];
        } else {
            this.childNodes.push(child);
        }
    }

    get innerHTML() {
        if (this.childNodes.length > 0) {
            return this.childNodes.map(c => `<${c.nodeName}></${c.nodeName}>`).join('');
        }
        return this._innerHTML;
    }

    set innerHTML(val) {
        this._innerHTML = val;
        this.childNodes = [];
    }
}

class Element extends Node {}
class DocumentFragment extends Node {
    constructor() {
        super('#document-fragment');
    }
}

function createGoalCard(g) {
    const el = new Element('div');
    el._innerHTML = `Goal: ${g.id}`;
    return el;
}

// --- Benchmark Data ---
const NUM_ITEMS = 50000;
const activeGoals = Array.from({ length: NUM_ITEMS }, (_, i) => ({ id: i }));

// --- Baseline (Current approach) ---
function runBaseline() {
    const todayGoalsContainer = new Element('div');
    todayGoalsContainer.innerHTML = '';

    const start = performance.now();
    activeGoals.forEach(g => {
        todayGoalsContainer.appendChild(createGoalCard(g));
    });
    const end = performance.now();

    return { container: todayGoalsContainer, time: end - start };
}

// --- Optimized (DocumentFragment) ---
function runOptimized() {
    const todayGoalsContainer = new Element('div');
    todayGoalsContainer.innerHTML = '';

    const start = performance.now();
    const fragment = new DocumentFragment();
    activeGoals.forEach(g => {
        fragment.appendChild(createGoalCard(g));
    });
    todayGoalsContainer.appendChild(fragment);
    const end = performance.now();

    return { container: todayGoalsContainer, time: end - start };
}

// --- Verification & Execution ---
function main() {
    console.log(`Running benchmark with ${NUM_ITEMS} items...`);

    // Warmup
    for(let i=0; i<5; i++) {
        runBaseline();
        runOptimized();
    }

    // Test Correctness
    const baselineResult = runBaseline();
    const optimizedResult = runOptimized();

    // Check lengths
    assert.strictEqual(
        baselineResult.container.childNodes.length,
        optimizedResult.container.childNodes.length,
        'DOM children count mismatch'
    );

    // Verify properties
    for (let i = 0; i < baselineResult.container.childNodes.length; i++) {
        const b = baselineResult.container.childNodes[i];
        const o = optimizedResult.container.childNodes[i];
        assert.strictEqual(b.nodeName, o.nodeName);
        assert.strictEqual(b.innerHTML, o.innerHTML);
    }

    console.log('✅ Correctness verified: Both approaches produce identical DOM trees.');

    // Run real bench
    let baseTime = 0;
    let optTime = 0;
    const ITERATIONS = 20;

    for (let i = 0; i < ITERATIONS; i++) {
        baseTime += runBaseline().time;
        optTime += runOptimized().time;
    }

    const avgBase = baseTime / ITERATIONS;
    const avgOpt = optTime / ITERATIONS;

    console.log(`\n📊 Results (avg over ${ITERATIONS} runs):`);
    console.log(`- Baseline (Direct appendChild): ${avgBase.toFixed(2)} ms`);
    console.log(`- Optimized (DocumentFragment):  ${avgOpt.toFixed(2)} ms`);

    if (avgOpt < avgBase) {
        const improvement = (((avgBase - avgOpt) / avgBase) * 100).toFixed(2);
        console.log(`⚡ Optimization is ${improvement}% faster!`);
    } else {
        console.log(`⚠️ Optimization is slower or equal (this is normal in minimal V8 mocks, but saves layout thrashing in real browsers).`);
    }
}

main();
