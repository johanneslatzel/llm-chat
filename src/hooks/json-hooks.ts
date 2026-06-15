import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Hook } from './hook.js';
import { ChatMessageOrigin, ChatRole, type HookMessageWriter } from '../chats/chat.js';
import { ChunkType } from '../chats/stream.js';
import type { ToolResult } from '../tools/base.js';
import type { ChatHookBuilder } from '../chats/chat.js';
import type { StreamHookBuilder } from '../chats/stream.js';
import type { ToolHookBuilder } from '../tools/suite.js';

export type JsonHookTarget = 'chat' | 'stream' | 'tool';

export type JsonHookInfo = {
    label: string;
    target: JsonHookTarget;
};

export type JsonAction = {
    type: string;
    message?: string;
    role?: string;
    resend?: boolean;
};

type JsonHookBase = {
    label?: string;
    enabled?: boolean;
    actions?: JsonAction[];
};

export type JsonHookChat = JsonHookBase & {
    target: 'chat';
    roles?: string[];
    regex?: string;
    maxTriggers?: number;
};

export type JsonHookStream = JsonHookBase & {
    target: 'stream';
    chunks?: string[];
};

export type JsonHookTool = JsonHookBase & {
    target: 'tool';
    tools?: string[];
    event?: 'before' | 'after' | 'error';
};

export type JsonHookDefinition = JsonHookChat | JsonHookStream | JsonHookTool;

export type HookEventData = Record<string, unknown>;

export type ActionHandler = (data: HookEventData, action: JsonAction) => void;

export interface HookTargets {
    chat?: { hook(): ChatHookBuilder };
    stream?: { hook(): StreamHookBuilder };
    tools?: { hook(): ToolHookBuilder };
}

export interface JsonHookControls {
    setNeedsResend(): void;
    interrupt(needsResend?: boolean): void;
}

export function formatTemplate(template: string, data: HookEventData): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
        const val = data[key];
        return val !== undefined ? String(val) : `{{${key}}}`;
    });
}

function defaultMessage(data: HookEventData): string {
    const label = data.label as string;
    const target = data.target as string;
    const prefix = label ? `[json-hook ${label}]` : '[json-hook]';
    return `${prefix} ${target}: ${JSON.stringify(data)}`;
}

function consoleAction(method: 'log' | 'warn' | 'info' | 'debug'): ActionHandler {
    return (data, action) => {
        console[method](formatTemplate(action.message ?? defaultMessage(data), data));
    };
}

export class JsonHookRegistry {
    // Track hooks so we can dispose them on reload (load() clears
    // then re-registers). Parents (Chat, ChunkStream, ToolSuite) act as
    // event emitters and don't manage Hook lifecycle themselves.
    private _hooks: Hook[] = [];
    private _hookInfos: JsonHookInfo[] = [];
    private _actions: Record<string, ActionHandler>;

    constructor(
        private _hookWriter?: HookMessageWriter,
        private _controls?: JsonHookControls
    ) {
        this._actions = {
            log: consoleAction('log'),
            warn: consoleAction('warn'),
            info: consoleAction('info'),
            debug: consoleAction('debug'),
            interrupt: (_data, action) => {
                this._controls?.interrupt(action.resend);
            },
            'queue-resend': () => {
                this._controls?.setNeedsResend();
            },
            'queue-message': (data, action) => {
                if (!this._hookWriter) return;
                const roleStr = action.role ?? 'assistant';
                const content = formatTemplate(action.message ?? defaultMessage(data), data);
                switch (roleStr) {
                    case 'user':
                        void this._hookWriter.user(content, ChatMessageOrigin.Hook);
                        break;
                    case 'tool':
                        void this._hookWriter.tool(
                            content,
                            `inject-${Date.now()}`,
                            ChatMessageOrigin.Hook
                        );
                        break;
                    case 'reasoning':
                        void this._hookWriter.reasoning(content, ChatMessageOrigin.Hook);
                        break;
                    default:
                        void this._hookWriter.assistant(content, undefined, ChatMessageOrigin.Hook);
                }
            }
        };
    }

    get size(): number {
        return this._hooks.length;
    }

    get hookInfos(): readonly JsonHookInfo[] {
        return this._hookInfos;
    }

    setAction(name: string, handler: ActionHandler): void {
        this._actions[name] = handler;
    }

    removeAction(name: string): void {
        delete this._actions[name];
    }

    async load(dirPath: string, targets: HookTargets): Promise<this> {
        this.clear(); // dispose previous hooks to avoid duplicate listeners
        const absDir = path.resolve(process.cwd(), dirPath);
        let entries: string[];
        try {
            entries = await readdir(absDir);
        } catch {
            console.warn(`JsonHookRegistry: hooks directory not found: ${absDir}`);
            return this;
        }
        const jsonFiles = entries.filter((f) => f.endsWith('.json')).sort();
        for (const file of jsonFiles) {
            const filePath = path.join(absDir, file);
            try {
                const content = await readFile(filePath, 'utf-8');
                const parsed = JSON.parse(content);
                const defs: JsonHookDefinition[] = Array.isArray(parsed) ? parsed : [parsed];
                for (const def of defs) {
                    const hook = this._registerOne(def, targets);
                    if (hook) {
                        this._hooks.push(hook);
                        this._hookInfos.push({ label: def.label ?? '', target: def.target });
                    }
                }
            } catch (err) {
                console.warn(
                    `JsonHookRegistry: skipping ${path.basename(filePath)} — ${(err as Error).message}`
                );
            }
        }
        return this;
    }

    // Dispose all tracked hooks so load() can re-register without
    // accumulating duplicate listeners on the parent objects.
    clear(): void {
        for (const h of this._hooks) {
            h.dispose();
        }
        this._hooks = [];
        this._hookInfos = [];
    }

    private _executeActions(def: JsonHookDefinition, data: HookEventData): void {
        const list = def.actions?.length ? def.actions : [{ type: 'log' }];
        for (const action of list) {
            const handler = this._actions[action.type];
            if (!handler) {
                console.warn(
                    `JsonHookRegistry: unknown action type '${action.type}', skipping remaining actions`
                );
                return;
            }
            handler(data, action);
        }
    }

    private _registerOne(def: JsonHookDefinition, targets: HookTargets): Hook | null {
        if (def.enabled === false) return null;
        if (!def.target) {
            console.warn('JsonHookRegistry: hook definition missing target');
            return null;
        }
        if (def.target === 'chat') return this._registerChat(def, targets.chat);
        if (def.target === 'stream') return this._registerStream(def, targets.stream);
        if (def.target === 'tool') return this._registerTool(def, targets.tools);
        console.warn(`JsonHookRegistry: unknown target '${(def as { target: string }).target}'`);
        return null;
    }

    private _registerChat(def: JsonHookChat, target: HookTargets['chat']): Hook | null {
        if (!target) {
            console.warn('JsonHookRegistry: chat hook requires a chat target');
            return null;
        }
        const matchingRoles =
            def.roles
                ?.map((r) => {
                    const role = Object.values(ChatRole).find((v) => v === r);
                    if (!role) console.warn(`JsonHookRegistry: unknown role '${r}'`);
                    return role;
                })
                .filter((r): r is ChatRole => r !== undefined) ?? [];
        const effectiveRoles =
            matchingRoles.length === 0 && !def.regex ? Object.values(ChatRole) : matchingRoles;
        let builder = target.hook().message(...effectiveRoles);
        if (def.regex) builder = builder.regex(def.regex);
        if (def.maxTriggers !== undefined) builder = builder.maxTriggers(def.maxTriggers);
        return builder.do((message, matches) => {
            this._executeActions(def, {
                label: def.label ?? '',
                target: def.target,
                role: message.role,
                content: message.content,
                match: matches[0]
            });
        });
    }

    private _registerStream(def: JsonHookStream, target: HookTargets['stream']): Hook | null {
        if (!target) {
            console.warn('JsonHookRegistry: stream hook requires a stream target');
            return null;
        }
        const types = def.chunks
            ?.map((c) => {
                const chunkType = Object.values(ChunkType).find((v) => v === c);
                if (!chunkType) console.warn(`JsonHookRegistry: unknown chunk type '${c}'`);
                return chunkType;
            })
            .filter((c): c is ChunkType => c !== undefined);
        const builder = target.hook().chunks(...(types ?? []));
        return builder.do((chunk) => {
            const vars: Record<string, string> = {
                label: def.label ?? '',
                target: def.target,
                type: chunk.type
            };
            if ('text' in chunk) vars.text = chunk.text;
            if ('toolCallId' in chunk && chunk.toolCallId) vars.toolCallId = chunk.toolCallId;
            if ('finishReason' in chunk) vars.finishReason = chunk.finishReason;
            this._executeActions(def, vars);
        });
    }

    private _registerTool(def: JsonHookTool, target: HookTargets['tools']): Hook | null {
        if (!target) {
            console.warn('JsonHookRegistry: tool hook requires a tools target');
            return null;
        }
        let builder = target.hook();
        if (def.tools && def.tools.length > 0) builder = builder.filter(...def.tools);
        const event = def.event ?? 'after';
        switch (event) {
            case 'before':
                return builder.before().do((name, args) => {
                    this._executeActions(def, {
                        label: def.label ?? '',
                        target: def.target,
                        event: 'before',
                        name,
                        args
                    });
                });
            case 'after':
                return builder.after().do((result) => {
                    this._executeActions(def, {
                        label: def.label ?? '',
                        target: def.target,
                        event: 'after',
                        result: result as ToolResult
                    });
                });
            case 'error':
                return builder.error().do((name, error) => {
                    this._executeActions(def, {
                        label: def.label ?? '',
                        target: def.target,
                        event: 'error',
                        name,
                        error: error.message
                    });
                });
            default:
                console.warn(`JsonHookRegistry: unknown tool event '${event}'`);
                return null;
        }
    }
}
