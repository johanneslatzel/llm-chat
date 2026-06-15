import { describe, it, expect } from 'vitest';
import { ChatRole, Prompt, PromptContainer } from '../../../src/index.js';
import { PromptComponent, ComponentType } from '../../../src/chats/system-prompt.js';

// ---------------------------------------------------------------------------
// PromptComponent (abstract — exercised via Prompt and PromptContainer)
// ---------------------------------------------------------------------------

describe('PromptComponent', () => {
    describe('id', () => {
        it('auto-generates a unique id when omitted', () => {
            const p = new Prompt('title', 'content');
            expect(p.id()).toBeTruthy();
            expect(typeof p.id()).toBe('string');
        });

        it('uses the provided id', () => {
            const p = new Prompt('title', 'content', 'my-id');
            expect(p.id()).toBe('my-id');
        });

        it('generates different ids for different instances', () => {
            const a = new Prompt('t', 'c');
            const b = new Prompt('t', 'c');
            expect(a.id()).not.toBe(b.id());
        });
    });

    describe('title / setTitle', () => {
        it('returns the title passed to the constructor', () => {
            const p = new Prompt('My Title', 'content');
            expect(p.title()).toBe('My Title');
        });

        it('setTitle overrides the title', () => {
            const p = new Prompt('Old', 'content');
            p.setTitle('New');
            expect(p.title()).toBe('New');
        });

        it('setTitle invalidates the compose cache', () => {
            const p = new Prompt('Title', 'hello');
            p.compose();
            p.setTitle('Changed');
            const result = p.compose();
            expect(result).toContain('Changed');
            expect(result).not.toContain('Title');
        });
    });

    describe('hasTitle', () => {
        it('returns true for non-empty title', () => {
            const p = new Prompt('Title', 'c');
            expect(p.hasTitle()).toBe(true);
        });

        it('returns false for empty title', () => {
            const p = new Prompt('', 'c');
            expect(p.hasTitle()).toBe(false);
        });
    });

    describe('compose caching', () => {
        it('caches compose result across multiple calls', () => {
            const p = new Prompt('Title', 'hello');
            const first = p.compose();
            const second = p.compose();
            expect(first).toBe(second);
        });

        it('invalidates child cache when setContent is called', () => {
            const p = new Prompt('Title', 'hello');
            p.compose();
            p.setContent('world');
            const after = p.compose();
            expect(after).toContain('world');
        });

        it('invalidates parent cache when child is mutated', () => {
            const child = new Prompt('Child', 'text');
            const root = new PromptContainer('');
            root.add(child);

            root.compose();
            child.setContent('updated');

            const after = root.compose();
            expect(after).toContain('updated');
        });

        it('invalidates parent cache when a new child is added', () => {
            const root = new PromptContainer('Root');
            root.compose();
            root.add(new Prompt('Child', 'new text'));
            const after = root.compose();
            expect(after).toContain('new text');
        });

        it('child setTitle invalidates its own compose cache', () => {
            const child = new Prompt('Old', 'text');
            child.compose();
            child.setTitle('New');
            const after = child.compose();
            expect(after).toContain('New');
            expect(after).not.toContain('Old');
        });
    });

    describe('message', () => {
        it('returns a ChatMessage with role System', () => {
            const p = new Prompt('Title', 'content');
            const msg = p.message();
            expect(msg.role).toBe(ChatRole.System);
            expect(msg.content).toBe(p.compose());
            expect(msg.createdAt).toBeInstanceOf(Date);
        });
    });
});

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

describe('Prompt', () => {
    describe('hasContent', () => {
        it('returns true for non-empty content', () => {
            const p = new Prompt('T', 'hello');
            expect(p.hasContent()).toBe(true);
        });

        it('returns false for empty content', () => {
            const p = new Prompt('T', '');
            expect(p.hasContent()).toBe(false);
        });
    });

    describe('content', () => {
        it('returns the raw content', () => {
            const p = new Prompt('T', 'hello\nworld');
            expect(p.content()).toBe('hello\nworld');
        });
    });

    describe('setContent', () => {
        it('overrides content and invalidates cache', () => {
            const p = new Prompt('T', 'old');
            p.compose();
            p.setContent('new');
            expect(p.content()).toBe('new');
            expect(p.compose()).toContain('new');
        });
    });

    describe('clear', () => {
        it('clears content and title', () => {
            const p = new Prompt('My Title', 'some content');
            p.clear();
            expect(p.content()).toBe('');
            expect(p.title()).toBe('');
            expect(p.hasContent()).toBe(false);
        });

        it('invalidate compose cache', () => {
            const p = new Prompt('Title', 'content');
            p.compose();
            p.clear();
            expect(p.compose()).toBe('');
        });
    });

    describe('compose', () => {
        it('renders title + indented content when titled', () => {
            const p = new Prompt('My Title', 'line1\nline2');
            const output = p.compose();
            expect(output).toBe('My Title\n    line1\n    line2');
        });

        it('renders flat content when title is empty', () => {
            const p = new Prompt('', 'flat content');
            expect(p.compose()).toBe('flat content');
        });
    });

    describe('toJSON', () => {
        it('serializes with type, title, content, id', () => {
            const p = new Prompt('Title', 'content', 'my-id');
            const json = p.toJSON() as any;
            expect(json.type).toBe(ComponentType.Prompt);
            expect(json.title).toBe('Title');
            expect(json.content).toBe('content');
            expect(json.id).toBe('my-id');
        });
    });
});

// ---------------------------------------------------------------------------
// PromptContainer
// ---------------------------------------------------------------------------

describe('PromptContainer', () => {
    describe('add', () => {
        it('appends a child component', () => {
            const root = new PromptContainer('');
            const child = new Prompt('T', 'c');
            root.add(child);
            expect(root.hasContent()).toBe(true);
        });

        it('sets parent reference on the added child', () => {
            const root = new PromptContainer('');
            const child = new Prompt('T', 'c');
            root.add(child);
            expect((child as any)._parent).toBe(root);
        });
    });

    describe('hasContent', () => {
        it('returns false when empty', () => {
            expect(new PromptContainer('').hasContent()).toBe(false);
        });

        it('returns true when a child has content', () => {
            const root = new PromptContainer('');
            root.add(new Prompt('T', 'hello'));
            expect(root.hasContent()).toBe(true);
        });

        it('returns true when a nested child has content', () => {
            const inner = new PromptContainer('Inner');
            inner.add(new Prompt('Leaf', 'text'));
            const root = new PromptContainer('');
            root.add(inner);
            expect(root.hasContent()).toBe(true);
        });

        it('returns true when later child has content after empty ones', () => {
            const root = new PromptContainer('');
            root.add(new Prompt('Empty1', ''));
            root.add(new Prompt('Empty2', ''));
            root.add(new Prompt('Full', 'content'));
            expect(root.hasContent()).toBe(true);
        });
    });

    describe('content', () => {
        it('returns the composed output', () => {
            const root = new PromptContainer('');
            root.add(new Prompt('A', 'first'));
            root.add(new Prompt('B', 'second'));
            expect(root.content()).toBe('A\n    first\nB\n    second');
        });

        it('includes child titles when children are titled', () => {
            const root = new PromptContainer('');
            root.add(new Prompt('Section', 'content text'));
            expect(root.content()).toBe('Section\n    content text');
        });
    });

    describe('compose', () => {
        it('wraps children with title + indentation', () => {
            const root = new PromptContainer('Root');
            root.add(new Prompt('', 'child1'));
            root.add(new Prompt('', 'child2'));
            expect(root.compose()).toBe('Root\n    child1\n    child2');
        });

        it('renders flat when titled is empty', () => {
            const root = new PromptContainer('');
            root.add(new Prompt('', 'flat'));
            expect(root.compose()).toBe('flat');
        });

        it('nests child compose output under parent title', () => {
            const root = new PromptContainer('Root');
            const child = new Prompt('Section', 'text');
            root.add(child);
            expect(root.compose()).toBe('Root\n    Section\n        text');
        });
    });

    describe('child', () => {
        it('creates a container child and returns it', () => {
            const root = new PromptContainer('');
            const c = root.child('a');
            expect(c.title()).toBe('a');
            expect(c.id()).toBe('a');
            expect(c).toBeInstanceOf(PromptContainer);
        });

        it('chained child() creates nested containers', () => {
            const root = new PromptContainer('');
            const c = root.child('a').child('b').child('c');
            expect(c.id()).toBe('c');
            expect(c).toBeInstanceOf(PromptContainer);
        });

        it('returns existing container when id exists', () => {
            const root = new PromptContainer('');
            const first = root.child('a');
            const second = root.child('a');
            expect(first).toBe(second);
        });

        it('throws when a child with matching id exists but is not a container', () => {
            const root = new PromptContainer('');
            root.prompt('leaf');
            expect(() => root.child('leaf')).toThrow('leaf');
        });
    });

    describe('prompt', () => {
        it('creates a prompt child and returns it', () => {
            const root = new PromptContainer('');
            const p = root.prompt('greeting');
            expect(p.title()).toBe('greeting');
            expect(p.id()).toBe('greeting');
            expect(p).toBeInstanceOf(Prompt);
        });

        it('returns existing prompt when id exists', () => {
            const root = new PromptContainer('');
            const first = root.prompt('greeting');
            const second = root.prompt('greeting');
            expect(first).toBe(second);
        });

        it('throws when a child with matching id exists but is a container', () => {
            const root = new PromptContainer('');
            root.child('block');
            expect(() => root.prompt('block')).toThrow('block');
        });

        it('chains after child() to create nested prompts', () => {
            const root = new PromptContainer('');
            const p = root.child('section').prompt('my-prompt');
            expect(p.id()).toBe('my-prompt');
            expect(p).toBeInstanceOf(Prompt);
        });
    });

    describe('clear', () => {
        it('removes all children and resets title', () => {
            const root = new PromptContainer('Root');
            root.add(new Prompt('Child', 'text'));
            root.clear();
            expect(root.title()).toBe('');
            expect(root.hasContent()).toBe(false);
            expect(root.content()).toBe('');
        });

        it('invalidates compose cache on parent', () => {
            const root = new PromptContainer('Root');
            const child = new Prompt('Child', 'text');
            root.add(child);
            root.compose();
            child.clear();
            const output = root.compose();
            expect(output).not.toContain('text');
        });
    });

    describe('toJSON', () => {
        it('serializes container with children', () => {
            const root = new PromptContainer('Root', 'root-id');
            root.add(new Prompt('Child', 'text', 'child-id'));
            const json = root.toJSON() as any;
            expect(json.type).toBe(ComponentType.Container);
            expect(json.title).toBe('Root');
            expect(json.id).toBe('root-id');
            expect(json.components).toHaveLength(1);
            expect(json.components[0].type).toBe(ComponentType.Prompt);
            expect(json.components[0].id).toBe('child-id');
        });

        it('empty container serializes with no children', () => {
            const root = new PromptContainer('Empty');
            const json = root.toJSON() as any;
            expect(json.components).toHaveLength(0);
        });
    });
});

// ---------------------------------------------------------------------------
// fromJSON
// ---------------------------------------------------------------------------

describe('fromJSON', () => {
    it('deserializes a Prompt', () => {
        const c = PromptComponent.fromJSON({
            type: ComponentType.Prompt,
            title: 'Title',
            content: 'text',
            id: 'pid'
        });
        expect(c).toBeInstanceOf(Prompt);
        expect(c.title()).toBe('Title');
        expect((c as Prompt).content()).toBe('text');
        expect(c.id()).toBe('pid');
    });

    it('deserializes a PromptContainer', () => {
        const c = PromptComponent.fromJSON({
            type: ComponentType.Container,
            title: 'Root',
            id: 'rid',
            components: [
                { type: ComponentType.Prompt, title: 'Child', content: 'v' }
            ]
        });
        expect(c).toBeInstanceOf(PromptContainer);
        expect(c.title()).toBe('Root');
        expect(c.id()).toBe('rid');
        expect(c.hasContent()).toBe(true);
        expect((c as PromptContainer).content()).toBe('Root\n    Child\n        v');
    });

    it('round-trips through toJSON / fromJSON', () => {
        const root = new PromptContainer('Root', 'rid');
        root.add(new Prompt('A', 'a', 'aid'));
        root.add(new Prompt('B', 'b', 'bid'));
        const json = root.toJSON();
        const restored = PromptComponent.fromJSON(json) as PromptContainer;
        expect(restored.title()).toBe('Root');
        expect(restored.id()).toBe('rid');
        expect(restored.content()).toBe('Root\n    A\n        a\n    B\n        b');
        expect((restored as any)._components).toHaveLength(2);
    });

    it('throws on unknown type', () => {
        expect(() =>
            PromptComponent.fromJSON({
                type: 'unknown' as any,
                title: '',
                content: ''
            })
        ).toThrow('cannot be converted from JSON');
    });
});
