import { expect, test } from 'claude-code/testing'

import { parseExplanations } from '../hooks/register'

const PLUGIN = 'command-log'
const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: 'command-log',
  props: {} as never,
} as const

test('logs each Bash command in the pane and the band', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '' } }) as never)

  await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'ls -la', description: 'List project files' })

  for (const surface of SURFACES) {
    const pane = await $.ui.mount({ ...PANE, surface })
    const before = (await pane.find({ key: 'log' }))?.text ?? ''
    expect(before).toContain('ls -la')
    expect(before).toContain('List project files')
    expect(before).toContain('_not summarized yet_')
    await pane.unmount()
  }

  for (const surface of SURFACES) {
    const band = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 } as never,
    })
    expect(await band.find({ key: 'log' })).toBeDefined()
    expect(await band.find({ key: 'summarize' })).toBeDefined()
    await band.unmount()
  }
})

test('reads the summarizer\'s explanations', async () => {
  const found = parseExplanations(
    'Sure:\n[{"id":"t1","why":"To see the files.","what":"ls lists the folder."},{"id":"t2"}]',
  )
  expect(found.get('t1')).toEqual({ why: 'To see the files.', what: 'ls lists the folder.' })
  expect(found.has('t2')).toBe(false)
  expect(parseExplanations('no json here').size).toBe(0)
})
