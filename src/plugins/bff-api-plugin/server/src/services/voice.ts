// eslint-disable-next-line @typescript-eslint/no-var-requires
const FormData = require('form-data')
import type { Core } from '@strapi/strapi'
import axios from 'axios'
import fs from 'fs'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000/ask_voice'
const INSTR_UID = 'api::instruction.instruction'

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async askVoice(file: any) {
    try {
      strapi.log.info(`[voice.askVoice] Got file: ${file?.name}, path: ${file?.filepath}, size: ${file?.size}`)

      // --- достаём инструкции ---
      const instructions: any[] = await (strapi as any).documents(INSTR_UID).findMany({
        fields: ['id', 'value'],
        limit: 100,
        status: 'published',
      })

      const allInstructions = instructions.map((i) => i.value).join('\n')
      strapi.log.info(`[voice.askVoice] Loaded ${instructions.length} instructions`)

      const formData = new FormData()
      formData.append('file', fs.createReadStream(file.filepath), {
        filename: file.name || 'voice.webm',
        contentType: file.mimetype || 'audio/webm',
      })

      // 👇 добавляем инструкции в запрос (можно как отдельное поле)
      formData.append('instructions', allInstructions)

      strapi.log.info(`[voice.askVoice] Sending request to ${PYTHON_API_URL}`)

      const response = await axios.post(PYTHON_API_URL, formData, {
        headers: formData.getHeaders(),
        responseType: 'arraybuffer',
        validateStatus: () => true,
      })

      strapi.log.info(`[voice.askVoice] Response status: ${response.status}`)
      strapi.log.info(`[voice.askVoice] Response headers: ${JSON.stringify(response.headers, null, 2)}`)

      if (response.status !== 200) {
        strapi.log.error(`[voice.askVoice] Python API error: ${response.status}`)
        try {
          strapi.log.error(response.data.toString())
        } catch {
          strapi.log.error(`[voice.askVoice] Could not stringify response.data`)
        }
        throw new Error('Python API failed')
      }

      return response.data
    } catch (err) {
      strapi.log.error(`[voice.askVoice] Unexpected error: ${err instanceof Error ? err.stack : JSON.stringify(err)}`)
      throw err
    }
  },
})
