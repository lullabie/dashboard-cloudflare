import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MockNode {
    constructor(tagName, isSVG = false) {
        this.tagName = tagName ? tagName.toLowerCase() : null;
        this.classList = new Set();
        this.dataset = {};
        this.attributes = {};
        this.style = {};
        this.children = [];
        this.textContent = '';
        this._listeners = {};
        this._innerHTML = '';
        this.isSVG = isSVG;
    }

    set className(val) {
        this.classList = new Set(val.split(' ').filter(Boolean));
    }

    get className() {
        return Array.from(this.classList).join(' ');
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return this.attributes[name];
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    addEventListener(type, listener) {
        if (!this._listeners[type]) {
            this._listeners[type] = [];
        }
        this._listeners[type].push(listener);
    }

    set innerHTML(val) {
        this._innerHTML = val;
    }

    get innerHTML() {
        return this._innerHTML;
    }

    querySelectorAll(selector) {
        let results = [];
        if (selector.startsWith('.')) {
            const cls = selector.substring(1);
            if (this.classList.has(cls)) results.push(this);
            for (const child of this.children) {
                if (child.querySelectorAll) {
                    results = results.concat(child.querySelectorAll(selector));
                }
            }
        }
        return results;
    }

    querySelector(selector) {
        const results = this.querySelectorAll(selector);
        return results.length > 0 ? results[0] : null;
    }
}

global.document = {
    createElement: (tag) => new MockNode(tag),
    createElementNS: (ns, tag) => new MockNode(tag, ns === 'http://www.w3.org/2000/svg'),
};

function stringifyAttributes(node) {
    let attrs = '';
    const classes = Array.from(node.classList).sort().join(' ');
    if (classes) attrs += ` class="${classes}"`;
    const dKeys = Object.keys(node.dataset).sort();
    for (const k of dKeys) { attrs += ` data-${k}="${node.dataset[k]}"`; }
    const aKeys = Object.keys(node.attributes).sort();
    for (const k of aKeys) {
        if (k !== 'class' && k !== 'style') attrs += ` ${k}="${node.attributes[k]}"`;
    }
    const sKeys = Object.keys(node.style).sort();
    let styleStr = '';
    for (const k of sKeys) {
        const kebab = k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
        styleStr += `${kebab}: ${node.style[k]}; `;
    }
    if (node.attributes['style'] && sKeys.length === 0) {
       let rawStyle = node.attributes['style'];
       const parsedStyles = rawStyle.split(';').map(s => s.trim()).filter(Boolean).sort();
       styleStr = parsedStyles.join('; ') + (parsedStyles.length ? ';' : '');
    }
    if (styleStr) attrs += ` style="${styleStr.trim()}"`;
    return attrs;
}

function normalizeStringRepresentation(node) {
    if (typeof node === 'string') return node;
    let result = '';
    if (node._innerHTML) {
        result = node._innerHTML
            .replace(/>\s+</g, '><')
            .replace(/\s+/g, ' ')
            .trim();
    } else {
        const attrs = stringifyAttributes(node);
        const inner = node.textContent + node.children.map(normalizeStringRepresentation).join('');
        result = `<${node.tagName}${attrs}>${inner}</${node.tagName}>`;
    }
    return result;
}

async function runTest() {
    const originalCode = fs.readFileSync(path.join(__dirname, '../js/goals.js'), 'utf8');

    global.getLocalDateString = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    global.escapeHtml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

    const strippedCode = originalCode
        .replace(/import .*;/, 'const getData = () => ({}); const saveData = () => {};')
        .replace(/export function getGoals/g, 'function getGoals')
        .replace(/export function saveGoal/g, 'function saveGoal');

    const base64Code = Buffer.from(strippedCode).toString('base64');
    const module = await import(`data:text/javascript;base64,${base64Code}`);

    const mockGoal = {
        id: 'g1',
        title: 'Learn JS & DOM',
        status: 'active',
        target: 5,
        showNotes: true,
        notes: 'Notes here',
        occurrences: {
            [global.getLocalDateString(new Date())]: 'done'
        }
    };

    let clickedEdit = false;
    let clickedArchive = false;
    let clickedCycle = false;
    const onEdit = () => { clickedEdit = true; };
    const onToggleArchive = () => { clickedArchive = true; };
    const onCycleOccurrence = () => { clickedCycle = true; };

    const card = module.createGoalCard(mockGoal, onEdit, onToggleArchive, onCycleOccurrence);

    const renderedHtml = normalizeStringRepresentation(card);

    if (!card.querySelector('.edit-btn')) {
        console.error("Missing edit button.");
        process.exit(1);
    }

    card.querySelector('.edit-btn')._listeners['click'][0]();
    if (!clickedEdit) { console.error("Edit click failed"); process.exit(1); }

    card.querySelector('.archive-btn')._listeners['click'][0]();
    if (!clickedArchive) { console.error("Archive click failed"); process.exit(1); }

    const day = card.querySelector('.timeline-day');
    if (day) {
        day._listeners['click'][0]();
        if (!clickedCycle) { console.error("Cycle click failed"); process.exit(1); }
    }

    // Check that innerHTML is empty (no longer used)
    if (card._innerHTML !== '') {
        console.error("Failed: innerHTML is still being used on the card.");
        process.exit(1);
    }

    // Check structure looks correct
    if (!renderedHtml.includes('Learn JS & DOM') || !renderedHtml.includes('timeline')) {
        console.error("Failed: Structure is missing key components.", renderedHtml);
        process.exit(1);
    }

    console.log("PASS: DOM nodes created dynamically and event listeners attached properly.");
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
