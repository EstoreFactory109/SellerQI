/**
 * Static no-undef guard. ESLint is not installed for the server, so this uses
 * Babel's scope analysis (already present via Jest) to find every identifier
 * reference that is neither bound in the file nor a Node global.
 *
 * A dropped require is otherwise invisible: the reference throws a
 * ReferenceError inside the function's own try/catch and the caller just sees
 * an empty/failed result.
 *
 * @param {string} file - absolute path of a CommonJS source file
 * @returns {string[]} 'name:line' for each undefined reference
 */
const fs = require('fs');

function findUndefinedIdentifiers(file) {
    const { parse } = require('@babel/parser');
    const traverse = require('@babel/traverse').default;

    const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'script', errorRecovery: false });
    const nodeGlobals = new Set([
        ...Object.getOwnPropertyNames(globalThis),
        'require', 'module', 'exports', '__dirname', '__filename',
    ]);
    const undefinedRefs = [];
    traverse(ast, {
        ReferencedIdentifier(p) {
            if (p.isJSXIdentifier()) return;
            const { name } = p.node;
            if (p.scope.hasBinding(name, true)) return;
            if (nodeGlobals.has(name)) return;
            if (p.parentPath.isUnaryExpression({ operator: 'typeof' })) return;
            undefinedRefs.push(`${name}:${p.node.loc.start.line}`);
        },
    });
    return undefinedRefs;
}

module.exports = { findUndefinedIdentifiers };
