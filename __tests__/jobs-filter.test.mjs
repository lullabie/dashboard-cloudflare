import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const mainJs = fs.readFileSync('js/main.js', 'utf8');

// Use a simple trick to extract the functions without strict regex boundaries
const isOtherStr = mainJs.substring(mainJs.indexOf('export function isOtherJobStatus'), mainJs.indexOf('}', mainJs.indexOf('export function isOtherJobStatus')) + 1).replace('export ', '');
const handlerStrStart = mainJs.indexOf('export function createChartJobFilterHandler');
const handlerStrEnd = mainJs.indexOf('}', mainJs.indexOf('}', handlerStrStart) + 1) + 1;
const handlerStr = mainJs.substring(handlerStrStart, handlerStrEnd).replace('export ', '');

const isOtherJobStatus = new Function('status', isOtherStr + '\nreturn isOtherJobStatus(status);');
const createChartJobFilterHandler = new Function('selectElement', 'refreshCallback', handlerStr + '\nreturn createChartJobFilterHandler(selectElement, refreshCallback);');

test('isOtherJobStatus logic', (t) => {
    assert.strictEqual(isOtherJobStatus('other'), true);
    assert.strictEqual(isOtherJobStatus('pending'), true);
    assert.strictEqual(isOtherJobStatus(''), true);
    assert.strictEqual(isOtherJobStatus(undefined), true);
    assert.strictEqual(isOtherJobStatus(null), true);
    
    assert.strictEqual(isOtherJobStatus('applied'), false);
    assert.strictEqual(isOtherJobStatus('interview'), false);
    assert.strictEqual(isOtherJobStatus('offer'), false);
    assert.strictEqual(isOtherJobStatus('rejected'), false);
});

test('Jobs filter integration logic', (t) => {
    const jobs = [
        { id: 1, status: 'applied', location: 'toronto' },
        { id: 2, status: 'interview', location: 'vancouver' },
        { id: 3, status: 'offer', location: 'remote-canada' },
        { id: 4, status: 'rejected', location: 'other' },
        { id: 5, status: 'other', location: 'toronto' },
        { id: 6, status: 'pending', location: 'toronto' },
        { id: 7, status: '', location: 'vancouver' },
        { id: 8, location: 'other' } // missing status
    ];

    const filterJobs = (activeStatusFilter, activeLocationFilter) => {
        let filteredJobs = jobs;
        if (activeStatusFilter !== 'all') { 
            filteredJobs = filteredJobs.filter(j => 
                activeStatusFilter === 'other' ? isOtherJobStatus(j.status) : j.status === activeStatusFilter
            ); 
        }
        if (activeLocationFilter !== 'all') { 
            filteredJobs = filteredJobs.filter(j => j.location === activeLocationFilter); 
        }
        return filteredJobs;
    };

    const otherJobs = filterJobs('other', 'all');
    assert.strictEqual(otherJobs.length, 4);
    assert.strictEqual(otherJobs.some(j => j.status === 'applied'), false);

    assert.strictEqual(filterJobs('applied', 'all').length, 1);
    assert.strictEqual(filterJobs('interview', 'all').length, 1);
    assert.strictEqual(filterJobs('offer', 'all').length, 1);
    assert.strictEqual(filterJobs('rejected', 'all').length, 1);

    assert.strictEqual(filterJobs('all', 'all').length, 8);

    const otherToronto = filterJobs('other', 'toronto');
    assert.strictEqual(otherToronto.length, 2);
    assert.strictEqual(otherToronto[0].id, 5);
    assert.strictEqual(otherToronto[1].id, 6);
});

test('chart callback guard', (t) => {
    let selectValue = 'all';
    let refreshCount = 0;
    
    const mockSelect = {
        get value() { return selectValue; },
        set value(v) { selectValue = v; }
    };
    
    const mockRefresh = () => { refreshCount++; };
    
    const handler = createChartJobFilterHandler(mockSelect, mockRefresh);
    
    handler(undefined);
    assert.strictEqual(selectValue, 'all');
    assert.strictEqual(refreshCount, 0);
    
    handler('random');
    assert.strictEqual(selectValue, 'all');
    assert.strictEqual(refreshCount, 0);
    
    handler('other');
    assert.strictEqual(selectValue, 'other');
    assert.strictEqual(refreshCount, 1);
    
    handler('applied');
    assert.strictEqual(selectValue, 'applied');
    assert.strictEqual(refreshCount, 2);
});
