import { ValueError, parseValue } from '../dataforms/fieldTypes.js';
import { evaluateExpression } from '../formulas/formula.js';

export class ActionError extends Error {}

// Works out the value a "set field" action writes: a literal or the result of a formula, converted to the field's type.
// Returns null to clear the field. Throws ActionError with a readable message if the value does not fit.
export function computeValue(spec, field, formulaContext) {
  let raw = spec.mode === 'formula' ? evaluateExpression(spec.expression, formulaContext) : spec.value;
  if (raw instanceof Date) raw = field.type === 'date' ? raw.toISOString().slice(0, 10) : raw.toISOString();
  if (typeof raw === 'number' && !Number.isFinite(raw)) raw = null;
  if ((field.type === 'text' || field.type === 'textarea') && typeof raw === 'number') raw = String(raw);
  try {
    const value = parseValue({ ...field, min: field.min, max: field.max }, raw);
    if (value === null && field.required) throw new ValueError('This field is required');
    return value;
  } catch (err) {
    if (err instanceof ValueError) throw new ActionError(`${field.label}: ${err.message}`);
    throw err;
  }
}
