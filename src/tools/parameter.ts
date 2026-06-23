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
    /**
     * @param properties - Named parameter definitions.
     * @param required  - Parameter names that are required.
     */
    constructor(properties: Record<string, ToolParameterProperty>, required?: string[]) {
        this.properties = properties;
        if (required) {
            this.required = required;
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
     * @param description - Human-readable description.
     * @param type        - JSON Schema type (defaults to `PropertyType.String`).
     * @param properties  - Nested property definitions (only valid for object type).
     * @param required    - Required sub-property keys (only valid for object type).
     * @param items       - Item schema (only valid for array type).
     */
    constructor(
        description: string,
        type: PropertyType = PropertyType.String,
        properties?: Record<string, ToolParameterProperty>,
        required?: string[],
        items?: ToolParameterProperty
    ) {
        this.description = description;
        this.type = type;
        this.properties = properties;
        this.required = required;
        this.items = items;
        this.validate();
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
