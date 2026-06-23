import { randomUUID } from 'node:crypto';
import { ChatMessage, ChatMessageOrigin, ChatRole } from './types.js';

const INDENTATION = '    ';

export enum ComponentType {
    Prompt = 'prompt',
    Container = 'container'
}

export type ComponentJSON =
    | { type: ComponentType.Prompt; title: string; content: string; id?: string }
    | { type: ComponentType.Container; title: string; components: ComponentJSON[]; id?: string };

export abstract class PromptComponent {
    private _id: string;
    private _composed: string | undefined;
    private _parent: PromptContainer | null = null;

    constructor(
        protected _title: string,
        id?: string
    ) {
        this._id = id ?? randomUUID();
    }

    /** Remove all content and reset the title to empty. Implementations must
     *  zero out their state and call {@link invalidate}. */
    abstract clear(): void;
    abstract hasContent(): boolean;
    abstract toJSON(): ComponentJSON;

    id(): string {
        return this._id;
    }

    title(): string {
        return this._title;
    }

    setTitle(title: string): void {
        this._title = title;
        this.invalidate();
    }

    hasTitle(): boolean {
        return this._title.length > 0;
    }

    setParent(parent: PromptContainer | null): void {
        this._parent = parent;
    }

    protected invalidate(): void {
        this._composed = undefined;
        this._parent?.invalidate();
    }

    compose(): string {
        if (this._composed !== undefined) return this._composed;
        this._composed = this.buildComposed();
        return this._composed;
    }

    protected abstract buildComposed(): string;

    message(): ChatMessage {
        return {
            role: ChatRole.System,
            content: this.compose(),
            createdAt: new Date(),
            origin: ChatMessageOrigin.System
        };
    }

    static fromJSON(json: ComponentJSON): PromptComponent {
        switch (json.type) {
            case ComponentType.Prompt:
                return new Prompt(json.title, json.content, json.id);
            case ComponentType.Container: {
                const c = new PromptContainer(json.title, json.id);
                for (const child of json.components) {
                    c.add(PromptComponent.fromJSON(child));
                }
                return c;
            }
            default: {
                throw new Error('PromptComponent type cannot be converted from JSON');
            }
        }
    }
}

/** A single leaf prompt component with a title and content string. */
export class Prompt extends PromptComponent {
    constructor(
        title: string,
        private _content: string,
        id?: string
    ) {
        super(title, id);
    }

    /** Clear content and title. After calling this, {@link hasContent} returns
     *  `false` and {@link compose} produces an empty string. */
    clear(): void {
        this._content = '';
        this._title = '';
        this.invalidate();
    }

    /** Whether the prompt has any content. */
    hasContent(): boolean {
        return this._content.length > 0;
    }

    /** The raw content string (without title prefix). */
    content(): string {
        return this._content;
    }

    /** Set the raw content string. */
    setContent(content: string): void {
        this._content = content;
        this.invalidate();
    }

    protected buildComposed(): string {
        if (!this.hasTitle()) {
            return this._content;
        }
        const lines: string[] = [this.title()];
        for (const line of this._content.split('\n')) {
            lines.push(`${INDENTATION}${line}`);
        }
        return lines.join('\n');
    }

    /** Serialise to JSON. */
    toJSON(): ComponentJSON {
        return {
            type: ComponentType.Prompt,
            title: this.title(),
            content: this._content,
            id: this.id()
        };
    }
}

/** A prompt container that groups child components (prompts or nested containers). */
export class PromptContainer extends PromptComponent {
    private _components: PromptComponent[] = [];

    constructor(title: string, id?: string) {
        super(title, id);
    }

    /** Add a child component. */
    add(component: PromptComponent): void {
        component.setParent(this);
        this._components.push(component);
        this.invalidate();
    }

    /** Whether any child component has content. */
    hasContent(): boolean {
        for (const component of this._components) {
            if (component.hasContent()) return true;
        }
        return false;
    }

    /** The composed content of all children. */
    content(): string {
        return this.compose();
    }

    /** Get or create a child container by id. */
    child(id: string): PromptContainer {
        const existing = this._components.find((c) => c.id() === id);
        if (existing) {
            if (!(existing instanceof PromptContainer)) {
                throw new Error(`'${id}' exists but is not a container`);
            }
            return existing;
        }
        const c = new PromptContainer(id, id);
        this.add(c);
        return c;
    }

    /** Get or create a child prompt by id. */
    prompt(id: string): Prompt {
        const existing = this._components.find((c) => c.id() === id);
        if (existing) {
            if (!(existing instanceof Prompt)) {
                throw new Error(`'${id}' exists but is not a prompt`);
            }
            return existing;
        }
        const p = new Prompt(id, '', id);
        this.add(p);
        return p;
    }

    /** Remove all child components and reset the title to empty. After
     *  calling this, {@link hasContent} returns `false`. */
    clear(): void {
        this._components = [];
        this._title = '';
        this.invalidate();
    }

    protected buildComposed(): string {
        if (this._components.length === 0) return '';
        const body = this._components.map((c) => c.compose()).join('\n');
        if (!this.hasTitle()) {
            return body;
        }
        const indented = body
            .split('\n')
            .map((line) => `${INDENTATION}${line}`)
            .join('\n');
        return `${this.title()}\n${indented}`;
    }

    /** Serialise to JSON. */
    toJSON(): ComponentJSON {
        return {
            type: ComponentType.Container,
            title: this.title(),
            components: this._components.map((c) => c.toJSON()),
            id: this.id()
        };
    }
}
