# Typed Tools

A tool schema can describe nested objects, arrays, hidden aliases, and multiple
results. This example searches an in-memory document index.

```typescript
import {
    OpenAIChatService,
    ResultBuilder,
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult
} from '@johannes.latzel/llm-chat';

type Document = {
    id: string;
    title: string;
    author: string;
    year: number;
    tags: string[];
};

const documents: Document[] = [
    { id: 'doc-1', title: 'Streaming responses', author: 'Ada', year: 2024, tags: ['api', 'streaming'] },
    { id: 'doc-2', title: 'Streaming at scale', author: 'Ada', year: 2024, tags: ['api', 'operations'] },
    { id: 'doc-3', title: 'Tool schemas', author: 'Grace', year: 2023, tags: ['tools'] }
];

class SearchDocumentsTool extends Tool {
    constructor() {
        super(
            'search_documents',
            'Search the document index by title text, author, year, and tags.',
            new ToolParameters(
                {
                    query: ToolParameterProperty.string('Title text'),
                    filters: ToolParameterProperty.object('Optional filters')
                        .addProperty('author', ToolParameterProperty.string('Author'))
                        .addProperty('year', ToolParameterProperty.integer('Year'))
                        .build(),
                    tags: ToolParameterProperty.array(
                        'Required tags',
                        ToolParameterProperty.string('Tag')
                    ).accepts('tag')
                },
                ['query']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        const query = String(args.query).toLowerCase();
        const tags = Array.isArray(args.tags) ? (args.tags as string[]) : [];
        const filters = (args.filters ?? {}) as Record<string, unknown>;

        const matches = documents.filter(
            (document) =>
                document.title.toLowerCase().includes(query) &&
                (typeof filters.author !== 'string' ||
                    document.author.toLowerCase() === filters.author.toLowerCase()) &&
                (typeof filters.year !== 'number' || document.year === filters.year) &&
                tags.every((tag) => document.tags.includes(tag))
        );

        if (matches.length === 0) {
            return { result: 'No documents matched.', status: ResultStatus.Success };
        }

        return ResultBuilder.from(
            matches.map((document) => ({
                result: `${document.id}: ${document.title} by ${document.author} (${document.year})`,
                status: ResultStatus.Success
            }))
        ).build();
    }
}

const service = OpenAIChatService.builder()
    .systemPrompt('Search the index before answering and cite document IDs.')
    .create();

service.tools().add(new SearchDocumentsTool());

await service.chat().user('Find streaming documents by Ada from 2024 tagged api.');
await service.send();
console.log(service.lastAssistantContent());
```

## Schema features

- `ToolParameterProperty.object()` builds a nested schema.
- `ToolParameterProperty.array()` takes an item schema. `.accepts('tag')` adds a
  hidden alias that is removed before `onExecute` runs.
- `ResultBuilder.from()` returns one result per document, so the model sees
  each match as a separate tool message.

## See also

- [Defining a tool](../tools/defining-tools.md)
- [Multiple results](../tools/defining-tools.md#multiple-results)
- [Hidden parameter aliases](../tools/defining-tools.md#hidden-parameter-aliases)
