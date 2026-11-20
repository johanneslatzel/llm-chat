/** A JSON Schema object accepted by OpenAI Structured Outputs. */
export type JsonSchemaObject = Record<string, unknown>;

/** Discriminant for OpenAI `response_format` types. */
export enum ResponseFormatType {
    Text = 'text',
    JsonObject = 'json_object',
    JsonSchema = 'json_schema'
}

/** Default text response format. */
export interface ResponseFormatText {
    type: ResponseFormatType.Text;
}

/** JSON object mode. The prompt must instruct the model to return JSON. */
export interface ResponseFormatJsonObject {
    type: ResponseFormatType.JsonObject;
}

/** Structured Outputs constrained by a JSON Schema. */
export interface ResponseFormatJsonSchema {
    type: ResponseFormatType.JsonSchema;
    json_schema: {
        name: string;
        description?: string;
        schema: JsonSchemaObject;
        strict?: boolean;
    };
}

/** Response format accepted by {@link OpenAIChatService}. */
export type ResponseFormat =
    ResponseFormatText | ResponseFormatJsonObject | ResponseFormatJsonSchema;

/** Options for the {@link OpenAIChatServiceBuilder.jsonSchema} builder method. */
export interface JsonSchemaResponseOptions {
    name: string;
    schema: JsonSchemaObject;
    description?: string;
    strict?: boolean;
}

/** Why structured-output parsing failed. */
export enum StructuredOutputErrorReason {
    Refused = 'refused',
    Filtered = 'filtered',
    Incomplete = 'incomplete',
    InvalidJson = 'invalid_json'
}

/** Error raised when the last assistant output cannot be returned as structured JSON. */
export class StructuredOutputError extends Error {
    /** Machine-readable failure reason. */
    readonly reason: StructuredOutputErrorReason;

    /**
     * @param reason  - Why the structured output is unavailable.
     * @param message - Safe, user-facing explanation.
     * @param options - Optional underlying cause.
     */
    constructor(
        reason: StructuredOutputErrorReason,
        message: string,
        options: { cause?: unknown } = {}
    ) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = 'StructuredOutputError';
        this.reason = reason;
    }
}
