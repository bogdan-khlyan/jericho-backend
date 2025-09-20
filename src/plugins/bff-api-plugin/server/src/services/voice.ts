// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data')
import type { Core } from '@strapi/strapi'
import axios from 'axios'
import fs from 'fs'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'
const INSTR_UID = 'api::instruction.instruction'
const MEM_UID = 'api::assistants-memory.assistants-memory'

// 🔹 утилита очистки ответа
function cleanAssistantAnswer(raw: string): string {
  if (!raw) return ''
  const firstAssistant = raw.split(/Ассистент:/i)[1] || raw
  return firstAssistant
    .split(/Пользователь:/i)[0] // обрезаем всё после первой вставки "Пользователь:"
    .trim()
}


export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async getInstructions(): Promise<string[]> {
    try {
      const instructions: any[] = await (strapi as any).documents(INSTR_UID).findMany({
        fields: ['id', 'value'],
        limit: 100,
        status: 'published',
      })
      strapi.log.info(`[voice.getInstructions] Loaded ${instructions.length} instructions`)
      return instructions.map((i) => i.value)
    } catch (err) {
      strapi.log.error(
        `[voice.getInstructions] ERROR: ${err instanceof Error ? err.stack : JSON.stringify(err)}`
      )
      return []
    }
  },

  async getMemory(limit = 20): Promise<{ role: string; text: string }[]> {
    try {
      const entries: any[] = await (strapi as any).documents(MEM_UID).findMany({
        fields: ['id', 'role', 'text', 'createdAt'],
        sort: [{ createdAt: 'desc' }],
        limit,
        status: 'published',
      })

      strapi.log.info(`[voice.getMemory] Loaded ${entries.length} entries`)
      entries.forEach((e, i) => {
        strapi.log.info(`[voice.getMemory] #${i + 1}: role=${e.role}, text=${e.text}`)
      })

      return (entries || [])
        .reverse()
        .map((e) => ({ role: e.role, text: e.text }))
    } catch (err) {
      strapi.log.error(
        `[voice.getMemory] ERROR: ${err instanceof Error ? err.stack : JSON.stringify(err)}`
      )
      return []
    }
  },

  async saveMemory(role: 'user' | 'assistant', text: string) {
    try {
      const created = await (strapi as any).documents(MEM_UID).create({
        data: { role, text },
      })
      await (strapi as any).documents(MEM_UID).publish({ documentId: created.documentId })
      strapi.log.info(`[voice.saveMemory] Saved ${role}: ${text}`)
    } catch (err) {
      strapi.log.error(
        `[voice.saveMemory] ERROR: ${err instanceof Error ? err.stack : JSON.stringify(err)}`
      )
    }
  },

  async askVoice(file: any) {
    try {
      // === 1. Speech → Text ===
      const formDataSTT = new FormData()
      formDataSTT.append('file', fs.createReadStream(file.filepath), {
        filename: file.name || 'voice.webm',
        contentType: file.mimetype || 'audio/webm',
      })

      const sttResp = await axios.post(`${PYTHON_API_URL}/speech_to_text`, formDataSTT, {
        headers: formDataSTT.getHeaders(),
        validateStatus: () => true,
      })

      if (sttResp.status !== 200 || !sttResp.data?.text) {
        throw new Error(`Speech-to-text failed: ${sttResp.status}`)
      }
      const userText = sttResp.data.text
      strapi.log.info(`=== STT: ${userText}`)

      // сохраняем в память
      await this.saveMemory('user', userText)

      // === 2. Собираем контекст ===
      const instructions = await this.getInstructions()
      const memory = await this.getMemory(10)

      const history = memory
        .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.text}`)
        .join('\n')

      strapi.log.info('=== Dialogue history built ===')
      strapi.log.info(history || '(память пуста)')

      const prompt = [
        '=== Instructions ===',
        instructions.join('\n'),
        '=== Dialogue history ===',
        history,
        'Ассистент:',
      ]
        .filter(Boolean)
        .join('\n')

      strapi.log.info('=== Prompt sent to LLaMA ===')
      strapi.log.info(prompt)


      // === 3. LLaMA ответ ===
      const llamaResp = await axios.post(`${PYTHON_API_URL}/ask_text`, { text: prompt }, {
        validateStatus: () => true,
      })

      if (llamaResp.status !== 200 || !llamaResp.data?.answer) {
        throw new Error(`LLaMA failed: ${llamaResp.status}`)
      }

      const rawAnswer = llamaResp.data.answer
      const assistantAnswer = cleanAssistantAnswer(rawAnswer)

      strapi.log.info(`=== LLaMA raw answer ===\n${rawAnswer}`)
      strapi.log.info(`=== Clean answer ===\n${assistantAnswer}`)

      // сохраняем в память
      await this.saveMemory('assistant', assistantAnswer)

      // === 4. Text → Speech ===
      const formDataTTS = new FormData()
      formDataTTS.append('text', assistantAnswer)

      const ttsResp = await axios.post(`${PYTHON_API_URL}/text_to_speech`, formDataTTS, {
        headers: formDataTTS.getHeaders(),
        responseType: 'arraybuffer',
        validateStatus: () => true,
      })

      if (ttsResp.status !== 200) {
        throw new Error(`Text-to-speech failed: ${ttsResp.status}`)
      }

      strapi.log.info(`[voice.askVoice] TTS OK, size=${ttsResp.data?.length || 0}`)
      return ttsResp.data
    } catch (err) {
      strapi.log.error(
        `[voice.askVoice] Unexpected error: ${err instanceof Error ? err.stack : JSON.stringify(err)}`
      )
      throw err
    }
  },
})
