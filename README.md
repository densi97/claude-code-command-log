# Command Log

**See every shell command your Claude Code agent runs, and get a plain-language explanation of each one, only when you ask for it.**

Command Log is a Claude Code mod. While the agent works, it quietly records every shell command it runs. When you want to understand what happened, one click explains each command: why the agent ran it at that point in the task, and what it actually does.

```
3 commands run, 3 not summarized · Summarize commands · Command log
```

## Why use it

### No extra tokens unless you ask

Recording commands is free. Command Log makes no model calls, adds nothing to the agent's context and never interrupts the agent while it works. Tokens are spent only when **you** press **Summarize commands**. Even then it's one call per 20 commands, and it reuses the session's prompt cache.

### Understand what the agent did

Agents run many commands quickly, and reading raw shell is hard. Command Log turns each command into an explanation you can follow:

- **Why**: the goal or question the command served in your task, taken from the conversation
- **What it does**: each program, notable flag, pipe and redirect in plain language, and whether the command changes something (files, packages, git state, network) or only reads

That makes it easier to review the agent's work, catch a risky step, learn shell along the way, or explain a session to someone else.

### A complete record

- Every `Bash` call, including those made by subagents and background commands
- The exact command as it ran, its status (✓ ok, ✗ failed, ⊘ denied, ⏳ running) and the time
- An export to Markdown when you want to keep or share the log

## Features

| | |
| --- | --- |
| Line above the prompt | Shows how many commands ran and how many aren't summarized, with **Summarize commands** (`s`) and **Command log** (`c`) |
| Command log pane | Newest first, the last 40 commands, each with its command, status, time, Why and What it does |
| `/commands` | Open the Command log pane |
| `/commands summarize` | Explain every command not yet summarized, then open the pane |
| `/commands export` | Write the whole log to `command-log-<time>.md` in the session's folder |
| `/commands clear` | Clear the log |

Before a command is summarized, the log shows the agent's own one-line description of it.

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install command-log --marketplace densi97/claude-code-command-log
```

Answer `y` to add the marketplace, then pick a scope. The user scope makes it available in every session, including Code tab sessions in the Claude desktop app.

To try it from a local copy without installing:

```bash
claude --plugin-dir /path/to/command-log
```

**Requirements:** Claude Code with mods (function hooks) support, version 2.1.287 or later. Tested on 2.1.295 in the terminal and the desktop app.

## Privacy and permissions

Mods aren't sandboxed, so here is exactly what Command Log does:

- **Reads** the input and result status of `Bash` tool calls. It never changes, delays or blocks a command. If the mod itself fails, the command still runs.
- **Calls the model** (`$.model.fork`) only when you ask for a summary. The call goes to the same model and account as your session and carries no tools. It's told never to repeat secrets, keys or personal data.
- **Writes a file** only when you run `/commands export` or press Export in the pane, and only in the session's own folder.
- Sends nothing anywhere else. The log is kept in memory for the session only.

## Development

```bash
claude plugin validate .
claude plugin test .
```

| Path | Contents |
| --- | --- |
| `hooks/register.tsx` | The mod: logging, summaries, the line above the prompt and the pane |
| `types/index.d.ts` | The session state the mod keeps |
| `tests/` | Tests run by `claude plugin test` |
| `.claude-plugin/plugin.json` | Plugin manifest |
| `.claude-plugin/marketplace.json` | Makes this repository installable as a marketplace |

## License

[MIT](LICENSE)
