/** Valid JSON Schema property types for {@link ToolParameterProperty}. */
export enum PropertyType {
    String = 'string',
    Number = 'number',
    Integer = 'integer',
    Boolean = 'boolean',
    Array = 'array',
    Object = 'object'
}

function isPrimitive(type: PropertyType): boolean {
    return (
        type === PropertyType.String ||
        type === PropertyType.Number ||
        type === PropertyType.Integer ||
        type === PropertyType.Boolean
    );
}

/** Describes the input schema for an OpenAI-compatible tool definition. */
export class ToolParameters {
    /** JSON Schema type — always `'object'`. */
    type: string = 'object';
    /** Map of parameter names to their property definitions. */
    properties: Record<string, ToolParameterProperty>;
    /** Optional list of parameter names that must be provided. */
    required?: string[];
    /** Whether any top-level property declares hidden aliases. */
    private readonly hasAliases: boolean;
    /**
     * @param properties - Named parameter definitions.
     * @param required  - Parameter names that are required.
     */
    constructor(properties: Record<string, ToolParameterProperty>, required?: string[]) {
        this.properties = properties;
        if (required) {
            this.required = required;
        }
        this.validateAliases();
        this.hasAliases = Object.values(this.properties).some(
            (property) => property.aliases.length > 0
        );
    }

    /**
     * Returns a copy of the arguments with hidden alias keys rewritten to their
     * canonical parameter names.
     *
     * The canonical name always wins when it is present. Otherwise the first
     * alias in declaration order that has a value wins. A scalar alias value for
     * an array-typed parameter is wrapped in a one-element array. Consumed alias
     * keys are removed from the result.
     *
     * @param args - Raw tool-call arguments.
     * @returns Normalized arguments, or `args` itself when no aliases exist.
     */
    normalizeArguments(args: Record<string, unknown>): Record<string, unknown> {
        if (!this.hasAliases) {
            return args;
        }

        const normalized = { ...args };
        for (const [canonical, property] of Object.entries(this.properties)) {
            if (property.aliases.length === 0) {
                continue;
            }

            if (normalized[canonical] === undefined) {
                for (const alias of property.aliases) {
                    const value = normalized[alias];
                    if (value === undefined) {
                        continue;
                    }
                    normalized[canonical] =
                        property.type === PropertyType.Array && !Array.isArray(value)
                            ? [value]
                            : value;
                    break;
                }
            }

            for (const alias of property.aliases) {
                delete normalized[alias];
            }
        }
        return normalized;
    }

    /** Validates that alias declarations are unambiguous and do not shadow declared names. */
    private validateAliases(): void {
        const declared = new Set(Object.keys(this.properties));
        const claimed = new Map<string, string>();

        for (const [canonical, property] of Object.entries(this.properties)) {
            for (const alias of property.aliases) {
                if (!alias.trim() || alias !== alias.trim()) {
                    throw new Error(
                        `Alias '${alias}' for parameter '${canonical}' must be a non-empty string without surrounding whitespace`
                    );
                }
                if (alias === canonical) {
                    throw new Error(
                        `Alias '${alias}' for parameter '${canonical}' must differ from the canonical name`
                    );
                }
                if (declared.has(alias)) {
                    throw new Error(
                        `Alias '${alias}' for parameter '${canonical}' collides with a declared parameter name`
                    );
                }

                const owner = claimed.get(alias);
                if (owner !== undefined) {
                    throw new Error(
                        owner === canonical
                            ? `Alias '${alias}' is declared more than once for parameter '${canonical}'`
                            : `Alias '${alias}' is declared for both '${owner}' and '${canonical}'`
                    );
                }
                claimed.set(alias, canonical);
            }
        }
    }

    /** Serializes to a JSON Schema object. Called automatically by `JSON.stringify`. */
    toJSON() {
        const serializeProp = (prop: ToolParameterProperty): Record<string, unknown> => {
            const entry: Record<string, unknown> = {
                type: prop.type,
                description: prop.description
            };
            if (prop.type === PropertyType.Object && prop.properties) {
                entry.properties = serializeProps(prop.properties);
                if (prop.required) entry.required = prop.required;
            }
            if (prop.type === PropertyType.Array) {
                entry.items = prop.items ? serializeProp(prop.items) : { type: 'string' };
            }
            return entry;
        };

        const serializeProps = (
            props: Record<string, ToolParameterProperty>
        ): Record<string, unknown> => {
            const result: Record<string, unknown> = {};
            for (const [key, prop] of Object.entries(props)) {
                result[key] = serializeProp(prop);
            }
            return result;
        };

        const result: Record<string, unknown> = {
            type: this.type,
            properties: serializeProps(this.properties)
        };
        if (this.required) result.required = this.required;
        return result;
    }
}

/** A single parameter definition within a tool's input schema. */
export class ToolParameterProperty {
    /** The JSON Schema type for this parameter (e.g. `string`, `integer`). */
    readonly type: PropertyType;
    /** A human-readable description of what this parameter does. */
    readonly description: string;
    /** Nested property definitions for object-typed parameters. */
    readonly properties: Record<string, ToolParameterProperty> | undefined;
    /** Required sub-property keys for object-typed parameters. */
    readonly required: string[] | undefined;
    /** Item schema for array-typed parameters (defaults to string when undefined). */
    readonly items: ToolParameterProperty | undefined;
    /**
     * Alternate top-level argument names accepted for this parameter, in
     * precedence order. Aliases are never serialized into the tool schema.
     */
    readonly aliases: readonly string[];

    /**
     * @param description - Human-readable description.
     * @param type        - JSON Schema type (defaults to `PropertyType.String`).
     * @param properties  - Nested property definitions (only valid for object type).
     * @param required    - Required sub-property keys (only valid for object type).
     * @param items       - Item schema (only valid for array type).
     * @param aliases     - Hidden alternate argument names, in precedence order.
     */
    constructor(
        description: string,
        type: PropertyType = PropertyType.String,
        properties?: Record<string, ToolParameterProperty>,
        required?: string[],
        items?: ToolParameterProperty,
        aliases?: readonly string[]
    ) {
        this.description = description;
        this.type = type;
        this.properties = properties;
        this.required = required;
        this.items = items;
        this.aliases = aliases ? [...aliases] : [];
        this.validate();
    }

    /**
     * Returns a copy of this property that also accepts the given hidden
     * argument names. Aliases are tried in the order given and are never
     * exposed in the tool schema.
     *
     * @param aliases - Alternate argument names to accept.
     */
    accepts(...aliases: string[]): ToolParameterProperty {
        return new ToolParameterProperty(
            this.description,
            this.type,
            this.properties,
            this.required,
            this.items,
            [...this.aliases, ...aliases]
        );
    }

    private validate(): void {
        if (this.type === PropertyType.Object) {
            if (this.items) {
                throw new Error(
                    `Property "${this.description}" has type object but also specifies items`
                );
            }
            if (!this.properties || Object.keys(this.properties).length === 0) {
                throw new Error(
                    `Property "${this.description}" has type object but no child properties`
                );
            }
            if (this.required?.some((k) => !(k in this.properties!))) {
                throw new Error(
                    `Property "${this.description}" has required key not present in properties`
                );
            }
            return;
        }
        if (this.type === PropertyType.Array) {
            if (this.properties) {
                throw new Error(
                    `Property "${this.description}" has type array but also specifies child properties`
                );
            }
            return;
        }
        if (isPrimitive(this.type) && (this.properties || this.items || this.required)) {
            throw new Error(
                `Property "${this.description}" has primitive type but also specifies nested schema`
            );
        }
    }

    static string(desc: string): ToolParameterProperty {
        return new ToolParameterProperty(desc, PropertyType.String);
    }

    static number(desc: string): ToolParameterProperty {
        return new ToolParameterProperty(desc, PropertyType.Number);
    }

    static integer(desc: string): ToolParameterProperty {
        return new ToolParameterProperty(desc, PropertyType.Integer);
    }

    static boolean(desc: string): ToolParameterProperty {
        return new ToolParameterProperty(desc, PropertyType.Boolean);
    }

    static array(desc: string, items?: ToolParameterProperty): ToolParameterProperty {
        return new ToolParameterProperty(desc, PropertyType.Array, undefined, undefined, items);
    }

    static object(desc: string): ObjectPropertyBuilder {
        return new ObjectPropertyBuilder(desc);
    }
}

export class ObjectPropertyBuilder {
    private props: Record<string, ToolParameterProperty> = {};
    private requiredKeys: string[] = [];

    constructor(private description: string) {}

    addProperty(name: string, prop: ToolParameterProperty): this {
        this.props[name] = prop;
        return this;
    }

    setRequired(...names: string[]): this {
        this.requiredKeys = names;
        return this;
    }

    build(): ToolParameterProperty {
        return new ToolParameterProperty(
            this.description,
            PropertyType.Object,
            this.props,
            this.requiredKeys.length > 0 ? this.requiredKeys : undefined
        );
    }
}
