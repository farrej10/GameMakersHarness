import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const agentInstructionRoles = ['logic', 'level', 'art', 'repair'] as const;
export type AgentInstructionRole = (typeof agentInstructionRoles)[number];
export type AgentInstructions = Partial<Record<AgentInstructionRole, string>>;

export function normalizeAgentInstructions(value: unknown): AgentInstructions {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Agent instructions must be an object.');
  }
  const input = value as Record<string, unknown>;
  const extra = Object.keys(input).filter(
    (key) => !agentInstructionRoles.includes(key as AgentInstructionRole),
  );
  if (extra.length) throw new Error(`Unsupported agent instruction roles: ${extra.join(', ')}.`);
  const result: AgentInstructions = {};
  for (const role of agentInstructionRoles) {
    const instruction = input[role];
    if (instruction === undefined || instruction === null || instruction === '') continue;
    if (typeof instruction !== 'string') throw new Error(`${role} instructions must be text.`);
    const trimmed = instruction.trim();
    if (Buffer.byteLength(trimmed, 'utf8') > 2_000) {
      throw new Error(`${role} instructions exceed 2000 UTF-8 bytes.`);
    }
    if (trimmed) result[role] = trimmed;
  }
  return result;
}

export function readAgentInstructions(runRoot: string): AgentInstructions {
  const file = path.join(runRoot, 'agent-instructions.json');
  if (!existsSync(file)) return {};
  return normalizeAgentInstructions(JSON.parse(readFileSync(file, 'utf8')));
}

export function writeAgentInstructions(runRoot: string, value: unknown): AgentInstructions {
  const instructions = normalizeAgentInstructions(value);
  writeFileSync(path.join(runRoot, 'agent-instructions.json'), `${JSON.stringify(instructions, null, 2)}\n`);
  return instructions;
}

export function applyAgentInstruction(
  basePrompt: string,
  role: AgentInstructionRole,
  instructions: AgentInstructions,
): string {
  const instruction = instructions[role];
  return instruction
    ? `${basePrompt.trimEnd()}\n\nUser guidance for this run:\n${instruction}\n`
    : basePrompt;
}
