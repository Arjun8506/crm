import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FormulaError, evaluateExpression as ev, parse, referencedFields, renderTemplate } from '../src/modules/formulas/formula.js';

const values = { stage: 'won', value: 12000, name: 'Acme', empty: '', tags: ['vip', 'event'], close: new Date('2026-11-01T00:00:00Z'), loc: { lat: 51.5, lng: -0.1 }, flag: true };
const now = new Date('2026-10-25T10:00:00Z');
const run = (expr, extra = {}) => ev(expr, { values, now, ...extra });

describe('formula engine: evaluation', () => {
  it('does arithmetic with the usual precedence and treats empty as zero', () => {
    assert.equal(run('1 + 2 * 3'), 7);
    assert.equal(run('(1 + 2) * 3'), 9);
    assert.equal(run('{value} / 4 - 500'), 2500);
    assert.equal(run('10 % 4'), 2);
    assert.equal(run('-{value} + 12000'), 0);
    assert.equal(run('{missing} + 5'), 5);
    assert.equal(run('2 * -3'), -6);
  });

  it('compares numbers, text, dates and empties', () => {
    assert.equal(run('{value} >= 10000'), true);
    assert.equal(run('{stage} = "won"'), true);
    assert.equal(run('{stage} != "lost"'), true);
    assert.equal(run('{stage} <> "won"'), false);
    assert.equal(run('{empty} = {missing}'), true, 'empty equals empty');
    assert.equal(run('{close} > TODAY()'), true);
    assert.equal(run('"apple" < "banana"'), true);
    assert.equal(run('"10" = 10'), true);
  });

  it('supports logic, short-circuiting IF and text', () => {
    assert.equal(run('{stage} = "won" && {value} > 1'), true);
    assert.equal(run('{stage} = "lost" || {value} > 1'), true);
    assert.equal(run('!{flag}'), false);
    assert.equal(run('IF({value} > 5000, "big", "small")'), 'big');
    assert.equal(run('IF(true, 1, 1 / 0)'), 1, 'the untaken branch is not evaluated');
    assert.equal(run('{name} & " - " & {stage}'), 'Acme - won');
    assert.equal(run('CONCAT({name}, " (", LEN({name}), ")")'), 'Acme (4)');
    assert.equal(run('UPPER(TRIM("  hi  "))'), 'HI');
  });

  it('provides list, number, date and utility functions', () => {
    assert.equal(run('CONTAINS({tags}, "vip")'), true);
    assert.equal(run('CONTAINS({name}, "CM")'), true, 'text contains is case-insensitive');
    assert.equal(run('IN({stage}, "won", "lost")'), true);
    assert.equal(run('COALESCE({missing}, {empty}, "fallback")'), 'fallback');
    assert.equal(run('ISEMPTY({empty})'), true);
    assert.equal(run('ROUND(3.14159, 2)'), 3.14);
    assert.equal(run('MAX(1, {value}, 3)'), 12000);
    assert.equal(run('SUM(1, 2, 3)'), 6);
    assert.equal(run('ABS(-4) + FLOOR(2.9) + CEIL(0.1)'), 7);
    assert.equal(run('DATEDIFF({close}, TODAY(), "days")'), 7);
    assert.equal(run('DATEDIFF(NOW(), {close}, "hours")'), -158);
    assert.equal(run('ADDDAYS(TODAY(), 2)').toISOString(), '2026-10-27T00:00:00.000Z');
    assert.equal(run('{loc.lat} > 50'), true, 'dotted access into nested values');
    assert.equal(run('ISCHANGED("stage")', { changed: new Set(['stage']) }), true);
    assert.equal(run('ISCHANGED("name")', { changed: new Set(['stage']) }), false);
  });

  it('reports mistakes with clear messages', () => {
    const bad = [
      ['', /Enter a formula/], ['1 +', /ends unexpectedly/], ['(1 + 2', /Missing closing/], ['NOPE(1)', /Unknown function/],
      ['foo', /Unknown word/], ['{a b}', /Invalid field reference/], ['"open', /Unterminated/], ['1 $ 2', /Unexpected character/],
      ['IF(1, 2)', /IF takes 3/], ['ROUND()', /ROUND takes 1 to 2/], ['1 / 0', /Division by zero/], ['"abc" * 2', /Expected a number/],
      ['DATEDIFF(NOW(), NOW(), "years")', /unit/], ['DATE("not a date")', /not a date/],
    ];
    for (const [expr, re] of bad) assert.throws(() => run(expr), (e) => e instanceof FormulaError && re.test(e.message), expr);
  });

  it('lists the fields a formula uses', () => {
    assert.deepEqual([...referencedFields(parse('IF({a} > {b.c}, {d}, 1)'))].sort(), ['a', 'b', 'd']);
  });
});

describe('formula engine: safety', () => {
  it('cannot reach prototypes or run code', () => {
    const ctx = { values: { safe: 1 }, now };
    for (const expr of ['{__proto__}', '{constructor}', '{safe.constructor}', '{safe.__proto__.x}']) assert.equal(ev(expr, ctx), null);
    for (const expr of ['process.exit()', 'constructor.constructor("return 1")()', 'require("fs")', 'this', 'globalThis', 'eval("1")', '`${1}`']) {
      assert.throws(() => ev(expr, ctx), FormulaError, expr);
    }
    assert.equal(Object.keys(ctx.values).length, 1, 'the context is not modified');
  });

  it('enforces size, nesting and step limits', () => {
    assert.throws(() => parse('1+'.repeat(600) + '1'), /too long/);
    assert.throws(() => parse('('.repeat(40) + '1' + ')'.repeat(40)), /nested too deeply/);
    assert.throws(() => parse('-'.repeat(100) + '1'), /nested too deeply/);
    const wide = `SUM(${Array.from({ length: 60 }, () => 'LEN("x")').join(',')})`;
    assert.equal(ev(wide, { values: {} }), 60, 'a large but reasonable formula still works');
    const tooManyTokens = '1+'.repeat(300) + '1'; // 601 tokens in under 1000 characters
    assert.throws(() => parse(tooManyTokens), /too long/);
  });
});

describe('templates', () => {
  it('fills placeholders, ignores unknown ones and escapes HTML on request', () => {
    const v = { name: 'Ada <b>', record: { label: 'Acme' }, n: 3 };
    assert.equal(renderTemplate('Hi {{name}}, re {{ record.label }} x{{n}} {{nope}}!', v), 'Hi Ada <b>, re Acme x3 !');
    assert.equal(renderTemplate('Hi {{name}}', v, { html: true }), 'Hi Ada &lt;b&gt;');
    assert.equal(renderTemplate('{{__proto__}}{{constructor}}', v), '');
  });
});
