export var ResultStatus;
(function (ResultStatus) {
    ResultStatus["Success"] = "success";
    ResultStatus["Error"] = "error";
})(ResultStatus || (ResultStatus = {}));
export class ToolParameters {
    type = 'object';
    properties;
    required;
    constructor(properties, required) {
        this.properties = properties;
        if (required) {
            this.required = required;
        }
    }
}
export class ToolParameterProperty {
    type = 'string';
    description;
    constructor(description) {
        this.description = description;
    }
}
export class Tool {
    name;
    description;
    parameters;
    constructor(name, description, parameters) {
        this.name = name;
        this.description = description;
        this.parameters = parameters;
    }
    async execute(args) {
        const partialResult = await this.onExecute(args);
        return {
            tool: this.name,
            ...partialResult
        };
    }
    toOpenAI() {
        return {
            type: 'function',
            function: {
                name: this.name,
                description: this.description,
                parameters: this.parameters
            }
        };
    }
}
//# sourceMappingURL=base.js.map