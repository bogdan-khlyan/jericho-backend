// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require("form-data")
import type { Core } from "@strapi/strapi"
import axios from "axios"
import fs from "fs"

import {
  cleanAssistantAnswer,
  buildPrompt,
} from "../utils/assistant"

const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://localhost:8000"
const INSTR_UID = "api::instruction.instruction"
const MEM_UID = "api::assistants-memory.assistants-memory"

function simpleClean(text: string): string {
  if (!text) {
    return "Sorry, I cannot answer that."
  }

  let t = text.trim()
  // убираем типичные служебные префиксы
  t = t.replace(/^(Assistant:|Output:|Answer:|Часть\s*\d+:)\s*/i, "")
  t = t.replace(/\s+/g, " ")

  // если остались только точки, пустота или короткий мусор — отбрасываем
  if (!t || /^[\.\s]+$/.test(t) || t.length < 3) {
    return "Sorry, I cannot answer that."
  }

  return t
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  // ====== Служебные методы ======
  async getInstructions(): Promise<string[]> {
    try {
      const docs: any[] = await (strapi as any).documents(INSTR_UID).findMany({
        fields: ["id", "value"],
        limit: 100,
        status: "published",
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
        fields: ["id", "role", "text", "createdAt"],
        sort: [{ createdAt: "desc" }],
        limit,
        status: "published",
      })
      return (docs || [])
        .reverse()
        .map((e) => ({ role: e.role, text: e.text }))
    } catch (err) {
      strapi.log.error(`[voice.getMemory] ERROR: ${err}`)
      return []
    }
  },

  async saveMemory(role: "user" | "assistant", text: string) {
    try {
      const created = await (strapi as any).documents(MEM_UID).create({
        data: { role, text },
      })
      await (strapi as any).documents(MEM_UID).publish({
        documentId: created.documentId,
      })
    } catch (err) {
      strapi.log.error(`[voice.saveMemory] ERROR: ${err}`)
    }
  },

  // ====== Шаги пайплайна ======

  // 1. Голос → Текст
  async speechToText(file: any): Promise<string> {
    const formData = new FormData()
    formData.append("file", fs.createReadStream(file.filepath), {
      filename: file.name || "voice.webm",
      contentType: file.mimetype || "audio/webm",
    })

    const resp = await axios.post(
      `${PYTHON_API_URL}/speech_to_text`,
      formData,
      {
        headers: formData.getHeaders(),
        validateStatus: () => true,
      }
    )

    if (resp.status !== 200 || !resp.data?.text) {
      throw new Error(`Speech-to-text failed: ${resp.status}`)
    }

    const text = resp.data.text
    strapi.log.info(`[speechToText] ${text}`)
    return text
  },

  // 2. Вопрос → LLaMA
  async ask(userText: string) {
    const instructions = await this.getInstructions()
    const memory = await this.getMemory(10)
    const history = memory
      .map((m) =>
        `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.text}`
      )
      .join(";\n")

    const prompt = buildPrompt(instructions, history, userText)

    strapi.log.info(`=== PROMPT =======`)
    strapi.log.info(prompt)

    const resp = await axios.post(
      `${PYTHON_API_URL}/ask_text`,
      { text: prompt },
      { validateStatus: () => true }
    )
    strapi.log.info(`AAAAAAAAAAAAA`)
    strapi.log.info(`data=${JSON.stringify(resp.data)}`)
    if (resp.status !== 200 || !resp.data?.answer) {
      throw new Error(`LLaMA failed: ${resp.status}`)
    }
    const rawAnswer = resp.data.answer
    const cleanAnswer = cleanAssistantAnswer(rawAnswer)
    strapi.log.info(`=== LLaMA raw answer ===\n${rawAnswer}`)
    strapi.log.info(`=== Clean answer (EN/RU) ===\n${cleanAnswer}`)

    return rawAnswer
  },

  // 3. Текст → Голос
  async textToSpeech(text: string): Promise<Buffer> {
    const formData = new FormData()
    formData.append("text", text)

    const resp = await axios.post(
      `${PYTHON_API_URL}/text_to_speech`,
      formData,
      {
        headers: formData.getHeaders(),
        responseType: "arraybuffer",
        validateStatus: () => true,
      }
    )

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
      await this.saveMemory("user", userText)

      const assistantText = await this.ask(userText)

      // === Поиск команд ===
      const commandRegex = /\[COMMAND\](.*?)\[\/COMMAND\]/gs
      const commands: string[] = []
      let match
      while ((match = commandRegex.exec(assistantText)) !== null) {
        commands.push(match[1].trim())
      }

      if (commands.length > 0) {
        strapi.log.info(`=== COMMANDS DETECTED ===`)
        strapi.log.info(commands)

        for (const cmd of commands) {
          await this.saveMemory("assistant", `[COMMAND]${cmd}[/COMMAND]`)
        }
      }

      // === Чистим текст от команд ===
      let cleanedText = assistantText.replace(commandRegex, "").trim()
      const validationText = simpleClean(cleanedText)

      strapi.log.info("=== Final validated answer ===")
      strapi.log.info(validationText)

      await this.saveMemory("assistant", validationText)

      // Если текста нет (например, только команды) — не озвучиваем
      if (!validationText || validationText === "Sorry, I cannot answer that.") {
        return null
      }

      const audio = await this.textToSpeech(validationText)
      return audio
    } catch (err) {
      strapi.log.error(`[askVoice] Unexpected error: ${err}`)
      throw err
    }
  },
})
