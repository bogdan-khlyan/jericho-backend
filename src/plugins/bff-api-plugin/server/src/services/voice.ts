// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data')
import type { Core } from '@strapi/strapi'
import axios from 'axios'
import fs from 'fs'

import {
  cleanAssistantAnswer,
  buildPrompt,
  validateCommand,
} from '../utils/assistant'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'
const INSTR_UID = 'api::instruction.instruction'
const MEM_UID = 'api::assistants-memory.assistants-memory'
const VALID_UID = 'api::assistant-validation.assistant-validation'

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

  async getValidations(): Promise<string[]> {
    try {
      const docs: any[] = await (strapi as any).documents(VALID_UID).findMany({
        fields: ['id', 'rule'],
        limit: 100,
        status: 'published',
      })
      return docs.map((i) => i.rule)
    } catch (err) {
      strapi.log.error(`[voice.getValidations] ERROR: ${err}`)
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

  async ask(userText: string) {
    const instructions = await this.getInstructions()
    const memory = await this.getMemory(10)
    const history = memory
      .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.text}`)
      .join(';\n')

    const prompt = buildPrompt(instructions, history, userText)

    strapi.log.info(`=== PROMPT =======`)
    strapi.log.info(`=== PROMPT =======`)
    strapi.log.info(`=== PROMPT =======`)
    strapi.log.info(`=== PROMPT =======`)
    strapi.log.info(prompt)
    strapi.log.info(`=== PROMPT =======`)
    strapi.log.info(`=== PROMPT =======`)
    strapi.log.info(`=== PROMPT =======`)

    const resp = await axios.post(`${PYTHON_API_URL}/ask_text`, { text: prompt }, { validateStatus: () => true })
    if (resp.status !== 200 || !resp.data?.answer) {
      throw new Error(`LLaMA failed: ${resp.status}`)
    }
    const rawAnswer = resp.data.answer
    const cleanAnswer = cleanAssistantAnswer(rawAnswer)
    strapi.log.info(`=== LLaMA raw answer ===\n${rawAnswer}`)
    strapi.log.info(`=== Clean answer ===\n${cleanAnswer}`)

    return cleanAnswer
  },

  // 2. Текст + Контекст → Ответ от LLaMA
  async buildPromptAndAskLlama(userText: string): Promise<string> {
    const instructions = await this.getInstructions()
    const memory = await this.getMemory(10)
    const history = memory
      .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${m.text}`)
      .join('\n')

    const prompt = buildPrompt(instructions, history, userText)
    strapi.log.info('=== Prompt sent to LLaMA ===')
    strapi.log.info(prompt)

    const resp = await axios.post(`${PYTHON_API_URL}/ask_text`, { text: prompt }, { validateStatus: () => true })
    if (resp.status !== 200 || !resp.data?.answer) {
      throw new Error(`LLaMA failed: ${resp.status}`)
    }
    const rawAnswer = resp.data.answer
    const cleanAnswer = cleanAssistantAnswer(rawAnswer)

    // Валидации
    const validations = await this.getValidations()
    let validated = cleanAnswer
    for (const rule of validations) {
      if (rule.toLowerCase().includes('не говори о погоде')) {
        if (/погод/i.test(validated)) {
          validated = 'Извините, я не могу говорить о погоде.'
        }
      }
    }

    const finalAnswer = await validateCommand(userText, validated)
    strapi.log.info(`=== Final answer ===\n${finalAnswer}`)

    return finalAnswer
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

  async validation(text: string, validations: string[]): Promise<string> {
    try {
      const rules = validations.map((r, i) => `${i + 1}. ${r}`).join('\n')

      const prompt = `
Ты — строгий фильтр.
Правила:
${rules}

Ответ ассистента:
"${text}"

⚡ Формат:
Верни только одну строку:
- Если ответ соответствует всем правилам → верни его без изменений.
- Если нарушает хотя бы одно правило → верни точно: "Извините, я не могу ответить на это."
- Никаких пояснений, примеров, разметки, комментариев.
- Только финальный текст.
`

      const resp = await axios.post(
        `${PYTHON_API_URL}/ask_text`,
        { text: prompt },
        { validateStatus: () => true }
      )

      if (resp.status !== 200 || !resp.data?.answer) {
        throw new Error(`Validation LLaMA failed: ${resp.status}`)
      }

      const validated = resp.data.answer.trim().split('\n')[0] // берём только первую строку
      strapi.log.info(`=== Validation fixed answer ===\n${validated}`)
      return validated
    } catch (err) {
      strapi.log.error(`[voice.validation] ERROR: ${err}`)
      throw err
    }
  },

  // ====== Основной метод ======
  async askVoice(file: any) {
    try {
      const userText = await this.speechToText(file)
      await this.saveMemory('user', userText)

      const assistantText = await this.ask(userText)

      const validations = await this.getValidations()
      const validationText = await this.validation(assistantText, validations)
      strapi.log.info('validationsvalidationsvalidationsvalidations')
      strapi.log.info('validationsvalidationsvalidationsvalidations')
      strapi.log.info('validationsvalidationsvalidationsvalidations')
      strapi.log.info(validationText)
      strapi.log.info('validationsvalidationsvalidationsvalidations')
      strapi.log.info('validationsvalidationsvalidationsvalidations')
      strapi.log.info('validationsvalidationsvalidationsvalidations')
      // const assistantText = await this.buildPromptAndAskLlama(userText)
      // await this.saveMemory('assistant', assistantText)

      const audio = await this.textToSpeech(validationText)
      return audio
    } catch (err) {
      strapi.log.error(`[askVoice] Unexpected error: ${err}`)
      throw err
    }
  },
})
