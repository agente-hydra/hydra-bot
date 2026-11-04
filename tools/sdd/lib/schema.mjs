// @ts-check

/**
 * @typedef {{
 *   type?: string | string[];
 *   required?: string[];
 *   properties?: Record<string, any>;
 *   items?: any;
 *   enum?: any[];
 *   pattern?: string;
 *   minimum?: number;
 *   maximum?: number;
 *   minItems?: number;
 *   maxItems?: number;
 *   additionalProperties?: boolean | any;
 * }} JsonSchema
 */

/**
 * Validate a data value against a minimal JSON Schema.
 * @param {any} data
 * @param {JsonSchema} schema
 * @param {string} [path]
 * @returns {{ valid: boolean; errors: { path: string; message: string }[] }}
 */
export function validateSchema(data, schema, path = '$') {
  /** @type {{ path: string; message: string }[]} */
  const errors = [];

  if (!schema || typeof schema !== 'object') {
    return { valid: true, errors: [] };
  }

  // Type check
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = getJsonType(data);
    const matches = types.some((t) => {
      if (t === 'integer') return Number.isInteger(data);
      if (t === 'number') return typeof data === 'number' && !Number.isNaN(data);
      return actualType === t;
    });
    if (!matches) {
      errors.push({ path, message: `Expected type ${types.join('|')}, got ${actualType}` });
      return { valid: false, errors }; // Early exit for type mismatch
    }
  }

  // Enum check
  if (schema.enum && Array.isArray(schema.enum)) {
    const match = schema.enum.some((val) => deepEqual(val, data));
    if (!match) {
      errors.push({ path, message: `Value ${JSON.stringify(data)} not in enum [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}]` });
    }
  }

  // String validations
  if (typeof data === 'string') {
    if (schema.pattern) {
      const rx = new RegExp(schema.pattern);
      if (!rx.test(data)) {
        errors.push({ path, message: `String does not match pattern ${schema.pattern}` });
      }
    }
  }

  // Number validations
  if (typeof data === 'number') {
    if (typeof schema.minimum === 'number' && data < schema.minimum) {
      errors.push({ path, message: `Number ${data} is less than minimum ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && data > schema.maximum) {
      errors.push({ path, message: `Number ${data} is greater than maximum ${schema.maximum}` });
    }
  }

  // Array validations
  if (Array.isArray(data)) {
    if (typeof schema.minItems === 'number' && data.length < schema.minItems) {
      errors.push({ path, message: `Array has ${data.length} items, minimum is ${schema.minItems}` });
    }
    if (typeof schema.maxItems === 'number' && data.length > schema.maxItems) {
      errors.push({ path, message: `Array has ${data.length} items, maximum is ${schema.maxItems}` });
    }
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        const itemResult = validateSchema(data[i], schema.items, `${path}[${i}]`);
        errors.push(...itemResult.errors);
      }
    }
  }

  // Object validations
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    if (schema.required && Array.isArray(schema.required)) {
      for (const reqProp of schema.required) {
        if (!(reqProp in data) || data[reqProp] === undefined) {
          errors.push({ path: `${path}.${reqProp}`, message: `Missing required property: ${reqProp}` });
        }
      }
    }
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propName in data && data[propName] !== undefined) {
          const propResult = validateSchema(data[propName], propSchema, `${path}.${propName}`);
          errors.push(...propResult.errors);
        }
      }
    }
    if (schema.additionalProperties === false) {
      const allowedProps = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(data)) {
        if (!allowedProps.has(key)) {
          errors.push({ path: `${path}.${key}`, message: `Unexpected additional property: ${key}` });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function getJsonType(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}
