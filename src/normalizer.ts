import {whiteBright} from 'cli-color'
import {cloneDeep} from 'lodash'
import {JSONSchema, JSONSchemaTypeName, NormalizedJSONSchema} from './types/JSONSchema'
import {escapeBlockComment, justName, log, toSafeString, traverse} from './utils'
import {Options} from './'

export type Rule = (
  schema: JSONSchema,
  rootSchema: JSONSchema,
  fileName: string,
  options: Options,
  isRoot: boolean
) => void
const rules = new Map<string, Rule>()

function hasType(schema: JSONSchema, type: JSONSchemaTypeName) {
  return schema.type === type || (Array.isArray(schema.type) && schema.type.includes(type))
}
function isObjectType(schema: JSONSchema) {
  return schema.properties !== undefined || hasType(schema, 'object') || hasType(schema, 'any')
}
function isArrayType(schema: JSONSchema) {
  return schema.items !== undefined || hasType(schema, 'array') || hasType(schema, 'any')
}

rules.set('Remove `type=["null"]` if `enum=[null]`', schema => {
  if (
    Array.isArray(schema.enum) &&
    schema.enum.some(e => e === null) &&
    Array.isArray(schema.type) &&
    schema.type.includes('null')
  ) {
    schema.type = schema.type.filter(type => type !== 'null')
  }
})

rules.set('Destructure unary types', schema => {
  if (schema.type && Array.isArray(schema.type) && schema.type.length === 1) {
    schema.type = schema.type[0]
  }
})

rules.set('Add empty `required` property if none is defined', schema => {
  if (isObjectType(schema) && !('required' in schema)) {
    schema.required = []
  }
})

rules.set('Transform `required`=false to `required`=[]', schema => {
  if (schema.required === false) {
    schema.required = []
  }
})

// TODO: default to empty schema (as per spec) instead
rules.set('Default additionalProperties to true', schema => {
  if (isObjectType(schema) && !('additionalProperties' in schema) && schema.patternProperties === undefined) {
    schema.additionalProperties = true
  }
})

rules.set('Default top level `id`', (schema, _rootSchema, fileName, _options, isRoot) => {
  if (isRoot && !schema.id) {
    schema.id = toSafeString(justName(fileName))
  }
})

rules.set('Escape closing JSDoc Comment', schema => {
  escapeBlockComment(schema)
})

rules.set('Optionally remove maxItems and minItems', (schema, _rootSchema, _fileName, options) => {
  if (options.ignoreMinAndMaxItems) {
    if ('maxItems' in schema) {
      delete schema.maxItems
    }
    if ('minItems' in schema) {
      delete schema.minItems
    }
  }
})

rules.set('Normalise schema.minItems', (schema, _rootSchema, _fileName, options) => {
  if (options.ignoreMinAndMaxItems) {
    return
  }
  // make sure we only add the props onto array types
  if (isArrayType(schema)) {
    const {minItems} = schema
    schema.minItems = typeof minItems === 'number' ? minItems : 0
  }
  // cannot normalise maxItems because maxItems = 0 has an actual meaning
})

rules.set('Normalize schema.items', (schema, _rootSchema, _fileName, options) => {
  if (options.ignoreMinAndMaxItems) {
    return
  }
  const {maxItems, minItems} = schema
  const hasMaxItems = typeof maxItems === 'number' && maxItems >= 0
  const hasMinItems = typeof minItems === 'number' && minItems > 0

  if (schema.items && !Array.isArray(schema.items) && (hasMaxItems || hasMinItems)) {
    const items = schema.items
    // create a tuple of length N
    const newItems = Array(maxItems || minItems || 0).fill(items)
    if (!hasMaxItems) {
      // if there is no maximum, then add a spread item to collect the rest
      schema.additionalItems = items
    }
    schema.items = newItems
  }

  if (Array.isArray(schema.items) && hasMaxItems && maxItems! < schema.items.length) {
    // it's perfectly valid to provide 5 item defs but require maxItems 1
    // obviously we shouldn't emit a type for items that aren't expected
    schema.items = schema.items.slice(0, maxItems)
  }

  return schema
})

rules.set('Transform $defs to definitions', schema => {
  if (schema.$defs) {
    schema.definitions = schema.$defs
    delete schema.$defs
  }
})

rules.set('Transform const to singleton enum', schema => {
  if (schema.const) {
    schema.enum = [schema.const]
    delete schema.const
  }
})

export function normalize(schema: JSONSchema, filename: string, options: Options): NormalizedJSONSchema {
  const _schema = cloneDeep(schema) as NormalizedJSONSchema
  const apply = (rule: Rule, key: string) => {
    traverse(_schema, (schema, isRoot) => rule(schema, _schema, filename, options, isRoot), true)
    log(whiteBright.bgYellow('normalizer'), `Applied rule: "${key}"`)
  }
  rules.forEach(apply)
  options.normalizerRules?.forEach(apply)
  return _schema
}
