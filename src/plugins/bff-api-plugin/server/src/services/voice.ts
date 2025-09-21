// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require("form-data")
import type { Core } from "@strapi/strapi"
import axios from "axios"
import fs from "fs"

import {
  cleanAssistantAnswer,
  buildPrompt,
} from "../utils/assistant"

const AUTH_KEY = "Jakdf8sh3jf88"
const CHAT_ID = "856775414"

const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://localhost:8000"
const INSTR_UID = "api::instruction.instruction"
const MEM_UID = "api::assistants-memory.assistants-memory"

function simpleClean(text: string): string {
  if (!text) return "Извини, я не могу ответить на это."

  let t = text.trim()
  t = t.replace(/^(Assistant:|Output:|Answer:|Часть\s*\d+:)\s*/i, "")
  t = t.replace(/\s+/g, " ")
  if (!t || /^[\.\s]+$/.test(t) || t.length < 3) {
    return "Извини, я не могу ответить на это."
  }
  return t
}

// ====== Локальный детектор команд ======
// ====== Локальный детектор команд ======
function detectLocalCommand(userText: string): string | null {
  const text = userText.trim().toLowerCase()

  const patterns = [
    // Основные вариации имени ассистента
    /^еле[, ]*\s*(сделай|отправь|напиши)/i,
    /^ере[, ]*\s*(сделай|отправь|напиши)/i,
    /^не ери[, ]*\s*(сделай|отправь|напиши)/i,
    /^не ере[, ]*\s*(сделай|отправь|напиши)/i,
    /^гере[, ]*\s*(сделай|отправь|напиши)/i,
    /^пере[, ]*\s*(сделай|отправь|напиши)/i,
    /^ге рин[, ]*\s*(сделай|отправь|напиши)/i,
    /^герин[, ]*\s*(сделай|отправь|напиши)/i,
    /^и рехон[, ]*\s*(сделай|отправь|напиши)/i,
    /^и рехон[, ]*\s*(сделай|отправь|напиши)/i,
    /^иерихон[, ]*\s*(сделай|отправь|напиши)/i,
    /^ирихон[, ]*\s*(сделай|отправь|напиши)/i,
    /^и\s*рихон[, ]*\s*(сделай|отправь|напиши)/i,
    /^иери[, ]*\s*(сделай|отправь|напиши)/i,
    /^ери[, ]*\s*(сделай|отправь|напиши)/i,
    /^ери\s*хон[, ]*\s*(сделай|отправь|напиши)/i,
    /^ере[, ]*\s*(сделай|отправь|напиши)/i,
    /^ере\s*хон[, ]*\s*(сделай|отправь|напиши)/i,
    /^ере\s*хан[, ]*\s*(сделай|отправь|напиши)/i,
    /^ири[, ]*\s*(сделай|отправь|напиши)/i,
    /^ири\s*хон[, ]*\s*(сделай|отправь|напиши)/i,
    /^ири\s*хан[, ]*\s*(сделай|отправь|напиши)/i,

    // Общие команды без имени ассистента
    /^напиши\s+сообщение\s+в\s+телеграм[, ]*/i,
    /^отправ(ь|и)\s+сообщение\s+в\s+телеграм[, ]*/i,
  ]

  for (const p of patterns) {
    if (p.test(text)) {
      const body = text.replace(p, "").trim()
      if (body) {
        return `[COMMAND]TG_MESSAGE:${body}[/COMMAND]`
      }
    }
  }

  return null
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
      return (docs || []).reverse().map((e) => ({ role: e.role, text: e.text }))
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

  // ====== Голос → Текст ======
  async speechToText(file: any): Promise<string> {
    const formData = new FormData()
    formData.append("file", fs.createReadStream(file.filepath), {
      filename: file.name || "voice.webm",
      contentType: file.mimetype || "audio/webm",
    })

    const resp = await axios.post(`${PYTHON_API_URL}/speech_to_text`, formData, {
      headers: formData.getHeaders(),
      validateStatus: () => true,
    })

    strapi.log.info(resp?.data?.text)

    if (resp.status !== 200 || !resp.data?.text) {
      throw new Error(`Speech-to-text failed: ${resp.status}`)
    }

    return resp.data.text
  },

  // ====== Основной запрос к LLaMA ======
  async ask(userText: string) {
    const instructions = await this.getInstructions()
    const memory = await this.getMemory(10)
    const history = memory
      .map((m) => `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.text}`)
      .join(";\n")

    const prompt = buildPrompt(instructions, history, userText)

    strapi.log.info(prompt)
    const resp = await axios.post(
      `${PYTHON_API_URL}/ask_text`,
      { text: prompt },
      { validateStatus: () => true }
    )
    if (resp.status !== 200 || !resp.data?.answer) {
      throw new Error(`LLaMA failed: ${resp.status}`)
    }
    return resp.data.answer
  },

  // ====== Текст → Голос ======
  async textToSpeech(text: string): Promise<Buffer> {
    const formData = new FormData()
    formData.append("text", text)

    const resp = await axios.post(`${PYTHON_API_URL}/text_to_speech`, formData, {
      headers: formData.getHeaders(),
      responseType: "arraybuffer",
      validateStatus: () => true,
    })

    if (resp.status !== 200) {
      throw new Error(`Text-to-speech failed: ${resp.status}`)
    }
    return resp.data
  },

  async sendTelegramMessage(text: string) {
    try {
      const resp = await axios.post(
        "http://localhost:5555/sendMessage",
        {
          chatId: CHAT_ID,
          parseMode: "HTML",
          text: text,
        },
        {
          headers: {
            "x-auth": AUTH_KEY,
            "Content-Type": "application/json",
          },
        }
      )

      console.log("Telegram response:", resp.data)
      return resp.data
    } catch (err) {
      console.error("Failed to send Telegram message:", err)
      throw err
    }
  },

  // ====== Основной пайплайн ======
  async askVoice(file: any) {
    try {
      const userText = await this.speechToText(file)
      strapi.log.info(`[USER TEXT] ${userText}`)
      await this.saveMemory("user", userText)

      // === Локальная проверка на команду ===
      const localCommand = detectLocalCommand(userText)
      strapi.log.info(localCommand)
      strapi.log.info(localCommand)
      strapi.log.info(localCommand)
      strapi.log.info(localCommand)
      if (localCommand) {
        const commandBody = localCommand
          .replace("[COMMAND]TG_MESSAGE:", "")
          .replace("[/COMMAND]", "")
          .trim()

        strapi.log.info(`=== LOCAL COMMAND DETECTED ===`)
        strapi.log.info(`Команда выполняется: ${commandBody}`)

        await this.sendTelegramMessage(commandBody)
        await this.saveMemory("assistant", localCommand)

        const audio = await this.textToSpeech("Уже делаю")
        return audio
      }

      // === Если команда не найдена → идём обычным путём ===
      const assistantText = await this.ask(userText)
      const validationText = simpleClean(assistantText)
      strapi.log.info(validationText)

      await this.saveMemory("assistant", validationText)

      const audio = await this.textToSpeech(validationText)
      return audio
    } catch (err) {
      strapi.log.error(`[askVoice] Unexpected error: ${err}`)
      throw err
    }
  }
})
