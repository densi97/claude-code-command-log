export type CommandStatus = 'running' | 'ok' | 'failed' | 'denied'

export type CommandEntry = {
  id: string
  command: string
  summary?: string
  why?: string
  what?: string
  status: CommandStatus
  isSubagent: boolean
  isBackground: boolean
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'command-log': {
      commands: CommandEntry[]
      isSummarizing: boolean
    }
  }
}
