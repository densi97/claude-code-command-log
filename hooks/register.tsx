import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CommandEntry, CommandStatus } from '../types'

const PANE = 'command-log'
const PANE_TITLE = 'Command log'

// Commands are logged as they run and explained only when the person asks.
const EXPLAIN_MAX_PER_CALL = 20
const MAX_COMMANDS = 500
const MAX_COMMAND_CHARS = 2000
const PANE_ENTRIES = 40

const commands = atom({ plugin: 'command-log', key: 'commands' } as const, [])
const isSummarizing = atom({ plugin: 'command-log', key: 'isSummarizing' } as const, false)

const SUMMARIZER = [
  'IMPORTANT CONTEXT:',
  '- You are a separate, lightweight agent spawned to answer this one request.',
  '- The main agent is NOT interrupted; it keeps working independently.',
  '- You have NO tools: you cannot read files, run commands or search. Use only the conversation so far.',
  '- This is a one-off response; there are no follow-up turns.',
  '- Never reproduce secrets, credentials, tokens, keys, environment values or personal data from the conversation.',
  'Answer straight away: do not think it over first, do not call any tool.',
  '',
].join('\n')

function explainPrompt(todo: readonly CommandEntry[]): string {
  const items = todo.map(c => ({
    id: c.id,
    command: c.command.slice(0, MAX_COMMAND_CHARS),
    agentDescription: c.summary,
    ranInSubagent: c.isSubagent || undefined,
  }))

  return [
    SUMMARIZER,
    'The person watching this session keeps a plain-language log of every shell command the agent ran. For each command below write:',
    '- "why": one sentence on why the agent ran it at that point: the goal or question it served in the task, taken from the conversation. If it ran in a subagent and you cannot tell, give the most likely reason from what the subagent was asked to do.',
    '- "what": one or two sentences explaining what the command does, for someone who does not read shell: name each program, notable flag, pipe and redirect, and say whether it changes anything (files, packages, git state, network) or only reads.',
    '',
    'Commands (JSON):',
    JSON.stringify(items, null, 2),
    '',
    'Answer with JSON only, no code fence: an array of {"id": string, "why": string, "what": string}, one per command, in the order given.',
  ].join('\n')
}

type Explained = { why: string; what: string }

export function parseExplanations(text: string): Map<string, Explained> {
  const found = new Map<string, Explained>()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) {
    return found
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed)) {
      return found
    }
    for (const item of parsed) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.why === 'string' &&
        typeof item.what === 'string'
      ) {
        found.set(item.id, { why: item.why.trim(), what: item.what.trim() })
      }
    }
  } catch {
    // An unparseable reply leaves the batch to the fallback below.
  }

  return found
}

function statusOf(ran: { deny?: string; isError?: boolean }): CommandStatus {
  if (ran.deny !== undefined) {
    return 'denied'
  }

  return ran.isError === true ? 'failed' : 'ok'
}

const STATUS_LABEL: Record<CommandStatus, string> = {
  running: '⏳ running',
  ok: '✓ ok',
  failed: '✗ failed',
  denied: '⊘ denied',
}

function clock(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function fence(command: string): string {
  const longest = Math.max(2, ...(command.match(/`+/g) ?? []).map(t => t.length))

  return `${'`'.repeat(longest + 1)}bash\n${command}\n${'`'.repeat(longest + 1)}`
}

function entryMarkdown(c: CommandEntry, n: number): string {
  const tags = [STATUS_LABEL[c.status], clock(c.at)]
  if (c.isSubagent) tags.push('subagent')
  if (c.isBackground) tags.push('background')
  const pending = c.status === 'running' ? '_still running_' : '_not summarized yet_'

  return [
    `**${n}.** ${tags.join(' · ')}`,
    fence(c.command),
    `**Why:** ${c.why ?? pending}`,
    '',
    `**What it does:** ${c.what ?? c.summary ?? pending}`,
  ].join('\n')
}

function logMarkdown(list: readonly CommandEntry[], limit: number): string {
  if (list.length === 0) {
    return '_No shell commands have run in this session yet._'
  }
  const shown = list.slice(-limit).map((c, i, all) => ({ c, n: list.length - all.length + i + 1 }))
  const head =
    list.length > shown.length
      ? `_${list.length} commands, the newest ${shown.length} shown first. \`/commands export\` writes them all._\n\n`
      : `_${list.length} command${list.length === 1 ? '' : 's'}, newest first._\n\n`

  return head + shown.toReversed().map(({ c, n }) => entryMarkdown(c, n)).join('\n\n---\n\n')
}

// Module variables reset on a reload; everything drawn lives in $.state.
let isExplaining = false
let counter = 0

const isUnexplained = (c: CommandEntry) => c.what === undefined && c.status !== 'running'

// Explains the finished commands that are not explained yet, in batches.
async function explainPending($: EngineInterface) {
  if (isExplaining) {
    return
  }
  isExplaining = true
  await update($, isSummarizing, () => true)
  const tried = new Set<string>()
  try {
    for (;;) {
      const todo = (await read($, commands))
        .filter(c => isUnexplained(c) && !tried.has(c.id))
        .slice(0, EXPLAIN_MAX_PER_CALL)
      if (todo.length === 0) {
        break
      }
      todo.forEach(c => tried.add(c.id))
      const reply = await $.model.fork({ prompt: explainPrompt(todo) })
      const found = reply.isAnswered ? parseExplanations(reply.text) : new Map<string, Explained>()
      await update($, commands, list =>
        list.map(c => {
          if (!tried.has(c.id) || c.what !== undefined) return c
          const got = found.get(c.id)

          return got !== undefined
            ? { ...c, ...got }
            : {
                ...c,
                why: 'Not explained: the summarizer gave no answer for it.',
                what: c.summary ?? 'Not explained.',
              }
        }),
      )
    }
  } catch {
    // Left unexplained; the next request tries again.
  } finally {
    isExplaining = false
    await update($, isSummarizing, () => false)
  }
}

async function exportLog($: EngineInterface): Promise<string> {
  const list = await read($, commands)
  const at = new Date()
  const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = `${await $.session.cwd()}/command-log-${stamp}.md`
  const body = list.map((c, i) => entryMarkdown(c, i + 1)).join('\n\n---\n\n')
  await $.fs.write(path, `# Command log\n\n_Exported ${at.toISOString()}, ${list.length} commands._\n\n${body}\n`)

  return path
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'commands',
      description: 'Show every shell command the agent ran, with why and what it does',
      argumentHint: '[summarize|export|clear]',
    })

    return next(e)
  })

  on('command.run', { command: 'commands' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'summarize') {
      await explainPending($)
      await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true })

      return { text: 'Commands summarized.' }
    }
    if (arg === 'export') {
      return { text: `Command log written to ${await exportLog($)}` }
    }
    if (arg === 'clear') {
      await update($, commands, () => [])

      return { text: 'Command log cleared.' }
    }
    await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true })

    return { text: 'Command log opened.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    counter += 1
    const entry: CommandEntry = {
      id: e.tool_use_id ?? `c${Date.now()}-${counter}`,
      command: e.command,
      summary: e.description,
      status: 'running',
      isSubagent: e.agentId !== undefined,
      isBackground: e.run_in_background === true,
      at: Date.now(),
    }
    await update($, commands, list => [...list, entry].slice(-MAX_COMMANDS))

    const ran = await next(e)
    await update($, commands, list =>
      list.map(c => (c.id === entry.id ? { ...c, status: statusOf(ran) } : c)),
    )

    return ran
  }).catch(($, e, next) => next(e)) // logging never blocks a command

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, commands)
    if (e.props.hasSurvey || list.length === 0) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const openLog = () => $.ui.open({ id: PANE, title: PANE_TITLE, focus: true })
    const summarize = async () => {
      await openLog()
      await explainPending($)
    }
    const unexplained = list.filter(isUnexplained).length
    const isBusy = await read($, isSummarizing)

    return (
      <Box gap={1}>
        <Text dimColor>
          {list.length} command{list.length === 1 ? '' : 's'} run
          {unexplained > 0 ? `, ${unexplained} not summarized` : ''} ·
        </Text>
        {isBusy ? (
          <Text dimColor>Summarizing…</Text>
        ) : (
          unexplained > 0 && (
            <Button key="summarize" plain hotkey="s" label="Summarize commands" onPress={summarize} />
          )
        )}
        <Button key="log" plain dimColor hotkey="c" label="Command log" onPress={openLog} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const list = await read($, commands)
    const unexplained = list.filter(isUnexplained).length
    const isBusy = await read($, isSummarizing)

    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={2}>
          {isBusy && <Text dimColor>Summarizing…</Text>}
          {!isBusy && unexplained > 0 && (
            <Button
              key="summarize"
              plain
              hotkey="s"
              label={`Summarize ${unexplained} command${unexplained === 1 ? '' : 's'}`}
              onPress={() => explainPending($)}
            />
          )}
          {list.length > 0 && (
            <Button
              key="export"
              plain
              hotkey="x"
              label="Export to markdown"
              onPress={async () => $.ui.toast(`Command log written to ${await exportLog($)}`)}
            />
          )}
        </Box>
        <Markdown key="log" text={logMarkdown(list, PANE_ENTRIES)} />
      </Box>
    )
  })
}
