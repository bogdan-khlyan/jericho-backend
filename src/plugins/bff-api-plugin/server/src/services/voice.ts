// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data')
import type { Core } from '@strapi/strapi'
import axios from 'axios'
import fs from 'fs'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'
const INSTR_UID = 'api::instruction.instruction'
const MEM_UID = 'api::assistants-memory.assistants-memory'

// 🔹 очистка ответа LLaMA
function cleanAssistantAnswer(raw: string): string {
  if (!raw) return ''
  const firstAssistant = raw.split(/Ассистент:/i)[1] || raw
  return firstAssistant
    .split(/Пользователь:/i)[0]
    .trim()
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  // ====== Служебные методы ======
  async getInstructions(): Promise<string[]> {
    try {
      const docs: any[] = await (strapi as any).documents(INSTR_UID).findMany({
        fields: ['id', 'value'],
        limit: 100,
        status: 'published',
      })
      return docs.map((i) => i.value)
    } catch (err) {
      strapi.log.error(`[voice.getInstructions] ERROR: ${err}`)
      return []
    }
  },

  async getMemory(limit = 20): Promise<{ role: string; text: string }[]> {
    try {
      const docs: any[] = await (strapi as any).documents(MEM_UID).findMany({
        fields: ['id', 'role', 'text', 'createdAt'],
        sort: [{ createdAt: 'desc' }],
        limit,
        status: 'published',
      })
      return (docs || [])
        .reverse()
        .map((e) => ({ role: e.role, text: e.text }))
    } catch (err) {
      strapi.log.error(`[voice.getMemory] ERROR: ${err}`)
      return []
    }
  },

  async saveMemory(role: 'user' | 'assistant', text: string) {
    try {
      const created = await (strapi as any).documents(MEM_UID).create({
        data: { role, text },
      })
      await (strapi as any).documents(MEM_UID).publish({ documentId: created.documentId })
    } catch (err) {
      strapi.log.error(`[voice.saveMemory] ERROR: ${err}`)
    }
  },

  // ====== Шаги пайплайна ======

  // 1. Голос → Текст
  async speechToText(file: any): Promise<string> {
    const formData = new FormData()
    formData.append('file', fs.createReadStream(file.filepath), {
      filename: file.name || 'voice.webm',
      contentType: file.mimetype || 'audio/webm',
    })

    const resp = await axios.post(`${PYTHON_API_URL}/speech_to_text`, formData, {
      headers: formData.getHeaders(),
      validateStatus: () => true,
    })

    if (resp.status !== 200 || !resp.data?.text) {
      throw new Error(`Speech-to-text failed: ${resp.status}`)
    }

    const text = resp.data.text
    strapi.log.info(`[speechToText] ${text}`)
    return text
  },

  // 2. Текст + Контекст → Ответ от LLaMA
  async buildPromptAndAskLlama(userText: string): Promise<string> {
    const instructions = await this.getInstructions()
    const memory = await this.getMemory(10)

    const history = memory
      .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.text}`)
      .join('\n')

    const prompt = [
      '=== Instructions ===',
      instructions.join('\n'),
      '=== Dialogue history ===',
      history,
      `Пользователь: ${userText}`,
      'Ассистент:',
    ].filter(Boolean).join('\n')

    strapi.log.info('=== Prompt sent to LLaMA ===')
    strapi.log.info(prompt)

    const resp = await axios.post(`${PYTHON_API_URL}/ask_text`, { text: prompt }, {
      validateStatus: () => true,
    })

    if (resp.status !== 200 || !resp.data?.answer) {
      throw new Error(`LLaMA failed: ${resp.status}`)
    }

    const rawAnswer = resp.data.answer
    const cleanAnswer = cleanAssistantAnswer(rawAnswer)

    strapi.log.info(`=== LLaMA raw answer ===\n${rawAnswer}`)
    strapi.log.info(`=== Clean answer ===\n${cleanAnswer}`)

    return cleanAnswer
  },

  // 3. Текст → Голос
  async textToSpeech(text: string): Promise<Buffer> {
    const formData = new FormData()
    formData.append('text', text)

    const resp = await axios.post(`${PYTHON_API_URL}/text_to_speech`, formData, {
      headers: formData.getHeaders(),
      responseType: 'arraybuffer',
      validateStatus: () => true,
    })

    if (resp.status !== 200) {
      throw new Error(`Text-to-speech failed: ${resp.status}`)
    }

    strapi.log.info(`[textToSpeech] OK, size=${resp.data?.length || 0}`)
    return resp.data
  },

  // ====== Основной метод ======
  async askVoice(file: any) {
    try {
      const userText = await this.speechToText(file)
      await this.saveMemory('user', userText)

      const assistantText = await this.buildPromptAndAskLlama(userText)
      await this.saveMemory('assistant', assistantText)

      const audio = await this.textToSpeech(assistantText)

      return audio
    } catch (err) {
      strapi.log.error(`[askVoice] Unexpected error: ${err}`)
      throw err
    }
  },
})
